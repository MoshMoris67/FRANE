import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, AlertTriangle, ArrowRight } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox } from '../components/ui'
import { useDashboard } from '../features/dashboard/useDashboard'
import { buildAlerts } from '../features/dashboard/alerts'
import { CashFlowChart, PeriodCharts, TrendCharts, OperationsCharts } from '../features/dashboard/Charts'
import { presetRange, type Range } from '../lib/dates'
import { fmtUGX, fmtDate, fmtNum, today } from '../lib/format'
import { supabase } from '../lib/supabase'
import { TXN_LABEL } from '../lib/types'
import { useRecord } from '../components/layout/RecordContext'
import { usePeriod } from '../components/layout/PeriodContext'
import { useAuth } from '../auth/AuthContext'

const tone = (n: number) => (n < 0 ? 'text-bad-500' : 'text-charcoal-900')

/** A figure in a ruled list — the building block of the compact summaries. */
function Row({ label, value, sub, to, color }: { label: string; value: string; sub?: string; to?: string; color?: string }) {
  const nav = useNavigate()
  const inner = (<><span className="min-w-0"><span className="block text-sm text-slate2-700">{label}</span>{sub && <span className="block text-xs text-slate2-500">{sub}</span>}</span><span className={clsx('figure shrink-0 text-lg', color)}>{value}</span></>)
  const cls = 'flex w-full items-baseline justify-between gap-3 border-b border-slate2-100 py-2 text-left last:border-0'
  return to ? <button className={clsx(cls, 'hover:bg-slate2-50')} onClick={() => nav(to)}>{inner}</button> : <div className={cls}>{inner}</div>
}
const Head = ({ title, action, to }: { title: string; action?: string; to?: string }) => (
  <div className="mb-1 flex items-baseline justify-between"><h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>{to && <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">{action ?? 'View all'}<ArrowRight size={12} /></Link>}</div>
)

interface Activity { id: string; txn_date: string; description: string; type: string; direction: 'in' | 'out'; amount: number; status: string; accounts: { name: string } | null; transaction_categories: { name: string } | null }
function RecentActivity() {
  const q = useQuery({
    queryKey: ['dashboard-activity'], staleTime: 20_000,
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase.from('transactions').select('id,txn_date,description,type,direction,amount,status,accounts(name),transaction_categories(name)').neq('type', 'transfer').order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(10)
      if (error) throw error
      return (data ?? []) as unknown as Activity[]
    },
  })
  return (
    <section aria-label="Recent activity" className="card">
      <div className="border-b border-slate2-200 px-4 pb-2 pt-3"><Head title="Recent activity" to="/transactions" /></div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? <p className="p-6 text-center text-sm text-slate2-500">No transactions yet. Use “Record Transaction” to add your first.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr><th className="th">Date</th><th className="th">Description</th><th className="th">Category</th><th className="th">Account</th><th className="th text-right">Amount</th><th className="th">Type</th></tr></thead>
          <tbody>{q.data!.map((r) => (
            <tr key={r.id} className="border-t border-slate2-100">
              <td className="td whitespace-nowrap text-slate2-600">{fmtDate(r.txn_date)}</td><td className="td max-w-[16rem] truncate font-medium">{r.description}</td>
              <td className="td text-slate2-600">{r.transaction_categories?.name ?? '—'}</td><td className="td text-slate2-600">{r.accounts?.name ?? '—'}</td>
              <td className={clsx('td num whitespace-nowrap font-medium', r.direction === 'in' ? 'text-ok-600' : 'text-bad-500', r.status === 'reversed' && 'line-through opacity-50')}>{r.direction === 'in' ? '+' : '−'}{fmtUGX(r.amount)}</td>
              <td className="td whitespace-nowrap text-slate2-600">{TXN_LABEL[r.type as keyof typeof TXN_LABEL] ?? r.type}</td></tr>))}</tbody></table></div>)}
    </section>
  )
}

export default function Dashboard() {
  const { range, valid, label } = usePeriod()
  const { data: d, isLoading, error, refetch } = useDashboard(valid ? range : presetRange('month'))
  const { data: t } = useDashboard(presetRange('today'))
  const { openRecord } = useRecord(); const { can } = useAuth()
  const q = (r: Range, extra = '') => `/transactions?from=${r.from}&to=${r.to}${extra}`
  const td = presetRange('today'); const mo = presetRange('month')
  const byType = (type: string) => (d?.accounts ?? []).filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0)
  const total = (d?.accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const alerts = d ? buildAlerts(d) : []
  const net = d ? d.inflows - d.outflows : 0
  const todayNet = (t?.inflows ?? 0) - (t?.outflows ?? 0)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-[2.1rem] font-semibold leading-none tracking-tight">Dashboard</h1><p className="mt-1.5 text-sm text-slate2-500">Financial position and factory output · {label}</p></div>
        {can('transactions', 'create') && <button className="btn-primary lg:hidden" onClick={() => openRecord()}><Plus size={16} />Record Transaction</button>}
      </div>
      {!valid && <p className="mb-4 text-sm text-bad-500">“From” date is after “To” date — showing this month instead.</p>}
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {d && (
        <div className="space-y-6">
          {d.accounts.length === 0 && (
            <div className="card flex flex-col items-start gap-3 border-brand-400 bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-semibold">Set up your money accounts to get started</p><p className="text-sm text-slate2-600">Add your cash box, bank and mobile-money accounts with their opening balances. Everything else builds on them.</p></div>
              <Link to="/accounts" className="btn-primary shrink-0">Set up accounts</Link></div>)}

          {/* 1 · Financial hero */}
          <section aria-label="Cash position" className="concrete overflow-hidden rounded-lg bg-charcoal-900 text-white">
            <div className="relative z-10 grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.25fr_1fr] lg:items-end">
              <div>
                <p className="text-sm text-slate2-300">Total cash available</p>
                <Link to="/accounts" className={clsx('figure mt-2 block text-[3rem] leading-none sm:text-[4.25rem]', total < 0 ? 'text-[#e8836d]' : 'text-white')}>{fmtUGX(total)}</Link>
                <p className="mt-3 text-sm text-slate2-300">Net cash flow, {label.toLowerCase()}: <b className={clsx('font-semibold tabular-nums', net >= 0 ? 'text-[#7fc29d]' : 'text-[#e8836d]')}>{net >= 0 ? '+' : '−'}{fmtUGX(Math.abs(net))}</b></p>
              </div>
              <dl className="grid grid-cols-3 gap-px bg-white/10 text-sm">
                {[['Cash on hand', byType('cash')], ['Bank', byType('bank')], ['Mobile money', byType('mobile_money')]].map(([l, v]) => (
                  <div key={l as string} className="min-w-0 bg-charcoal-900 p-2.5 sm:p-3"><dt className="text-xs text-slate2-400">{l}</dt><dd className="figure mt-1 truncate text-base sm:text-xl">{fmtUGX(v as number)}</dd></div>))}
              </dl>
            </div>
          </section>

          {/* 2 · Alerts, only when there is something to act on */}
          {alerts.length > 0 && (
            <section aria-label="Alerts" className="divide-y divide-slate2-200 rounded-lg border border-slate2-200 bg-white">
              {alerts.slice(0, 3).map((a, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <AlertTriangle size={15} className={clsx('mt-0.5 shrink-0', a.tone === 'red' ? 'text-bad-500' : 'text-brand-500')} />
                  <p className="flex-1"><span className="font-medium">{a.title}.</span> <span className="text-slate2-600">{a.detail}</span></p>
                  {a.to && <Link to={a.to} className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700">View</Link>}
                </div>))}
              {alerts.length > 3 && <p className="px-4 py-2 text-xs text-slate2-500">+{alerts.length - 3} more — open the bell in the header to see all.</p>}
            </section>)}

          {/* 3 · Cash-flow chart + financial summary */}
          <div className="grid gap-6 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
            <CashFlowChart d={d} range={valid ? range : mo} />
            <aside aria-label="Financial summary" className="card p-4 sm:p-5">
              <Head title="Financial summary" />
              <p className="mb-1 mt-3 text-xs font-medium text-slate2-500">Today · {fmtDate(today())}</p>
              <Row label="Income" value={fmtUGX(t?.revenue)} to={q(td, '&type=income')} color="text-ok-600" />
              <Row label="Expenses" value={fmtUGX(t?.expenses)} to={q(td, '&type=expense')} color="text-bad-500" />
              <Row label="Customer collections" sub="Not counted as revenue" value={fmtUGX(t?.collections)} to={q(td, '&type=customer_payment')} />
              <Row label="Net cash flow" value={fmtUGX(todayNet)} to={q(td)} color={tone(todayNet)} />
              <p className="mb-1 mt-5 text-xs font-medium text-slate2-500">This month</p>
              <Row label="Revenue" value={fmtUGX(d.month_revenue)} to={q(mo, '&type=income')} color="text-ok-600" />
              <Row label="Expenses" value={fmtUGX(d.month_expenses)} to={q(mo, '&type=expense')} color="text-bad-500" />
              <Row label="Estimated profit" sub={d.cogs_incomplete > 0 ? 'Some dispatched goods have no cost recorded' : 'Revenue − cost of goods − expenses'} value={fmtUGX(d.month_revenue - d.month_expenses)} color={tone(d.month_revenue - d.month_expenses)} />
            </aside>
          </div>

          {/* 4 · Period ledger strip */}
          <section aria-label="Financial overview" className="rounded-lg border border-slate2-200 bg-white">
            <dl className="grid grid-cols-2 sm:grid-cols-5 sm:divide-x sm:divide-slate2-200">
              {([['Opening cash', d.opening, ''], ['Inflows', d.inflows, 'text-ok-600'], ['Outflows', d.outflows, 'text-bad-500'], ['Net movement', net, tone(net)], ['Closing cash', d.closing, 'font-bold']] as const).map(([l, v, c]) => (
                <div key={l} className="border-b border-slate2-100 px-4 py-3 sm:border-b-0"><dt className="text-xs text-slate2-500">{l}</dt><dd className={clsx('figure mt-0.5 text-xl', c)}>{fmtUGX(v)}</dd></div>))}
            </dl>
            <p className="border-t border-slate2-100 px-4 py-1.5 text-[11px] text-slate2-500">{fmtDate(range.from)} – {fmtDate(range.to)} · transfers excluded · opening + inflows − outflows = closing</p>
          </section>

          {/* 5 · Accounts + factory performance */}
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <section className="card p-4 sm:p-5">
              <Head title="Accounts" to="/accounts" action="Manage" />
              <ul className="mt-1">{d.accounts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between border-b border-slate2-100 py-2 last:border-0"><span className="text-sm">{a.name}<span className="ml-2 text-xs text-slate2-400">{a.type === 'mobile_money' ? 'Mobile money' : a.type === 'bank' ? 'Bank' : 'Cash'}</span></span><span className={clsx('figure text-lg', tone(a.balance))}>{fmtUGX(a.balance)}</span></li>))}
                {d.accounts.length === 0 && <li className="py-2 text-sm text-slate2-500">No accounts yet.</li>}</ul>
            </section>
            {can('inventory', 'view') && (
              <section className="concrete overflow-hidden rounded-lg border border-slate2-200 bg-slate2-100/60 p-4 sm:p-5">
                <div className="relative z-10">
                  <Head title="Factory performance" to="/production" action="Production" />
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-4">
                    <div><dt className="text-xs text-slate2-500">Produced today</dt>{d.produced_today.length === 0 ? <dd className="figure text-3xl text-slate2-400">0</dd> : d.produced_today.map((r) => <dd key={r.category} className="flex items-baseline justify-between text-sm"><span className="truncate text-slate2-700">{r.category}</span><b className="figure text-2xl">{fmtNum(r.qty)}</b></dd>)}</div>
                    <div><dt className="text-xs text-slate2-500">Sold today</dt>{d.sold_today.length === 0 ? <dd className="figure text-3xl text-slate2-400">0</dd> : d.sold_today.map((r) => <dd key={r.category} className="flex items-baseline justify-between text-sm"><span className="truncate text-slate2-700">{r.category}</span><b className="figure text-2xl">{fmtNum(r.qty)}</b></dd>)}</div>
                    <div><dt className="text-xs text-slate2-500">Inventory</dt><dd><Link to="/inventory" className="figure text-3xl hover:text-brand-600">{fmtNum(d.stock_units)}</Link><span className="ml-1 text-xs text-slate2-500">units</span><span className="block text-xs text-slate2-500">{fmtUGX(d.stock_value)} finished goods</span></dd></div>
                    <div><dt className="text-xs text-slate2-500">Awaiting delivery</dt><dd><Link to="/sales?delivery=open&from=2000-01-01" className="figure text-3xl hover:text-brand-600">{d.pending_orders}</Link><span className="block text-xs text-slate2-500">{d.batches_in_progress} batch(es) in progress{d.low_stock_products.length ? ` · ${d.low_stock_products.length} low on stock` : ''}</span></dd></div>
                  </dl></div>
              </section>)}
          </div>

          {/* 6 · Recent activity + money owed and controls */}
          <div className="grid gap-6 xl:grid-cols-[1fr_340px] [&>*]:min-w-0 xl:items-start">
            <RecentActivity />
            <div className="space-y-6">
              <section className="card p-4 sm:p-5"><Head title="Owed" />
                <Row label="Customers owe us" sub={d.receivables_overdue > 0 ? `${fmtUGX(d.receivables_overdue)} overdue` : 'Nothing overdue'} value={fmtUGX(d.receivables_total)} to="/debts" color={d.receivables_overdue > 0 ? 'text-bad-500' : undefined} />
                <Row label="We owe suppliers" sub={d.payables_overdue > 0 ? `${fmtUGX(d.payables_overdue)} overdue` : d.payables_due_soon > 0 ? `${fmtUGX(d.payables_due_soon)} due in 7 days` : 'Nothing due soon'} value={fmtUGX(d.payables_total)} to="/debts?tab=payables" />
                {d.largest_debtors.slice(0, 3).map((x) => <p key={x.id} className="flex justify-between border-t border-slate2-100 pt-1.5 text-xs text-slate2-600"><Link to={`/customers/${x.id}`} className="truncate hover:text-brand-600">{x.name}</Link><span className="tabular-nums">{fmtUGX(x.outstanding)}</span></p>)}
              </section>
              {(can('expenses', 'view') || can('daily_closing', 'view')) && (
                <section className="card p-4 sm:p-5"><Head title="Controls" />
                  <Row label="Unpaid expenses" sub={d.pending_expense_approvals ? `${d.pending_expense_approvals} awaiting approval` : undefined} value={fmtUGX(d.unpaid_expenses)} to="/expenses" />
                  {d.payroll_unpaid != null && <Row label="Payroll to pay" sub={d.payroll_pending ? `${d.payroll_pending} awaiting approval` : undefined} value={fmtUGX(d.payroll_unpaid)} to="/expenses?tab=payroll" />}
                  <Row label="Budgets at risk" sub={d.budget_alerts[0] ? `${d.budget_alerts[0].label}: ${d.budget_alerts[0].pct}% used` : 'All within budget'} value={String(d.budget_alerts.length)} to="/budgets" color={d.budget_alerts.some((b) => b.pct >= 100) ? 'text-bad-500' : undefined} />
                  <Row label="Unreconciled accounts" sub={d.closings_pending ? `${d.closings_pending} closing(s) to approve` : undefined} value={String(d.unreconciled_accounts.length)} to="/daily-closing?tab=reconciliations" color={d.unreconciled_accounts.length ? 'text-bad-500' : undefined} />
                </section>)}
            </div>
          </div>

          {/* 7 · Analysis */}
          <details className="group">
            <summary className="cursor-pointer list-none font-display text-xl font-semibold tracking-tight hover:text-brand-600">Analysis <span className="text-sm font-normal text-slate2-500 group-open:hidden">— income, categories, trends</span></summary>
            <div className="mt-4 space-y-6"><PeriodCharts d={d} range={valid ? range : mo} /><TrendCharts d={d} />{can('inventory', 'view') && <OperationsCharts d={d} />}</div>
          </details>
        </div>)}
    </>
  )
}
