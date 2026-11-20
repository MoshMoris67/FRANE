# FRANE CONCRETE FACTORY — Management System

React + TypeScript + Tailwind + Supabase (Auth, PostgreSQL, RLS, Storage). Currency UGX, dates DD/MM/YYYY, timezone Africa/Kampala.

## Status
**Phase 1 (Foundation) — complete:** branded shell, auth, RBAC + RLS, accounts, immutable transaction ledger (record / transfer / edit / reverse, audited),
cashbook with Excel/CSV/PDF export, live dashboard, settings, audit log, backup export, removable demo data.

**Phase 2 (Commercial) — complete:** customers (balances, history, statements), multi-line sales with draft → confirmed invoices, discounts, transport,
immediate or credit payment, delivery tracking, cancellation with reason; customer payments with oldest-first or manual invoice allocation, partial and
multiple payments, customer credit; receivables with aging; suppliers, supplier invoices (materials vs expense), supplier payments with allocation, payables
with aging; product catalogue & price list; printable/PDF invoices, receipts and customer/supplier statements; dashboard receivables/payables/orders cards and alerts.

**Phase 3 (Manufacturing) — complete:** finished-goods stock and raw materials with a full movement ledger and weighted-average costing; goods receipt
(stock up + supplier payable); production batches (plan → in progress → completed/cancelled) with material consumption, labour and other costs (incurred vs paid),
accepted/rejected output and cost per unit; controlled stock deduction at dispatch; returns, damage, adjustments, opening stock; COGS and stock losses in the
dashboard; production reports; low-stock / shortage / negative-stock alerts.

**Phase 4 (Management) — complete:** Expenses register (incurred vs paid vs owing, part-payments, approval thresholds, receipts, duplicate check, edit/cancel with audit, charts and Excel/CSV/PDF export, one list across expenses, supplier expense invoices and legacy cash expenses);
payroll & labour (employees, daily/monthly pay, overtime, allowances, deductions, approve → pay, summaries by day/week/month, labour charged to a production batch); budgets (monthly/quarterly/yearly by category, department, total or production, actual vs budget, last-period comparison, over-budget alerts, every change audited with a reason);
daily closing (expected vs counted cash, note/coin counting, variance explanation, optional manager approval, reopen with reason, printable report) and account reconciliation (optional audited adjustment); dashboard controls and alerts.

**Phase 5 (Analytics) — complete:** Profit & Loss (accrual, with previous-period comparison, product profitability, an “estimated” banner when costing is incomplete, and a memo of what is deliberately *not* in profit); cash-flow statement; provisional balance sheet; daily/monthly summaries;
cash-flow **forecast** (7/30/60/90 days, adjustable collection and payment assumptions, planned items, shortage alerts — always labelled as a projection); a library of 35 reports with date/product/customer/supplier/category/account filters and Excel/CSV/PDF export; a filterable audit log with before/after diffs and CSV export; a data-integrity check.

**Not built yet:** bulk CSV/Excel import of historical data (opening balances, debts, stock, sales) and the final QA pass (Phase 6).

## Setup
1. Create a Supabase project. In the SQL editor run, in order, `supabase/migrations/0001_foundation.sql`, `0002_commercial.sql`, then `0003_manufacturing.sql`, `0004_management.sql`, then `0005_analytics.sql`.
2. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. `npm install && npm run dev`
4. Open the app and **create the first account — it automatically becomes the Owner.** Other staff sign up and wait
   for the Owner to assign a role in Settings → Users & permissions. (Consider disabling public sign-ups in Supabase
   Auth settings once your staff are registered.)
5. Accounts → add your cash box / bank / mobile money with today's opening balances. Optionally Settings → Backup & demo data → load demo data to explore, then remove it.

## Accounting rules enforced in the database
- Ledger is append-only: no direct insert/update/delete (RLS + trigger); only `record_transaction`, `record_transfer`, `edit_transaction`, `reverse_transaction`.
- Balance = opening + Σin − Σout over all ledger rows; reversals post an opposite entry and the original stays, flagged.
- Revenue/expense reports use posted, non-reversed `income` / `expense` rows only. Transfers, loans, owner capital/drawings,
  customer collections and supplier payments are never revenue or expense.
- Overdrafts blocked unless the account allows them; duplicate suspicion prompts for confirmation; retries are idempotent.
- Dashboard “estimated profit” is cash-basis until Sales (credit) and Production (cost of goods) exist, and is labelled as such.

- Payments are ledger rows (`customer_payment` / `supplier_payment`) plus allocation tables; one book, no duplicate entry. Reversing a payment releases its allocations and re-opens the invoices.
- Revenue = confirmed invoices (by invoice date) + other income. Collections are never revenue. Credit sales raise receivables, not cash.
- Supplier invoices of kind *expense* are recognised as an expense on invoice date (paying them is not a second expense). Kind *materials* is held as inventory and is not expensed until Phase 3 production consumption.
- Confirmed invoices are immutable; invoice line prices are copied at sale time; invoice numbers are assigned on confirmation (drafts never leave gaps).
- Stock leaves exactly once, when a sale is marked Dispatched/Delivered (`sales.stock_deducted_at`); confirming a sale never moves stock. Orders can't be moved back after dispatch — record a return.
- Costing is perpetual weighted-average. Purchases go to inventory (not expense); materials reach cost only when a batch consumes them. Cement/sand/aggregate/stone dust are blocked as direct expenses (category flag, editable in Settings) so they can't be counted twice.
- Batch labour/other costs are ledger expenses tagged with the batch; they are excluded from period operating expenses and reach profit as COGS when the goods are dispatched. A cancelled batch releases any cash already paid back into operating expenses.
- Dashboard costs = operating expenses + cost of goods dispatched + stock losses. If dispatched goods have no cost on record the dashboard says profit is overstated.
- Stock can't go negative silently: only a manager can override, and the movement is flagged and alerted.
- Expenses are accrual records: incurred when recorded (and approved), paid later by `expense_payment` ledger rows allocated to them. A payment is never a second expense. Pending/rejected expenses are not counted and cannot be paid. The person who recorded an expense (or payroll, or a closing) cannot approve it unless they are the Owner.
- Payroll cost is incurred when approved (take-home pay) and paid by a ledger payment; payroll tagged to an open batch is that batch's labour cost (inventory cost) rather than operating expense. Payroll data is restricted by the `payroll` permission (off for managers by default).
- Budgets are written only through `save_budget` (reason + before/after audit). Actuals come from approved expenses, supplier expense invoices, legacy cash expenses and payroll, or batch costs for production budgets.
- Daily closing never edits the ledger; it records expected vs counted, requires an explanation for variances, and a reconciliation row. Reopening needs a reason and is audited.
- Staff names for "recorded by" labels come from a names-only view; the profiles table (phones etc.) stays private.
- **Profit & Loss** = invoiced sales (+ manual entries in 'Sales' categories) − cost of goods (stock dispatched at weighted-average cost, returns, losses, production write-offs) − operating expenses (approved expenses, expense invoices, payroll not charged to batches) + other income − other expenses. Customer collections booked as income, transfers, loans, owner flows, supplier payments, material purchases and batch costs are excluded and disclosed in the memo. Product profitability allocates invoice discounts across lines and uses the actual dispatch cost (estimated from current average cost, and marked, when not yet dispatched).
- **Balance sheet** is provisional: it is built from live balances as at today, equity is the balancing figure, and fixed assets/depreciation/tax are not tracked.
- **Forecast** never writes to the ledger. It starts from actual balances, applies the collection percentages to open invoices (it does not assume all debts are collected on time), adds expected new sales (cash share learnt from history unless overridden), supplier bills by due date, approved unpaid payroll/expenses, recurring expense and payroll run-rates, and planned items. Financial reports and the forecast require both `reports` and `dashboard` permissions (cashiers and supervisors get only the operational reports for their modules).
- Internal database helpers are not callable by signed-in users: migration 0003 revokes `EXECUTE` from `authenticated` on everything and re-grants an explicit allow-list (Supabase otherwise grants it by default).
- Supplier/payables data is restricted to the `suppliers` permission (cashiers see customer debts only).

## Tests
- `npm test` — date/format helpers.
- `supabase/tests/run.sh` — 326 database checks (Phases 1–5) (balances, transfers, reversals, edits, RLS, roles, audit, demo data) against a scratch local PostgreSQL
  (`PGHOST=… PGPORT=… PGUSER=postgres ./supabase/tests/run.sh`).
