import { supabase } from '../../lib/supabase'
import { fmtDate, fmtNum, fmtUGX, num } from '../../lib/format'
import { AGING_LABEL, AGING_ORDER, STOCK_KIND_LABEL, type AgingBucket, type BalanceSheet, type CashFlowStatement, type PnL, type StockKind } from '../../lib/types'
import { statementRows } from './PnLView'

export interface ReportFilters { from: string; to: string; product: string; customer: string; supplier: string; category: string; account: string }
export interface ReportResult { columns: string[]; rows: (string | number)[][]; numericCols: number[]; summary?: [string, string][]; note?: string }
export type FilterKey = Exclude<keyof ReportFilters, 'from' | 'to'> | 'dates'
export interface ReportDef {
  id: string; group: 'Financial' | 'Sales' | 'Inventory' | 'Production' | 'Debts'; title: string; description: string
  module: string; financial?: boolean; filters: FilterKey[]; link?: string; requires?: FilterKey; run?: (f: ReportFilters) => Promise<ReportResult>
}

const n = fmtNum
const U = fmtUGX
type Row = Record<string, unknown>

async function all(build: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < 20; i++) { const { data, error } = await build(i * 1000, i * 1000 + 999); if (error) throw error; out.push(...((data ?? []) as Row[])); if ((data?.length ?? 0) < 1000) break }
  return out
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data as T }
const sumBy = (rows: Row[], k: string) => rows.reduce((s, r) => s + num(r[k]), 0)

function salesBy(group: string, label: string): (f: ReportFilters) => Promise<ReportResult> {
  return async (f) => {
    const d = await rpc<{ rows: Row[] }>('sales_report', { p_group: group, p_from: f.from, p_to: f.to, p_product: f.product || null, p_customer: f.customer || null })
    const isProd = group === 'product'
    const rows = d.rows.map((r) => isProd ? [String(r.label), num(r.invoices), n(num(r.quantity)), n(num(r.gross)), n(num(r.discount)), n(num(r.net))] : [String(r.label), num(r.invoices), n(num(r.quantity)), n(num(r.gross)), n(num(r.discount)), n(num(r.transport)), n(num(r.net)), n(num(r.paid)), n(num(r.outstanding))])
    return { columns: isProd ? [label, 'Invoices', 'Quantity', 'Gross', 'Discount', 'Net sales'] : [label, 'Invoices', 'Quantity', 'Gross', 'Discount', 'Transport', 'Net sales', 'Paid', 'Outstanding'], numericCols: isProd ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7, 8], rows,
      summary: [['Net sales', U(sumBy(d.rows, 'net'))], ['Invoices', String(sumBy(d.rows, 'invoices'))], ...(isProd ? [] : [['Outstanding', U(sumBy(d.rows, 'outstanding'))] as [string, string]])] }
  }
}
const invoiceList = (status: 'credit' | 'paid'): ReportDef['run'] => async (f) => {
  const data = await all((a, b) => {
    let q = supabase.from('sales').select('sale_no, sale_date, due_date, total, amount_paid, balance, payment_status, customers(name)').eq('status', 'confirmed').gte('sale_date', f.from).lte('sale_date', f.to).order('sale_date', { ascending: false }).range(a, b)
    q = status === 'paid' ? q.eq('payment_status', 'paid') : q.neq('payment_status', 'paid')
    if (f.customer) q = q.eq('customer_id', f.customer)
    return q
  })
  return { columns: ['Invoice', 'Date', 'Customer', 'Due', 'Total', 'Paid', 'Balance', 'Status'], numericCols: [4, 5, 6], rows: data.map((r) => [String(r.sale_no), fmtDate(String(r.sale_date)), String((r.customers as { name: string } | null)?.name ?? ''), fmtDate(r.due_date as string), n(num(r.total)), n(num(r.amount_paid)), n(num(r.balance)), String(r.payment_status).replace('_', ' ')]),
    summary: [['Invoices', String(data.length)], ['Total', U(sumBy(data, 'total'))], ['Still owing', U(sumBy(data, 'balance'))]] }
}

const agingReport = (kind: 'customer' | 'supplier'): ReportDef['run'] => async (f) => {
  const isC = kind === 'customer'
  const data = await all((a, b) => { let q = supabase.from(isC ? 'receivables' : 'payables').select('*').range(a, b); if (isC && f.customer) q = q.eq('customer_id', f.customer); if (!isC && f.supplier) q = q.eq('supplier_id', f.supplier); return q })
  const map = new Map<string, Record<AgingBucket, number>>()
  for (const r of data) { const k = String(isC ? r.customer_name : r.supplier_name); const m = map.get(k) ?? { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }; m[r.aging_bucket as AgingBucket] += num(r.balance); map.set(k, m) }
  const rows = [...map.entries()].map(([k, m]) => ({ k, m, t: AGING_ORDER.reduce((s, b) => s + m[b], 0) })).sort((x, y) => y.t - x.t)
  const tot = AGING_ORDER.map((b) => rows.reduce((s, r) => s + r.m[b], 0))
  return { columns: [isC ? 'Customer' : 'Supplier', ...AGING_ORDER.map((b) => AGING_LABEL[b]), 'Total'], numericCols: [1, 2, 3, 4, 5, 6], rows: [...rows.map((r) => [r.k, ...AGING_ORDER.map((b) => n(r.m[b])), n(r.t)]), ['TOTAL', ...tot.map(n), n(tot.reduce((a, b) => a + b, 0))]],
    summary: [['Total outstanding', U(tot.reduce((a, b) => a + b, 0))], ['Overdue', U(tot.slice(1).reduce((a, b) => a + b, 0))]], note: 'As at today. Buckets are days past the due date.' }
}

async function stockLedger(f: ReportFilters, kinds?: string[]): Promise<ReportResult> {
  const [p, m] = await Promise.all([
    all((a, b) => { let q = supabase.from('inventory_movements').select('movement_date, kind, quantity, unit_cost, balance_after, note, products(name, unit)').gte('movement_date', f.from).lte('movement_date', f.to).order('movement_date', { ascending: false }).range(a, b); if (f.product) q = q.eq('product_id', f.product); if (kinds) q = q.in('kind', kinds); return q }),
    f.product ? Promise.resolve([] as Row[]) : all((a, b) => { let q = supabase.from('material_movements').select('movement_date, kind, quantity, unit_cost, balance_after, note, raw_materials(name, unit)').gte('movement_date', f.from).lte('movement_date', f.to).order('movement_date', { ascending: false }).range(a, b); if (kinds) q = q.in('kind', kinds); return q }),
  ])
  const merged: Row[] = [...p.map((r) => ({ ...r, item: (r.products as { name: string } | null)?.name, unit: (r.products as { unit: string } | null)?.unit, ledger: 'Finished goods' })), ...m.map((r) => ({ ...r, item: (r.raw_materials as { name: string } | null)?.name, unit: (r.raw_materials as { unit: string } | null)?.unit, ledger: 'Raw material' }))]
  const rows = merged.sort((a, b) => String(b.movement_date).localeCompare(String(a.movement_date)))
  return { columns: ['Date', 'Ledger', 'Item', 'Type', 'Quantity', 'Unit cost', 'Value', 'Balance after', 'Note'], numericCols: [4, 5, 6, 7],
    rows: rows.map((r) => [fmtDate(String(r.movement_date)), String(r.ledger), String(r.item ?? ''), STOCK_KIND_LABEL[r.kind as StockKind], `${num(r.quantity) > 0 ? '+' : ''}${n(num(r.quantity))} ${r.unit ?? ''}`, n(Math.round(num(r.unit_cost))), n(Math.round(num(r.quantity) * num(r.unit_cost))), n(num(r.balance_after)), String(r.note ?? '')]),
    summary: [['Movements', String(rows.length)], ['Net value', U(rows.reduce((s, r) => s + num(r.quantity) * num(r.unit_cost), 0))]] }
}

async function stockBalance(f: ReportFilters, which: 'both' | 'goods' | 'materials', mode: 'balance' | 'valuation' | 'low'): Promise<ReportResult> {
  const [p, m] = await Promise.all([which === 'materials' ? [] : all((a, b) => { let q = supabase.from('products').select('name, sku, unit, current_stock, min_stock, avg_cost, status, product_categories(name)').eq('status', 'active').order('name').range(a, b); if (f.product) q = q.eq('id', f.product); return q }),
    which === 'goods' || f.product ? [] : all((a, b) => supabase.from('raw_materials').select('name, unit, current_stock, min_stock, unit_cost, status').eq('status', 'active').order('name').range(a, b))])
  let items = [...(p as Row[]).map((r) => ({ kind: 'Finished goods', name: String(r.name), unit: String(r.unit), qty: num(r.current_stock), min: num(r.min_stock), cost: num(r.avg_cost) })), ...(m as Row[]).map((r) => ({ kind: 'Raw material', name: String(r.name), unit: String(r.unit), qty: num(r.current_stock), min: num(r.min_stock), cost: num(r.unit_cost) }))]
  if (mode === 'low') items = items.filter((i) => i.min > 0 && i.qty <= i.min)
  const val = items.reduce((s, i) => s + Math.max(0, i.qty) * i.cost, 0)
  const rows = items.map((i) => mode === 'valuation' ? [i.kind, i.name, `${n(i.qty)} ${i.unit}`, n(Math.round(i.cost)), n(Math.round(Math.max(0, i.qty) * i.cost))] : [i.kind, i.name, `${n(i.qty)} ${i.unit}`, i.min ? n(i.min) : '—', i.qty < 0 ? 'NEGATIVE' : i.min > 0 && i.qty <= i.min ? 'LOW' : 'OK'])
  return mode === 'valuation' ? { columns: ['Type', 'Item', 'Quantity', 'Avg cost', 'Value'], numericCols: [2, 3, 4], rows: [...rows, ['', 'TOTAL', '', '', n(Math.round(val))]], summary: [['Stock value', U(Math.round(val))]], note: 'Weighted-average cost. Negative stock is valued at zero.' }
    : { columns: ['Type', 'Item', 'Quantity', 'Minimum', 'Status'], numericCols: [2, 3], rows, summary: [['Items', String(items.length)], ['Low or negative', String(items.filter((i) => i.qty < 0 || (i.min > 0 && i.qty <= i.min)).length)]] }
}

async function batchList(f: ReportFilters, mode: 'batches' | 'costs' | 'rejected'): Promise<ReportResult> {
  const data = await all((a, b) => { let q = supabase.from('production_batches').select('batch_no, production_date, status, qty_planned, qty_produced, qty_rejected, qty_accepted, material_cost, other_cost, total_cost, cost_per_unit, products(name)').gte('production_date', f.from).lte('production_date', f.to).neq('status', 'cancelled').order('production_date', { ascending: false }).range(a, b); if (f.product) q = q.eq('product_id', f.product); if (mode === 'rejected') q = q.gt('qty_rejected', 0); return q })
  const pn = (r: Row) => String((r.products as { name: string } | null)?.name ?? '')
  if (mode === 'costs') return { columns: ['Batch', 'Date', 'Product', 'Materials', 'Labour & other', 'Total cost', 'Accepted', 'Cost / unit'], numericCols: [3, 4, 5, 6, 7], rows: data.map((r) => [String(r.batch_no), fmtDate(String(r.production_date)), pn(r), n(num(r.material_cost)), n(num(r.other_cost)), n(num(r.total_cost)), r.status === 'completed' ? n(num(r.qty_accepted)) : '—', r.cost_per_unit ? n(Math.round(num(r.cost_per_unit))) : '—']), summary: [['Total cost', U(sumBy(data, 'total_cost'))]] }
  if (mode === 'rejected') return { columns: ['Batch', 'Date', 'Product', 'Produced', 'Rejected', 'Reject rate'], numericCols: [3, 4, 5], rows: data.map((r) => [String(r.batch_no), fmtDate(String(r.production_date)), pn(r), n(num(r.qty_produced)), n(num(r.qty_rejected)), `${((num(r.qty_rejected) / Math.max(1, num(r.qty_produced))) * 100).toFixed(1)}%`]), summary: [['Rejected units', n(sumBy(data, 'qty_rejected'))]] }
  return { columns: ['Batch', 'Date', 'Product', 'Status', 'Planned', 'Produced', 'Rejected', 'Accepted', 'Total cost'], numericCols: [4, 5, 6, 7, 8], rows: data.map((r) => [String(r.batch_no), fmtDate(String(r.production_date)), pn(r), String(r.status).replace('_', ' '), n(num(r.qty_planned)), n(num(r.qty_produced)), n(num(r.qty_rejected)), n(num(r.qty_accepted)), n(num(r.total_cost))]), summary: [['Batches', String(data.length)], ['Accepted units', n(sumBy(data, 'qty_accepted'))]] }
}

export const REPORTS: ReportDef[] = [
  // ----- Financial -----
  { id: 'cash-flow', group: 'Financial', title: 'Cash flow statement', description: 'Actual money in and out by activity, tying opening to closing cash.', module: 'dashboard', financial: true, filters: ['dates'],
    run: async (f) => { const d = await rpc<CashFlowStatement>('cash_flow_statement', { p_from: f.from, p_to: f.to }); const rows: (string | number)[][] = [['Opening cash', '', '', n(num(d.opening))]]
      for (const s of ['Operating', 'Financing', 'Other']) { const ls = d.lines.filter((l) => l.section === s); if (!ls.length) continue; rows.push([s.toUpperCase() + ' ACTIVITIES', '', '', '']); ls.forEach((l) => rows.push(['   ' + l.label, n(num(l.inflow)), n(num(l.outflow)), n(num(l.net))])) }
      rows.push(['Total inflows / outflows / net', n(num(d.inflows)), n(num(d.outflows)), n(num(d.net))], ['Closing cash', '', '', n(num(d.closing))]); return { columns: ['', 'Money in', 'Money out', 'Net'], numericCols: [1, 2, 3], rows, summary: [['Opening', U(num(d.opening))], ['Net cash flow', U(num(d.net))], ['Closing', U(num(d.closing))]], note: d.note } } },
  { id: 'cashbook', group: 'Financial', title: 'Cashbook', description: 'Date, ref, description, money in / out and running balance.', module: 'cashbook', filters: [], link: '/cashbook' },
  { id: 'pnl', group: 'Financial', title: 'Profit & Loss', description: 'Revenue, cost of goods, expenses and net profit.', module: 'dashboard', financial: true, filters: ['dates'], link: '/reports?tab=pnl',
    run: async (f) => { const d = await rpc<PnL>('profit_and_loss', { p_from: f.from, p_to: f.to }); return { columns: ['', 'UGX'], numericCols: [1], rows: statementRows(d), summary: [['Net profit', U(num(d.net_profit))], ['Gross margin', d.gross_margin_pct == null ? '—' : `${d.gross_margin_pct}%`]], note: d.flags.estimated ? 'ESTIMATED: some dispatched goods have no cost on record.' : undefined } } },
  { id: 'balance-sheet', group: 'Financial', title: 'Balance sheet (provisional)', description: 'Assets, liabilities and net assets as at today, from live balances.', module: 'dashboard', financial: true, filters: [],
    run: async () => { const d = await rpc<BalanceSheet>('balance_sheet', {}); const a = d.assets, l = d.liabilities, e = d.equity; const rows: (string | number)[][] = [['ASSETS', ''], ...a.cash_and_bank.map((c) => ['   ' + c.name, n(num(c.balance))]), ['   Customer receivables', n(num(a.receivables))], ['   Finished goods stock', n(num(a.finished_goods))], ['   Raw materials stock', n(num(a.raw_materials))], ['   Supplier advances', n(num(a.supplier_advances))], ['Total assets', n(num(a.total))],
      ['LIABILITIES', ''], ['   Supplier payables', n(num(l.supplier_payables))], ['   Unpaid expenses', n(num(l.unpaid_expenses))], ['   Payroll owed', n(num(l.payroll_owed))], ['   Customer credit held', n(num(l.customer_credit))], ['   Loans', n(num(l.loans))], ['Total liabilities', n(num(l.total))],
      ['NET ASSETS (owner’s equity)', n(num(e.net_assets))], ['   of which owner contributions', n(num(e.owner_contributions))], ['   less owner withdrawals', n(num(e.owner_withdrawals))], ['   retained earnings & opening capital (balancing)', n(num(e.retained_and_opening_balance))], ['   memo: profit to date per P&L', n(num(e.profit_to_date_per_pl))]]
      return { columns: ['As at ' + fmtDate(d.as_at), 'UGX'], numericCols: [1], rows, summary: [['Total assets', U(num(a.total))], ['Total liabilities', U(num(l.total))], ['Net assets', U(num(e.net_assets))]], note: d.notes.join(' ') } } },
  { id: 'account-statement', group: 'Financial', title: 'Account statement', description: 'Every movement of one account with a running balance.', module: 'cashbook', filters: ['dates', 'account'], requires: 'account',
    run: async (f) => { const d = await rpc<{ opening: number; closing: number; total_in: number; total_out: number; rows: Row[] }>('cashbook_report', { p_from: f.from, p_to: f.to, p_account_id: f.account, p_category_id: f.category || null, p_search: null })
      return { columns: ['Date', 'Ref', 'Description', 'Money in', 'Money out', 'Balance'], numericCols: [3, 4, 5], rows: [['', '', 'Opening balance', '', '', n(num(d.opening))], ...d.rows.map((r) => [fmtDate(String(r.date)), String(r.reference || r.txn_no), String(r.description), num(r.money_in) ? n(num(r.money_in)) : '', num(r.money_out) ? n(num(r.money_out)) : '', n(num(r.balance))]), ['', '', 'Closing balance', n(num(d.total_in)), n(num(d.total_out)), n(num(d.closing))]], summary: [['Opening', U(num(d.opening))], ['Closing', U(num(d.closing))]] } } },
  ...(['day', 'month'] as const).map((g): ReportDef => ({ id: `${g}-summary`, group: 'Financial', title: g === 'day' ? 'Daily financial summary' : 'Monthly financial summary', description: 'Revenue, cost, profit and cash movement per ' + g + '.', module: 'dashboard', financial: true, filters: ['dates'],
    run: async (f) => { const d = await rpc<{ rows: Row[] }>('period_summary', { p_group: g, p_from: f.from, p_to: f.to }); return { columns: [g === 'day' ? 'Date' : 'Month', 'Revenue', 'Cost of goods', 'Expenses', 'Net profit', 'Money in', 'Money out', 'Closing cash'], numericCols: [1, 2, 3, 4, 5, 6, 7],
      rows: d.rows.map((r) => [g === 'day' ? fmtDate(String(r.period)) : String(r.period), n(num(r.revenue)), n(num(r.cogs)), n(num(r.expenses)), n(num(r.net_profit)), n(num(r.money_in)), n(num(r.money_out)), n(num(r.closing_cash))]), summary: [['Revenue', U(sumBy(d.rows, 'revenue'))], ['Net profit', U(sumBy(d.rows, 'net_profit'))]], note: 'Profit here is revenue − cost of goods − operating expenses by event date (before reclassifying collections booked as income).' } } })),
  { id: 'expense-report', group: 'Financial', title: 'Expense report', description: 'Incurred, paid and owing, by category.', module: 'expenses', filters: ['dates', 'category'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('expense_register_v').select('*').gte('expense_date', f.from).lte('expense_date', f.to).eq('status', 'open').order('expense_date', { ascending: false }).range(a, b); if (f.category) q = q.eq('category_id', f.category); return q })
      return { columns: ['Date', 'Ref', 'Category', 'Description', 'Paid to', 'Incurred', 'Paid', 'Owing', 'Approval'], numericCols: [5, 6, 7], rows: data.map((r) => [fmtDate(String(r.expense_date)), String(r.ref_no), String(r.category_name ?? ''), String(r.description), String(r.payee ?? ''), n(num(r.amount)), n(num(r.amount_paid)), n(num(r.balance)), String(r.approval_status)]), summary: [['Incurred', U(sumBy(data.filter((r) => r.approval_status === 'approved'), 'amount'))], ['Owing', U(sumBy(data.filter((r) => r.approval_status === 'approved'), 'balance'))]] } } },
  { id: 'budget', group: 'Financial', title: 'Budget report', description: 'Budget vs actual with variance and last-period comparison.', module: 'budgets', filters: [], link: '/budgets' },
  { id: 'reconciliation', group: 'Financial', title: 'Reconciliation report', description: 'System vs actual balances and differences.', module: 'daily_closing', filters: ['dates', 'account'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('reconciliations').select('reconciliation_date, system_balance, actual_balance, difference, notes, accounts(name)').gte('reconciliation_date', f.from).lte('reconciliation_date', f.to).order('reconciliation_date', { ascending: false }).range(a, b); if (f.account) q = q.eq('account_id', f.account); return q })
      return { columns: ['Date', 'Account', 'System', 'Actual', 'Difference', 'Notes'], numericCols: [2, 3, 4], rows: data.map((r) => [fmtDate(String(r.reconciliation_date)), String((r.accounts as { name: string } | null)?.name ?? ''), n(num(r.system_balance)), n(num(r.actual_balance)), n(num(r.difference)), String(r.notes ?? '')]), summary: [['Net difference', U(sumBy(data, 'difference'))]] } } },
  // ----- Sales -----
  { id: 'sales-day', group: 'Sales', title: 'Sales by day', description: 'Invoiced sales per day.', module: 'sales', filters: ['dates', 'product', 'customer'], run: salesBy('day', 'Date') },
  { id: 'sales-month', group: 'Sales', title: 'Sales by month', description: 'Invoiced sales per month.', module: 'sales', filters: ['dates', 'product', 'customer'], run: salesBy('month', 'Month') },
  { id: 'sales-product', group: 'Sales', title: 'Sales by product', description: 'Quantity and value per product.', module: 'sales', filters: ['dates', 'product', 'customer'], run: salesBy('product', 'Product') },
  { id: 'sales-customer', group: 'Sales', title: 'Sales by customer', description: 'Who buys, and who still owes.', module: 'sales', filters: ['dates', 'product', 'customer'], run: salesBy('customer', 'Customer') },
  { id: 'sales-person', group: 'Sales', title: 'Sales by salesperson', description: 'Invoiced sales per salesperson.', module: 'sales', filters: ['dates', 'product', 'customer'], run: salesBy('salesperson', 'Salesperson') },
  { id: 'credit-sales', group: 'Sales', title: 'Credit sales', description: 'Invoices not yet fully paid.', module: 'sales', filters: ['dates', 'customer'], run: invoiceList('credit') },
  { id: 'paid-sales', group: 'Sales', title: 'Paid sales', description: 'Invoices fully paid.', module: 'sales', filters: ['dates', 'customer'], run: invoiceList('paid') },
  { id: 'outstanding-invoices', group: 'Sales', title: 'Outstanding invoices', description: 'Every open invoice with days overdue.', module: 'debts', filters: ['customer'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('receivables').select('*').order('due_date').range(a, b); if (f.customer) q = q.eq('customer_id', f.customer); return q })
      return { columns: ['Invoice', 'Customer', 'Date', 'Due', 'Total', 'Paid', 'Balance', 'Days overdue'], numericCols: [4, 5, 6, 7], rows: data.map((r) => [String(r.sale_no), String(r.customer_name), fmtDate(String(r.sale_date)), fmtDate(r.due_date as string), n(num(r.total)), n(num(r.amount_paid)), n(num(r.balance)), num(r.days_overdue)]), summary: [['Open invoices', String(data.length)], ['Outstanding', U(sumBy(data, 'balance'))]] } } },
  // ----- Inventory -----
  { id: 'inv-balance', group: 'Inventory', title: 'Inventory balance', description: 'Current stock of finished goods and raw materials.', module: 'inventory', filters: ['product'], run: (f) => stockBalance(f, 'both', 'balance') },
  { id: 'inv-valuation', group: 'Inventory', title: 'Inventory valuation', description: 'Stock value at weighted-average cost.', module: 'inventory', filters: ['product'], run: (f) => stockBalance(f, 'both', 'valuation') },
  { id: 'inv-movement', group: 'Inventory', title: 'Stock movement', description: 'Every stock movement in the period.', module: 'inventory', filters: ['dates', 'product'], run: (f) => stockLedger(f) },
  { id: 'inv-goods', group: 'Inventory', title: 'Finished goods', description: 'Finished goods stock and value.', module: 'inventory', filters: ['product'], run: (f) => stockBalance(f, 'goods', 'valuation') },
  { id: 'inv-materials', group: 'Inventory', title: 'Raw materials', description: 'Raw material stock and value.', module: 'inventory', filters: [], run: (f) => stockBalance(f, 'materials', 'valuation') },
  { id: 'inv-damaged', group: 'Inventory', title: 'Damaged stock', description: 'Stock written off as damaged.', module: 'inventory', filters: ['dates', 'product'], run: (f) => stockLedger(f, ['damage']) },
  { id: 'inv-low', group: 'Inventory', title: 'Low stock', description: 'Items at or below their minimum.', module: 'inventory', filters: [], run: (f) => stockBalance(f, 'both', 'low') },
  // ----- Production -----
  { id: 'prod-date', group: 'Production', title: 'Production by date', description: 'Produced, accepted and rejected per day.', module: 'production', filters: ['dates'],
    run: async (f) => { const d = await rpc<{ by_day: Row[] }>('production_report', { p_from: f.from, p_to: f.to }); return { columns: ['Date', 'Produced', 'Accepted', 'Rejected'], numericCols: [1, 2, 3], rows: d.by_day.map((r) => [fmtDate(String(r.date)), n(num(r.produced)), n(num(r.accepted)), n(num(r.rejected))]), summary: [['Accepted', n(sumBy(d.by_day, 'accepted'))], ['Rejected', n(sumBy(d.by_day, 'rejected'))]] } } },
  { id: 'prod-product', group: 'Production', title: 'Production by product', description: 'Output, cost and cost per unit per product.', module: 'production', filters: ['dates'],
    run: async (f) => { const d = await rpc<{ by_product: Row[] }>('production_report', { p_from: f.from, p_to: f.to }); return { columns: ['Product', 'Batches', 'Produced', 'Accepted', 'Rejected', 'Total cost', 'Cost / unit'], numericCols: [1, 2, 3, 4, 5, 6], rows: d.by_product.map((r) => [String(r.product), num(r.batches), n(num(r.produced)), n(num(r.accepted)), n(num(r.rejected)), n(num(r.cost)), r.cost_per_unit ? n(num(r.cost_per_unit)) : '—']), summary: [['Total cost', U(sumBy(d.by_product, 'cost'))]] } } },
  { id: 'prod-batch', group: 'Production', title: 'Production by batch', description: 'Every batch with quantities and cost.', module: 'production', filters: ['dates', 'product'], run: (f) => batchList(f, 'batches') },
  { id: 'prod-costs', group: 'Production', title: 'Production costs', description: 'Materials, labour and cost per unit by batch.', module: 'production', filters: ['dates', 'product'], run: (f) => batchList(f, 'costs') },
  { id: 'prod-cpu', group: 'Production', title: 'Cost per unit', description: 'Latest cost per unit by product.', module: 'production', filters: ['dates'],
    run: async (f) => { const d = await rpc<{ by_product: Row[] }>('production_report', { p_from: f.from, p_to: f.to }); return { columns: ['Product', 'Accepted units', 'Total cost', 'Cost per unit'], numericCols: [1, 2, 3], rows: d.by_product.map((r) => [String(r.product), n(num(r.accepted)), n(num(r.cost)), r.cost_per_unit ? n(num(r.cost_per_unit)) : '—']) } } },
  { id: 'prod-rejected', group: 'Production', title: 'Rejected products', description: 'Batches with rejected or damaged output.', module: 'production', filters: ['dates', 'product'], run: (f) => batchList(f, 'rejected') },
  // ----- Debts -----
  { id: 'cust-receivables', group: 'Debts', title: 'Customer receivables', description: 'Purchases, payments and balance per customer.', module: 'debts', filters: ['customer'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('customer_balances').select('*').order('outstanding', { ascending: false }).range(a, b); if (f.customer) q = q.eq('id', f.customer); return q })
      return { columns: ['Customer', 'Phone', 'Total purchases', 'Total payments', 'Outstanding', 'Overdue', 'Credit held'], numericCols: [2, 3, 4, 5, 6], rows: data.filter((r) => num(r.outstanding) > 0 || num(r.credit_balance) > 0 || f.customer).map((r) => [String(r.name), String(r.phone ?? ''), n(num(r.total_purchases)), n(num(r.total_payments)), n(num(r.outstanding)), n(num(r.overdue)), n(num(r.credit_balance))]), summary: [['Total owed to you', U(sumBy(data, 'outstanding'))], ['Overdue', U(sumBy(data, 'overdue'))]] } } },
  { id: 'supp-payables', group: 'Debts', title: 'Supplier payables', description: 'What you owe each supplier.', module: 'suppliers', filters: ['supplier'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('supplier_balances').select('*').order('outstanding', { ascending: false }).range(a, b); if (f.supplier) q = q.eq('id', f.supplier); return q })
      return { columns: ['Supplier', 'Phone', 'Total purchases', 'Total payments', 'Outstanding', 'Overdue', 'Advance held'], numericCols: [2, 3, 4, 5, 6], rows: data.filter((r) => num(r.outstanding) > 0 || num(r.credit_balance) > 0 || f.supplier).map((r) => [String(r.name), String(r.phone ?? ''), n(num(r.total_purchases)), n(num(r.total_payments)), n(num(r.outstanding)), n(num(r.overdue)), n(num(r.credit_balance))]), summary: [['Total you owe', U(sumBy(data, 'outstanding'))], ['Overdue', U(sumBy(data, 'overdue'))]] } } },
  { id: 'cust-aging', group: 'Debts', title: 'Customer aging', description: 'Open invoices by days overdue.', module: 'debts', filters: ['customer'], run: agingReport('customer') },
  { id: 'supp-aging', group: 'Debts', title: 'Supplier aging', description: 'Open supplier bills by days overdue.', module: 'suppliers', filters: ['supplier'], run: agingReport('supplier') },
  { id: 'collections', group: 'Debts', title: 'Debt collection history', description: 'Customer payments received.', module: 'debts', filters: ['dates', 'customer', 'account'],
    run: async (f) => { const data = await all((a, b) => { let q = supabase.from('transactions').select('txn_date, amount, receipt_no, payment_method, reference, customers(name), accounts(name)').eq('type', 'customer_payment').eq('status', 'posted').eq('is_reversal', false).gte('txn_date', f.from).lte('txn_date', f.to).order('txn_date', { ascending: false }).range(a, b); if (f.customer) q = q.eq('customer_id', f.customer); if (f.account) q = q.eq('account_id', f.account); return q })
      return { columns: ['Date', 'Receipt', 'Customer', 'Account', 'Method', 'Reference', 'Amount'], numericCols: [6], rows: data.map((r) => [fmtDate(String(r.txn_date)), String(r.receipt_no ?? ''), String((r.customers as { name: string } | null)?.name ?? ''), String((r.accounts as { name: string } | null)?.name ?? ''), String(r.payment_method ?? ''), String(r.reference ?? ''), n(num(r.amount))]), summary: [['Collected', U(sumBy(data, 'amount'))], ['Receipts', String(data.length)]] } } },
]
