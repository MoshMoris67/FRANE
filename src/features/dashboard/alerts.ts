import type { DashboardData } from '../../lib/types'
import { fmtUGX } from '../../lib/format'

export interface Alert { tone: 'red' | 'amber' | 'neutral'; title: string; detail: string; to?: string }

/** Alerts derivable from Phase 1 data. Stock/budget/reconciliation alerts arrive with their modules. */
export function buildAlerts(d: DashboardData): Alert[] {
  const out: Alert[] = []
  if (d.receivables_overdue > 0) out.push({ tone: 'red', title: 'Overdue customer payments', detail: `${d.receivables_overdue_count} invoice(s), ${fmtUGX(d.receivables_overdue)} past due.`, to: '/debts' })
  if (d.payables_overdue > 0) out.push({ tone: 'red', title: 'Overdue supplier payments', detail: `${fmtUGX(d.payables_overdue)} past due to suppliers.`, to: '/debts?tab=payables' })
  if (d.payables_due_soon > 0) out.push({ tone: 'amber', title: 'Supplier payments due within 7 days', detail: fmtUGX(d.payables_due_soon), to: '/debts?tab=payables' })
  if (d.pending_orders > 0) out.push({ tone: 'neutral', title: 'Orders awaiting fulfilment', detail: `${d.pending_orders} confirmed order(s) not yet dispatched.`, to: '/sales?delivery=open&from=2000-01-01' })
  if (d.low_stock_materials.length > 0) out.push({ tone: 'red', title: 'Production shortage risk', detail: d.low_stock_materials.map((m) => `${m.name} (${m.stock} ${m.unit})`).join(', ') + ' at or below minimum.', to: '/inventory' })
  if (d.low_stock_products.length > 0) out.push({ tone: 'amber', title: 'Low finished-goods stock', detail: d.low_stock_products.map((p) => `${p.name} (${p.stock})`).join(', '), to: '/inventory' })
  if (d.negative_stock_count > 0) out.push({ tone: 'red', title: 'Negative stock needs review', detail: `${d.negative_stock_count} item(s) are below zero — find the missing receipt or production entry.`, to: '/inventory' })
  if (d.cogs_incomplete > 0) out.push({ tone: 'amber', title: 'Profit is overstated', detail: `${d.cogs_incomplete} dispatch(es) had no cost on record. Add opening costs or complete batches with materials and labour.`, to: '/inventory' })
  if (d.forecast_shortage) out.push({ tone: 'red', title: 'Projected cash shortage', detail: `Forecast: cash could fall to ${fmtUGX(d.forecast_shortage.balance)} by ${d.forecast_shortage.date.split('-').reverse().join('/')} (forecast, not actual).`, to: '/reports?tab=forecast' })
  for (const b of d.budget_alerts) out.push({ tone: b.pct >= 100 ? 'red' : 'amber', title: b.pct >= 100 ? `Budget exceeded: ${b.label}` : `Budget nearly used: ${b.label}`, detail: `${fmtUGX(b.actual)} of ${fmtUGX(b.budget)} (${b.pct}%) this ${b.period_type}.`, to: '/budgets' })
  if (d.unreconciled_accounts.length > 0) out.push({ tone: 'amber', title: 'Unreconciled accounts', detail: d.unreconciled_accounts.map((a) => a.name).join(', ') + ' — not counted recently.', to: '/daily-closing?tab=reconciliations' })
  if (d.pending_expense_approvals > 0) out.push({ tone: 'amber', title: 'Expenses awaiting approval', detail: `${d.pending_expense_approvals} expense(s) cannot be paid until approved.`, to: '/expenses' })
  if (d.closings_pending > 0) out.push({ tone: 'amber', title: 'Daily closings awaiting approval', detail: `${d.closings_pending} closing(s) have a cash variance to review.`, to: '/daily-closing?tab=history' })
  if ((d.payroll_pending ?? 0) > 0) out.push({ tone: 'neutral', title: 'Payroll awaiting approval', detail: `${d.payroll_pending} payroll record(s).`, to: '/expenses?tab=payroll' })
  for (const a of d.accounts) if (a.balance < 0) out.push({ tone: 'red', title: `${a.name} is overdrawn`, detail: `Balance ${fmtUGX(a.balance)}`, to: '/accounts' })
  const cash = d.accounts.filter((a) => a.type === 'cash').reduce((s, a) => s + a.balance, 0)
  if (d.accounts.some((a) => a.type === 'cash') && cash > 0 && cash > 20_000_000) out.push({ tone: 'amber', title: 'Large cash holding', detail: `${fmtUGX(cash)} held as physical cash — consider banking some.`, to: '/accounts' })
  if (d.outflows > d.inflows && d.outflows > 0) out.push({ tone: 'amber', title: 'Negative cash flow in this period', detail: `Out ${fmtUGX(d.outflows)} exceeds in ${fmtUGX(d.inflows)}.`, to: '/cashbook' })
  if (d.month_expenses > d.month_revenue && d.month_expenses > 0) out.push({ tone: 'amber', title: 'Expenses exceed revenue this month', detail: `${fmtUGX(d.month_expenses)} spent vs ${fmtUGX(d.month_revenue)} earned.` })
  return out
}
