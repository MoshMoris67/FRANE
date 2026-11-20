#!/usr/bin/env bash
# Runs migration + Phase 1 tests against a throwaway local PostgreSQL (needs psql and a running server).
# Usage: PGHOST=/tmp/pgt PGPORT=5544 PGUSER=postgres ./supabase/tests/run.sh
set -e
D=$(dirname "$0"); P="psql -q"
$P -c "drop database if exists frane_test" -c "create database frane_test"
$P -c "create role anon nologin" 2>/dev/null || true; $P -c "create role authenticated nologin" 2>/dev/null || true
$P -d frane_test -f "$D/stub_supabase.sql"
$P -d frane_test -f "$D/../migrations/0001_foundation.sql"
$P -d frane_test -f "$D/phase1_test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/.*NOTICE:  //'
