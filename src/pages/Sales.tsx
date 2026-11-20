import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, ShoppingCart } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtUGX, num } from '../lib/format'
import { presetRange } from '../lib/dates'
import type { Sale } from '../lib/types'
import { SaleStatusBadges, DeliveryBadge, DELIVERY_LABEL } from '../features/commercial/badges'
import { useAuth } from '../auth/AuthContext'

export default function Sales() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const { can } = useAuth()
  const from = sp.get('from') ?? presetRange('month').from; const to = sp.get('to') ?? presetRange('month').to
  const status = sp.get('status') ?? ''; const delivery = sp.get('delivery') ?? ''
  const [q, setQ] = useState('')
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }) }

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sales', from, to, status, delivery],
    queryFn: async () => {
      let qy = supabase.from('sales').select('*, customers(name, phone, customer_no)').gte('sale_date', from).lte('sale_date', to).order('sale_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
      if (status === 'draft' || status === 'confirmed' || status === 'cancelled') qy = qy.eq('status', status)
      if (status === 'unpaid') qy = qy.eq('status', 'confirmed').gt('balance', 0)
      if (status === 'paid') qy = qy.eq('status', 'confirmed').eq('payment_status', 'paid')
      if (delivery === 'open') qy = qy.eq('status', 'confirmed').in('delivery_status', ['pending', 'loading'])
      else if (delivery) qy = qy.eq('delivery_status', delivery)
      const { data, error } = await qy
      if (error) throw error
      return (data ?? []).map((s) => ({ ...s, subtotal: num(s.subtotal), total: num(s.total), amount_paid: num(s.amount_paid), balance: num(s.balance) })) as unknown as Sale[]
    },
  })
  const list = (data ?? []).filter((s) => !q || `${s.sale_no ?? ''} ${s.customers?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const live = list.filter((s) => s.status === 'confirmed')
  const sum = (k: 'total' | 'amount_paid' | 'balance') => live.reduce((a, s) => a + s[k], 0)

  return (
    <>
      <PageHeader title="Sales" subtitle="Invoices, payments and delivery"
        actions={can('sales', 'create') ? <Link to="/sales/new" className="btn-primary"><Plus size={16} />New sale</Link> : undefined} />
      <div className="mb-4 grid grid-cols-3 gap-3">{[['Invoiced', sum('total'), ''], ['Collected', sum('amount_paid'), 'text-emerald-700'], ['Still owing', sum('balance'), 'text-red-600']].map(([l, v, c]) => (
        <div key={l as string} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-lg font-bold tabular-nums sm:text-2xl', c)}>{fmtUGX(v as number)}</p></div>))}</div>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate2-400" /><input className="input pl-9" placeholder="Invoice or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <input type="date" className="input" value={from} max={to} onChange={(e) => set('from', e.target.value)} aria-label="From" />
        <input type="date" className="input" value={to} min={from} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        <select className="input" value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">All sales</option><option value="draft">Drafts</option><option value="confirmed">Confirmed</option><option value="unpaid">Unpaid / part-paid</option><option value="paid">Fully paid</option><option value="cancelled">Cancelled</option></select>
        <select className="input" value={delivery} onChange={(e) => set('delivery', e.target.value)} aria-label="Delivery"><option value="">Any delivery</option><option value="open">Awaiting fulfilment</option>{['pending', 'loading', 'dispatched', 'delivered'].map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}</select>
      </div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (list.length === 0 ? <div className="card"><Empty icon={<ShoppingCart size={22} />} title="No sales found">Create a sale, or widen the date range.</Empty></div> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate2-100 md:hidden">{list.map((s) => (
            <li key={s.id}><Link to={`/sales/${s.id}`} className="block px-4 py-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{s.customers?.name}</p><p className="text-xs text-slate2-500">{s.sale_no ?? 'Draft'} · {fmtDate(s.sale_date)}</p></div><p className="font-semibold tabular-nums">{fmtUGX(s.total)}</p></div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1"><SaleStatusBadges sale={s} />{s.status === 'confirmed' && <DeliveryBadge status={s.delivery_status} />}{s.status === 'confirmed' && s.balance > 0 && <span className="text-xs text-red-600">{fmtUGX(s.balance)} owing</span>}</div></Link></li>))}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Invoice</th><th className="th">Date</th><th className="th">Customer</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th><th className="th">Status</th><th className="th">Delivery</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{list.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate2-50" onClick={() => nav(`/sales/${s.id}`)}>
                <td className="td font-mono text-xs">{s.sale_no ?? <Badge>Draft</Badge>}</td><td className="td whitespace-nowrap">{fmtDate(s.sale_date)}</td><td className="td">{s.customers?.name}</td>
                <td className="td num font-medium">{fmtUGX(s.total)}</td><td className="td num">{s.status === 'confirmed' ? fmtUGX(s.amount_paid) : '—'}</td>
                <td className={clsx('td num', s.balance > 0 && 'font-semibold text-red-600')}>{s.status === 'confirmed' ? fmtUGX(s.balance) : '—'}</td>
                <td className="td"><SaleStatusBadges sale={s} /></td><td className="td">{s.status === 'confirmed' ? <DeliveryBadge status={s.delivery_status} /> : '—'}</td></tr>))}</tbody></table></div>
          {data.length >= 500 && <p className="border-t border-slate2-100 px-4 py-2 text-xs text-slate2-500">Showing the latest 500 — narrow the date range to see others.</p>}
        </div>))}
    </>
  )
}
