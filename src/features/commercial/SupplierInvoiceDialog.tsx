import { useRef, useState } from 'react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useAccounts, useCategories, useRefreshMoney, useSettings } from '../data'
import { fmtUGX, today } from '../../lib/format'
import { addDays } from '../../lib/dates'
import { toast } from '../../components/toast'

export default function SupplierInvoiceDialog({ supplierId, supplierName, onClose }: { supplierId: string; supplierName: string; onClose: () => void }) {
  const accounts = useAccounts(); const cats = useCategories(); const settings = useSettings(); const refresh = useRefreshMoney()
  const [f, setF] = useState({ no: '', date: today(), due: '', kind: 'expense' as const, category: '', desc: '', amount: '', notes: '' })
  const [payNow, setPayNow] = useState(false); const [pay, setPay] = useState({ account: '', amount: '', method: '', ref: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const key = useRef(crypto.randomUUID())
  const amount = Number(f.amount.replace(/,/g, '')) || 0
  const days = settings.data?.credit_terms.supplier_days ?? 30
  const due = f.due || addDays(f.date, days)

  async function save() {
    setError('')
    if (!(amount > 0)) return setError('Enter the invoice amount.')
    if (!f.desc.trim()) return setError('Enter a description.')
    if (f.kind === 'expense' && !f.category) return setError('Choose the expense category.')
    if (payNow && (!pay.account || !(Number(pay.amount.replace(/,/g, '')) > 0))) return setError('Choose the paying account and amount, or untick “pay now”.')
    setBusy(true)
    const { error: e } = await supabase.rpc('record_supplier_invoice', {
      p_supplier_id: supplierId, p_invoice_no: f.no || null, p_date: f.date, p_due_date: f.due || null, p_kind: f.kind, p_category_id: f.kind === 'expense' ? f.category : null,
      p_description: f.desc, p_amount: amount, p_notes: f.notes || null, p_attachments: [],
      p_payment: payNow ? { account_id: pay.account, amount: Number(pay.amount.replace(/,/g, '')), method: pay.method || null, reference: pay.ref || null } : null, p_idempotency_key: key.current,
    })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Supplier invoice recorded'); onClose()
  }
  return (
    <Modal open onClose={onClose} wide title={`New expense invoice — ${supplierName}`} footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Expense category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Select…</option>{(cats.data ?? []).filter((c) => c.kind === 'expense' && c.is_active && !c.tracks_inventory).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <p className="mt-1 text-xs text-slate2-500">For services and running costs (power, transport, repairs). Buying cement, sand or aggregate? Use <b>Receive materials</b> instead so stock is costed once, when used.</p></div>
        <Field label="Supplier's invoice no. (optional)"><input className="input" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })} /></Field>
        <Field label="Amount (UGX)" hint={amount > 0 ? fmtUGX(amount) : undefined}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
        <Field label="Invoice date"><input type="date" className="input" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Due date" hint={`Default: ${days} days after invoice`}><input type="date" className="input" value={f.due} placeholder={due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder="e.g. 100 bags cement" /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes (optional)"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={payNow} onChange={(e) => { setPayNow(e.target.checked); if (e.target.checked && !pay.amount) setPay({ ...pay, amount: f.amount }) }} />Pay (part of) it now</label>
        {payNow && <>
          <Field label="Paid from account"><select className="input" value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
          <Field label="Amount paid now"><input className="input" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.,]/g, '') })} /></Field>
          <Field label="Method"><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input className="input" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} /></Field></>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
