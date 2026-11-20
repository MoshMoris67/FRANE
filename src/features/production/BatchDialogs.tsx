import { useState } from 'react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { useProducts, useRawMaterials } from '../commercial/hooks'
import { useAccounts, useCategories, useRefreshMoney, useSettings } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { fmtNum, fmtUGX, today } from '../../lib/format'
import { toast } from '../../components/toast'

export function NewBatchDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const products = useProducts(); const refresh = useRefreshMoney()
  const [f, setF] = useState({ product: '', date: today(), qty: '', supervisor: '', notes: '', start: true }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.product) return setError('Select the product.'); if (!(Number(f.qty) > 0)) return setError('Enter the planned quantity.')
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('create_batch', { p_product: f.product, p_date: f.date, p_qty_planned: Number(f.qty), p_supervisor: f.supervisor || null, p_notes: f.notes || null, p_start: f.start })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Batch created'); onCreated(data as string)
  }
  const p = products.data?.find((x) => x.id === f.product)
  return (
    <Modal open onClose={onClose} title="New production batch" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Create batch'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Product"><select className="input" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="">Select…</option>{(products.data ?? []).filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name}{x.dimensions ? ` ${x.dimensions}` : ''}</option>)}</select></Field></div>
        <Field label="Production date"><input type="date" className="input" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={`Planned quantity${p ? ` (${p.unit})` : ''}`}><input className="input" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <div className="sm:col-span-2"><Field label="Supervisor"><input className="input" value={f.supervisor} onChange={(e) => setF({ ...f, supervisor: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.start} onChange={(e) => setF({ ...f, start: e.target.checked })} />Start production now (needed before recording materials)</label>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function AddMaterialDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const materials = useRawMaterials(); const refresh = useRefreshMoney(); const { can } = useAuth()
  const [mat, setMat] = useState(''); const [qty, setQty] = useState(''); const [neg, setNeg] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const m = materials.data?.find((x) => x.id === mat); const q = Number(qty) || 0
  async function save() {
    if (!mat || !(q > 0)) return setError('Select the material and quantity.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('add_batch_material', { p_batch: batchId, p_material: mat, p_qty: q, p_allow_negative: neg })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Material recorded'); onClose()
  }
  return (
    <Modal open onClose={onClose} title="Record material used" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record usage'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Material"><select className="input" value={mat} onChange={(e) => setMat(e.target.value)}><option value="">Select…</option>{(materials.data ?? []).filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name} — {fmtNum(x.current_stock)} {x.unit} in stock</option>)}</select></Field></div>
        <Field label={`Quantity used${m ? ` (${m.unit})` : ''}`}><input className="input" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <div className="self-end text-sm text-slate2-600">{m && q > 0 && <>Cost at average: <b>{fmtUGX(Math.round(q * m.unit_cost))}</b>{m.unit_cost === 0 && <span className="block text-xs text-amber-700">No cost recorded for this material — it will count as zero.</span>}</>}</div>
        {m && q > m.current_stock && can('inventory', 'edit') && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={neg} onChange={(e) => setNeg(e.target.checked)} />Stock is short — allow negative stock (flagged)</label>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function AddCostDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const refresh = useRefreshMoney(); const { can } = useAuth(); const accounts = useAccounts(); const cats = useCategories(); const settings = useSettings()
  const [f, setF] = useState({ kind: 'labour' as 'labour' | 'other', desc: '', worker: '', amount: '' }); const [payNow, setPayNow] = useState(false); const [pay, setPay] = useState({ account: '', category: '', method: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const canPay = can('transactions', 'create')
  async function save() {
    if (!f.desc.trim()) return setError('Describe the cost.'); if (!(Number(f.amount) > 0)) return setError('Enter the amount.')
    if (payNow && (!pay.account || !pay.category)) return setError('Choose the account and expense category to pay from.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('add_batch_cost', { p_batch: batchId, p_kind: f.kind, p_description: f.desc, p_amount: Number(f.amount), p_worker: f.worker || null, p_payment: payNow ? { account_id: pay.account, category_id: pay.category, method: pay.method || null } : null })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Cost recorded'); onClose()
  }
  return (
    <Modal open onClose={onClose} title="Add production cost" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add cost'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'labour' | 'other' })}><option value="labour">Labour</option><option value="other">Other production cost</option></select></Field>
        <Field label="Amount (UGX)"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><input className="input" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} placeholder="e.g. Block makers — 3 workers" /></Field></div>
        {f.kind === 'labour' && <div className="sm:col-span-2"><Field label="Worker / team (optional)"><input className="input" value={f.worker} onChange={(e) => setF({ ...f, worker: e.target.value })} /></Field></div>}
        {canPay && <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />Already paid — record the cash payment now</label>}
        {payNow && <>
          <Field label="Paid from"><select className="input" value={pay.account} onChange={(e) => setPay({ ...pay, account: e.target.value })}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
          <Field label="Expense category"><select className="input" value={pay.category} onChange={(e) => setPay({ ...pay, category: e.target.value })}><option value="">Select…</option>{(cats.data ?? []).filter((c) => c.kind === 'expense' && c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Method"><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="">—</option>{(settings.data?.payment_methods ?? []).map((m) => <option key={m}>{m}</option>)}</select></Field></>}
      </div>
      <p className="mt-3 text-xs text-slate2-500">The cost counts toward this batch whether or not it is paid yet. Cash paid is recorded in the cashbook; it is part of the product’s cost, not a separate operating expense.</p>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function PayCostDialog({ costId, amount, onClose }: { costId: string; amount: number; onClose: () => void }) {
  const refresh = useRefreshMoney(); const accounts = useAccounts(); const cats = useCategories()
  const [acc, setAcc] = useState(''); const [cat, setCat] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!acc || !cat) return setError('Choose the account and category.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('pay_batch_cost', { p_cost: costId, p_account: acc, p_category: cat })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Cost paid'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Pay ${fmtUGX(amount)}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Paying…' : 'Pay now'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid from"><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select…</option>{(accounts.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name} ({fmtUGX(a.current_balance)})</option>)}</select></Field>
        <Field label="Expense category"><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Select…</option>{(cats.data ?? []).filter((c) => c.kind === 'expense' && c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function CompleteBatchDialog({ batchId, planned, totalCost, unit, onClose }: { batchId: string; planned: number; totalCost: number; unit: string; onClose: () => void }) {
  const refresh = useRefreshMoney()
  const [produced, setProduced] = useState(String(planned)); const [rejected, setRejected] = useState('0'); const [date, setDate] = useState(today()); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const p = Number(produced) || 0; const r = Number(rejected) || 0; const acc = p - r
  async function save() {
    if (!(p > 0)) return setError('Enter the quantity produced.'); if (r < 0 || r > p) return setError('Rejected must be between 0 and produced.')
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('complete_batch', { p_id: batchId, p_produced: p, p_rejected: r, p_date: date })
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Batch completed — finished goods stocked'); onClose()
  }
  return (
    <Modal open onClose={onClose} title="Complete batch" footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Completing…' : 'Confirm & add to stock'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Actually produced (${unit})`} hint={`Planned: ${fmtNum(planned)}`}><input className="input" inputMode="decimal" autoFocus value={produced} onChange={(e) => setProduced(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="Damaged / rejected"><input className="input" inputMode="decimal" value={rejected} onChange={(e) => setRejected(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="Completion date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="rounded-md bg-slate2-100 p-3 text-sm"><p>Accepted into stock: <b>{fmtNum(Math.max(0, acc))}</b></p><p>Batch cost: <b>{fmtUGX(totalCost)}</b></p><p>Cost per unit: <b>{acc > 0 ? fmtUGX(Math.round(totalCost / acc)) : '—'}</b></p></div>
      </div>
      {totalCost === 0 && <div className="mt-3"><Notice tone="amber">No materials or costs have been recorded, so these goods will enter stock at zero cost and profit will be overstated. Add the materials and labour first if you can.</Notice></div>}
      <p className="mt-3 text-xs text-slate2-500">Completed batches are locked. Rejected units are absorbed into the cost of the accepted ones.</p>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
