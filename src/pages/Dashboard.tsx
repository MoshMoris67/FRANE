import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, Landmark, Smartphone, TrendingUp, TrendingDown, Wallet, ArrowDownLeft, ArrowUpRight, Scale, AlertTriangle, Plus, Hammer, ShoppingCart, Users, Truck, PackageCheck, Receipt, PiggyBank, Boxes, Factory, Layers, ClipboardCheck } from 'lucide-react'
import clsx from 'clsx'
import { PageHeader, Spinner, ErrorBox, Notice } from '../components/ui'
import { useDashboard } from '../features/dashboard/useDashboard'
import { buildAlerts } from '../features/dashboard/alerts'
import { PeriodCharts, TrendCharts, OperationsCharts } from '../features/dashboard/Charts'
import { presetRange, PRESET_LABEL, type Preset, type Range } from '../lib/dates'
import { fmtUGX, fmtDate, fmtNum, today } from '../lib/format'
import { TXN_LABEL } from '../lib/types'
import { useRecord } from '../components/layout/RecordContext'
import { useAuth } from '../auth/AuthContext'

function Kpi({ label, value, sub, icon: Icon, tone = 'neutral', to }: { label: string; value: string; sub?: string; icon: typeof Banknote; tone?: 'neutral' | 'green' | 'red' | 'orange'; to?: string }) {
  const nav = useNavigate()
  const color = { neutral: 'text-charcoal-900', green: 'text-emerald-700', red: 'text-red-600', orange: 'text-brand-600' }[tone]
  const Tag = to ? 'button' : 'div'
  return (
    <Tag onClick={to ? () => nav(to) : undefined} className={clsx('card p-4 text-left', to && 'transition hover:border-brand-400 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500/40')}>
      <div className="flex items-center justify-between text-slate2-500"><span className="text-xs font-semibold uppercase tracking-wide">{label}</span><Icon size={16} /></div>
      <p className={clsx('mt-2 font-display text-[1.7rem] font-bold leading-none tabular-nums', color)}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-slate2-500">{sub}</p>}
    </Tag>
  )
}

export default function Dashboard() {
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState<Range>({ from: today(), to: today() })
  const range = preset === 'custom' ? custom : presetRange(preset)
  const valid = range.from <= range.to
  const { data: d, isLoading, error, refetch } = useDashboard(valid ? range : presetRange('month'))
  const { data: t } = useDashboard(presetRange('today'))
  const { openRecord } = useRecord()
  const { can } = useAuth()
  const q = (r: Range, extra = '') => `/transactions?from=${r.from}&to=${r.to}${extra}`
  const td = presetRange('today')

  const byType = (type: string) => (d?.accounts ?? []).filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0)
  const total = (d?.accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const alerts = d ? buildAlerts(d) : []

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live financial position of FRANE CONCRETE FACTORY"
        actions={can('transactions', 'create') ? <button className="btn-primary lg:hidden" onClick={() => openRecord()}><Plus size={16} />Record Transaction</button> : undefined} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <button key={p} onClick={() => setPreset(p)} className={clsx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium', preset === p ? 'bg-charcoal-900 text-white' : 'bg-white text-slate2-600 ring-1 ring-slate2-200 hover:bg-slate2-100')}>{PRESET_LABEL[p]}</button>))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input !w-auto" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From date" />
            <span className="text-slate2-400">to</span>
            <input type="date" className="input !w-auto" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To date" />
          </div>
        )}
        <span className="ml-auto text-xs text-slate2-500">{fmtDate(range.from)} – {fmtDate(range.to)}</span>
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {d && (
        <div className="space-y-6">
          {d.accounts.length === 0 && (
            <div className="card flex flex-col items-start gap-3 border-brand-400 bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-semibold text-charcoal-900">Set up your money accounts to get started</p><p className="text-sm text-slate2-600">Add your cash box, bank and mobile-money accounts with their opening balances. Everything else builds on them.</p></div>
              <Link to="/accounts" className="btn-primary shrink-0">Set up accounts</Link>
            </div>
          )}

          {alerts.length > 0 && (
            <section aria-label="Alerts" className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i} className={clsx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', a.tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900')}>
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div className="flex-1"><span className="font-semibold">{a.title}.</span> {a.detail}</div>
                  {a.to && <Link to={a.to} className="shrink-0 font-semibold underline">View</Link>}
                </div>))}
            </section>
          )}

          <section aria-label="Cash position">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">Cash position (now)</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Total cash available" value={fmtUGX(total)} icon={Wallet} tone={total < 0 ? 'red' : 'orange'} to="/accounts" sub="All active accounts" />
              <Kpi label="Cash on hand" value={fmtUGX(byType('cash'))} icon={Banknote} to="/accounts" />
              <Kpi label="Bank balances" value={fmtUGX(byType('bank'))} icon={Landmark} to="/accounts" />
              <Kpi label="Mobile money" value={fmtUGX(byType('mobile_money'))} icon={Smartphone} to="/accounts" />
            </div>
          </section>

          <section aria-label="Today">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">Today · {fmtDate(today())}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Today's income" value={fmtUGX(t?.revenue)} icon={ArrowDownLeft} tone="green" to={q(td, '&type=income')} sub={t && t.inflows !== t.revenue ? `Total cash received ${fmtUGX(t.inflows)}` : 'Revenue earned'} />
              <Kpi label="Today's expenses" value={fmtUGX(t?.expenses)} icon={ArrowUpRight} tone="red" to={q(td, '&type=expense')} sub={t && t.outflows !== t.expenses ? `Total cash paid out ${fmtUGX(t.outflows)}` : 'Expenses incurred'} />
              <Kpi label="Today's net cash flow" value={fmtUGX((t?.inflows ?? 0) - (t?.outflows ?? 0))} icon={Scale} tone={(t?.inflows ?? 0) - (t?.outflows ?? 0) >= 0 ? 'green' : 'red'} to={q(td)} sub="Actual money in − out" />
              <Kpi label="Customer collections today" value={fmtUGX(t?.collections)} icon={TrendingUp} to={q(td, '&type=customer_payment')} sub="Not counted as revenue" />
            </div>
          </section>

          <section aria-label="Month">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">This month</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Monthly revenue" value={fmtUGX(d.month_revenue)} icon={TrendingUp} tone="green" to={q(presetRange('month'), '&type=income')} />
              <Kpi label="Monthly expenses" value={fmtUGX(d.month_expenses)} icon={TrendingDown} tone="red" to={q(presetRange('month'), '&type=expense')} />
              <Kpi label="Estimated monthly profit" value={fmtUGX(d.month_revenue - d.month_expenses)} icon={Scale} tone={d.month_revenue - d.month_expenses >= 0 ? 'green' : 'red'} sub={d.cogs_incomplete > 0 ? 'Estimate — some dispatched goods have no cost recorded' : 'Estimate: revenue − cost of goods − operating expenses'} />
              <Kpi label="Sales invoiced today" value={fmtUGX(d.sales_today)} icon={ShoppingCart} to="/sales" sub="Confirmed invoices" />
            </div>
          </section>

          <section aria-label="Receivables and payables">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">Customers &amp; suppliers</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Outstanding customer balances" value={fmtUGX(d.receivables_total)} icon={Users} tone={d.receivables_overdue > 0 ? 'red' : 'orange'} to="/debts" sub={d.receivables_overdue > 0 ? `${fmtUGX(d.receivables_overdue)} overdue` : 'Nothing overdue'} />
              <Kpi label="Outstanding supplier balances" value={fmtUGX(d.payables_total)} icon={Truck} to="/debts?tab=payables" sub={d.payables_overdue > 0 ? `${fmtUGX(d.payables_overdue)} overdue` : d.payables_due_soon > 0 ? `${fmtUGX(d.payables_due_soon)} due within 7 days` : 'Nothing due soon'} />
              <Kpi label="Orders awaiting fulfilment" value={String(d.pending_orders)} icon={PackageCheck} to="/sales?delivery=open&from=2000-01-01" sub="Pending or loading" />
              <div className="card p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate2-500">Largest debtors</p>
                {d.largest_debtors.length === 0 ? <p className="mt-2 text-xs text-slate2-500">None</p> : <ul className="mt-1.5 space-y-1 text-sm">{d.largest_debtors.slice(0, 3).map((x) => <li key={x.id} className="flex justify-between gap-2"><Link to={`/customers/${x.id}`} className="truncate hover:text-brand-600">{x.name}</Link><span className="tabular-nums">{fmtUGX(x.outstanding)}</span></li>)}</ul>}</div>
            </div>
          </section>

          {can('inventory', 'view') && (
          <section aria-label="Operations">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">Production &amp; stock</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="card p-4"><div className="flex items-center justify-between text-slate2-500"><span className="text-xs font-semibold uppercase tracking-wide">Produced today</span><Factory size={16} /></div>
                {d.produced_today.length === 0 ? <p className="mt-2 font-display text-[1.7rem] font-bold leading-none">0</p> : <ul className="mt-1.5 space-y-0.5 text-sm">{d.produced_today.map((r) => <li key={r.category} className="flex justify-between gap-2"><span className="truncate">{r.category}</span><b className="tabular-nums">{fmtNum(r.qty)}</b></li>)}</ul>}</div>
              <div className="card p-4"><div className="flex items-center justify-between text-slate2-500"><span className="text-xs font-semibold uppercase tracking-wide">Sold today (units)</span><ShoppingCart size={16} /></div>
                {d.sold_today.length === 0 ? <p className="mt-2 font-display text-[1.7rem] font-bold leading-none">0</p> : <ul className="mt-1.5 space-y-0.5 text-sm">{d.sold_today.map((r) => <li key={r.category} className="flex justify-between gap-2"><span className="truncate">{r.category}</span><b className="tabular-nums">{fmtNum(r.qty)}</b></li>)}</ul>}</div>
              <Kpi label="Current inventory" value={`${fmtNum(d.stock_units)} units`} icon={Boxes} to="/inventory" sub={`Finished goods ${fmtUGX(d.stock_value)} · materials ${fmtUGX(d.material_value)}`} />
              <Kpi label="Batches in progress" value={String(d.batches_in_progress)} icon={Layers} to="/production" sub={d.low_stock_products.length ? `${d.low_stock_products.length} product(s) low on stock` : 'No low-stock products'} />
            </div>
          </section>)}

          {(can('expenses', 'view') || can('daily_closing', 'view')) && (
          <section aria-label="Management">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate2-500">Controls</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Unpaid expenses" value={fmtUGX(d.unpaid_expenses)} icon={Receipt} to="/expenses" sub={d.pending_expense_approvals ? `${d.pending_expense_approvals} awaiting approval` : 'Incurred, not yet paid'} />
              {d.payroll_unpaid != null && <Kpi label="Payroll awaiting payment" value={fmtUGX(d.payroll_unpaid)} icon={Users} to="/expenses?tab=payroll" sub={d.payroll_pending ? `${d.payroll_pending} awaiting approval` : 'Approved, unpaid'} />}
              <Kpi label="Budgets at risk" value={String(d.budget_alerts.length)} icon={PiggyBank} tone={d.budget_alerts.some((b) => b.pct >= 100) ? 'red' : 'neutral'} to="/budgets" sub={d.budget_alerts[0] ? `${d.budget_alerts[0].label}: ${d.budget_alerts[0].pct}% used` : 'All within budget'} />
              <Kpi label="Unreconciled accounts" value={String(d.unreconciled_accounts.length)} icon={ClipboardCheck} tone={d.unreconciled_accounts.length ? 'red' : 'neutral'} to="/daily-closing?tab=reconciliations" sub={d.closings_pending ? `${d.closings_pending} closing(s) to approve` : 'Counted recently'} />
            </div>
          </section>)}

          <section aria-label="Financial overview" className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate2-200 px-4 py-3"><h2 className="text-sm font-semibold">Financial overview</h2><span className="text-xs text-slate2-500">{fmtDate(range.from)} – {fmtDate(range.to)}</span></div>
            <dl className="grid grid-cols-2 divide-slate2-200 sm:grid-cols-5 sm:divide-x">
              {[['Opening cash', d.opening, ''], ['Total inflows', d.inflows, 'text-emerald-700'], ['Total outflows', d.outflows, 'text-red-600'], ['Net movement', d.inflows - d.outflows, d.inflows - d.outflows >= 0 ? 'text-emerald-700' : 'text-red-600'], ['Closing cash', d.closing, 'font-bold']].map(([l, v, c]) => (
                <div key={l as string} className="border-b border-slate2-100 p-4 sm:border-b-0"><dt className="text-xs uppercase tracking-wide text-slate2-500">{l}</dt><dd className={clsx('mt-1 text-lg tabular-nums', c)}>{fmtUGX(v as number)}</dd></div>))}
            </dl>
            <p className="border-t border-slate2-100 px-4 py-2 text-[11px] text-slate2-500">Internal transfers between accounts are excluded from inflows/outflows. Opening + inflows − outflows = closing.</p>
          </section>

          <PeriodCharts d={d} range={range} />
          <TrendCharts d={d} />
          {can('inventory', 'view') && <OperationsCharts d={d} />}

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card lg:col-span-2">
              <div className="flex items-center justify-between border-b border-slate2-200 px-4 py-3"><h2 className="text-sm font-semibold">Recent transactions</h2><Link to="/transactions" className="text-xs font-semibold text-brand-600">View all</Link></div>
              {d.recent.length === 0 ? <p className="p-6 text-center text-sm text-slate2-500">No transactions yet. Use “Record Transaction” to add your first.</p> : (
                <ul className="divide-y divide-slate2-100">{d.recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0"><p className="truncate font-medium">{r.description}</p><p className="text-xs text-slate2-500">{fmtDate(r.date)} · {TXN_LABEL[r.type]} · {r.account}{r.status === 'reversed' && ' · reversed'}</p></div>
                    <span className={clsx('shrink-0 font-semibold tabular-nums', r.direction === 'in' ? 'text-emerald-700' : 'text-red-600', r.status === 'reversed' && 'line-through opacity-50')}>{r.direction === 'in' ? '+' : '−'}{fmtUGX(r.amount)}</span>
                  </li>))}</ul>)}
            </section>
            <section className="card p-4">
              <h2 className="text-sm font-semibold">Accounts</h2>
              <ul className="mt-2 divide-y divide-slate2-100 text-sm">{d.accounts.map((a) => (
                <li key={a.id} className="flex justify-between py-2"><span>{a.name}</span><span className={clsx('tabular-nums font-medium', a.balance < 0 && 'text-red-600')}>{fmtUGX(a.balance)}</span></li>))}
                {d.accounts.length === 0 && <li className="py-2 text-slate2-500">No accounts yet.</li>}</ul>
            </section>
          </div>

          <Notice tone="neutral"><span className="inline-flex items-center gap-1.5 font-semibold"><Hammer size={14} />Coming next (Phase 5):</span> full Profit &amp; Loss, cash-flow forecast and the reports centre. Not shown yet rather than filled with placeholder numbers.</Notice>
        </div>
      )}
    </>
  )
}
