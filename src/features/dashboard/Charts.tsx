import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import type { DashboardData } from '../../lib/types'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, bucketKey, spanDays, type Range } from '../../lib/dates'
import { fmtCompact, fmtDate, fmtUGX, num, today } from '../../lib/format'
import { TrendingUp } from 'lucide-react'
import { useDashboard } from './useDashboard'
import { Empty } from '../../components/ui'

const C = { green: '#3f8a63', red: '#c2452d', orange: '#c8651f', slate: '#756f64', charcoal: '#2c3033', grid: '#e6e3dc' }
const PIE = ['#c8651f', '#2c3033', '#3f8a63', '#9d988d', '#8c4414', '#57534b', '#5f7f8c', '#dc9355', '#756f64', '#c4c0b6']

const tip = { contentStyle: { borderRadius: 3, border: '1px solid #dedbd3', fontSize: 12, boxShadow: 'none' }, formatter: (v: unknown) => fmtUGX(num(v)) }
const axis = { tick: { fontSize: 11, fill: C.slate }, tickLine: false, axisLine: false } as const

function label(k: string) {
  if (k.length === 7) { const [y, m] = k.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y.slice(2)}` }
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`
}

export function ChartCard({ title, subtitle, children, empty }: { title: string; subtitle?: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="card p-4">
      <h3 className="font-display text-lg font-semibold tracking-tight text-charcoal-900">{title}</h3>
      {subtitle && <p className="text-xs text-slate2-500">{subtitle}</p>}
      <div className="mt-3 h-64">{empty ? <Empty title="No data for this period" /> : children}</div>
    </div>
  )
}

export function PeriodCharts({ d, range }: { d: DashboardData; range: Range }) {
  const span = spanDays(range)
  const map = new Map<string, { k: string; revenue: number; expenses: number; money_in: number; money_out: number }>()
  for (const r of d.daily) {
    const k = bucketKey(r.date, span)
    const b = map.get(k) ?? { k, revenue: 0, expenses: 0, money_in: 0, money_out: 0 }
    b.revenue += num(r.revenue); b.expenses += num(r.expenses); b.money_in += num(r.money_in); b.money_out += num(r.money_out)
    map.set(k, b)
  }
  const rows = [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map((b) => ({ ...b, name: label(b.k), net: b.money_in - b.money_out }))
  let run = d.opening
  const flow = rows.map((r) => { run += r.net; return { ...r, balance: run } })
  const none = rows.length === 0
  const unit = span <= 45 ? 'daily' : span <= 200 ? 'weekly' : 'monthly'

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Income vs expenses" subtitle={`Revenue earned and expenses incurred, ${unit}`} empty={none}>
        <ResponsiveContainer><BarChart data={rows} barGap={2}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="revenue" name="Income" fill={C.green} radius={[3, 3, 0, 0]} /><Bar isAnimationActive={false} dataKey="expenses" name="Expenses" fill={C.red} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Cash flow" subtitle={`Net cash movement and running balance, ${unit} (transfers excluded)`} empty={none}>
        <ResponsiveContainer><AreaChart data={flow}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke={C.slate} />
          <Area isAnimationActive={false} dataKey="balance" name="Closing balance" stroke={C.charcoal} fill={C.charcoal} fillOpacity={0.08} strokeWidth={2} />
          <Area isAnimationActive={false} dataKey="net" name="Net cash flow" stroke={C.orange} fill={C.orange} fillOpacity={0.15} strokeWidth={2} /></AreaChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Expenses by category" subtitle="Posted expenses in the selected period" empty={d.expense_by_category.length === 0}>
        <Donut data={d.expense_by_category} />
      </ChartCard>
      <ChartCard title="Income by category" subtitle="Posted income in the selected period" empty={d.income_by_category.length === 0}>
        <Donut data={d.income_by_category} />
      </ChartCard>
    </div>
  )
}

function Donut({ data }: { data: { name: string; amount: number }[] }) {
  const rows = data.map((r) => ({ name: r.name, value: num(r.amount) }))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <div className="flex h-full flex-col items-center gap-2 sm:flex-row">
      <div className="h-36 w-full min-w-0 sm:h-60 sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={1}>{rows.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip {...tip} /></PieChart></ResponsiveContainer>
      </div>
      <ul className="max-h-full w-full space-y-1 overflow-y-auto text-xs sm:w-1/2">
        {rows.slice(0, 8).map((r, i) => (
          <li key={r.name} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{r.name}</span>
            <span className="tabular-nums text-slate2-600">{Math.round((r.value / total) * 100)}%</span></li>))}
      </ul>
    </div>
  )
}

export function TrendCharts({ d }: { d: DashboardData }) {
  const rows = d.monthly.map((m) => ({ name: label(m.month), revenue: num(m.revenue), expenses: num(m.expenses), profit: num(m.revenue) - num(m.expenses) }))
  const none = rows.length === 0
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard title="Monthly revenue trend" subtitle="Last 12 months" empty={none}>
        <ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} /><Line isAnimationActive={false} dataKey="revenue" name="Revenue" stroke={C.green} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Monthly expense trend" subtitle="Last 12 months" empty={none}>
        <ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} /><Line isAnimationActive={false} dataKey="expenses" name="Expenses" stroke={C.red} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Estimated profit trend" subtitle="Revenue − expenses (cash basis, estimated)" empty={none}>
        <ResponsiveContainer><BarChart data={rows}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} /><ReferenceLine y={0} stroke={C.slate} />
          <Bar isAnimationActive={false} dataKey="profit" name="Est. profit" radius={[3, 3, 0, 0]}>{rows.map((r, i) => <Cell key={i} fill={r.profit >= 0 ? C.green : C.red} />)}</Bar></BarChart></ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

export function OperationsCharts({ d }: { d: DashboardData }) {
  const sales = d.sales_by_product.map((r) => ({ name: r.name, amount: num(r.amount), qty: num(r.qty) }))
  const prod = d.production_by_product.map((r) => ({ name: r.name, qty: num(r.qty) }))
  const mov = d.inventory_movement.map((r) => ({ name: label(r.date), in: num(r.in), out: num(r.out) }))
  const qtip = { contentStyle: tip.contentStyle, formatter: (v: unknown) => num(v).toLocaleString() }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard title="Sales by product" subtitle="Invoiced amount in the period" empty={sales.length === 0}>
        <ResponsiveContainer><BarChart data={sales} layout="vertical" margin={{ left: 8 }}><CartesianGrid stroke={C.grid} horizontal={false} /><XAxis type="number" {...axis} tickFormatter={fmtCompact} /><YAxis type="category" dataKey="name" {...axis} width={96} /><Tooltip {...tip} />
          <Bar isAnimationActive={false} dataKey="amount" name="Sales" fill={C.orange} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Production by product" subtitle="Accepted units from completed batches" empty={prod.length === 0}>
        <ResponsiveContainer><BarChart data={prod} layout="vertical" margin={{ left: 8 }}><CartesianGrid stroke={C.grid} horizontal={false} /><XAxis type="number" {...axis} tickFormatter={fmtCompact} /><YAxis type="category" dataKey="name" {...axis} width={96} /><Tooltip {...qtip} />
          <Bar isAnimationActive={false} dataKey="qty" name="Accepted units" fill={C.charcoal} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Inventory movement" subtitle="Finished goods in vs out (units)" empty={mov.length === 0}>
        <ResponsiveContainer><BarChart data={mov}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...qtip} /><Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="in" name="In" fill={C.green} radius={[3, 3, 0, 0]} /><Bar isAnimationActive={false} dataKey="out" name="Out" fill={C.red} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

type Gran = 'day' | 'week' | 'month'
type Chip = '7D' | '30D' | '3M' | '6M' | '1Y' | 'Custom'
const CHIP_DAYS: Record<Exclude<Chip, 'Custom'>, number> = { '7D': 7, '30D': 30, '3M': 90, '6M': 180, '1Y': 365 }
function weekStart(date: string) { const d = new Date(date + 'T00:00:00Z'); const off = (d.getUTCDay() + 6) % 7; return addDays(date, -off) }

/** Hero trend: money received, money spent and net, with its own range chips. Transfers are excluded upstream. */
function FlowTip({ active, payload, label: l }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; payload: { range: string } }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const by = Object.fromEntries(payload.map((p) => [p.dataKey, p.value])) as Record<string, number>
  const rows: [string, string, number | undefined][] = [['received', 'Received', by.received], ['spent', 'Spent', by.spent], ['net', 'Net', by.net]]
  return (
    <div className="rounded-md border border-slate2-200 bg-white px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-charcoal-900">{payload[0].payload.range || l}</p>
      {rows.filter(([, , v]) => v !== undefined).map(([k, name, v]) => (
        <p key={k} className="flex items-center justify-between gap-5"><span className="flex items-center gap-1.5 text-slate2-600"><i className="h-2 w-2 rounded-full" style={{ background: k === 'received' ? C.green : k === 'spent' ? C.orange : C.charcoal }} />{name}</span><b className="tabular-nums">{(v as number) < 0 ? '−' : ''}{fmtUGX(Math.abs(v as number))}</b></p>))}
      <p className="mt-1 border-t border-slate2-100 pt-1 text-[11px] text-slate2-500">Tap to open these entries in the cashbook</p>
    </div>
  )
}

/** Hero trend: money received, money spent and net, with its own range chips. Transfers are excluded upstream. Click a point to open that day/week/month in the cashbook. */
export function CashFlowChart({ className }: { className?: string }) {
  const nav = useNavigate()
  const [chip, setChip] = useState<Chip>('30D')
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [custom, setCustom] = useState<Range>({ from: addDays(today(), -29), to: today() })
  const range: Range = chip === 'Custom' ? custom : { from: addDays(today(), -(CHIP_DAYS[chip] - 1)), to: today() }
  const ok = range.from <= range.to
  const { data: d, isLoading } = useDashboard(ok ? range : { from: addDays(today(), -29), to: today() })
  const span = spanDays(range)
  const gran: Gran = span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'
  const map = new Map<string, { k: string; received: number; spent: number }>()
  for (const r of d?.daily ?? []) {
    const k = gran === 'day' ? r.date : gran === 'week' ? weekStart(r.date) : r.date.slice(0, 7)
    const b = map.get(k) ?? { k, received: 0, spent: 0 }
    b.received += num(r.money_in); b.spent += num(r.money_out); map.set(k, b)
  }
  const bucketRange = (k: string): Range => gran === 'day' ? { from: k, to: k } : gran === 'week' ? { from: k, to: addDays(k, 6) } : { from: `${k}-01`, to: addDays(`${addMonth(k)}-01`, -1) }
  const rows = [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map((b) => { const r = bucketRange(b.k); return { k: b.k, name: label(b.k), range: gran === 'day' ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`, received: b.received, spent: b.spent, net: b.received - b.spent } })
  const totals = rows.reduce((t, r) => ({ rec: t.rec + r.received, sp: t.sp + r.spent }), { rec: 0, sp: 0 })
  const dot = (c: string) => (rows.length < 32 ? { r: 3, fill: c, strokeWidth: 0 } : false)
  const open = (k?: string) => { if (!k) return; const r = bucketRange(k); nav(`/cashbook?from=${r.from}&to=${r.to}`) }
  const toggle = (k: string) => setHidden((h) => ({ ...h, [k]: !h[k] }))
  const legend = [['received', 'Money Received', 'bg-ok-500', totals.rec], ['spent', 'Money Spent', 'bg-brand-500', totals.sp], ['net', 'Net Cash Flow', 'bg-charcoal-700', totals.rec - totals.sp]] as const
  return (
    <section aria-label="Cash flow trend" className={`card p-4 sm:p-5 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight"><TrendingUp size={20} className="text-brand-500" />Cash Flow Trend</h2>
        <div role="group" aria-label="Chart range" className="flex flex-wrap gap-1">
          {(['7D', '30D', '3M', '6M', '1Y', 'Custom'] as Chip[]).map((c) => <button key={c} onClick={() => setChip(c)} aria-pressed={chip === c} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${chip === c ? 'bg-brand-500 text-white' : 'bg-slate2-100 text-slate2-700 hover:bg-slate2-200'}`}>{c}</button>)}
        </div>
      </div>
      {chip === 'Custom' && <div className="mt-3 flex items-center gap-2"><input type="date" aria-label="Chart from date" className="input !w-auto" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><span className="text-slate2-400">to</span><input type="date" aria-label="Chart to date" className="input !w-auto" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {legend.map(([k, name, bg, total]) => (
          <button key={k} onClick={() => toggle(k)} aria-pressed={!hidden[k]} title={hidden[k] ? `Show ${name}` : `Hide ${name}`} className={`rounded-md border px-2.5 py-2 text-left transition ${hidden[k] ? 'border-slate2-200 opacity-45' : 'border-slate2-200 hover:border-slate2-400'}`}>
            <span className="flex items-center gap-1.5 text-[11px] text-slate2-600 sm:text-xs"><i className={`h-2.5 w-2.5 rounded-full ${bg}`} />{name}</span>
            <span className="figure mt-0.5 block text-base leading-tight sm:text-xl">{total < 0 ? '−' : ''}{fmtUGX(Math.abs(total))}</span>
          </button>))}
      </div>
      <div className="mt-3 h-64 sm:h-80">{isLoading ? <Empty title="Loading…" /> : rows.length === 0 ? <Empty title="No cash movement in this period" /> : (
        <ResponsiveContainer><AreaChart data={rows} margin={{ left: 0, right: 8, top: 6 }} style={{ cursor: 'pointer' }} onClick={(e) => open(rows[Number(e?.activeIndex)]?.k)}>
          <defs><linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.green} stopOpacity=".28" /><stop offset="1" stopColor={C.green} stopOpacity="0" /></linearGradient><linearGradient id="gSp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.orange} stopOpacity=".24" /><stop offset="1" stopColor={C.orange} stopOpacity="0" /></linearGradient></defs>
          <CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} minTickGap={22} interval="preserveStartEnd" /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip content={<FlowTip />} cursor={{ stroke: C.slate, strokeDasharray: '3 3' }} /><ReferenceLine y={0} stroke={C.slate} />
          {!hidden.received && <Area isAnimationActive={false} type="monotone" dataKey="received" name="Received" stroke={C.green} strokeWidth={2.5} fill="url(#gRec)" dot={dot(C.green)} activeDot={{ r: 5 }} />}
          {!hidden.spent && <Area isAnimationActive={false} type="monotone" dataKey="spent" name="Spent" stroke={C.orange} strokeWidth={2.5} fill="url(#gSp)" dot={dot(C.orange)} activeDot={{ r: 5 }} />}
          {!hidden.net && <Area isAnimationActive={false} type="monotone" dataKey="net" name="Net" stroke={C.charcoal} strokeWidth={2.5} strokeDasharray="5 3" fill="none" dot={dot(C.charcoal)} activeDot={{ r: 5 }} />}</AreaChart></ResponsiveContainer>)}</div>
      <p className="mt-1 text-[11px] text-slate2-500">Tap a legend box to hide a line. Tap the chart to open that {gran} in the cashbook. Transfers between your own accounts are excluded.</p>
    </section>
  )
}
const addMonth = (k: string) => { const [y, m] = k.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
