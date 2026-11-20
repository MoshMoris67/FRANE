# FRANE CONCRETE FACTORY — Deployment & go-live guide

## 1. What you need
- A **Supabase** project (database, login, file storage). The free plan works for trying it out; use a paid plan for real operations so you get daily backups.
- A static web host: **Netlify**, **Vercel** or **Cloudflare Pages** (all included below). Nothing runs on your own server.
- Node.js 20+ on one computer, only to build the app.

## 2. Create the backend (about 10 minutes)
1. supabase.com → **New project**. Pick the nearest available region and a strong database password (store it in a password manager).
2. **SQL Editor → New query**, paste the whole of `supabase/all_migrations.sql`, **Run**. It must finish with no errors. (This creates every table, security rule, function and the storage buckets.)
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key. *Never* use or share the `service_role` key anywhere in this app.
4. **Authentication → Providers → Email**: keep email sign-in on. Turn **Confirm email** on if you can set up an email sender (Authentication → SMTP); otherwise leave it off for the first-day setup and turn it on afterwards.
5. **Authentication → URL Configuration**: set **Site URL** to your final web address (step 3 below).

## 3. Publish the web app
```bash
cp .env.example .env      # then edit: VITE_SUPABASE_URL=… and VITE_SUPABASE_ANON_KEY=…
npm install
npm run build             # creates the dist/ folder
```
- **Netlify**: add a new site from this repo (build command `npm run build`, publish folder `dist`), or drag-and-drop `dist/`. Add the two `VITE_…` variables under *Site settings → Environment variables*. `netlify.toml` and `public/_redirects` already make page refreshes work.
- **Vercel**: import the repo; framework **Vite**; add the two variables. `vercel.json` handles routing.
- **Cloudflare Pages**: build command `npm run build`, output `dist`, add the variables; `public/_redirects` handles routing.

The app can be “installed” on a phone (Share/⋮ menu → *Add to Home screen*). It needs an internet connection; there is no offline mode.

## 4. First-run checklist (do these in order, **before** sharing the link with staff)
1. Open the app and **create your account first — the first account becomes the Owner.** Do not share the address until this is done.
2. **Settings → Company**: name, address, phone, email, TIN, logo, payment methods, invoice/receipt prefixes, default credit days.
3. **Settings → Controls & approvals**: expense approval threshold, daily-closing tolerance, budget warning level.
4. **Settings → Categories**: review expense/income categories; add your own.
5. Create staff logins: each person signs up on the login page, then in **Settings → Users & permissions** you give them a role (and review the permission grid). Then, in Supabase **Authentication → Providers → Email**, **disable new sign-ups** so strangers cannot create accounts.
6. Move your books in: follow section 5.

## 5. Moving from the handwritten books (cut-over)
Pick a **cut-over date** (e.g. the 1st of a month) and prepare, *as at that date*: each account’s balance, finished-goods and raw-material counts, what customers owe you, what you owe suppliers.

**Settings → Import data** — in this order (each file is checked first; nothing is saved until you confirm; the same file can’t be imported twice):

| Step | File | Notes |
|---|---|---|
| 1 | Accounts + opening balances | Cash box, banks, mobile money |
| 2 | Products & prices | SKU, size, price |
| 3–5 | Customers, suppliers, employees | |
| 6–7 | Opening stock (finished goods, raw materials) | Include a cost per unit or profit will be overstated |
| 8–9 | Customer debts / supplier debts | Debts only — not revenue/expense |
| 10–11 | Historical sales / expenses (optional) | For past-period reports; move no cash and no stock |

Then: **Settings → Backup & demo data → Run integrity check** (must show *All checks passed*), and **Daily Closing → Reconcile** each account against the real cash / bank statement / MoMo balance. Run the old books and the system **in parallel for a week**, comparing the cashbook balance with your cash box each evening, before you stop the old books.

> Cash history before the cut-over is *not* reproduced in the cashbook — the opening balances carry it. Historical sales/expenses affect reports only.

## 6. Backups and recovery
- **Primary safety net**: Supabase database backups — daily on paid plans; enable **Point-in-Time Recovery** if you can (Project Settings → Database → Backups). Know how to restore from there.
- **Your own copy**: **Settings → Backup & demo data → Excel / JSON** downloads every record with its IDs (transactions, sales, stock, payroll, audit log…). Do it weekly and keep dated copies off the computer. It is for reconciliation and rebuilding, not a one-click restore.
- Uploaded receipts live in Supabase Storage (bucket `attachments`; the logo is in `branding`). Include them in your backup routine (Storage → download), or rely on Supabase project backups.
- Test a restore into a *separate* Supabase project once, before you need it.

## 7. Security checklist
- Row-level security is on for every table; browsers hold only the public **anon** key. Money tables cannot be written directly — only through controlled database functions, which check the user’s role. (`supabase/tests/` proves this.)
- Use long unique passwords for every login; the Owner login especially. Turn on two-factor sign-in for your **Supabase dashboard** account.
- Deactivate staff who leave (**Settings → Users**) — their access stops immediately.
- Review **Settings → Audit log** regularly (reversals, edits, adjustments, reopenings, permission changes).
- Keep the `service_role` key and database password out of the repo and out of the hosting variables for this app.

## 8. Upgrading later
New versions ship new numbered files in `supabase/migrations/` (e.g. `0007_…sql`). Run only the *new* files, in order, in the SQL editor; then deploy the new web build. Take a backup first.

## 9. Verifying a deployment (developers)
```bash
npm run typecheck && npm test                # unit tests (parsing, exports, formatting)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:db     # ~400 database checks on a scratch PostgreSQL
bash supabase/tests/concurrency.sh           # parallel-session race tests
bash supabase/tests/perf.sh                  # 200k-row volume test
npm run qa                                   # browser QA at 4 screen sizes (needs: npm i -D playwright && npx playwright install chromium)
```

## 10. Known limitations
No offline mode · UGX only · fixed Africa/Kampala timezone and DD/MM/YYYY display · no VAT/tax computation · no fixed assets or depreciation (the balance sheet is provisional) · single site (no stock transfers between locations) · no e-mail/SMS notifications · imports are all-or-nothing and cannot be undone (reverse or adjust records instead) · full restore is a database-level operation (see section 6).
