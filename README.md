# FRANE CONCRETE FACTORY — Management System

React + TypeScript + Tailwind + Supabase (Auth, PostgreSQL, RLS, Storage). Currency UGX, dates DD/MM/YYYY, timezone Africa/Kampala.

## Status
**Phase 1 (Foundation) — complete & tested:** branded shell, Supabase auth, RBAC + RLS, accounts, immutable transaction ledger
(record / transfer / edit / reverse with audit), cashbook with running balance and Excel/CSV/PDF export, live dashboard,
settings (company, categories, users & permissions, audit log, backup export, removable demo data).
Phases 2–5 (sales, customers, suppliers, inventory, production, expenses, payroll, budgets, daily closing, P&L, forecasting, reports)
appear in the sidebar tagged P2–P5 and are not built yet.

## Setup
1. Create a Supabase project. In the SQL editor run `supabase/migrations/0001_foundation.sql`.
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

## Tests
- `npm test` — date/format helpers.
- `supabase/tests/run.sh` — 50 database checks (balances, transfers, reversals, edits, RLS, roles, audit, demo data) against a scratch local PostgreSQL
  (`PGHOST=… PGPORT=… PGUSER=postgres ./supabase/tests/run.sh`).
