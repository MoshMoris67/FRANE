import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Factory, FileDown, FileSpreadsheet } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui'
import { NewBatchDialog } from '../features/production/BatchDialogs'
import { BATCH_LABEL, BATCH_TONE } from './BatchDetail'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtNum, fmtUGX, num, today } from '../lib/format'
import { presetRange, PRESET_LABEL, type Preset, type Range } from '../lib/dates'
import type { Batch } from '../lib/types'
import { useAuth } from '../auth/AuthContext'
import { exportCSV, exportXLSX, type ExportTable } from '../lib/export'
import { ChartCard } from '../features/dashboard/Charts'

export default function Production() {
  const { can } = useAuth(); const nav = useNavigate()
  const [tab, setTab] = useState<'batches' | 'reports'>('batches'); const [creating, setCreating] = useState(false)
  return (
    <>
      <PageHeader title="Production" subtitle="Batches, material use, labour and cost per unit"
        actions={can('production', 'create') ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} />New batch</button> : undefined} />
      <div className="mb-4 flex gap-1 border-b border-slate2-200">{(['batches', 'reports'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold capitalize', tab === t ? 'border-brand-500' : 'border-transparent text-slate2-500')}>{t}</button>)}</div>
      {tab === 'batches' ? <Batches /> : <Reports />}
      {creating && <NewBatchDialog onClose={() => setCreating(false)} onCreated={(id) => nav(`/production/${id}`)} />}
    </>
  )
}

function Batches() {
  const nav = useNavigate(); const [status, setStatus] = useState(''); const [q, setQ] = useState('')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['batches', status],
    queryFn: async () => {
      let qy = supabase.from('production_batches').select('*, products(name, unit, sku)').order('production_date', { ascending: false }).order('created_at', { ascending: false }).limit(300)
      if (status) qy = qy.eq('status', status)
      const { data, error } = await qy
      if (error) throw error
      return (data ?? []).map((b) => ({ ...b, qty_planned: num(b.qty_planned), qty_produced: num(b.qty_produced), qty_rejected: num(b.qty_rejected), qty_accepted: num(b.qty_accepted), total_cost: num(b.total_cost), cost_per_unit: b.cost_per_unit == null ? null : num(b.cost_per_unit) })) as unknown as Batch[]
    },
  })
  const list = (data ?? []).filter((b) => !q || `${b.batch_no} ${b.products?.name ?? ''} ${b.supervisor ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="card mb-4 grid gap-3 p-3 sm:grid-cols-3"><input className="input sm:col-span-2" placeholder="Search batch, product, supervisor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(BATCH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && (list.length === 0 ? <div className="card"><Empty icon={<Factory size={22} />} title="No batches yet">Create a batch, record the cement, sand and labour used, then complete it to add finished goods to stock.</Empty></div> : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate2-100 md:hidden">{list.map((b) => (
            <li key={b.id}><Link to={`/production/${b.id}`} className="block px-4 py-3"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{b.products?.name}</p><p className="text-xs text-slate2-500">{b.batch_no} · {fmtDate(b.production_date)}</p></div><Badge tone={BATCH_TONE[b.status]}>{BATCH_LABEL[b.status]}</Badge></div>
              <p className="mt-1 text-sm text-slate2-600">{b.status === 'completed' ? `${fmtNum(b.qty_accepted)} accepted of ${fmtNum(b.qty_produced)}` : `Planned ${fmtNum(b.qty_planned)}`} · {fmtUGX(b.total_cost)}</p></Link></li>))}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Batch</th><th className="th">Date</th><th className="th">Product</th><th className="th text-right">Planned</th><th className="th text-right">Produced</th><th className="th text-right">Rejected</th><th className="th text-right">Total cost</th><th className="th text-right">Cost/unit</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{list.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-slate2-50" onClick={() => nav(`/production/${b.id}`)}><td className="td font-mono text-xs"><Link to={`/production/${b.id}`} onClick={(e) => e.stopPropagation()} className="text-brand-600">{b.batch_no}</Link></td><td className="td whitespace-nowrap">{fmtDate(b.production_date)}</td><td className="td">{b.products?.name}</td>
                <td className="td num">{fmtNum(b.qty_planned)}</td><td className="td num">{b.status === 'completed' ? fmtNum(b.qty_produced) : '—'}</td><td className={clsx('td num', b.qty_rejected > 0 && 'text-red-600')}>{b.status === 'completed' ? fmtNum(b.qty_rejected) : '—'}</td>
                <td className="td num">{fmtUGX(b.total_cost)}</td><td className="td num">{b.cost_per_unit ? fmtUGX(Math.round(b.cost_per_unit)) : '—'}</td><td className="td"><Badge tone={BATCH_TONE[b.status]}>{BATCH_LABEL[b.status]}</Badge></td></tr>))}</tbody></table></div>
        </div>))}
    </>
  )
}

interface Report { by_day: { date: string; produced: number; accepted: number; rejected: number }[]; by_product: { product: string; batches: number; produced: number; accepted: number; rejected: number; cost: number; cost_per_unit: number | null }[]; materials: { material: string; unit: string; quantity: number; cost: number }[] }

function Reports() {
  const [preset, setPreset] = useState<Preset>('month'); const [custom, setCustom] = useState<Range>({ from: today(), to: today() })
  const range = preset === 'custom' ? custom : presetRange(preset)
  const { data, isLoading, error } = useQuery({ queryKey: ['production-report', range.from, range.to], enabled: range.from <= range.to, queryFn: async () => { const { data, error } = await supabase.rpc('production_report', { p_from: range.from, p_to: range.to }); if (error) throw error; return data as Report } })
  const tot = (data?.by_product ?? []).reduce((a, r) => ({ produced: a.produced + num(r.produced), accepted: a.accepted + num(r.accepted), rejected: a.rejected + num(r.rejected), cost: a.cost + num(r.cost) }), { produced: 0, accepted: 0, rejected: 0, cost: 0 })
  const tables = (): ExportTable => ({ title: 'Production report', filename: `production_${range.from}_${range.to}`, subtitle: `${fmtDate(range.from)} – ${fmtDate(range.to)}`, columns: ['Product', 'Batches', 'Produced', 'Accepted', 'Rejected', 'Total cost', 'Cost per unit'], numericCols: [1, 2, 3, 4, 5, 6],
    rows: (data?.by_product ?? []).map((r) => [r.product, r.batches, fmtNum(r.produced), fmtNum(r.accepted), fmtNum(r.rejected), fmtNum(r.cost), r.cost_per_unit ? fmtNum(r.cost_per_unit) : '']) })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['today', 'week', 'month', 'quarter', 'year', 'custom'] as Preset[]).map((p) => <button key={p} onClick={() => setPreset(p)} className={clsx('rounded-full px-3.5 py-1.5 text-sm font-medium', preset === p ? 'bg-charcoal-900 text-white' : 'bg-white text-slate2-600 ring-1 ring-slate2-200')}>{PRESET_LABEL[p]}</button>)}
        {preset === 'custom' && <><input type="date" className="input !w-auto" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><span className="text-slate2-400">to</span><input type="date" className="input !w-auto" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        <div className="ml-auto flex gap-2"><button className="btn-ghost" disabled={!data} onClick={() => exportXLSX(tables())}><FileSpreadsheet size={15} />Excel</button><button className="btn-ghost" disabled={!data} onClick={() => exportCSV(tables())}><FileDown size={15} />CSV</button></div>
      </div>
      {isLoading && <Spinner />}{error && <ErrorBox error={error} />}
      {data && (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[['Produced', fmtNum(tot.produced), ''], ['Accepted', fmtNum(tot.accepted), 'text-emerald-700'], ['Rejected', fmtNum(tot.rejected), tot.rejected ? 'text-red-600' : ''], ['Reject rate', tot.produced ? `${((tot.rejected / tot.produced) * 100).toFixed(1)}%` : '—', ''], ['Total cost', fmtUGX(tot.cost), '']].map(([l, v, c]) => <div key={l} className="card p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate2-500">{l}</p><p className={clsx('mt-1 font-display text-xl font-bold tabular-nums', c)}>{v}</p></div>)}
        </div>
        <ChartCard title="Accepted vs rejected" subtitle="By completion date" empty={data.by_day.length === 0}>
          <ResponsiveContainer><BarChart data={data.by_day.map((d) => ({ name: d.date.slice(8, 10) + '/' + d.date.slice(5, 7), accepted: num(d.accepted), rejected: num(d.rejected) }))}><CartesianGrid stroke="#e6e8eb" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar isAnimationActive={false} dataKey="accepted" name="Accepted" stackId="a" fill="#059669" /><Bar isAnimationActive={false} dataKey="rejected" name="Rejected" stackId="a" fill="#dc2626" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
        <section className="card overflow-x-auto"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">By product</h2>{data.by_product.length === 0 ? <p className="p-4 text-sm text-slate2-500">No completed batches in this period.</p> : (
          <table className="w-full min-w-[640px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Product</th><th className="th text-right">Batches</th><th className="th text-right">Produced</th><th className="th text-right">Accepted</th><th className="th text-right">Rejected</th><th className="th text-right">Cost</th><th className="th text-right">Cost / unit</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{data.by_product.map((r) => <tr key={r.product}><td className="td font-medium">{r.product}</td><td className="td num">{r.batches}</td><td className="td num">{fmtNum(r.produced)}</td><td className="td num">{fmtNum(r.accepted)}</td><td className="td num">{fmtNum(r.rejected)}</td><td className="td num">{fmtUGX(num(r.cost))}</td><td className="td num font-medium">{r.cost_per_unit ? fmtUGX(num(r.cost_per_unit)) : '—'}</td></tr>)}</tbody></table>)}</section>
        <section className="card overflow-x-auto"><h2 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Raw material consumption</h2>{data.materials.length === 0 ? <p className="p-4 text-sm text-slate2-500">No materials used in this period.</p> : (
          <table className="w-full min-w-[420px]"><thead className="border-b border-slate2-200 bg-slate2-50"><tr><th className="th">Material</th><th className="th text-right">Quantity</th><th className="th text-right">Cost</th></tr></thead>
            <tbody className="divide-y divide-slate2-100">{data.materials.map((r) => <tr key={r.material}><td className="td font-medium">{r.material}</td><td className="td num">{fmtNum(r.quantity)} {r.unit}</td><td className="td num">{fmtUGX(num(r.cost))}</td></tr>)}</tbody></table>)}</section>
      </>)}
    </div>
  )
}
