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
      return {
        ...d,
        opening: num(d.opening), inflows: num(d.inflows), outflows: num(d.outflows), closing: num(d.closing), revenue: num(d.revenue),
        expenses: num(d.expenses), collections: num(d.collections), month_revenue: num(d.month_revenue), month_expenses: num(d.month_expenses),
        receivables_total: num(d.receivables_total), receivables_overdue: num(d.receivables_overdue), receivables_overdue_count: num(d.receivables_overdue_count),
        payables_total: num(d.payables_total), payables_overdue: num(d.payables_overdue), payables_due_soon: num(d.payables_due_soon),
        pending_orders: num(d.pending_orders), sales_today: num(d.sales_today),
      }
    },
    refetchOnWindowFocus: true,
  })
}
