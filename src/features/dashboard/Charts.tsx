import { ResponsiveContainer, ComposedChart, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import type { DashboardData } from '../../lib/types'
import { useState } from 'react'
import { addDays, bucketKey, spanDays, type Range } from '../../lib/dates'
import { fmtCompact, fmtUGX, num } from '../../lib/format'
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
const GRAN_LABEL: Record<Gran, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' }
function weekStart(date: string) { const d = new Date(date + 'T00:00:00Z'); const off = (d.getUTCDay() + 6) % 7; return addDays(date, -off) }

/** Hero chart: money received vs spent per bucket, with net movement as a line. Transfers are excluded upstream. */
export function CashFlowChart({ d, range }: { d: DashboardData; range: Range }) {
  const span = spanDays(range)
  const auto: Gran = span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'
  const [pick, setPick] = useState<Gran | null>(null); const gran = pick ?? auto
  const map = new Map<string, { k: string; received: number; spent: number }>()
  for (const r of d.daily) {
    const k = gran === 'day' ? r.date : gran === 'week' ? weekStart(r.date) : r.date.slice(0, 7)
    const b = map.get(k) ?? { k, received: 0, spent: 0 }
    b.received += num(r.money_in); b.spent += num(r.money_out); map.set(k, b)
  }
  const rows = [...map.values()].sort((a, b) => a.k.localeCompare(b.k)).map((b) => ({ name: label(b.k), received: b.received, spent: b.spent, net: b.received - b.spent }))
  const totals = rows.reduce((t, r) => ({ rec: t.rec + r.received, sp: t.sp + r.spent }), { rec: 0, sp: 0 })
  return (
    <section aria-label="Cash flow" className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-xl font-semibold tracking-tight">Cash flow</h2>
          <p className="mt-0.5 text-xs text-slate2-500">Money received and spent, {GRAN_LABEL[gran].toLowerCase()}. Transfers between your own accounts are excluded.</p></div>
        <div role="group" aria-label="Chart interval" className="flex overflow-hidden rounded-md border border-slate2-200">
          {(Object.keys(GRAN_LABEL) as Gran[]).map((g) => <button key={g} onClick={() => setPick(g)} aria-pressed={gran === g} className={`px-3 py-1.5 text-xs font-medium ${gran === g ? 'bg-charcoal-900 text-white' : 'bg-white text-slate2-600 hover:bg-slate2-100'}`}>{GRAN_LABEL[g]}</button>)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 bg-ok-500" />Received <b className="tabular-nums">{fmtUGX(totals.rec)}</b></span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 bg-brand-500" />Spent <b className="tabular-nums">{fmtUGX(totals.sp)}</b></span>
        <span className="flex items-center gap-2"><i className="h-0.5 w-3.5 bg-charcoal-700" />Net <b className="tabular-nums">{fmtUGX(totals.rec - totals.sp)}</b></span>
      </div>
      <div className="mt-3 h-72 sm:h-80">{rows.length === 0 ? <Empty title="No cash movement in this period" /> : (
        <ResponsiveContainer><ComposedChart data={rows} barGap={2} margin={{ left: 0, right: 4 }}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="name" {...axis} minTickGap={16} /><YAxis {...axis} tickFormatter={fmtCompact} width={44} /><Tooltip {...tip} cursor={{ fill: 'rgba(16,18,19,.04)' }} /><ReferenceLine y={0} stroke={C.slate} />
          <Bar isAnimationActive={false} dataKey="received" name="Received" fill={C.green} maxBarSize={22} /><Bar isAnimationActive={false} dataKey="spent" name="Spent" fill={C.orange} maxBarSize={22} />
          <Line isAnimationActive={false} dataKey="net" name="Net" stroke={C.charcoal} strokeWidth={2} dot={rows.length < 25 ? { r: 2.5 } : false} /></ComposedChart></ResponsiveContainer>)}</div>
    </section>
  )
}
