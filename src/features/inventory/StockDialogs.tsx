import { useState } from 'react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { fmtNum, today } from '../../lib/format'
import { useRefreshMoney } from '../data'
import { useAuth } from '../../auth/AuthContext'
import { toast } from '../../components/toast'

export interface StockItem { id: string; name: string; unit: string; stock: number }
type Mode = 'opening' | 'adjust' | 'damage'
const TITLE: Record<Mode, string> = { opening: 'Record opening stock', adjust: 'Adjust stock', damage: 'Record damaged stock' }

export function StockActionDialog({ kind, mode, item, onClose }: { kind: 'product' | 'material'; mode: Mode; item: StockItem; onClose: () => void }) {
  const refresh = useRefreshMoney(); const { can } = useAuth()
  const [qty, setQty] = useState(''); const [cost, setCost] = useState(''); const [reason, setReason] = useState(''); const [date, setDate] = useState(today())
  const [dir, setDir] = useState<'in' | 'out'>('in'); const [neg, setNeg] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const q = Number(qty) || 0

  async function save() {
    setError('')
    if (!(q > 0)) return setError('Enter a quantity greater than zero.')
    if (mode !== 'opening' && reason.trim().length < 3) return setError('A reason is required.')
    setBusy(true)
    const fn = { product: { opening: 'record_opening_stock', adjust: 'adjust_stock', damage: 'record_damage' }, material: { opening: 'record_material_opening', adjust: 'adjust_material', damage: 'record_material_damage' } }[kind][mode]
    const idKey = kind === 'product' ? 'p_product' : 'p_material'
    const args = mode === 'opening' ? { [idKey]: item.id, p_qty: q, p_unit_cost: Number(cost) || 0, p_date: date }
      : mode === 'damage' ? { [idKey]: item.id, p_qty: q, p_reason: reason, p_date: date }
      : { [idKey]: item.id, p_delta: dir === 'in' ? q : -q, p_reason: reason, p_date: date, p_allow_negative: neg }
    const { error: e } = await supabase.rpc(fn, args)
    setBusy(false)
    if (e) return setError(errMsg(e))
    await refresh(); toast('Stock updated'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={`${TITLE[mode]} — ${item.name}`} footer={<><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <p className="mb-3 text-sm text-slate2-500">Currently in stock: <b className="text-charcoal-900">{fmtNum(item.stock)} {item.unit}</b></p>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'adjust' && <Field label="Direction"><select className="input" value={dir} onChange={(e) => setDir(e.target.value as 'in' | 'out')}><option value="in">Increase stock</option><option value="out">Decrease stock</option></select></Field>}
        <Field label={`Quantity (${item.unit})`}><input className="input" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        {mode === 'opening' && <Field label="Cost per unit (UGX)" hint="Used for stock valuation and cost of goods"><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        <Field label="Date"><input type="date" className="input" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {mode !== 'opening' && <div className="sm:col-span-2"><Field label="Reason (required, audited)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'damage' ? 'e.g. Dropped during loading' : 'e.g. Stock-take count correction'} /></Field></div>}
        {mode === 'adjust' && dir === 'out' && can('inventory', 'edit') && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={neg} onChange={(e) => setNeg(e.target.checked)} />Allow stock to go below zero (will be flagged)</label>}
      </div>
      {mode === 'damage' && <p className="mt-3 text-xs text-slate2-500">Damaged stock leaves inventory at its average cost and is counted as a stock loss.</p>}
      {mode === 'opening' && <p className="mt-3 text-xs text-slate2-500">Use this once, when you start using the system, to enter what you already hold.</p>}
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function MaterialFormDialog({ material, onClose }: { material?: { id: string; name: string; unit: string; min_stock: number; status: string } | null; onClose: () => void }) {
  const refresh = useRefreshMoney()
  const [f, setF] = useState({ name: material?.name ?? '', unit: material?.unit ?? '', min: String(material?.min_stock ?? ''), status: material?.status ?? 'active' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.name.trim() || !f.unit.trim()) return setError('Name and unit are required.')
    setBusy(true); setError('')
    const payload = { name: f.name.trim(), unit: f.unit.trim(), min_stock: Number(f.min) || 0, status: f.status }
    const { error: e } = material ? await supabase.from('raw_materials').update(payload).eq('id', material.id) : await supabase.from('raw_materials').insert(payload)
    setBusy(false)
    if (e) return setError(e.code === '23505' ? 'A material with that name already exists.' : errMsg(e))
    await refresh(); toast('Material saved'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={material ? 'Edit raw material' : 'Add raw material'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Unit"><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="bags, tonnes, litres…" /></Field>
        <Field label="Minimum stock (alert level)"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        {material && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
