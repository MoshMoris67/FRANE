export type Role = 'owner' | 'manager' | 'cashier' | 'supervisor' | 'storekeeper'
export type AccountType = 'cash' | 'bank' | 'mobile_money' | 'other'
export type TxnType =
  | 'income' | 'expense' | 'transfer' | 'customer_payment' | 'supplier_payment' | 'loan_received'
  | 'loan_repayment' | 'owner_contribution' | 'owner_withdrawal' | 'refund' | 'adjustment'

export interface Account {
  id: string; name: string; type: AccountType; status: 'active' | 'inactive'; opening_balance: number
  current_balance: number; account_ref: string | null; description: string | null; allow_negative: boolean
  txn_count: number; last_txn_date: string | null
}
export interface Category { id: string; name: string; kind: 'income' | 'expense'; group_name: string | null; is_active: boolean; is_system: boolean; sort_order: number }
export interface Party { id: string; name: string; phone: string | null }
export interface Txn {
  id: string; txn_no: string; txn_date: string; type: TxnType; direction: 'in' | 'out'; category_id: string | null
  description: string; amount: number; account_id: string; payment_method: string | null; reference: string | null
  customer_id: string | null; supplier_id: string | null; status: 'posted' | 'reversed'; is_reversal: boolean
  reversal_of: string | null; reversal_reason: string | null; notes: string | null; attachments: Attachment[]
  transfer_group_id: string | null; recorded_by: string | null; created_at: string; updated_at: string
  accounts?: { name: string } | null; transaction_categories?: { name: string } | null
  customers?: { name: string } | null; suppliers?: { name: string } | null
}
export interface Attachment { path: string; name: string }
export interface ModulePerm { view: boolean; create: boolean; edit: boolean; delete: boolean }
export interface MyPerms { role: Role | null; active: boolean; modules: Record<string, ModulePerm> }

export interface CashbookRow {
  id: string; txn_no: string; date: string; type: TxnType; reference: string | null; description: string
  account: string; category: string | null; money_in: number; money_out: number; balance: number
  status: 'posted' | 'reversed'; is_reversal: boolean
}
export interface CashbookReport { opening: number; closing: number; total_in: number; total_out: number; rows: CashbookRow[] }

export interface DashboardData {
  accounts: { id: string; name: string; type: AccountType; balance: number }[]
  opening: number; inflows: number; outflows: number; closing: number
  revenue: number; expenses: number; collections: number; month_revenue: number; month_expenses: number
  daily: { date: string; money_in: number; money_out: number; revenue: number; expenses: number }[]
  monthly: { month: string; revenue: number; expenses: number; money_in: number; money_out: number }[]
  expense_by_category: { name: string; amount: number }[]
  income_by_category: { name: string; amount: number }[]
  recent: { id: string; txn_no: string; date: string; type: TxnType; direction: 'in' | 'out'; description: string; amount: number; account: string; status: string }[]
}

export const TXN_LABEL: Record<TxnType, string> = {
  income: 'Income', expense: 'Expense', transfer: 'Account transfer', customer_payment: 'Customer payment',
  supplier_payment: 'Supplier payment', loan_received: 'Loan received', loan_repayment: 'Loan repayment',
  owner_contribution: 'Owner contribution', owner_withdrawal: 'Owner withdrawal', refund: 'Refund', adjustment: 'Adjustment',
}
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { cash: 'Cash', bank: 'Bank', mobile_money: 'Mobile money', other: 'Other' }
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner / Administrator', manager: 'Manager', cashier: 'Cashier / Accounts clerk', supervisor: 'Production supervisor', storekeeper: 'Storekeeper' }
