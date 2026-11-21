# FRANE CONCRETE FACTORY — security notes

## What the database enforces (verified by `supabase/tests`)
- Row Level Security is ON for every table; `anon` has no table or function access at all.
- Money tables (transactions, allocations, stock ledgers, audit log) cannot be written directly by anyone — only through
  checked functions. Nobody, owner included, can edit or delete a ledger row or an audit entry; mistakes are reversed, not erased.
- Every function checks the caller's role/permission itself (`has_perm`); views carry the same check.
- An account's opening balance locks once it has any activity (migration 0007).
- Every numeric column refuses NaN/Infinity (migration 0007).
- File uploads: receipts are images/PDF ≤ 5 MB; the logo is PNG/JPEG/WebP ≤ 2 MB and only the Owner can replace it.
- Browser headers (netlify.toml): CSP, HSTS, no framing, no sniffing, restricted browser features.

Run the whole suite any time: `PGHOST=/tmp/pgt PGPORT=5544 PGUSER=postgres ./supabase/tests/run.sh`
(`phase7_security_test.sql` attacks the database as cashier, manager, role-less, deactivated and anonymous users;
`audit_identity.sql` proves assets − liabilities = contributions − drawings + profit on a messy fresh ledger.)

## Settings only you can change (Supabase dashboard → they are not in the code)
1. **Authentication → Sign In / Providers → Email**: turn **Confirm email ON** (after the first owner exists), and turn **Allow new users to sign up OFF**
   once your staff have accounts. Add staff with *Authentication → Users → Add user*, then give them a role in the app (Settings → Users).
2. **Authentication → Providers → Email → Password**: minimum length 10+, and enable **leaked-password protection** if your plan has it.
3. **Authentication → URL Configuration**: Site URL = `https://franeconcretefactory.netlify.app`; add the same to Redirect URLs. Remove `localhost` entries.
4. **Authentication → Multi-Factor**: enable TOTP and have the Owner enrol an authenticator app.
5. **Project Settings → API**: only the publishable (anon) key belongs in Netlify. The `service_role` / secret key must never be put in Netlify, GitHub or the app.
6. **Database → Backups**: enable daily backups (Pro plan: Point-in-Time Recovery). Download a manual backup before big imports.
7. **GitHub**: keep the FRANE repository **private**; protect `main` (require review) once more than one person pushes.
8. Upgrading an existing database: run `supabase/migrations/0007_audit_fixes.sql` once in the SQL editor (new projects: `all_migrations.sql` already includes it).
