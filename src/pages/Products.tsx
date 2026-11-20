import { useState } from 'react'
import { Plus, Search, Boxes, Pencil, Tags } from 'lucide-react'
import { PageHeader, Spinner, ErrorBox, Empty, Modal, Field, Notice, Badge } from '../components/ui'
import { useProducts, useProductCategories } from '../features/commercial/hooks'
import { supabase, errMsg } from '../lib/supabase'
import { fmtUGX } from '../lib/format'
import type { Product } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../components/toast'

export default function Products({ embedded = false }: { embedded?: boolean }) {
  const { data, isLoading, error, refetch } = useProducts(); const cats = useProductCategories(); const { can } = useAuth()
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [edit, setEdit] = useState<Product | 'new' | null>(null); const [catOpen, setCatOpen] = useState(false)
  const list = (data ?? []).filter((p) => (!cat || p.category_id === cat) && (!q || `${p.name} ${p.sku} ${p.dimensions ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      {embedded ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate2-500">Prices set here are copied onto each invoice, so changing a price never alters past sales.</p>
          <div className="flex gap-2">{can('inventory', 'edit') && <button className="btn-ghost" onClick={() => setCatOpen(true)}><Tags size={15} />Categories</button>}{can('inventory', 'create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Add product</button>}</div></div>
      ) : (
        <PageHeader title="Products" subtitle="Product catalogue and price list" actions={<>{can('inventory', 'edit') && <button className="btn-ghost" onClick={() => setCatOpen(true)}><Tags size={15} />Categories</button>}{can('inventory', 'create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus size={16} />Add product</button>}</>} />
      )}
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (list.length === 0 ? <div className="card"><Empty icon={<Boxes size={22} />} title="No products yet">Add your blocks, pavers and other products with their selling prices. Nothing is pre-filled — enter your real sizes and prices.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[640px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Product</th><th className="th">Category</th><th className="th">Size</th><th className="th">Unit</th><th className="th text-right">Selling price</th><th className="th text-right">Est. cost</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate2-100">{list.map((p) => (
            <tr key={p.id}><td className="td"><p className="font-medium">{p.name} {p.status === 'inactive' && <Badge>Inactive</Badge>}</p><p className="font-mono text-xs text-slate2-500">{p.sku}</p></td><td className="td">{p.product_categories?.name ?? '—'}</td><td className="td">{p.dimensions ?? '—'}</td><td className="td">{p.unit}</td>
              <td className="td num font-medium">{fmtUGX(p.selling_price)}</td><td className="td num text-slate2-500">{p.production_cost_estimate ? fmtUGX(p.production_cost_estimate) : '—'}</td>
              <td className="td text-right">{can('inventory', 'edit') && <button aria-label={`Edit ${p.name}`} className="rounded p-1.5 text-slate2-500 hover:bg-slate2-100" onClick={() => setEdit(p)}><Pencil size={15} /></button>}</td></tr>))}</tbody></table></div>))}
      {edit && <ProductForm product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
    </>
  )
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const cats = useProductCategories(); const qc = useQueryClient()
  const [f, setF] = useState({ sku: product?.sku ?? '', name: product?.name ?? '', category: product?.category_id ?? '', dims: product?.dimensions ?? '', desc: product?.description ?? '', unit: product?.unit ?? 'pieces', price: String(product?.selling_price ?? ''), cost: String(product?.production_cost_estimate ?? ''), min: String(product?.min_stock ?? ''), status: product?.status ?? 'active' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    if (!f.sku.trim() || !f.name.trim()) return setError('SKU and name are required.')
    setBusy(true); setError('')
    const payload = { sku: f.sku.trim(), name: f.name.trim(), category_id: f.category || null, dimensions: f.dims.trim() || null, description: f.desc.trim() || null, unit: f.unit, selling_price: Number(f.price) || 0, production_cost_estimate: Number(f.cost) || 0, min_stock: Number(f.min) || 0, status: f.status }
    const { error: e } = product ? await supabase.from('products').update(payload).eq('id', product.id) : await supabase.from('products').insert(payload)
    setBusy(false)
    if (e) return setError(e.code === '23505' ? 'That SKU is already used.' : errMsg(e))
    await qc.invalidateQueries({ queryKey: ['products'] }); toast('Product saved'); onClose()
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onClose={onClose} wide title={product ? 'Edit product' : 'Add product'} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product name"><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field><Field label="SKU / code"><input className="input" value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={set('category')}><option value="">—</option>{(cats.data ?? []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Dimensions / size"><input className="input" value={f.dims} onChange={set('dims')} placeholder="e.g. 6 inch, 200×100×60 mm" /></Field>
        <Field label="Unit"><select className="input" value={f.unit} onChange={set('unit')}>{['pieces', 'units', 'bundles'].map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Selling price (UGX)"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Production cost estimate (UGX)" hint="Replaced by actual batch costs in Phase 3"><input className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Minimum stock threshold"><input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        {product && <Field label="Status"><select className="input" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>}
        <div className="sm:col-span-2"><Field label="Description"><textarea className="input" rows={2} value={f.desc} onChange={set('desc')} /></Field></div>
      </div>
      {error && <div className="mt-3"><Notice tone="red">{error}</Notice></div>}
    </Modal>
  )
}

function CategoryManager({ onClose }: { onClose: () => void }) {
  const cats = useProductCategories(); const qc = useQueryClient(); const [name, setName] = useState(''); const [error, setError] = useState('')
  const reload = () => qc.invalidateQueries({ queryKey: ['product_categories'] })
  async function add() { if (!name.trim()) return; const { error: e } = await supabase.from('product_categories').insert({ name: name.trim(), sort_order: 500 }); if (e) return setError(e.code === '23505' ? 'Already exists.' : errMsg(e)); setName(''); setError(''); reload() }
  async function toggle(id: string, v: boolean) { const { error: e } = await supabase.from('product_categories').update({ is_active: v }).eq('id', id); if (e) setError(errMsg(e)); else reload() }
  return (
    <Modal open onClose={onClose} title="Product categories" footer={<button className="btn-dark" onClick={onClose}>Done</button>}>
      <div className="mb-3 flex gap-2"><input className="input" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary shrink-0" onClick={add}>Add</button></div>
      {error && <Notice tone="red">{error}</Notice>}
      <ul className="divide-y divide-slate2-100">{(cats.data ?? []).map((c) => <li key={c.id} className="flex items-center justify-between py-2 text-sm"><span className={c.is_active ? '' : 'text-slate2-400 line-through'}>{c.name}</span><button className="text-xs font-semibold text-brand-600" onClick={() => toggle(c.id, !c.is_active)}>{c.is_active ? 'Deactivate' : 'Activate'}</button></li>)}</ul>
    </Modal>
  )
}
