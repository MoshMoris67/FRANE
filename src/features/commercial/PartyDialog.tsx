import { useState } from 'react'
import { Modal, Field, Notice } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { CUSTOMER_TYPE_LABEL, type CustomerBalance, type CustomerType, type SupplierBalance } from '../../lib/types'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'

export function CustomerDialog({ customer, onClose, onSaved }: { customer?: CustomerBalance | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', location: customer?.location ?? '', type: (customer?.customer_type ?? 'individual') as CustomerType, notes: customer?.notes ?? '', status: customer?.status ?? 'active' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.name.trim()) return setError('Enter the customer name.')
    setBusy(true); setError('')
    const payload = { name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, location: f.location.trim() || null, customer_type: f.type, notes: f.notes.trim() || null, status: f.status }
    const res = customer ? await supabase.from('customers').update(payload).eq('id', customer.id).select('id').single() : await supabase.from('customers').insert(payload).select('id').single()
    setBusy(false)
    if (res.error) return setError(errMsg(res.error))
    await qc.invalidateQueries(); toast(customer ? 'Customer updated' : 'Customer added'); onSaved?.(res.data.id); onClose()
  }
  return (
    <Modal open onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email (optional)"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Customer type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomerType })}>{(Object.keys(CUSTOMER_TYPE_LABEL) as CustomerType[]).map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABEL[t]}</option>)}</select></Field>
        {customer && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
        <div className="sm:col-span-2"><Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

export function SupplierDialog({ supplier, onClose }: { supplier?: SupplierBalance | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: supplier?.name ?? '', contact: supplier?.contact_person ?? '', phone: supplier?.phone ?? '', location: supplier?.location ?? '', materials: supplier?.supplied_materials ?? '', notes: supplier?.notes ?? '', status: supplier?.status ?? 'active' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.name.trim()) return setError('Enter the supplier name.')
    setBusy(true); setError('')
    const payload = { name: f.name.trim(), contact_person: f.contact.trim() || null, phone: f.phone.trim() || null, location: f.location.trim() || null, supplied_materials: f.materials.trim() || null, notes: f.notes.trim() || null, status: f.status }
    const res = supplier ? await supabase.from('suppliers').update(payload).eq('id', supplier.id) : await supabase.from('suppliers').insert(payload)
    setBusy(false)
    if (res.error) return setError(errMsg(res.error))
    await qc.invalidateQueries(); toast(supplier ? 'Supplier updated' : 'Supplier added'); onClose()
  }
  return (
    <Modal open onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Contact person"><input className="input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Supplies (materials)"><input className="input" value={f.materials} onChange={(e) => setF({ ...f, materials: e.target.value })} placeholder="Cement, sand, aggregate…" /></Field>
        {supplier && <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
        <div className="sm:col-span-2"><Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}
