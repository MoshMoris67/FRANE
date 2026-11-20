import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { num } from '../../lib/format'
import type { CustomerBalance, Product, ProductCategory, SupplierBalance } from '../../lib/types'

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase.from('products').select('*, product_categories(name)').order('name')
      if (error) throw error
      return (data ?? []).map((p) => ({ ...p, selling_price: num(p.selling_price), production_cost_estimate: num(p.production_cost_estimate), min_stock: num(p.min_stock) })) as Product[]
    },
  })
}
export function useProductCategories() {
  return useQuery({ queryKey: ['product_categories'], queryFn: async () => ((await supabase.from('product_categories').select('*').order('sort_order').order('name')).data ?? []) as ProductCategory[] })
}
export function useCustomerBalances() {
  return useQuery({
    queryKey: ['customer_balances'],
    queryFn: async (): Promise<CustomerBalance[]> => {
      const { data, error } = await supabase.from('customer_balances').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((c) => ({ ...c, total_purchases: num(c.total_purchases), outstanding: num(c.outstanding), overdue: num(c.overdue), total_payments: num(c.total_payments), credit_balance: num(c.credit_balance) })) as CustomerBalance[]
    },
  })
}
export function useSupplierBalances(enabled = true) {
  return useQuery({
    queryKey: ['supplier_balances'], enabled,
    queryFn: async (): Promise<SupplierBalance[]> => {
      const { data, error } = await supabase.from('supplier_balances').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((c) => ({ ...c, total_purchases: num(c.total_purchases), outstanding: num(c.outstanding), overdue: num(c.overdue), total_payments: num(c.total_payments), credit_balance: num(c.credit_balance) })) as SupplierBalance[]
    },
  })
}
