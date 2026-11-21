import { useState } from 'react'
import clsx from 'clsx'
import { Boxes, Package, Plus, Pencil, History } from 'lucide-react'
import { PageHeader, Spinner, ErrorBox, Empty, Badge, Modal } from '../components/ui'
import { useProducts, useRawMaterials, useSupplierList } from '../features/commercial/hooks'
import { StockActionDialog, MaterialFormDialog, type StockItem } from '../features/inventory/StockDialogs'
import MaterialReceiptDialog from '../features/inventory/MaterialReceiptDialog'
import MovementsTab from '../features/inventory/MovementsTab'
import Products from './Products'
import { fmtNum, fmtUGX } from '../lib/format'
import { useAuth } from '../auth/AuthContext'
import type { RawMaterial } from '../lib/types'

type Tab = 'goods' | 'materials' | 'movements' | 'catalogue'

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="card p-3"><p className="text-[11px] font-semibold text-slate2-500">{label}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl', tone)}>{value}</p></div>
}

export default function Inventory() {
  const { can } = useAuth(); const [tab, setTab] = useState<Tab>('goods')
  const products = useProducts(); const materials = useRawMaterials(); useSupplierList()
  const [act, setAct] = useState<{ kind: 'product' | 'material'; mode: 'opening' | 'adjust' | 'damage'; item: StockItem } | null>(null)
  const [hist, setHist] = useState<{ kind: 'product' | 'material'; id: string; name: string } | null>(null)
  const [receipt, setReceipt] = useState(false); const [matForm, setMatForm] = useState<RawMaterial | 'new' | null>(null)

  const goods = (products.data ?? []).filter((p) => p.status === 'active'); const mats = materials.data ?? []
  const goodsValue = goods.reduce((s, p) => s + Math.max(0, p.current_stock) * p.avg_cost, 0); const matValue = mats.reduce((s, m) => s + Math.max(0, m.current_stock) * m.unit_cost, 0)
  const lowGoods = goods.filter((p) => p.min_stock > 0 && p.current_stock <= p.min_stock).length; const lowMats = mats.filter((m) => m.status === 'active' && m.min_stock > 0 && m.current_stock <= m.min_stock).length
  const tabs: [Tab, string][] = [['goods', 'Finished goods'], ['materials', 'Raw materials'], ['movements', 'Stock movements'], ['catalogue', 'Catalogue & prices']]
  const canAdd = can('inventory', 'create')

  const rowActions = (kind: 'product' | 'material', item: StockItem) => (
    <div className="flex justify-end gap-1 text-xs font-semibold">
      {canAdd && <button className="rounded px-1.5 py-1 text-brand-600 hover:bg-brand-50" onClick={() => setAct({ kind, mode: 'opening', item })}>Opening</button>}
      {can('inventory', 'edit') && <button className="rounded px-1.5 py-1 text-brand-600 hover:bg-brand-50" onClick={() => setAct({ kind, mode: 'adjust', item })}>Adjust</button>}
      {canAdd && <button className="rounded px-1.5 py-1 text-red-600 hover:bg-red-50" onClick={() => setAct({ kind, mode: 'damage', item })}>Damage</button>}
      <button aria-label={`History of ${item.name}`} className="rounded p-1 text-slate2-500 hover:bg-slate2-100" onClick={() => setHist({ kind, id: item.id, name: item.name })}><History size={15} /></button>
    </div>
  )

  return (
    <>
      <PageHeader title="Inventory & Products" subtitle="Finished goods, raw materials and a full movement ledger — stock changes only through recorded movements"
        actions={<>{canAdd && <button className="btn-primary" onClick={() => setReceipt(true)}><Package size={15} />Receive materials</button>}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Finished goods value" value={fmtUGX(goodsValue)} /><Stat label="Raw materials value" value={fmtUGX(matValue)} />
        <Stat label="Low-stock products" value={String(lowGoods)} tone={lowGoods ? 'text-red-600' : ''} /><Stat label="Low-stock materials" value={String(lowMats)} tone={lowMats ? 'text-red-600' : ''} />
      </div>
      <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-slate2-200 px-1">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold', tab === k ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{l}</button>)}</div>

      {tab === 'goods' && (products.isLoading ? <Spinner /> : products.error ? <ErrorBox error={products.error} /> : goods.length === 0 ? <div className="card"><Empty icon={<Boxes size={22} />} title="No products yet">Add products in “Catalogue & prices”, then enter opening stock or record production.</Empty></div> : (
        <div className="card overflow-x-auto"><table className="stack w-full min-w-[700px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Product</th><th className="th">Category</th><th className="th text-right">In stock</th><th className="th text-right">Minimum</th><th className="th text-right">Avg cost</th><th className="th text-right">Value</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate2-100">{goods.map((p) => { const low = p.min_stock > 0 && p.current_stock <= p.min_stock; return (
            <tr key={p.id}><td className="td"><p className="font-medium">{p.name}{p.dimensions && <span className="font-normal text-slate2-500"> {p.dimensions}</span>}</p><p className="font-mono text-xs text-slate2-500">{p.sku}</p></td><td className="td">{p.product_categories?.name ?? '—'}</td>
              <td className={clsx('td num font-semibold', p.current_stock < 0 && 'text-red-600')}>{fmtNum(p.current_stock)} <span className="font-normal text-slate2-500">{p.unit}</span>{p.current_stock < 0 && <span className="block"><Badge tone="red">Negative</Badge></span>}{low && p.current_stock >= 0 && <span className="block"><Badge tone="amber">Low</Badge></span>}</td>
              <td className="td num text-slate2-500">{p.min_stock ? fmtNum(p.min_stock) : '—'}</td><td className="td num">{p.avg_cost ? fmtUGX(Math.round(p.avg_cost)) : <span className="text-amber-700" title="No cost recorded yet">no cost</span>}</td><td className="td num">{fmtUGX(Math.max(0, p.current_stock) * p.avg_cost)}</td>
              <td className="td">{rowActions('product', { id: p.id, name: p.name, unit: p.unit, stock: p.current_stock })}</td></tr>) })}</tbody></table></div>))}

      {tab === 'materials' && (materials.isLoading ? <Spinner /> : materials.error ? <ErrorBox error={materials.error} /> : (
        <>
          {canAdd && <div className="mb-3 flex justify-end"><button className="btn-ghost" onClick={() => setMatForm('new')}><Plus size={15} />Add material</button></div>}
          <div className="card overflow-x-auto"><table className="stack w-full min-w-[700px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Material</th><th className="th text-right">In stock</th><th className="th text-right">Minimum</th><th className="th text-right">Avg cost</th><th className="th text-right">Value</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate2-100">{mats.map((m) => { const low = m.status === 'active' && m.min_stock > 0 && m.current_stock <= m.min_stock; return (
              <tr key={m.id} className={m.status === 'inactive' ? 'opacity-50' : ''}><td className="td"><p className="font-medium">{m.name} {m.status === 'inactive' && <Badge>Inactive</Badge>}</p><p className="font-mono text-xs text-slate2-500">{m.material_no}</p></td>
                <td className={clsx('td num font-semibold', m.current_stock < 0 && 'text-red-600')}>{fmtNum(m.current_stock)} <span className="font-normal text-slate2-500">{m.unit}</span>{low && <span className="block"><Badge tone="amber">Low</Badge></span>}{m.current_stock < 0 && <span className="block"><Badge tone="red">Negative</Badge></span>}</td>
                <td className="td num text-slate2-500">{m.min_stock ? fmtNum(m.min_stock) : '—'}</td><td className="td num">{m.unit_cost ? fmtUGX(Math.round(m.unit_cost)) : <span className="text-amber-700">no cost</span>}</td><td className="td num">{fmtUGX(Math.max(0, m.current_stock) * m.unit_cost)}</td>
                <td className="td"><div className="flex items-center justify-end gap-1">{can('inventory', 'edit') && <button aria-label={`Edit ${m.name}`} className="rounded p-1 text-slate2-500 hover:bg-slate2-100" onClick={() => setMatForm(m)}><Pencil size={14} /></button>}{rowActions('material', { id: m.id, name: m.name, unit: m.unit, stock: m.current_stock })}</div></td></tr>) })}</tbody></table></div>
          <p className="mt-2 text-xs text-slate2-500">Material is bought with “Receive materials” (stock up + amount owed to supplier) and used through production batches (stock down, cost into the batch). Purchases are not expenses.</p>
        </>))}

      {tab === 'movements' && <MovementsTab />}
      {tab === 'catalogue' && <Products embedded />}

      {act && <StockActionDialog {...act} onClose={() => setAct(null)} />}
      {receipt && <MaterialReceiptDialog onClose={() => setReceipt(false)} />}
      {matForm && <MaterialFormDialog material={matForm === 'new' ? null : matForm} onClose={() => setMatForm(null)} />}
      {hist && <Modal open onClose={() => setHist(null)} wide title={`${hist.name} — stock history`}><MovementsTab itemId={hist.id} kind={hist.kind} /></Modal>}
    </>
  )
}
