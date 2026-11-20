import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg, isDuplicate } from '../../lib/supabase'
import { useAccounts, useCategories, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtUGX, today } from '../../lib/format'
import type { Attachment } from '../../lib/types'
import { toast } from '../../components/toast'

export default function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const cats = useCategories(); const accounts = useAccounts(); const settings = useSettings(); const refresh = useRefreshMoney(); const { can } = useAuth()
  const [f, setF] = useState({ date: today(), category: '', desc: '', amount: '', payee: '', notes: '' })
  const [pay, setPay] = useState<'none' | 'full' | 'part'>('none'); const [p, setP] = useState({ account: '', amount: '', method: '', ref: '' }); const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [dupe, setDupe] = useState(false); const key = useRef(crypto.randomUUID())
  const amount = Number(f.amount.replace(/,/g, '')) || 0; const canPay = can('transactions', 'create')
  const acct = accounts.data?.find((a) => a.id === p.account)

  async function save(force = false) {
    setError('')
    if (!f.category) return setError('Choose a category.'); if (!f.desc.trim()) return setError('Describe the expense.'); if (!(amount > 0)) return setError('Enter the amount.')
    const paying = pay === 'full' ? amount : pay === 'part' ? Number(p.amount.replace(/,/g, '')) || 0 : 0
    if (pay !== 'none' && (!p.account || !(paying > 0))) return setError('Choose the paying account and amount.')
    if (paying > amount) return setError('Payment cannot exceed the expense amount.')
    setBusy(true)
    const uploaded: Attachment[] = []
    try {
      for (const file of files) {
        const path = `${f.date.slice(0, 4)}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
        const { error: ue } = await supabase.storage.from('attachments').upload(path, file); if (ue) throw ue
        uploaded.push({ path, name: file.name })
      }
      const { data, error: e } = await supabase.rpc('record_expense', {
        p_date: f.date, p_category: f.category, p_description: f.desc, p_amount: amount, p_payee: f.payee || null, p_notes: f.notes || null, p_attachments: uploaded,
        p_payment: pay !== 'none' ? { account_id: p.account, amount: paying, method: p.method || null, reference: p.ref || null } : null, p_idempotency_key: key.current, p_force: force,
      })
      if (e) throw e
      const r = data as { approval_status: string; payment_skipped?: boolean }
      await refresh()
      toast(r.approval_status === 'pending' ? 'Expense recorded — awaiting approval' : 'Expense recorded')
      if (r.payment_skipped) toast('Payment not made: approve the expense first')
      onClose()
    } catch (e) {
      if (uploaded.length) void supabase.storage.from('attachments').remove(uploaded.map((u) => u.path))
      if (isDuplicate(e)) setDupe(true); else setError(errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} wide title="Record expense" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={() => save()} disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date"><input type="date" className="input" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Amount (UGX)" hint={amount > 0 ? fmtUGX(amount) : undefined}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Select…</option>
          {(cats.data ?? []).filter((c) => c.kind === 'expense' && c.is_active).map((c) => <option key={c.id} value={c.id} disabled={c.tracks_inventory}>{c.name}{c.tracks_inventory ? ' — use Receive materials' : ''}</option>)}</select></Field>
        <Field label="Paid to / recipient"><input className="input" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} placeholder="Person or business" /></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder="e.g. Electricity bill — November" /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes (optional)"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="sm:col-span-2">
          <span className="label">Receipt / supporting documents</span>
          <label className="btn-ghost cursor-pointer"><Paperclip size={14} />Add files<input type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} /></label>
          {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((x, i) => <li key={i} className="flex items-center justify-between rounded bg-slate2-100 px-2 py-1 text-xs"><span className="truncate">{x.name}</span><button onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label="Remove file"><X size={14} /></button></li>)}</ul>}
        </div>
      </div>
      {canPay && (
        <div className="mt-4 rounded-lg border border-slate2-200 p-3">
          <p className="label">Payment</p>
          <div className="inline-flex rounded-md bg-slate2-100 p-0.5 text-sm font-semibold">{([['none', 'Not paid yet'], ['full', 'Paid in full'], ['part', 'Part-paid']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setPay(k)} className={`rounded px-3 py-1.5 ${pay === k ? 'bg-white shadow-card' : 'text-slate2-500'}`}>{l}</button>)}</div>
          {pay !== 'none' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Paid from account" hint={acct ? `Balance ${fmtUGX(acct.current_balance)}` : undefined}><select className="input" value={p.account} onChange={(e) => setP({ ...p, account: e.target.value })}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              {pay === 'part' && <Field label="Amount paid now"><input className="input" inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>}
              <Field label="Method"><select className="input" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Reference"><input className="input" value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} /></Field>
            </div>)}
          <p className="mt-2 text-xs text-slate2-500">The expense counts as incurred when recorded. Money leaves the account only for the part you pay; the rest stays owing and can be paid later.</p>
        </div>)}
      <div className="mt-3 space-y-2">
        {dupe && <Notice tone="amber"><p className="font-semibold">Possible duplicate</p><p>An identical expense (same date, category, amount and description) already exists.</p><div className="mt-2 flex gap-2"><button className="btn-dark !py-1" onClick={() => { setDupe(false); void save(true) }}>Yes, save anyway</button><button className="btn-ghost !py-1" onClick={() => setDupe(false)}>Cancel</button></div></Notice>}
        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </Modal>
  )
}
