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
  for (const a of d.accounts) if (a.balance < 0) out.push({ tone: 'red', title: `${a.name} is overdrawn`, detail: `Balance ${fmtUGX(a.balance)}`, to: '/accounts' })
  const cash = d.accounts.filter((a) => a.type === 'cash').reduce((s, a) => s + a.balance, 0)
  if (d.accounts.some((a) => a.type === 'cash') && cash > 0 && cash > 20_000_000) out.push({ tone: 'amber', title: 'Large cash holding', detail: `${fmtUGX(cash)} held as physical cash — consider banking some.`, to: '/accounts' })
  if (d.outflows > d.inflows && d.outflows > 0) out.push({ tone: 'amber', title: 'Negative cash flow in this period', detail: `Out ${fmtUGX(d.outflows)} exceeds in ${fmtUGX(d.inflows)}.`, to: '/cashbook' })
  if (d.month_expenses > d.month_revenue && d.month_expenses > 0) out.push({ tone: 'amber', title: 'Expenses exceed revenue this month', detail: `${fmtUGX(d.month_expenses)} spent vs ${fmtUGX(d.month_revenue)} earned.` })
  return out
}
