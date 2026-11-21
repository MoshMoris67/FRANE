import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowRight, ChevronRight, Wallet, Banknote, Landmark, Smartphone, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Users, CalendarClock, Trophy, Receipt, Clock, Truck, PackageX, PiggyBank, AlertCircle, CheckCircle2, Factory, ClipboardList } from 'lucide-react'
import clsx from 'clsx'
import { Spinner, ErrorBox } from '../components/ui'
import { useDashboard } from '../features/dashboard/useDashboard'
import { buildAlerts } from '../features/dashboard/alerts'
import { CashFlowChart, PeriodCharts, TrendCharts, OperationsCharts } from '../features/dashboard/Charts'
import { BlockArt, PaverArt, SlabArt, StackArt } from '../features/dashboard/Art'
import { presetRange } from '../lib/dates'
import { fmtUGX, fmtDate, fmtNum, today } from '../lib/format'
import { supabase } from '../lib/supabase'
import { TXN_LABEL } from '../lib/types'
import { useRecord } from '../components/layout/RecordContext'
import { usePeriod } from '../components/layout/PeriodContext'
import { useSettings } from '../features/data'
import { useAuth } from '../auth/AuthContext'

/** Month-over-month change; only shown when last month has a figure to compare against. */
function Delta({ now, prev, goodUp = true }: { now: number; prev?: number; goodUp?: boolean }) {
  if (!prev || prev === 0) return <span className="text-xs text-slate2-400">&nbsp;</span>
  const pct = Math.round(((now - prev) / Math.abs(prev)) * 100); const up = pct >= 0; const good = up === goodUp
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return <span className={clsx('inline-flex items-center gap-0.5 text-xs font-semibold', good ? 'text-ok-600' : 'text-bad-500')}><Icon size={13} />{Math.abs(pct)}% <span className="font-normal text-slate2-500">vs last month</span></span>
}

const TILE = {
  green: ['border-ok-500', 'from-ok-500/[0.08]', 'text-ok-600 bg-ok-500/10'], red: ['border-bad-500', 'from-bad-500/[0.08]', 'text-bad-500 bg-bad-500/10'],
  blue: ['border-[#3b6e99]', 'from-[#3b6e99]/[0.08]', 'text-[#3b6e99] bg-[#3b6e99]/10'], orange: ['border-brand-500', 'from-brand-500/[0.09]', 'text-brand-600 bg-brand-500/10'],
  navy: ['border-[#44508a]', 'from-[#44508a]/[0.08]', 'text-[#44508a] bg-[#44508a]/10'], gold: ['border-[#b8892a]', 'from-[#b8892a]/[0.1]', 'text-[#a47a1f] bg-[#b8892a]/10'],
} as const
function Tile({ label, value, icon: Icon, c, to, foot }: { label: string; value: string; icon: typeof Wallet; c: keyof typeof TILE; to?: string; foot: React.ReactNode }) {
  const [bd, from, ic] = TILE[c]
  const body = (<><div className="flex items-start gap-3"><span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', ic)}><Icon size={18} /></span><div className="min-w-0"><p className="text-[13px] leading-tight text-slate2-600">{label}</p><p className="figure text-[1.45rem] leading-tight">{value}</p></div></div><div className="mt-1.5 pl-12">{foot}</div></>)
  const cls = clsx('block rounded-md border border-slate2-200 border-l-[3px] bg-gradient-to-br to-white p-3.5', bd, from)
  return to ? <Link to={to} className={clsx(cls, 'transition hover:shadow-pop')}>{body}</Link> : <div className={cls}>{body}</div>
}

interface Activity { id: string; txn_date: string; description: string; type: string; direction: 'in' | 'out'; amount: number; status: string; accounts: { name: string } | null; transaction_categories: { name: string } | null }
function RecentActivity({ className }: { className?: string }) {
  const q = useQuery({
    queryKey: ['dashboard-activity'], staleTime: 20_000,
    queryFn: async (): Promise<Activity[]> => {
      const { data, error } = await supabase.from('transactions').select('id,txn_date,description,type,direction,amount,status,accounts(name),transaction_categories(name)').neq('type', 'transfer').order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(8)
      if (error) throw error
      return (data ?? []) as unknown as Activity[]
    },
  })
  return (
    <section aria-label="Recent activity" className={clsx('concrete overflow-hidden rounded-lg bg-charcoal-900 text-white', className)}>
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-3.5"><h2 className="flex items-center gap-2.5 font-display text-lg font-semibold"><Clock size={18} />Recent Activity</h2><Link to="/transactions" className="inline-flex items-center gap-1 text-xs font-medium text-slate2-200 hover:text-white">View All<ArrowRight size={13} /></Link></div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? <p className="px-4 pb-6 text-sm text-slate2-300">No transactions yet. Use “Record Transaction” to add your first.</p> : (
          <div className="overflow-x-auto px-4 pb-3"><table className="w-full sm:min-w-[400px] text-[13px]">
            <thead><tr className="text-left text-xs text-slate2-300"><th className="py-1.5 pr-2 font-medium">Date</th><th className="py-1.5 pr-2 font-medium">Description</th><th className="hidden py-1.5 pr-2 font-medium sm:table-cell">Category</th><th className="py-1.5 text-right font-medium">Amount</th></tr></thead>
            <tbody>{q.data!.map((r) => (
              <tr key={r.id} className="border-t border-white/10" title={`${r.accounts?.name ?? ''} · ${TXN_LABEL[r.type as keyof typeof TXN_LABEL] ?? r.type}`}>
                <td className="whitespace-nowrap py-2 pr-2 text-slate2-200">{fmtDate(r.txn_date).slice(0, 5)}</td><td className="max-w-[9rem] truncate py-2 pr-2">{r.description}</td><td className="hidden max-w-[6rem] truncate py-2 pr-2 text-slate2-200 sm:table-cell">{r.transaction_categories?.name ?? TXN_LABEL[r.type as keyof typeof TXN_LABEL] ?? r.type}</td>
                <td className={clsx('whitespace-nowrap py-2 text-right font-medium tabular-nums', r.direction === 'in' ? 'text-[#6fd09a]' : 'text-[#f08a73]', r.status === 'reversed' && 'line-through opacity-50')}>{r.direction === 'in' ? '+' : '−'}{fmtNum(r.amount)}</td></tr>))}</tbody></table></div>)}
      </div>
    </section>
  )
}

const ACCT_ICON = { cash: [Banknote, 'bg-brand-500'], bank: [Landmark, 'bg-[#3b6e99]'], mobile_money: [Smartphone, 'bg-[#b8892a]'] } as const

export default function Dashboard() {
  const { range, valid, label } = usePeriod()
  const { data: d, isLoading, error, refetch } = useDashboard(valid ? range : presetRange('month'))
  const { data: t } = useDashboard(presetRange('today'))
  const { openRecord } = useRecord(); const { can } = useAuth(); const { data: settings } = useSettings()
  const q = (r: { from: string; to: string }, extra = '') => `/transactions?from=${r.from}&to=${r.to}${extra}`
  const td = presetRange('today'); const mo = presetRange('month')
  const byType = (type: string) => (d?.accounts ?? []).filter((a) => a.type === type).reduce((s, a) => s + a.balance, 0)
  const total = (d?.accounts ?? []).reduce((s, a) => s + a.balance, 0)
  const alerts = d ? buildAlerts(d) : []
  const net = d ? d.inflows - d.outflows : 0
  const name = settings?.company.name ?? 'FRANE CONCRETE FACTORY'
  const curKey = today().slice(0, 7); const monthly = d?.monthly ?? []
  const prev = [...monthly].filter((m) => m.month < curKey).pop()
  const sum = (cat: RegExp) => (d?.produced_today ?? []).filter((r) => cat.test(r.category)).reduce((s, r) => s + r.qty, 0)
  const soldAll = (d?.sold_today ?? []).reduce((s, r) => s + r.qty, 0)
  const profit = d ? d.month_revenue - d.month_expenses : 0

  return (
    <>
      {/* Brand banner */}
      <section className="concrete relative mb-5 overflow-hidden rounded-lg bg-charcoal-900 bg-cover bg-[position:70%_62%]" style={{ backgroundImage: "linear-gradient(90deg, rgba(16,18,19,.92) 0%, rgba(16,18,19,.78) 32%, rgba(16,18,19,.12) 75%), url(/factory-banner.jpg), url(/banner-art.svg)" }}>
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8 sm:py-8">
          <div><h1 className="font-display text-3xl font-semibold uppercase leading-none tracking-wide text-white sm:text-[2.6rem]">{name}</h1><p className="mt-2 text-base italic text-slate2-200 sm:text-lg">Concrete blocks, pavers and more…</p><div className="mt-3 h-[3px] w-24 bg-brand-500" /></div>
          {can('transactions', 'create') && <button className="btn-primary h-11 rounded-md px-5 lg:hidden" onClick={() => openRecord()}><Plus size={16} />Record Transaction</button>}
        </div>
      </section>
      {!valid && <p className="mb-4 text-sm text-bad-500">“From” date is after “To” date — showing this month instead.</p>}
      {isLoading && <Spinner />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {d && (
        <div className="space-y-5">
          {d.accounts.length === 0 && (
            <div className="card flex flex-col items-start gap-3 border-brand-400 bg-brand-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-semibold">Set up your money accounts to get started</p><p className="text-sm text-slate2-600">Add your cash box, bank and mobile-money accounts with their opening balances. Everything else builds on them.</p></div>
              <Link to="/accounts" className="btn-primary shrink-0">Set up accounts</Link></div>)}

          {/* Cash hero */}
          <section aria-label="Cash position" className="concrete overflow-hidden rounded-lg border-l-4 border-brand-500 bg-charcoal-900 text-white">
            <div className="relative z-10 grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:grid-cols-4 2xl:grid-cols-[1.5fr_repeat(4,1fr)] 2xl:items-center 2xl:gap-0">
              <div className="col-span-full flex items-center gap-4 2xl:col-span-1 2xl:pr-6">
                <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400 sm:flex"><Wallet size={28} /></span>
                <div className="min-w-0"><p className="text-lg text-slate2-100">Total Cash Available</p><Link to="/accounts" className={clsx('figure block truncate text-[2.6rem] leading-none sm:text-[3.1rem]', total < 0 && 'text-[#f08a73]')}>{fmtUGX(total)}</Link></div>
              </div>
              {([['Cash on Hand', byType('cash'), Banknote], ['Bank Balance', byType('bank'), Landmark], ['Mobile Money', byType('mobile_money'), Smartphone]] as const).map(([l, v, Ic]) => (
                <div key={l} className="2xl:border-l 2xl:border-white/10 2xl:px-6"><p className="flex items-center gap-2 text-sm text-slate2-200"><Ic size={18} className="text-slate2-100" />{l}</p><p className="figure mt-1.5 text-2xl">{fmtUGX(v)}</p></div>))}
              <div className="2xl:border-l 2xl:border-white/10 2xl:pl-6"><p className="flex items-center gap-2 text-sm text-slate2-200"><TrendingUp size={20} className={net >= 0 ? 'text-[#6fd09a]' : 'text-[#f08a73]'} />Net Cash Flow<span className="text-slate2-400">({label})</span></p><p className="figure mt-1.5 text-2xl">{net < 0 ? '−' : ''}{fmtUGX(Math.abs(net))}</p></div>
            </div>
          </section>

          {/* Trend + alerts */}
          <div className="grid gap-5 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
            <CashFlowChart />
            <section aria-label="Alerts" className="overflow-hidden rounded-lg border border-slate2-200 bg-white">
              <h2 className="concrete flex items-center gap-2.5 bg-charcoal-900 px-4 py-3.5 font-display text-lg font-semibold text-white"><span className="relative z-10 flex items-center gap-2.5"><AlertCircle size={18} className="text-brand-400" />Alerts</span></h2>
              <ul className="divide-y divide-slate2-100">
                {alerts.slice(0, 5).map((a, i) => {
                  const red = a.tone === 'red'; const Ic = /supplier/i.test(a.title) ? Truck : /overdue|customer/i.test(a.title) ? CalendarClock : /stock|shortage/i.test(a.title) ? PackageX : /budget/i.test(a.title) ? PiggyBank : AlertCircle
                  return (<li key={i}><Link to={a.to ?? '/'} className="flex items-center gap-3 px-4 py-3 hover:bg-slate2-50"><span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', red ? 'bg-bad-500/10 text-bad-500' : 'bg-brand-500/10 text-brand-600')}><Ic size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-tight">{a.title}</span><span className="block truncate text-xs text-slate2-500">{a.detail}</span></span><ChevronRight size={16} className="shrink-0 text-slate2-400" /></Link></li>)
                })}
                {alerts.length > 5 && <li className="px-4 py-2 text-xs text-slate2-500">+{alerts.length - 5} more in the bell at the top.</li>}
                {alerts.length === 0 && <li className="flex items-center gap-3 px-4 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-ok-500/10 text-ok-600"><CheckCircle2 size={18} /></span><span><span className="block text-sm font-semibold">All clear</span><span className="block text-xs text-slate2-500">Nothing needs attention right now.</span></span></li>}
              </ul>
            </section>
          </div>

          {/* Six summary tiles */}
          <section aria-label="Financial summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            <Tile label="Today's Income" value={fmtUGX(t?.revenue)} icon={TrendingUp} c="green" to={q(td, '&type=income')} foot={<span className="text-xs text-slate2-500">Revenue earned</span>} />
            <Tile label="Today's Expenses" value={fmtUGX(t?.expenses)} icon={Receipt} c="red" to={q(td, '&type=expense')} foot={<span className="text-xs text-slate2-500">Expenses incurred</span>} />
            <Tile label="Customer Collections" value={fmtUGX(t?.collections)} icon={Users} c="blue" to={q(td, '&type=customer_payment')} foot={<span className="text-xs text-slate2-500">Not counted as revenue</span>} />
            <Tile label="Monthly Revenue" value={fmtUGX(d.month_revenue)} icon={CalendarClock} c="navy" to={q(mo, '&type=income')} foot={<Delta now={d.month_revenue} prev={prev ? Number(prev.revenue) : undefined} />} />
            <Tile label="Monthly Expenses" value={fmtUGX(d.month_expenses)} icon={TrendingDown} c="orange" to={q(mo, '&type=expense')} foot={<Delta now={d.month_expenses} prev={prev ? Number(prev.expenses) : undefined} goodUp={false} />} />
            <Tile label="Estimated Profit" value={fmtUGX(profit)} icon={Trophy} c="gold" foot={<Delta now={profit} prev={prev ? Number(prev.revenue) - Number(prev.expenses) : undefined} />} />
          </section>

          {/* Accounts · factory · activity */}
          <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-[1fr_1.3fr_1fr] [&>*]:min-w-0">
            <section className="concrete overflow-hidden rounded-lg bg-charcoal-900 text-white">
              <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-center justify-between px-4 py-3.5"><h2 className="flex items-center gap-2.5 font-display text-lg font-semibold"><Landmark size={18} />Accounts Summary</h2><Link to="/accounts" className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-100">View All<ArrowRight size={13} /></Link></div>
                <ul className="flex-1 px-4">{d.accounts.map((a) => { const [Ic, bg] = ACCT_ICON[a.type as keyof typeof ACCT_ICON] ?? ACCT_ICON.cash; return (
                  <li key={a.id} className="flex items-center gap-3 border-t border-white/10 py-3"><span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white', bg)}><Ic size={16} /></span><span className="min-w-0 flex-1 truncate text-sm">{a.name}</span><span className={clsx('figure text-lg', a.balance < 0 && 'text-[#f08a73]')}>{fmtUGX(a.balance)}</span><span className={clsx('h-2 w-2 rounded-full', a.balance < 0 ? 'bg-bad-500' : 'bg-ok-500')} /></li>) })}
                  {d.accounts.length === 0 && <li className="border-t border-white/10 py-3 text-sm text-slate2-300">No accounts yet.</li>}</ul>
                <div className="flex items-baseline justify-between border-t border-white/10 px-4 py-3.5"><span className="font-semibold">Total Balance</span><span className="figure text-2xl text-brand-400">{fmtUGX(total)}</span></div>
              </div>
            </section>

            {can('inventory', 'view') && (
              <section className="overflow-hidden rounded-lg border border-slate2-200 bg-white">
                <div className="concrete flex items-center justify-between bg-charcoal-900 px-4 py-3.5 text-white"><h2 className="relative z-10 flex items-center gap-2.5 font-display text-lg font-semibold"><Factory size={18} />Factory Performance</h2><Link to="/production" className="relative z-10 inline-flex items-center gap-1 text-xs font-medium text-slate2-200 hover:text-white">View Details<ArrowRight size={13} /></Link></div>
                <div className="grid grid-cols-2 gap-px bg-slate2-100 sm:grid-cols-5">
                  {([['Blocks', fmtNum(sum(/block/i)), BlockArt, 'produced today'], ['Pavers', fmtNum(sum(/paver/i)), PaverArt, 'produced today'], ['Products Sold', fmtNum(soldAll), null, 'units today'], ['Current Stock', fmtNum(d.stock_units), StackArt, 'units'], ['Orders Pending', String(d.pending_orders), null, 'awaiting delivery']] as const).map(([l, v, Art, sub], i) => (
                    <div key={l} className="flex flex-col items-center bg-white px-2 py-4 text-center">
                      <div className="flex h-12 items-center">{Art ? <Art /> : i === 2 ? <SlabArt /> : <ClipboardList size={34} className="text-slate2-500" />}</div>
                      <p className="mt-2 text-xs text-slate2-600">{l}</p><p className="figure text-xl leading-tight">{v}</p><p className="text-[11px] text-slate2-400">{sub}</p></div>))}
                </div>
                <p className="border-t border-slate2-100 px-4 py-2.5 text-xs text-slate2-500">{d.batches_in_progress} batch(es) in progress{d.low_stock_products.length ? ` · ${d.low_stock_products.length} product(s) low on stock` : ''} · finished goods worth {fmtUGX(d.stock_value)}</p>
              </section>)}

            <RecentActivity />
          </div>

          {/* Owed + controls */}
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <section className="card p-4 sm:p-5"><h2 className="font-display text-lg font-semibold">Owed</h2>
              {[['Customers owe us', d.receivables_total, d.receivables_overdue > 0 ? `${fmtUGX(d.receivables_overdue)} overdue` : 'Nothing overdue', '/debts', d.receivables_overdue > 0], ['We owe suppliers', d.payables_total, d.payables_overdue > 0 ? `${fmtUGX(d.payables_overdue)} overdue` : d.payables_due_soon > 0 ? `${fmtUGX(d.payables_due_soon)} due in 7 days` : 'Nothing due soon', '/debts?tab=payables', d.payables_overdue > 0]].map(([l, v, sub, to, bad]) => (
                <Link key={l as string} to={to as string} className="flex items-baseline justify-between gap-3 border-b border-slate2-100 py-2.5 last:border-0 hover:bg-slate2-50"><span><span className="block text-sm">{l}</span><span className="block text-xs text-slate2-500">{sub}</span></span><span className={clsx('figure text-xl', bad && 'text-bad-500')}>{fmtUGX(v as number)}</span></Link>))}
            </section>
            {(can('expenses', 'view') || can('daily_closing', 'view')) && (
              <section className="card p-4 sm:p-5"><h2 className="font-display text-lg font-semibold">Controls</h2>
                {([['Unpaid expenses', fmtUGX(d.unpaid_expenses), d.pending_expense_approvals ? `${d.pending_expense_approvals} awaiting approval` : '', '/expenses', false], ...(d.payroll_unpaid != null ? [['Payroll to pay', fmtUGX(d.payroll_unpaid), d.payroll_pending ? `${d.payroll_pending} awaiting approval` : '', '/expenses?tab=payroll', false]] : []), ['Budgets at risk', String(d.budget_alerts.length), d.budget_alerts[0] ? `${d.budget_alerts[0].label}: ${d.budget_alerts[0].pct}% used` : 'All within budget', '/budgets', d.budget_alerts.some((b) => b.pct >= 100)], ['Unreconciled accounts', String(d.unreconciled_accounts.length), d.closings_pending ? `${d.closings_pending} closing(s) to approve` : '', '/daily-closing?tab=reconciliations', d.unreconciled_accounts.length > 0]] as [string, string, string, string, boolean][]).map(([l, v, sub, to, bad]) => (
                  <Link key={l} to={to} className="flex items-baseline justify-between gap-3 border-b border-slate2-100 py-2 last:border-0 hover:bg-slate2-50"><span><span className="block text-sm">{l}</span>{sub && <span className="block text-xs text-slate2-500">{sub}</span>}</span><span className={clsx('figure text-lg', bad && 'text-bad-500')}>{v}</span></Link>))}
              </section>)}
          </div>

          <details className="group">
            <summary className="cursor-pointer list-none font-display text-xl font-semibold tracking-tight hover:text-brand-600">Analysis <span className="text-sm font-normal text-slate2-500 group-open:hidden">— income, categories, trends</span></summary>
            <div className="mt-4 space-y-5"><PeriodCharts d={d} range={valid ? range : mo} /><TrendCharts d={d} />{can('inventory', 'view') && <OperationsCharts d={d} />}</div>
          </details>
        </div>)}
    </>
  )
}
