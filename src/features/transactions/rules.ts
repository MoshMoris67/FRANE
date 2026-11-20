import type { TxnType } from '../../lib/types'

export interface TypeRule {
  type: TxnType; label: string; direction: 'in' | 'out' | 'choose'
  category?: 'income' | 'expense'; party?: 'customer' | 'supplier'; partyRequired?: boolean
  effect: string // plain-language statement of the accounting effect
}

export const TYPE_RULES: TypeRule[] = [
  { type: 'income', label: 'Income (sale / other income)', direction: 'in', category: 'income', party: 'customer', effect: 'Money in. Counts as revenue.' },
  { type: 'expense', label: 'Expense', direction: 'out', category: 'expense', party: 'supplier', effect: 'Money out. Counts as an expense.' },
  { type: 'customer_payment', label: 'Customer payment (debt collection)', direction: 'in', party: 'customer', partyRequired: true, effect: 'Money in. NOT new revenue — the sale was already counted when it was made. Applied automatically to the customer’s oldest unpaid invoices (use the customer page to choose invoices).' },
  { type: 'supplier_payment', label: 'Supplier payment', direction: 'out', party: 'supplier', partyRequired: true, effect: 'Money out. Settles supplier invoices (oldest due first); not a new expense.' },
  { type: 'loan_received', label: 'Loan received', direction: 'in', effect: 'Money in. NOT revenue — it is a liability.' },
  { type: 'loan_repayment', label: 'Loan repayment (principal)', direction: 'out', effect: 'Money out. NOT an operating expense.' },
  { type: 'owner_contribution', label: 'Owner contribution', direction: 'in', effect: 'Money in. NOT revenue — it is owner capital.' },
  { type: 'owner_withdrawal', label: 'Owner withdrawal', direction: 'out', effect: 'Money out. NOT an operating expense — it is owner drawings.' },
  { type: 'refund', label: 'Refund (paid out)', direction: 'out', party: 'customer', effect: 'Money out to a customer.' },
  { type: 'adjustment', label: 'Adjustment (manager only)', direction: 'choose', effect: 'Corrects an account balance. Requires a reason. Fully audited.' },
]
export const ruleFor = (t: TxnType) => TYPE_RULES.find((r) => r.type === t)!
