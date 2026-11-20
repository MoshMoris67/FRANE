#!/usr/bin/env bash
# Race-condition tests: many parallel database sessions hammer the same account / invoice / stock.
# Usage: PGHOST=/tmp/pgt PGPORT=5544 PGUSER=postgres ./supabase/tests/concurrency.sh
set -u
D=$(cd "$(dirname "$0")" && pwd); P="psql -q -At"; DB=frane_conc; OWNER=aaaaaaaa-0000-0000-0000-000000000001
$P -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -c "create role anon nologin" 2>/dev/null; $P -c "create role authenticated nologin" 2>/dev/null
$P -d $DB -f "$D/stub_supabase.sql" >/dev/null 2>&1
for m in "$D"/../migrations/*.sql; do $P -v ON_ERROR_STOP=1 -d $DB -f "$m" >/dev/null 2>&1 || { echo "migration failed: $m"; exit 1; }; done
as_owner() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$OWNER',false);"; }
$P -d $DB -c "insert into auth.users(id,email) values ('$OWNER','o@x')" >/dev/null
$P -d $DB >/dev/null <<SQL
$(as_owner)
insert into accounts(name,type,opening_balance) values ('Race Cash','cash',100),('Pay Cash','cash',0);
insert into customers(name) values ('Racer');
insert into products(sku,name,selling_price) values ('R1','Race block',100);
select record_opening_stock((select id from products where sku='R1'), 10, 50);
SQL
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS : $1"; PASS=$((PASS+1)); else echo "FAIL : $1 (expected $3, got $2)"; FAIL=$((FAIL+1)); fi; }
run_parallel() { # $1=count, $2=sql template using :i
  for i in $(seq 1 "$1"); do ( $P -d $DB -c "$(as_owner) ${2//:i/$i}" >/dev/null 2>>/tmp/conc_err_$$ ) & done; wait; }

# A. overdraft race: 8 sessions each try to take 60 from an account holding 100
run_parallel 8 "select record_transaction('owner_withdrawal', current_date, (select id from accounts where name='Race Cash'), 60, 'Race withdrawal :i');"
check "overdraft race: exactly one 60 withdrawal succeeds" "$($P -d $DB -c "select count(*) from transactions where description like 'Race withdrawal%'")" 1
check "overdraft race: balance is 40, never negative" "$($P -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$OWNER',false); select current_balance from account_balances where name='Race Cash'" | tail -1)" 40.00

# B. idempotency race: 6 sessions submit the same request key
K=bbbbbbbb-0000-0000-0000-00000000000b
run_parallel 6 "select record_transaction('owner_contribution', current_date, (select id from accounts where name='Pay Cash'), 25, 'Idem race', null, null, null, null, null, null, '[]', '$K');"
check "idempotency race: the request is recorded once" "$($P -d $DB -c "select count(*) from transactions where idempotency_key='$K'")" 1

# C. allocation race: invoice of 100, five sessions each pay 40 against it
$P -d $DB >/dev/null <<SQL
$(as_owner)
select save_sale(null,(select id from customers where name='Racer'),current_date,jsonb_build_array(jsonb_build_object('product_id',(select id from products where sku='R1'),'quantity',1,'unit_price',100)),0,0,null,null,null,true);
SQL
SALE=$($P -d $DB -c "select id from sales where status='confirmed' order by created_at desc limit 1")
run_parallel 5 "select record_customer_payment((select id from customers where name='Racer'),(select id from accounts where name='Pay Cash'),40,current_date,'Cash',null,null,jsonb_build_array(jsonb_build_object('sale_id','$SALE','amount',40)),false);"
check "allocation race: invoice is never over-allocated (paid 80, owes 20)" "$($P -d $DB -c "select amount_paid||'/'||balance from sales where id='$SALE'")" "80.00/20.00"
check "allocation race: failed attempts left no stray payments" "$($P -d $DB -c "select count(*) from transactions where type='customer_payment'")" 2

# D. double dispatch race: six sessions dispatch the same order
run_parallel 6 "select set_delivery_status('$SALE','dispatched');"
check "dispatch race: stock leaves exactly once" "$($P -d $DB -c "select count(*) from inventory_movements where source_id='$SALE' and kind='sale'")" 1
check "dispatch race: stock is 9" "$($P -d $DB -c "select current_stock from products where sku='R1'")" 9.000

# E. oversell race: stock 9; five different orders of 4 units each try to dispatch
for i in 1 2 3 4 5; do $P -d $DB >/dev/null <<SQL
$(as_owner)
select save_sale(null,(select id from customers where name='Racer'),current_date,jsonb_build_array(jsonb_build_object('product_id',(select id from products where sku='R1'),'quantity',4,'unit_price',100)),0,0,null,null,null,true);
SQL
done
IDS=$($P -d $DB -c "select id from sales where status='confirmed' and stock_deducted_at is null")
for id in $IDS; do ( $P -d $DB -c "$(as_owner) select set_delivery_status('$id','dispatched');" >/dev/null 2>&1 ) & done; wait
check "oversell race: only two 4-unit orders fit in 9 units" "$($P -d $DB -c "select count(*) from sales where stock_deducted_at is not null and id <> '$SALE'")" 2
check "oversell race: stock ends at 1, never negative" "$($P -d $DB -c "select current_stock from products where sku='R1'")" 1.000

# F. books still balance
OUT=$($P -d $DB -c "$(as_owner) select count(*) from jsonb_array_elements(integrity_check()) x where not (x->>'ok')::boolean" | tail -1)
check "integrity check clean after the races" "$OUT" 0
rm -f /tmp/conc_err_$$; echo "== concurrency: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
