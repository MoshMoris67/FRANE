export type Role = 'owner' | 'manager' | 'cashier' | 'supervisor' | 'storekeeper'
export type AccountType = 'cash' | 'bank' | 'mobile_money' | 'other'
export type TxnType =
  | 'income' | 'expense' | 'transfer' | 'customer_payment' | 'supplier_payment' | 'loan_received'
  | 'loan_repayment' | 'owner_contribution' | 'owner_withdrawal' | 'refund' | 'adjustment' | 'expense_payment'

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
  budget_alerts: { id: string; label: string; period_type: string; budget: number; actual: number; pct: number }[]
  unreconciled_accounts: { id: string; name: string; last: string | null }[]
  forecast_shortage?: { day: number; date: string; balance: number } | null; forecast_lowest_30?: { date: string; balance: number } | null
  pending_expense_approvals: number; unpaid_expenses: number; payroll_unpaid: number | null; payroll_pending: number | null; closings_pending: number
}

export const TXN_LABEL: Record<TxnType, string> = {
  income: 'Income', expense: 'Expense', transfer: 'Account transfer', customer_payment: 'Customer payment',
  supplier_payment: 'Supplier payment', loan_received: 'Loan received', loan_repayment: 'Loan repayment',
  owner_contribution: 'Owner contribution', owner_withdrawal: 'Owner withdrawal', refund: 'Refund', adjustment: 'Adjustment', expense_payment: 'Expense payment',
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
  salesperson_id: string | null; stock_deducted_at: string | null; is_opening?: boolean; is_historical?: boolean; delivery_address: string | null; notes: string | null; cancel_reason: string | null; created_at: string
  customers?: { name: string; phone: string | null; location: string | null; customer_no: string } | null
}
export interface SaleItem { id: string; line_no: number; product_id: string | null; description: string; unit: string; quantity: number; unit_price: number; discount: number; line_total: number }
export interface Receivable { sale_id: string; sale_no: string; customer_id: string; customer_name: string; customer_phone: string | null; sale_date: string; due_date: string | null; total: number; amount_paid: number; balance: number; days_overdue: number; aging_bucket: AgingBucket; effective_status: string }
export interface Payable { invoice_id: string; purchase_no: string; supplier_invoice_no: string | null; supplier_id: string; supplier_name: string; invoice_date: string; due_date: string | null; kind: 'materials' | 'expense'; description: string; amount: number; amount_paid: number; balance: number; days_overdue: number; aging_bucket: AgingBucket; effective_status: string }
export interface SupplierInvoice { id: string; purchase_no: string; supplier_id: string; supplier_invoice_no: string | null; invoice_date: string; due_date: string | null; kind: 'materials' | 'expense' | 'opening'; description: string; amount: number; amount_paid: number; balance: number; status: 'open' | 'cancelled'; payment_status: string; notes: string | null; cancel_reason: string | null; transaction_categories?: { name: string } | null }
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

/* ---------- Phase 4 ---------- */
export interface ExpenseRow {
  source: 'expense' | 'supplier_invoice' | 'legacy'; id: string; ref_no: string; expense_date: string; category_id: string | null; category_name: string | null; group_name: string | null
  description: string; payee: string | null; amount: number; amount_paid: number; balance: number; payment_status: 'unpaid' | 'partially_paid' | 'paid'
  approval_status: 'pending' | 'approved' | 'rejected'; status: 'open' | 'cancelled'; notes: string | null; attachments: Attachment[]; created_at: string
}
export interface Employee { id: string; employee_no: string; name: string; role: string | null; phone: string | null; employment_type: 'permanent' | 'casual' | 'daily' | 'production'; pay_basis: 'daily' | 'monthly'; rate: number; status: 'active' | 'inactive'; start_date: string | null; notes: string | null }
export const EMPLOYMENT_LABEL = { permanent: 'Permanent', casual: 'Casual', daily: 'Daily labour', production: 'Production labour' } as const
export interface PayrollRecord { id: string; payroll_no: string; employee_id: string; period_start: string; period_end: string; workdays: number | null; rate: number; pay_basis: string; base_pay: number; overtime_hours: number; overtime_rate: number; overtime_pay: number; allowances: number; deductions: number; total_pay: number; batch_id: string | null; status: 'pending' | 'approved' | 'paid' | 'cancelled'; paid_date: string | null; notes: string | null; employees?: { name: string; employee_no: string; role: string | null } | null; production_batches?: { batch_no: string } | null }
export interface BudgetRow { id: string; scope_type: 'total' | 'group' | 'category' | 'production'; category_id: string | null; group_name: string | null; label: string; notes: string | null; budget: number; actual: number; remaining: number; variance: number; pct_used: number; previous_actual: number; status: 'ok' | 'warning' | 'over' }
export interface BudgetReport { period_type: 'month' | 'quarter' | 'year'; period_start: string; period_end: string; threshold_pct: number; rows: BudgetRow[] }
export interface Closing { id: string; closing_date: string; account_id: string; opening_balance: number; receipts: number; payments: number; expected_balance: number; counted_balance: number; variance: number; denominations: Record<string, number> | null; explanation: string | null; status: 'submitted' | 'approved' | 'rejected' | 'reopened'; closed_by: string | null; closed_at: string; approved_by: string | null; approved_at: string | null; review_note: string | null; reopen_reason: string | null; accounts?: { name: string; type: AccountType } | null }
export interface Reconciliation { id: string; account_id: string; reconciliation_date: string; system_balance: number; actual_balance: number; difference: number; notes: string | null; adjustment_txn_id: string | null; closing_id: string | null; created_at: string; accounts?: { name: string } | null }

/* ---------- Phase 5 ---------- */
export interface Line { label: string; amount: number }
export interface PnL {
  from: string; to: string
  revenue: { product_sales: number; transport: number; invoiced_sales: number; manual_sales_entries: number; total: number }
  cogs: { lines: Line[]; total: number }; gross_profit: number; gross_margin_pct: number | null
  operating_expenses: { groups: { group: string; total: number; lines: Line[] }[]; total: number }
  other_income: { lines: Line[]; total: number }; other_expenses: { lines: Line[]; total: number }; net_profit: number
  memo: Record<string, number>
  flags: { uncosted_dispatches: number; pending_expenses_excluded: number; estimated: boolean; negative_stock_items: number }
}
export interface ProductProfit { product: string; quantity: number; revenue: number; cost: number; gross_profit: number; margin_pct: number | null; cost_per_unit: number | null; estimated_cost_share_pct: number }
export interface CashFlowStatement { opening: number; closing: number; inflows: number; outflows: number; net: number; lines: { section: string; label: string; inflow: number; outflow: number; net: number }[]; note: string }
export interface BalanceSheet {
  as_at: string
  assets: { cash_and_bank: { name: string; type: string; balance: number }[]; cash_and_bank_total: number; receivables: number; finished_goods: number; raw_materials: number; supplier_advances: number; total: number }
  liabilities: { supplier_payables: number; unpaid_expenses: number; payroll_owed: number; customer_credit: number; loans: number; total: number }
  equity: { owner_contributions: number; owner_withdrawals: number; net_assets: number; retained_and_opening_balance: number; profit_to_date_per_pl: number }
  notes: string[]
}
export interface ForecastDay { day: number; date: string; in_collections: number; in_new_sales: number; in_planned: number; out_suppliers: number; out_payroll: number; out_expenses: number; out_planned: number; net: number; balance: number }
export interface Forecast {
  is_forecast: true; as_of: string; opening: number; avg_daily_sales: number; cash_share_pct: number; recurring_daily_expenses: number; recurring_daily_payroll: number
  assumptions: Record<string, number | boolean | null>; daily: ForecastDay[]; first_shortage: { day: number; date: string; balance: number } | null; lowest_point: { day: number; date: string; balance: number }
}
export interface ForecastItem { id: string; item_date: string; description: string; amount: number; direction: 'in' | 'out'; kind: string; active: boolean }
