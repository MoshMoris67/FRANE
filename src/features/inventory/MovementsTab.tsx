import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileDown } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox, Empty, Badge } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtNum, fmtUGX, num } from '../../lib/format'
import { addDays } from '../../lib/dates'
import { today } from '../../lib/format'
import { STOCK_KIND_LABEL, type StockMovement } from '../../lib/types'
import { exportCSV } from '../../lib/export'

export default function MovementsTab({ itemId, kind: initialKind }: { itemId?: string; kind?: 'product' | 'material' }) {
  const [kind, setKind] = useState<'product' | 'material'>(initialKind ?? 'product')
  const [from, setFrom] = useState(addDays(today(), -30)); const [to, setTo] = useState(today()); const [type, setType] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['movements', kind, from, to, type, itemId],
    queryFn: async (): Promise<StockMovement[]> => {
      const table = kind === 'product' ? 'inventory_movements' : 'material_movements'
      let q = supabase.from(table).select(kind === 'product' ? '*, products(name, sku, unit)' : '*, raw_materials(name, unit)').gte('movement_date', from).lte('movement_date', to).order('movement_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000)
      if (type) q = q.eq('kind', type)
      if (itemId) q = q.eq(kind === 'product' ? 'product_id' : 'material_id', itemId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((m) => ({ ...m, quantity: num(m.quantity), unit_cost: num(m.unit_cost), balance_after: num(m.balance_after) })) as unknown as StockMovement[]
    },
  })
  const name = (m: StockMovement) => (kind === 'product' ? m.products?.name : m.raw_materials?.name) ?? ''
  const unit = (m: StockMovement) => (kind === 'product' ? m.products?.unit : m.raw_materials?.unit) ?? ''
  const link = (m: StockMovement) => m.source_type === 'sale' && m.source_id ? <Link className="text-brand-600" to={`/sales/${m.source_id}`}>sale</Link> : m.source_type === 'production_batch' && m.source_id ? <Link className="text-brand-600" to={`/production/${m.source_id}`}>batch</Link> : null
  const kinds = kind === 'product' ? ['opening', 'production', 'sale', 'return', 'damage', 'adjustment'] : ['opening', 'purchase', 'consumption', 'return', 'damage', 'adjustment']

  return (
    <div className="space-y-3">
      <div className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        {!initialKind && <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as 'product' | 'material'); setType('') }} aria-label="Ledger"><option value="product">Finished goods</option><option value="material">Raw materials</option></select>}
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type"><option value="">All movements</option>{kinds.map((k) => <option key={k} value={k}>{STOCK_KIND_LABEL[k as keyof typeof STOCK_KIND_LABEL]}</option>)}</select>
        <button className="btn-ghost" disabled={!data?.length} onClick={() => exportCSV({ title: 'Stock movements', filename: `stock_movements_${from}_${to}`, columns: ['Date', 'Item', 'Type', 'Quantity', 'Unit cost', 'Balance after', 'Note'], rows: (data ?? []).map((m) => [fmtDate(m.movement_date), name(m), STOCK_KIND_LABEL[m.kind], m.quantity, m.unit_cost, m.balance_after, m.note ?? '']) })}><FileDown size={15} />CSV</button>
      </div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && (data.length === 0 ? <div className="card"><Empty title="No movements in this period" /></div> : (
        <div className="card overflow-x-auto"><table className="stack w-full min-w-[720px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Date</th><th className="th">Item</th><th className="th">Type</th><th className="th text-right">Quantity</th><th className="th text-right">Unit cost</th><th className="th text-right">Balance</th><th className="th">Source / note</th></tr></thead>
          <tbody className="divide-y divide-slate2-100">{data.map((m) => (
            <tr key={m.id}><td className="td whitespace-nowrap">{fmtDate(m.movement_date)}</td><td className="td">{name(m)}</td><td className="td whitespace-nowrap">{STOCK_KIND_LABEL[m.kind]}{m.flagged_negative && <> <Badge tone="red">Negative</Badge></>}</td>
              <td className={clsx('td num font-medium', m.quantity > 0 ? 'text-emerald-700' : 'text-red-600')}>{m.quantity > 0 ? '+' : ''}{fmtNum(m.quantity)} {unit(m)}</td><td className="td num">{fmtUGX(Math.round(m.unit_cost))}</td><td className="td num">{fmtNum(m.balance_after)}</td>
              <td className="td text-xs text-slate2-600">{link(m)} {m.note}</td></tr>))}</tbody></table>
          {data.length >= 1000 && <p className="border-t border-slate2-100 px-4 py-2 text-xs text-slate2-500">Showing the latest 1,000 — narrow the dates.</p>}</div>))}
    </div>
  )
}
