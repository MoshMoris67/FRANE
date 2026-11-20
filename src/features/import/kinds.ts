import type { FieldDef } from '../../lib/import'

export interface ImportKind { id: string; step: number; title: string; description: string; warning?: string; fields: FieldDef[] }

const T = (key: string, label: string, required = false, aliases: string[] = [], help?: string): FieldDef => ({ key, label, required, type: 'text', aliases, help })
const N = (key: string, label: string, required = false, aliases: string[] = [], help?: string): FieldDef => ({ key, label, required, type: 'number', aliases, help })
const D = (key: string, label: string, required = false, aliases: string[] = [], help?: string): FieldDef => ({ key, label, required, type: 'date', aliases, help })

export const IMPORT_KINDS: ImportKind[] = [
  { id: 'accounts', step: 1, title: 'Money accounts & opening balances', description: 'Cash box, bank and mobile-money accounts with the balance each held on your start date.',
    warning: 'Opening balances are not transactions. Enter each account once; existing accounts are skipped and never changed.',
    fields: [T('name', 'Account name', true), T('type', 'Type', true, ['account type'], 'cash, bank, mobile money or other'), N('opening_balance', 'Opening balance', false, ['balance', 'opening']), T('account_ref', 'Account number', false, ['reference', 'account no']), T('description', 'Description')] },
  { id: 'products', step: 2, title: 'Products & prices', description: 'Your catalogue: blocks, pavers and other products.',
    fields: [T('sku', 'SKU', true, ['code', 'product code']), T('name', 'Product name', true, ['name', 'product']), T('category', 'Category'), T('dimensions', 'Dimensions', false, ['size']), T('unit', 'Unit'), N('selling_price', 'Selling price', true, ['price']), N('production_cost_estimate', 'Cost estimate', false, ['cost']), N('min_stock', 'Minimum stock', false, ['minimum', 'reorder level']), T('description', 'Description')] },
  { id: 'customers', step: 3, title: 'Customers', description: 'Customer list. Duplicates (same name and phone) are skipped.',
    fields: [T('name', 'Name', true, ['customer', 'customer name']), T('phone', 'Phone', false, ['telephone', 'mobile', 'contact']), T('location', 'Location', false, ['address', 'town']), T('customer_type', 'Customer type', false, ['type'], 'individual, contractor, construction company, dealer, other'), T('email', 'Email'), T('notes', 'Notes')] },
  { id: 'suppliers', step: 4, title: 'Suppliers', description: 'Supplier list.',
    fields: [T('name', 'Name', true, ['supplier', 'supplier name']), T('phone', 'Phone', false, ['telephone', 'mobile']), T('location', 'Location', false, ['address']), T('contact_person', 'Contact person', false, ['contact']), T('supplied_materials', 'Supplies', false, ['materials']), T('notes', 'Notes')] },
  { id: 'employees', step: 5, title: 'Employees', description: 'Workers and their wage or salary rates.',
    fields: [T('name', 'Name', true, ['employee', 'full name']), T('role', 'Role', false, ['position', 'job']), T('phone', 'Phone'), T('employment_type', 'Employment type', false, ['type'], 'permanent, casual, daily or production'), T('pay_basis', 'Pay basis', false, ['paid by'], 'daily or monthly'), N('rate', 'Rate', true, ['wage', 'salary', 'daily wage'])] },
  { id: 'opening_stock', step: 6, title: 'Opening stock — finished goods', description: 'What you hold today, with the cost per unit.', warning: 'Import products first. Each product can have opening stock only once. Without a cost, profit on these goods will be overstated.',
    fields: [T('sku', 'SKU', true, ['code', 'product code']), N('quantity', 'Quantity', true, ['qty', 'stock']), N('unit_cost', 'Unit cost', false, ['cost', 'cost per unit'])] },
  { id: 'material_opening', step: 7, title: 'Opening stock — raw materials', description: 'Cement, sand, aggregate etc. on hand today.', warning: 'The material names must already exist under Inventory → Raw materials.',
    fields: [T('name', 'Material', true, ['material name', 'item']), N('quantity', 'Quantity', true, ['qty', 'stock']), N('unit_cost', 'Unit cost', false, ['cost', 'cost per unit'])] },
  { id: 'opening_receivables', step: 8, title: 'Debts customers owe you', description: 'One row per unpaid invoice (or one total per customer). Customers must already exist.',
    warning: 'These are debts, not sales: they never count as revenue. Customers can pay them off in the normal way.',
    fields: [T('customer', 'Customer', true, ['customer name', 'name']), N('amount', 'Amount owed', true, ['amount', 'balance', 'outstanding']), D('invoice_date', 'Invoice date', true, ['date']), D('due_date', 'Due date'), T('reference', 'Reference', false, ['invoice no', 'book ref'])] },
  { id: 'opening_payables', step: 9, title: 'Debts you owe suppliers', description: 'One row per unpaid supplier bill. Suppliers must already exist.',
    warning: 'These are debts, not expenses: they never count as expenses. You pay them off in the normal way.',
    fields: [T('supplier', 'Supplier', true, ['supplier name', 'name']), N('amount', 'Amount owed', true, ['amount', 'balance', 'outstanding']), D('invoice_date', 'Invoice date', true, ['date']), D('due_date', 'Due date'), T('reference', 'Reference', false, ['invoice no']), T('description', 'Description')] },
  { id: 'historical_sales', step: 10, title: 'Historical sales (past records)', description: 'Past invoices from your books so reports show history. Rows with the same Invoice ref become lines of one invoice.',
    warning: 'These count as revenue in their own dates but move NO cash and NO stock (cash is in the opening balances; stock in the opening stock). “Paid amount” is what the customer had already paid.',
    fields: [T('invoice_ref', 'Invoice ref', false, ['invoice', 'invoice no', 'reference']), D('date', 'Date', true, ['invoice date']), T('customer', 'Customer', true, ['customer name']), T('sku', 'SKU', false, ['code', 'product code'], 'or give a description instead'), T('description', 'Description'), N('quantity', 'Quantity', true, ['qty']), N('unit_price', 'Unit price', true, ['price']), N('discount', 'Discount'), N('paid_amount', 'Paid amount', false, ['paid']), D('due_date', 'Due date')] },
  { id: 'historical_expenses', step: 11, title: 'Historical expenses (past records)', description: 'Past expenses so reports show history.', warning: 'These count as expenses on their own dates but move NO cash. Leave “Paid amount” empty if it was paid in full.',
    fields: [D('date', 'Date', true), T('category', 'Category', true, ['expense category']), T('description', 'Description', true, ['details']), N('amount', 'Amount', true), N('paid_amount', 'Paid amount', false, ['paid']), T('payee', 'Paid to', false, ['payee', 'recipient']), T('reference', 'Reference', false, ['receipt', 'voucher'])] },
]
