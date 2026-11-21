#!/usr/bin/env bash
# Applies all migrations + runs every test file against a throwaway local PostgreSQL.
# Usage: PGHOST=/tmp/pgt PGPORT=5544 PGUSER=postgres ./supabase/tests/run.sh
set -e
D=$(dirname "$0"); P="psql -q"
$P -c "drop database if exists frane_test" -c "create database frane_test"
$P -c "create role anon nologin" 2>/dev/null || true; $P -c "create role authenticated nologin" 2>/dev/null || true
$P -d frane_test -f "$D/stub_supabase.sql"
for m in "$D"/../migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d frane_test -f "$m"; done
# the single-file schema must match the individual migrations
( cd "$D/.." && bash build_all.sh >/dev/null && git diff --quiet -- all_migrations.sql 2>/dev/null ) || echo "NOTE: supabase/all_migrations.sql was regenerated — commit it"
for t in "$D"/phase*_test.sql; do echo "== $(basename "$t")"; $P -d frane_test -f "$t" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/.*NOTICE:  //'; done

# Accounting-identity audit runs on its own FRESH database (zero opening balances)
echo "== audit_identity.sql"
$P -c "drop database if exists frane_audit" -c "create database frane_audit"
$P -d frane_audit -f "$D/stub_supabase.sql"
for m in "$D"/../migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d frane_audit -f "$m"; done
$P -d frane_audit -f "$D/audit_identity.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/.*NOTICE:  //'
