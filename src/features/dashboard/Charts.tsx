import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import type { DashboardData } from '../../lib/types'
import { bucketKey, spanDays, type Range } from '../../lib/dates'
import { fmtCompact, fmtUGX, num } from '../../lib/format'
import { Empty } from '../../components/ui'

const C = { green: '#059669', red: '#dc2626', orange: '#ee7a26', slate: '#6f7782', charcoal: '#323941', grid: '#e6e8eb' }
const PIE = ['#ee7a26', '#323941', '#059669', '#6f7782', '#d9650f', '#9aa1aa', '#2f6f8f', '#b4510c', '#535b65', '#c3c8ce']

const tip = { contentStyle: { borderRadius: 8, border: '1px solid #dde0e4', fontSize: 12 }, formatter: (v: unknown) => fmtUGX(num(v)) }
const axis = { tick: { fontSize: 11, fill: C.slate }, tickLine: false, axisLine: false } as const

function label(k: string) {
  if (k.length === 7) { const [y, m] = k.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y.slice(2)}` }
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`
}

export function ChartCard({ title, subtitle, children, empty }: { title: string; subtitle?: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-charcoal-900">{title}</h3>
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
