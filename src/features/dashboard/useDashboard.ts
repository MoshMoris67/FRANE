import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { DashboardData } from '../../lib/types'
import { num } from '../../lib/format'
import type { Range } from '../../lib/dates'

export function useDashboard(r: Range) {
  return useQuery({
    queryKey: ['dashboard', r.from, r.to],
    queryFn: async (): Promise<DashboardData> => {
      const { data, error } = await supabase.rpc('dashboard_summary', { p_from: r.from, p_to: r.to })
      if (error) throw error
      const d = data as DashboardData
      // Costs = operating expenses + cost of goods (dispatched stock, losses). Merge so every chart/KPI is consistent.
      const cogsDay = new Map(d.cogs_daily.map((r) => [r.date, num(r.amount)]))
      const cogsMonth = new Map(d.cogs_monthly.map((r) => [r.month, num(r.amount)]))
      const days = new Map(d.daily.map((r) => [r.date, { ...r }]))
      for (const [date, amt] of cogsDay) { const r = days.get(date) ?? { date, money_in: 0, money_out: 0, revenue: 0, expenses: 0 }; r.expenses = num(r.expenses) + amt; days.set(date, r) }
      const months = new Map(d.monthly.map((r) => [r.month, { ...r }]))
      for (const [month, amt] of cogsMonth) { const r = months.get(month) ?? { month, revenue: 0, expenses: 0, money_in: 0, money_out: 0 }; r.expenses = num(r.expenses) + amt; months.set(month, r) }
      return {
        ...d,
        daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
        monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
        expense_by_category: [...d.expense_by_category, ...d.cogs_by_label.filter((x) => num(x.amount) > 0).map((x) => ({ name: x.name, amount: num(x.amount) }))].sort((a, b) => num(b.amount) - num(a.amount)),
        cogs: num(d.cogs), month_cogs: num(d.month_cogs), cogs_incomplete: num(d.cogs_incomplete), stock_units: num(d.stock_units), stock_value: num(d.stock_value), material_value: num(d.material_value),
        batches_in_progress: num(d.batches_in_progress), negative_stock_count: num(d.negative_stock_count),
        pending_expense_approvals: num(d.pending_expense_approvals), unpaid_expenses: num(d.unpaid_expenses), closings_pending: num(d.closings_pending),
        payroll_unpaid: d.payroll_unpaid == null ? null : num(d.payroll_unpaid), payroll_pending: d.payroll_pending == null ? null : num(d.payroll_pending),
        opening: num(d.opening), inflows: num(d.inflows), outflows: num(d.outflows), closing: num(d.closing), revenue: num(d.revenue),
        expenses: num(d.expenses) + num(d.cogs), collections: num(d.collections), month_revenue: num(d.month_revenue), month_expenses: num(d.month_expenses) + num(d.month_cogs),
        receivables_total: num(d.receivables_total), receivables_overdue: num(d.receivables_overdue), receivables_overdue_count: num(d.receivables_overdue_count),
        payables_total: num(d.payables_total), payables_overdue: num(d.payables_overdue), payables_due_soon: num(d.payables_due_soon),
        pending_orders: num(d.pending_orders), sales_today: num(d.sales_today),
      }
    },
    refetchOnWindowFocus: true,
  })
}
