# Specification coverage

Status: ✅ built and tested · 🟡 built with a stated limit · ❌ not built. “Tests” point to `supabase/tests/phaseN_test.sql` (database rules), `src/lib/*.test.ts` (unit), `qa/ui-qa.cjs` (browser).

| Spec | Requirement | Status | Notes / where tested |
|---|---|---|---|
| 1 | React + TS, Tailwind, Supabase Auth/Postgres/Storage, charts, Lucide, RLS | ✅ | RLS lockdown, role & read matrices: phase 6 |
| 2 | UGX, DD/MM/YYYY, Africa/Kampala, branding | 🟡 | Fixed (not editable) per spec defaults; native date pickers follow the browser locale |
| 3 | 15-module navigation, collapsible, mobile nav | ✅ | qa: 4 screen sizes |
| 4 | Executive dashboard, charts, ranges, alerts, clickable KPIs | ✅ | Alerts: overdue debts, due bills, low stock, shortages, budgets, unreconciled, projected cash, orders |
| 5 | Transactions: all types, safeguards, edit audit, reversals, no deletes | ✅ | phase 1 |
| 6 | Cashbook, running balance, filters, Excel/CSV/PDF | ✅ | phase 1; exports: unit + qa |
| 7 | Accounts, transfers, reconciliation | ✅ | phase 1, 4 |
| 8 | Sales, multi-line invoices, statuses, delivery, printable docs, controlled stock deduction | ✅ | phase 2, 3 |
| 9–10 | Customers, receivables, aging, payment allocation, statements | ✅ | phase 2 |
| 11 | Products & inventory ledger, valuation, low-stock, no silent negatives | 🟡 | Stock *transfers between locations* not built (single site) |
| 12 | Production batches, costing, cost per unit, reports | ✅ | phase 3 |
| 13 | Raw materials, purchases, consumption, no double counting | 🟡 | Per-material default supplier exists in the database, not shown in the UI |
| 14 | Expenses: incurred vs paid, approvals, receipts, reports | ✅ | phase 4 |
| 15–16 | Suppliers, payables, aging, allocation, statements | ✅ | phase 2 |
| 17 | Payroll & labour, batch-linked labour, restricted access | ✅ | phase 4 |
| 18 | Profit & Loss, product profitability, estimated-profit flag | ✅ | phase 5 |
| 19 | Budgets, alerts, audited changes, history | ✅ | phase 4 |
| 20 | Cash-flow forecast 7/30/60/90, adjustable, actual vs forecast separated | ✅ | phase 5 |
| 21 | Daily closing, denominations, approval, reopen with audit | ✅ | phase 4 |
| 22 | Reports library with filters and exports; balance sheet | 🟡 | 35 reports; balance sheet is provisional (no fixed assets/depreciation) |
| 23 | Branded documents: invoice, receipt, statements, purchase record, daily cash report | ✅ | Logo supported |
| 24 | Roles + database-level enforcement | ✅ | 200-cell role matrix + 115-cell read matrix |
| 25 | Audit trail with filters/diffs/export | ✅ | |
| 26 | Settings | 🟡 | Currency/date format/timezone are fixed by design |
| 27 | Relational schema, FKs, indexes, transactions for money | ✅ | Tables are named for what they hold; payments live in `transactions` with allocation tables (one book, no duplication) |
| 28 | Import (CSV/Excel), opening balances, history, backup/export | 🟡 | Import is all-or-nothing and not undoable; full restore is database-level (see DEPLOYMENT) |
| 29 | Design system, mobile-first | ✅ | qa: no overflow, labelled controls, ≥32px tap targets on phones |
| 30 | The 20 core business rules | ✅ | Each has at least one test; integrity check re-verifies on live data |
| Not in scope | VAT/tax calculation, e-mail/SMS notifications, offline mode, multi-currency, multi-branch | ❌ | |
