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

Phases 4–5 (expenses/payroll/budgets/daily closing, P&L/forecast/reports) are tagged P4–P5 in the sidebar and not built yet.

## Setup
1. Create a Supabase project. In the SQL editor run, in order, `supabase/migrations/0001_foundation.sql`, `0002_commercial.sql`, then `0003_manufacturing.sql`.
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
- Internal database helpers are not callable by signed-in users: migration 0003 revokes `EXECUTE` from `authenticated` on everything and re-grants an explicit allow-list (Supabase otherwise grants it by default).
- Supplier/payables data is restricted to the `suppliers` permission (cashiers see customer debts only).

## Tests
- `npm test` — date/format helpers.
- `supabase/tests/run.sh` — 180 database checks (Phases 1–3) (balances, transfers, reversals, edits, RLS, roles, audit, demo data) against a scratch local PostgreSQL
  (`PGHOST=… PGPORT=… PGUSER=postgres ./supabase/tests/run.sh`).
