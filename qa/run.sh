#!/usr/bin/env bash
# Builds the app against a mock Supabase URL, serves it, runs the browser QA, cleans up.
set -e
cd "$(dirname "$0")/.."
VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mockkey npx vite build --outDir dist-qa >/dev/null
npx vite preview --outDir dist-qa --port 4173 >/tmp/frane-qa-preview.log 2>&1 &
PID=$!; trap "kill $PID 2>/dev/null; rm -rf dist-qa" EXIT; sleep 2
node qa/ui-qa.cjs
