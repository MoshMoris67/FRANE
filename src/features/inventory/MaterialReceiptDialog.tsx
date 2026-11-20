import { useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useRawMaterials, useSupplierList } from '../commercial/hooks'
import { useAccounts, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtUGX, today } from '../../lib/format'
import { toast } from '../../components/toast'

interface Line { key: string; material: string; qty: string; total: string }
const blank = (): Line => ({ key: crypto.randomUUID(), material: '', qty: '', total: '' })
const n = (s: string) => Number(s.replace(/,/g, '')) || 0

export default function MaterialReceiptDialog({ supplierId, onClose }: { supplierId?: string; onClose: () => void }) {
  const materials = useRawMaterials(); const suppliers = useSupplierList(); const accounts = useAccounts(); const settings = useSettings(); const refresh = useRefreshMoney(); const { can } = useAuth()
  const [supplier, setSupplier] = useState(supplierId ?? ''); const [date, setDate] = useState(today()); const [invNo, setInvNo] = useState(''); const [due, setDue] = useState(''); const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()]); const [payNow, setPayNow] = useState(false); const [pay, setPay] = useState({ account: '', amount: '', method: '', ref: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const key = useRef(crypto.randomUUID())
  const mats = (materials.data ?? []).filter((m) => m.status === 'active')
  const total = lines.reduce((s, l) => s + n(l.total), 0)
  const canPay = can('suppliers', 'create')
  const set = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)))

  async function save() {
    setError('')
    if (!supplier) return setError('Select the supplier.')
    const valid = lines.filter((l) => l.material || l.qty || l.total)
    if (valid.length === 0) return setError('Add at least one material.')
    for (const [i, l] of valid.entries()) if (!l.material || !(n(l.qty) > 0) || !(n(l.total) > 0)) return setError(`Line ${i + 1}: choose the material, quantity and total cost.`)
    if (payNow && (!pay.account || !(n(pay.amount) > 0))) return setError('Choose the paying account and amount, or untick “pay now”.')
    setBusy(true)
    const { error: e } = await supabase.rpc('record_material_purchase', {
      p_supplier: supplier, p_date: date, p_invoice_no: invNo || null, p_due: due || null, p_notes: notes || null, p_idempotency_key: key.current,
      p_lines: valid.map((l) => ({ material_id: l.material, quantity: n(l.qty), line_total: n(l.total) })),
      p_payment: payNow ? { account_id: pay.account, amount: n(pay.amount), method: pay.method || null, reference: pay.ref || null } : null,
    })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Materials received and stocked'); onClose()
  }

  return (
    <Modal open onClose={onClose} wide title="Receive materials" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Receive into stock'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier"><select className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={!!supplierId}><option value="">Select…</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Supplier invoice / delivery note no."><input className="input" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Field>
        <Field label="Date received"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Payment due" hint="Default: supplier credit terms"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((l, i) => {
          const m = mats.find((x) => x.id === l.material)
          return (
            <div key={l.key} className="grid gap-2 rounded-lg border border-slate2-200 p-3 sm:grid-cols-12">
              <div className="sm:col-span-5"><span className="label">Material</span><select className="input" value={l.material} onChange={(e) => set(l.key, { material: e.target.value })}><option value="">Select…</option>{mats.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div>
              <div className="sm:col-span-3"><span className="label">Quantity{m ? ` (${m.unit})` : ''}</span><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })} /></div>
              <div className="sm:col-span-3"><span className="label">Total cost (UGX)</span><input className="input" inputMode="decimal" value={l.total} onChange={(e) => set(l.key, { total: e.target.value.replace(/[^\d.,]/g, '') })} />
                {n(l.qty) > 0 && n(l.total) > 0 && <span className="mt-0.5 block text-[11px] text-slate2-500">{fmtUGX(Math.round(n(l.total) / n(l.qty)))} per {m?.unit ?? 'unit'}</span>}</div>
              <div className="flex items-end justify-end sm:col-span-1">{lines.length > 1 && <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded p-2 text-slate2-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>}</div>
            </div>)
        })}
        <button type="button" className="btn-ghost" onClick={() => setLines((l) => [...l, blank()])}><Plus size={15} />Add material</button>
      </div>
      <p className="mt-3 text-right text-sm">Invoice total: <b className="tabular-nums">{fmtUGX(total)}</b></p>
      <div className="mt-2"><Field label="Notes (optional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      {canPay && <>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={payNow} onChange={(e) => { setPayNow(e.target.checked); if (e.target.checked && !pay.amount) setPay({ ...pay, amount: String(total || '') }) }} />Pay (part of) it now</label>
        {payNow && <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Paid from account"><select className="input" value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
          <Field label="Amount paid now"><input className="input" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
          <Field label="Method"><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input className="input" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></Field></div>}</>}
      <p className="mt-3 text-xs text-slate2-500">Receiving adds stock at this cost (blended into the average) and creates an amount owed to the supplier. It is not an expense — the cost reaches profit only when the material is used in production and the goods are sold.</p>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
