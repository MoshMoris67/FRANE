#!/usr/bin/env bash
# Volume test: ~200k ledger rows + 20k invoices, then time the heaviest screens/reports.
# Usage: PGHOST=/tmp/pgt PGPORT=5544 PGUSER=postgres ./supabase/tests/perf.sh   (set LIMIT_MS to change the pass mark, default 2000)
set -u
D=$(cd "$(dirname "$0")" && pwd); P="psql -q -At"; DB=frane_perf; OWNER=aaaaaaaa-0000-0000-0000-000000000002; LIMIT=${LIMIT_MS:-2000}
$P -c "drop database if exists $DB" -c "create database $DB" >/dev/null; $P -c "create role anon nologin" 2>/dev/null; $P -c "create role authenticated nologin" 2>/dev/null
$P -d $DB -f "$D/stub_supabase.sql" >/dev/null 2>&1
for m in "$D"/../migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d $DB -f "$m" >/dev/null 2>&1 || { echo "migration failed: $m"; exit 1; }; done
$P -d $DB -c "insert into auth.users(id,email) values ('$OWNER','o@x')" >/dev/null
echo "generating data…"
$P -d $DB >/dev/null <<'SQL'
select set_config('frane.ledger_write','on',false);
insert into accounts(name,type,opening_balance) values ('Cash','cash',1000000),('Bank','bank',5000000),('MoMo','mobile_money',200000);
insert into customers(name) select 'Customer '||g from generate_series(1,500) g;
insert into products(sku,name,selling_price) select 'P'||g,'Product '||g,2000+g from generate_series(1,40) g;
-- 200k ledger rows over ~3 years
insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,created_at)
select current_date - (g % 1095), case when g % 3 = 0 then 'income'::txn_type else 'owner_contribution'::txn_type end, case when g % 3 = 0 then 'in'::txn_direction else 'in'::txn_direction end,
       case when g % 3 = 0 then (select id from transaction_categories where name='Cash sales') end,
       'Row '||g, 1000 + (g % 997), (select id from accounts order by name offset (g % 3) limit 1), now() - (g || ' seconds')::interval
from generate_series(1,200000) g;
-- 20k invoices with items
insert into sales(sale_no,sale_date,customer_id,status,payment_status,delivery_status,subtotal,total,amount_paid,due_date,stock_deducted_at)
select 'PERF-'||g, current_date - (g % 1095), (select id from customers order by name offset (g % 500) limit 1), 'confirmed', case when g % 4 = 0 then 'paid' else 'unpaid' end, 'delivered', 100000 + g, 100000 + g, case when g % 4 = 0 then 100000 + g else 0 end, current_date - (g % 1095) + 30, now()
from generate_series(1,20000) g;
insert into sale_items(sale_id,line_no,product_id,description,quantity,unit_price,line_total)
select s.id, 1, (select id from products where sku = 'P' || (1 + abs(hashtext(s.id::text)) % 40)), 'Perf item', 50, (s.total/50.0), s.total from sales s;
analyze;
SQL
t() { # label, sql
  local s=$(date +%s%N); $P -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$OWNER',false); $2" >/dev/null 2>/tmp/perf_err; local ms=$(( ($(date +%s%N)-s)/1000000 ))
  if [ -s /tmp/perf_err ] && grep -q ERROR /tmp/perf_err; then echo "FAIL : $1 — $(head -1 /tmp/perf_err)"; FAILN=$((FAILN+1)); return; fi
  if [ "$ms" -le "$LIMIT" ]; then echo "PASS : $1 — ${ms} ms"; else echo "FAIL : $1 — ${ms} ms (limit ${LIMIT})"; FAILN=$((FAILN+1)); fi; }
FAILN=0
$P -d $DB -c "select 'rows: '||(select count(*) from transactions)||' transactions, '||(select count(*) from sales)||' invoices'"
t "dashboard (this month)" "select dashboard_summary(date_trunc('month',current_date)::date, current_date);"
t "dashboard (this year)" "select dashboard_summary(date_trunc('year',current_date)::date, current_date);"
t "dashboard (all time)" "select dashboard_summary('2000-01-01', current_date);"
t "account balances" "select * from account_balances;"
t "cashbook, one month, all accounts" "select cashbook_report(date_trunc('month',current_date)::date, current_date);"
t "cashbook, one year, one account" "select cashbook_report(current_date-365, current_date, (select id from accounts where name='Cash'));"
t "cashbook search" "select cashbook_report(current_date-1000, current_date, null, null, 'Row 1999');"
t "profit & loss (year)" "select profit_and_loss(date_trunc('year',current_date)::date, current_date);"
t "profit & loss (all time)" "select profit_and_loss('2000-01-01', current_date);"
t "period summary by month (3 years)" "select period_summary('month', current_date-1095, current_date);"
t "cash-flow statement (all time)" "select cash_flow_statement('2000-01-01', current_date);"
t "balance sheet" "select balance_sheet();"
t "cash-flow forecast (90 days)" "select cash_forecast();"
t "sales report by customer (3 years)" "select sales_report('customer', current_date-1095, current_date);"
t "product profitability (year)" "select product_profitability(date_trunc('year',current_date)::date, current_date);"
t "receivables view" "select count(*) from receivables;"
t "customer balances" "select count(*) from customer_balances;"
t "transactions list page (50 rows, filtered by date)" "select * from transactions where txn_date >= current_date-30 order by txn_date desc, created_at desc limit 50;"
t "integrity check" "select integrity_check();"
echo "== performance: $FAILN slow/failed (limit ${LIMIT} ms)"; [ "$FAILN" -eq 0 ]
