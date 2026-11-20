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
export interface Category { id: string; name: string; kind: 'income' | 'expense'; group_name: string | null; is_active: boolean; is_system: boolean; sort_order: number; tracks_inventory: boolean }
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
  receivables_total: number; receivables_overdue: number; receivables_overdue_count: number
  payables_total: number; payables_overdue: number; payables_due_soon: number
  pending_orders: number; sales_today: number
  largest_debtors: { id: string; name: string; outstanding: number }[]
  cogs: number; month_cogs: number; cogs_incomplete: number
  cogs_daily: { date: string; amount: number }[]; cogs_monthly: { month: string; amount: number }[]; cogs_by_label: { name: string; amount: number }[]
  produced_today: { category: string; qty: number }[]; sold_today: { category: string; qty: number }[]
  stock_units: number; stock_value: number; material_value: number
  low_stock_products: { id: string; name: string; stock: number; min: number }[]
  low_stock_materials: { id: string; name: string; stock: number; min: number; unit: string }[]
  batches_in_progress: number; negative_stock_count: number
  sales_by_product: { name: string; qty: number; amount: number }[]; production_by_product: { name: string; qty: number }[]
  inventory_movement: { date: string; in: number; out: number }[]
}

export const TXN_LABEL: Record<TxnType, string> = {
  income: 'Income', expense: 'Expense', transfer: 'Account transfer', customer_payment: 'Customer payment',
  supplier_payment: 'Supplier payment', loan_received: 'Loan received', loan_repayment: 'Loan repayment',
  owner_contribution: 'Owner contribution', owner_withdrawal: 'Owner withdrawal', refund: 'Refund', adjustment: 'Adjustment',
}
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { cash: 'Cash', bank: 'Bank', mobile_money: 'Mobile money', other: 'Other' }
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner / Administrator', manager: 'Manager', cashier: 'Cashier / Accounts clerk', supervisor: 'Production supervisor', storekeeper: 'Storekeeper' }

/* ---------- Phase 2 ---------- */
export interface Product {
  id: string; sku: string; name: string; category_id: string | null; dimensions: string | null; description: string | null
  unit: string; selling_price: number; production_cost_estimate: number; min_stock: number; status: 'active' | 'inactive'; current_stock: number; avg_cost: number
  product_categories?: { name: string } | null
}
export interface ProductCategory { id: string; name: string; is_active: boolean; sort_order: number }
export type CustomerType = 'individual' | 'contractor' | 'construction_company' | 'dealer' | 'other'
export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = { individual: 'Individual', contractor: 'Contractor', construction_company: 'Construction company', dealer: 'Dealer', other: 'Other' }
export interface CustomerBalance {
  id: string; customer_no: string; name: string; phone: string | null; email: string | null; location: string | null; customer_type: CustomerType
  notes: string | null; status: 'active' | 'inactive'; created_at: string; total_purchases: number; outstanding: number; overdue: number
  last_sale: string | null; total_payments: number; last_payment: string | null; credit_balance: number
}
export interface SupplierBalance {
  id: string; supplier_no: string; name: string; phone: string | null; location: string | null; contact_person: string | null
  supplied_materials: string | null; notes: string | null; status: 'active' | 'inactive'; created_at: string; total_purchases: number
  outstanding: number; overdue: number; last_invoice: string | null; total_payments: number; last_payment: string | null; credit_balance: number
}
export interface Sale {
  id: string; sale_no: string | null; sale_date: string; customer_id: string; status: 'draft' | 'confirmed' | 'cancelled'
  payment_status: 'unpaid' | 'partially_paid' | 'paid'; delivery_status: 'pending' | 'loading' | 'dispatched' | 'delivered' | 'cancelled'
  subtotal: number; discount: number; transport_charge: number; total: number; amount_paid: number; balance: number; due_date: string | null
  salesperson_id: string | null; stock_deducted_at: string | null; delivery_address: string | null; notes: string | null; cancel_reason: string | null; created_at: string
  customers?: { name: string; phone: string | null; location: string | null; customer_no: string } | null
  profiles?: { full_name: string } | null
}
export interface SaleItem { id: string; line_no: number; product_id: string | null; description: string; unit: string; quantity: number; unit_price: number; discount: number; line_total: number }
export interface Receivable { sale_id: string; sale_no: string; customer_id: string; customer_name: string; customer_phone: string | null; sale_date: string; due_date: string | null; total: number; amount_paid: number; balance: number; days_overdue: number; aging_bucket: AgingBucket; effective_status: string }
export interface Payable { invoice_id: string; purchase_no: string; supplier_invoice_no: string | null; supplier_id: string; supplier_name: string; invoice_date: string; due_date: string | null; kind: 'materials' | 'expense'; description: string; amount: number; amount_paid: number; balance: number; days_overdue: number; aging_bucket: AgingBucket; effective_status: string }
export interface SupplierInvoice { id: string; purchase_no: string; supplier_id: string; supplier_invoice_no: string | null; invoice_date: string; due_date: string | null; kind: 'materials' | 'expense'; description: string; amount: number; amount_paid: number; balance: number; status: 'open' | 'cancelled'; payment_status: string; notes: string | null; cancel_reason: string | null; transaction_categories?: { name: string } | null }
export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+'
export const AGING_LABEL: Record<AgingBucket, string> = { current: 'Current', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' }
export const AGING_ORDER: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+']
export interface StatementRow { date: string; kind?: string; ref: string; description: string; debit?: number; credit?: number; invoiced?: number; paid?: number; balance: number }
export interface Statement { opening: number; closing: number; rows: StatementRow[]; customer?: { id: string; name: string; phone: string | null; location: string | null; customer_no: string }; supplier?: { id: string; name: string; phone: string | null; supplier_no: string } }

/* ---------- Phase 3 ---------- */
export interface RawMaterial { id: string; material_no: string; name: string; unit: string; min_stock: number; current_stock: number; unit_cost: number; default_supplier_id: string | null; status: 'active' | 'inactive'; notes: string | null }
export type StockKind = 'opening' | 'production' | 'sale' | 'return' | 'damage' | 'adjustment' | 'purchase' | 'consumption'
export const STOCK_KIND_LABEL: Record<StockKind, string> = { opening: 'Opening stock', production: 'Produced', sale: 'Dispatched (sale)', return: 'Returned', damage: 'Damaged', adjustment: 'Adjustment', purchase: 'Purchased', consumption: 'Used in production' }
export interface StockMovement { id: string; movement_date: string; kind: StockKind; quantity: number; unit_cost: number; balance_after: number; source_type: string | null; source_id: string | null; note: string | null; flagged_negative: boolean; created_at: string; products?: { name: string; sku: string; unit: string } | null; raw_materials?: { name: string; unit: string } | null }
export type BatchStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export interface Batch { id: string; batch_no: string; production_date: string; product_id: string; qty_planned: number; qty_produced: number; qty_rejected: number; qty_accepted: number; status: BatchStatus; supervisor: string | null; material_cost: number; other_cost: number; total_cost: number; cost_per_unit: number | null; completed_date: string | null; notes: string | null; cancel_reason: string | null; products?: { name: string; unit: string; sku: string } | null }
export interface BatchMaterial { id: string; material_id: string; quantity: number; unit_cost: number; total_cost: number; reversed: boolean; created_at: string; raw_materials?: { name: string; unit: string } | null }
export interface BatchCost { id: string; kind: 'labour' | 'other'; description: string; worker_name: string | null; amount: number; paid: boolean; paid_txn_id: string | null; voided: boolean; void_reason: string | null; created_at: string }
