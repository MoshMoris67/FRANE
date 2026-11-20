import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Account, Category, Party } from '../lib/types'
import { num } from '../lib/format'

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase.from('account_balances').select('*').order('name')
      if (error) throw error
      return (data ?? []).map((a) => ({ ...a, opening_balance: num(a.opening_balance), current_balance: num(a.current_balance), txn_count: num(a.txn_count) })) as Account[]
    },
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase.from('transaction_categories').select('*').order('sort_order').order('name')
      if (error) throw error
      return data as Category[]
    },
  })
}

export function useParties(table: 'customers' | 'suppliers') {
  return useQuery({
    queryKey: [table],
    queryFn: async (): Promise<Party[]> => {
      const { data, error } = await supabase.from(table).select('id,name,phone').eq('status', 'active').order('name')
      if (error) throw error
      return data as Party[]
    },
  })
}

export interface CompanySettings { name: string; address: string; phone: string; email: string; tax_id: string; tagline: string }
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key,value')
      if (error) throw error
      const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
      return {
        company: { name: 'FRANE CONCRETE FACTORY', address: '', phone: '', email: '', tax_id: '', tagline: '', ...(m.company ?? {}) } as CompanySettings,
        payment_methods: (m.payment_methods ?? ['Cash']) as string[],
        locale: m.locale ?? { currency: 'UGX', date_format: 'DD/MM/YYYY', timezone: 'Africa/Kampala' },
      }
    },
  })
}

/** Invalidate everything that depends on ledger totals. */
export function useRefreshMoney() {
  const qc = useQueryClient()
  return () => Promise.all(['accounts', 'dashboard', 'cashbook', 'transactions'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
}
