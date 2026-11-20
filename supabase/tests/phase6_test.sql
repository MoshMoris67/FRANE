-- Phase 6 tests: data import, historical/opening records, role matrix, security lockdown
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,100); end $$;
create or replace function pg_temp.n(j jsonb, k text) returns numeric language sql as $$ select coalesce((j->>k)::numeric,0) $$;
create or replace function pg_temp.imp(k text, rows text, dry boolean default true, fname text default null) returns jsonb language sql as $$ select public.import_data(k, rows::jsonb, dry, fname) $$;

reset role;
-- restore the shipped default permissions (earlier phase tests loosened two of them to prove configurability)
update role_permissions set can_view=false, can_create=false, can_edit=false where role='manager' and module='payroll';
update role_permissions set can_view=false, can_create=false, can_edit=false where role='cashier' and module='expenses';
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

do $$ declare
  r jsonb; k int; txc int; bal numeric; rev0 numeric; exp0 numeric; d jsonb; pl jsonb; cu uuid; sup uuid; sid uuid; ps uuid; t uuid; st jsonb; avg0 numeric; pay jsonb; big jsonb; lo numeric;
begin
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  select count(*) into txc from transactions;

  -- ===== accounts, products, customers, suppliers, employees =====
  r := pg_temp.imp('accounts', '[{"_row":2,"name":"Imp Cash","type":"cash","opening_balance":"1,500,000"},{"_row":3,"name":"Imp Bank","type":"Bank","opening_balance":2500000},{"_row":4,"name":"imp cash","type":"cash"}]', true);
  perform pg_temp.check('dry run validates and reports per row, commits nothing', (r->>'committed')::boolean = false and (r->>'created')::int = 2 and (r->>'skipped')::int = 1 and not exists (select 1 from accounts where name like 'Imp %'));
  r := pg_temp.imp('accounts', '[{"_row":2,"name":"Imp Cash","type":"cash","opening_balance":"1,500,000"},{"_row":3,"name":"Imp Bank","type":"Bank","opening_balance":2500000}]', false, 'accounts.csv');
  perform pg_temp.check('commit creates accounts with their opening balances', (r->>'committed')::boolean and (select opening_balance from accounts where name='Imp Cash')=1500000 and (select opening_balance from accounts where name='Imp Bank')=2500000);
  perform pg_temp.check('opening balances create no ledger transactions', (select count(*) from transactions)=txc and (select current_balance from account_balances where name='Imp Cash')=1500000);
  perform pg_temp.fails('the same file cannot be imported twice', $q$select pg_temp.imp('accounts', '[{"_row":2,"name":"Imp Cash","type":"cash","opening_balance":"1,500,000"},{"_row":3,"name":"Imp Bank","type":"Bank","opening_balance":2500000}]', false, 'accounts.csv')$q$, 'already been imported');
  perform pg_temp.check('import is logged', exists (select 1 from import_batches where kind='accounts' and filename='accounts.csv' and created_count=2) and exists (select 1 from audit_logs where action='import' and table_name='import_batches'));
  r := pg_temp.imp('accounts', '[{"_row":2,"name":"Good Account","type":"cash"},{"_row":3,"name":"Bad Account","type":"cheque"}]', false, 'bad.csv');
  perform pg_temp.check('any bad row rolls the whole file back (all-or-nothing)', not (r->>'committed')::boolean and (r->>'errors')::int = 1 and not exists (select 1 from accounts where name in ('Good Account','Bad Account')) and r->'results'->1->>'message' like '%type must be%');

  r := pg_temp.imp('products', '[{"_row":2,"sku":"IMP-1","name":"Imported block","category":"New Category","dimensions":"6 inch","selling_price":"2,500","min_stock":100},{"_row":3,"sku":"IMP-2","name":"Imported paver","category":"Pavers","selling_price":30000},{"_row":4,"sku":"imp-1","name":"dup","selling_price":1}]', false, 'products.csv');
  perform pg_temp.check('products import creates products, auto-creates categories, skips duplicate SKUs', (r->>'created')::int=2 and (r->>'skipped')::int=1 and exists (select 1 from product_categories where name='New Category') and (select selling_price from products where sku='IMP-1')=2500);
  r := pg_temp.imp('customers', '[{"_row":2,"name":"Imp Customer","phone":"0711","customer_type":"Construction company"},{"_row":3,"name":"Imp Customer 2","phone":"0722"}]', false, 'customers.csv');
  perform pg_temp.check('customers import maps type labels', (r->>'created')::int=2 and (select customer_type from customers where name='Imp Customer')='construction_company');
  perform pg_temp.check('suppliers import', (pg_temp.imp('suppliers','[{"_row":2,"name":"Imp Supplier","supplied_materials":"Cement"}]',false,'s.csv')->>'created')::int=1);
  perform pg_temp.check('employees import validates pay basis', (pg_temp.imp('employees','[{"_row":2,"name":"Imp Worker","employment_type":"Daily labour","pay_basis":"daily","rate":25000}]',false,'e.csv')->>'created')::int=1 and (pg_temp.imp('employees','[{"_row":2,"name":"Bad Worker","pay_basis":"weekly","rate":1}]',true)->>'errors')::int=1);

  -- ===== opening stock =====
  r := pg_temp.imp('opening_stock', '[{"_row":2,"sku":"IMP-1","quantity":100,"unit_cost":500},{"_row":3,"sku":"NOPE","quantity":5}]', true);
  perform pg_temp.check('unknown SKU is reported as a row error', (r->>'errors')::int=1 and r->'results'->1->>'message' like '%NOPE%');
  r := pg_temp.imp('opening_stock', '[{"_row":2,"sku":"IMP-1","quantity":100,"unit_cost":500},{"_row":3,"sku":"IMP-2","quantity":40}]', false, 'stock.csv');
  perform pg_temp.check('opening stock posts opening movements at the given cost', (select current_stock from products where sku='IMP-1')=100 and (select avg_cost from products where sku='IMP-1')=500 and exists (select 1 from inventory_movements m join products p on p.id=m.product_id where p.sku='IMP-1' and m.kind='opening'));
  perform pg_temp.check('zero-cost opening stock is flagged in the result', r->'results'->1->>'message' like '%ZERO cost%');
  r := pg_temp.imp('opening_stock','[{"_row":2,"sku":"IMP-1","quantity":999,"unit_cost":1}]',false,'stock2.csv');
  perform pg_temp.check('re-importing opening stock never doubles it', (r->>'skipped')::int=1 and (select current_stock from products where sku='IMP-1')=100);
  r := pg_temp.imp('material_opening','[{"_row":2,"name":"Water","quantity":1000,"unit_cost":2}]',false,'m.csv');
  perform pg_temp.check('raw material opening stock', (r->>'created')::int=1 and (select current_stock from raw_materials where name='Water')=1000);

  -- ===== opening receivable: a debt, not revenue =====
  select id into cu from customers where name='Imp Customer';
  d := dashboard_summary('2000-01-01', current_date); rev0 := pg_temp.n(d,'revenue'); select (cash_forecast()->>'avg_daily_sales')::numeric into avg0;
  pl := profit_and_loss('2000-01-01', current_date);
  r := pg_temp.imp('opening_receivables', format('[{"_row":2,"customer":"imp customer","amount":"750,000","invoice_date":"%s","reference":"BOOK-17"}]', current_date-5), false, 'ar.csv');
  d := dashboard_summary('2000-01-01', current_date);
  perform pg_temp.check('opening receivable appears as a confirmed invoice with an OB number', (r->>'created')::int=1 and exists (select 1 from sales where customer_id=cu and is_opening and status='confirmed' and total=750000 and sale_no like 'OB-%'));
  perform pg_temp.check('it is owed (receivables, balances, aging)', (select outstanding from customer_balances where id=cu)=750000 and (select count(*) from receivables where customer_id=cu and balance=750000)=1);
  perform pg_temp.check('it is NOT revenue (dashboard and P&L unchanged)', pg_temp.n(d,'revenue')=rev0 and pg_temp.n(profit_and_loss('2000-01-01',current_date),'net_profit')=pg_temp.n(pl,'net_profit'));
  perform pg_temp.check('it does not feed forecast run-rates or sales reports', (cash_forecast()->>'avg_daily_sales')::numeric=avg0 and not exists (select 1 from jsonb_array_elements(sales_report('customer','2000-01-01',current_date)->'rows') x where x->>'label'='Imp Customer') and pg_temp.n(d,'sales_today')=pg_temp.n(dashboard_summary(current_date,current_date),'sales_today'));
  perform pg_temp.check('re-importing the same reference is skipped', (pg_temp.imp('opening_receivables', format('[{"_row":2,"customer":"Imp Customer","amount":750000,"invoice_date":"%s","reference":"BOOK-17"},{"_row":3,"customer":"Imp Customer","amount":1,"invoice_date":"%s","reference":"X"}]', current_date-5, current_date-5), true)->'results'->0->>'status')='skipped');
  select (pg_temp.imp('opening_receivables','[{"customer":"Nobody","amount":5,"invoice_date":"2025-01-01"}]',true)->>'errors')::int into txc;
  perform pg_temp.check('unknown customer reported', txc=1);
  st := customer_statement(cu, current_date-30, current_date);
  perform pg_temp.check('statement shows the opening balance and ties', (st->>'closing')::numeric=750000 and st->'rows'->0->>'description' like 'Opening balance%');
  select current_balance into bal from account_balances where name='Imp Cash';
  pay := record_customer_payment(cu, (select id from accounts where name='Imp Cash'), 750000, current_date, 'Cash');
  perform pg_temp.check('customers can pay opening debts: cash up, debt cleared, still no revenue', (select current_balance from account_balances where name='Imp Cash')=bal+750000 and (select outstanding from customer_balances where id=cu)=0 and pg_temp.n(dashboard_summary('2000-01-01',current_date),'revenue')=rev0);
  perform reverse_transaction((pay->>'txn_id')::uuid, 'Test reversal');
  perform pg_temp.check('reversal re-opens the opening debt', (select outstanding from customer_balances where id=cu)=750000);
  perform cancel_sale((select id from sales where customer_id=cu and is_opening), 'Imported by mistake');
  perform pg_temp.check('a mistaken opening invoice can be cancelled with a reason', (select outstanding from customer_balances where id=cu)=0);

  -- ===== opening payable: a debt, not an expense =====
  select id into sup from suppliers where name='Imp Supplier'; exp0 := pg_temp.n(dashboard_summary('2000-01-01',current_date),'expenses');
  r := pg_temp.imp('opening_payables', format('[{"_row":2,"supplier":"Imp Supplier","amount":400000,"invoice_date":"%s","reference":"SUP-9","description":"Cement balance"}]', current_date-20), false, 'ap.csv');
  perform pg_temp.check('opening payable is owed and appears in payables', (r->>'created')::int=1 and (select outstanding from supplier_balances where id=sup)=400000 and exists (select 1 from payables where supplier_id=sup and balance=400000));
  perform pg_temp.check('it is NOT an expense and not in the expense register', pg_temp.n(dashboard_summary('2000-01-01',current_date),'expenses')=exp0 and not exists (select 1 from expense_register_v where description='Cement balance'));
  perform record_supplier_payment(sup, (select id from accounts where name='Imp Bank'), 400000, current_date);
  perform pg_temp.check('supplier opening debt can be paid', (select outstanding from supplier_balances where id=sup)=0 and pg_temp.n(dashboard_summary('2000-01-01',current_date),'expenses')=exp0);

  -- ===== historical sales: revenue in their own period, but no cash, no stock =====
  select count(*) into txc from transactions; select current_stock into lo from products where sku='IMP-1'; select sum(current_balance) into bal from account_balances;
  r := pg_temp.imp('historical_sales', format('[{"_row":2,"invoice_ref":"H1","date":"%1$s","customer":"Imp Customer","sku":"IMP-1","quantity":10,"unit_price":2500,"discount":1000,"paid_amount":10000},{"_row":3,"invoice_ref":"H1","date":"%1$s","customer":"Imp Customer","description":"Special delivery","quantity":1,"unit_price":5000,"paid_amount":10000},{"_row":4,"invoice_ref":"H2","date":"%1$s","customer":"Imp Customer 2","sku":"IMP-2","quantity":2,"unit_price":30000,"paid_amount":60000}]', current_date-200), false, 'hist.csv');
  perform pg_temp.check('two historical invoices created (multi-line grouped by reference)', (r->>'created')::int=2 and (select count(*) from sale_items si join sales s on s.id=si.sale_id where s.is_historical and s.notes like '%H1')=2);
  select id into sid from sales where is_historical and notes like '%ref: H1';
  perform pg_temp.check('totals computed: (10×2500 − 1000) + 5000 = 29000, paid 10000', (select total from sales where id=sid)=29000 and (select amount_paid from sales where id=sid)=10000 and (select payment_status from sales where id=sid)='partially_paid' and (select balance from sales where id=sid)=19000);
  perform pg_temp.check('NO cash moved and NO stock moved by historical sales', (select count(*) from transactions)=txc and (select sum(current_balance) from account_balances)=bal and (select current_stock from products where sku='IMP-1')=lo);
  pl := profit_and_loss(current_date-210, current_date-190);
  perform pg_temp.check('they count as revenue in their own period', (pl->'revenue'->>'invoiced_sales')::numeric=29000+60000 and (pl->'flags'->>'estimated')::boolean);
  perform pg_temp.check('delivered, stock marked already deducted, shown as numbered HIS invoices', (select delivery_status from sales where id=sid)='delivered' and (select stock_deducted_at from sales where id=sid) is not null and (select sale_no from sales where id=sid) like 'HIS-%');
  perform pg_temp.check('they are not "orders awaiting fulfilment"', (dashboard_summary(current_date,current_date)->>'pending_orders')::numeric = (select count(*) from sales where status='confirmed' and delivery_status in ('pending','loading')));
  perform pg_temp.check('only the unpaid part is receivable', (select balance from receivables where sale_id=sid)=19000);
  st := customer_statement((select id from customers where name='Imp Customer'), current_date-300, current_date);
  perform pg_temp.check('statement credits the pre-system payment and ties to the balance', exists (select 1 from jsonb_array_elements(st->'rows') x where x->>'description' like 'Payments received before%') and (st->>'closing')::numeric=19000);
  pay := record_customer_payment((select id from customers where name='Imp Customer'), (select id from accounts where name='Imp Cash'), 19000, current_date, 'Cash');
  perform pg_temp.check('paying the remainder keeps the pre-system payment (10000 + 19000... = total)', (select amount_paid from sales where id=sid)=29000 and (select payment_status from sales where id=sid)='paid');
  perform reverse_transaction((pay->>'txn_id')::uuid, 'Test reversal');
  perform pg_temp.check('reversal returns to the imported paid amount, not to zero', (select amount_paid from sales where id=sid)=10000 and (select payment_status from sales where id=sid)='partially_paid');
  perform pg_temp.check('re-importing an invoice reference is skipped', (pg_temp.imp('historical_sales', format('[{"_row":2,"invoice_ref":"H1","date":"%s","customer":"Imp Customer","sku":"IMP-1","quantity":1,"unit_price":1}]', current_date-200), true)->>'skipped')::int=1);
  perform pg_temp.check('bad historical rows are caught: unknown SKU, over-payment, future date, unknown customer', (pg_temp.imp('historical_sales', format('[{"invoice_ref":"E1","date":"%1$s","customer":"Imp Customer","sku":"NOPE","quantity":1,"unit_price":1},{"invoice_ref":"E2","date":"%1$s","customer":"Imp Customer","description":"x","quantity":1,"unit_price":10,"paid_amount":99},{"invoice_ref":"E3","date":"2999-01-01","customer":"Imp Customer","description":"x","quantity":1,"unit_price":10},{"invoice_ref":"E4","date":"%1$s","customer":"Ghost","description":"x","quantity":1,"unit_price":10}]', current_date-10), true)->>'errors')::int=4);

  -- ===== historical expenses =====
  select count(*) into txc from transactions; select sum(current_balance) into bal from account_balances;
  r := pg_temp.imp('historical_expenses', format('[{"_row":2,"date":"%1$s","category":"rent","description":"Office rent (old)","amount":500000,"payee":"Landlord"},{"_row":3,"date":"%1$s","category":"Electricity","description":"Power (old)","amount":300000,"paid_amount":200000}]', current_date-100), false, 'hx.csv');
  perform pg_temp.check('historical expenses created as approved, paid or part-paid', (r->>'created')::int=2 and (select payment_status from expenses where description='Office rent (old)')='paid' and (select payment_status from expenses where description='Power (old)')='partially_paid' and (select balance from expenses where description='Power (old)')=100000);
  perform pg_temp.check('no cash moves for historical expenses', (select count(*) from transactions)=txc and (select sum(current_balance) from account_balances)=bal);
  pl := profit_and_loss(current_date-110, current_date-90);
  perform pg_temp.check('they count as operating expenses in their own period', (pl->'operating_expenses'->>'total')::numeric=800000);
  ps := (select id from expenses where description='Power (old)');
  t := pay_expense(ps, (select id from accounts where name='Imp Cash'), 100000, current_date);
  perform pg_temp.check('paying the remainder settles it', (select amount_paid from expenses where id=ps)=300000 and (select payment_status from expenses where id=ps)='paid');
  perform reverse_transaction(t, 'Test reversal');
  perform pg_temp.check('reversal keeps the imported paid part', (select amount_paid from expenses where id=ps)=200000 and (select payment_status from expenses where id=ps)='partially_paid');
  perform pg_temp.check('unknown expense category is an error', (pg_temp.imp('historical_expenses', format('[{"date":"%s","category":"Nonsense","description":"x","amount":5}]', current_date-1), true)->>'errors')::int=1);

  -- ===== forecast cash-share must not collapse invoices that share a total (regression) =====
  insert into products(sku,name,selling_price) values ('DUP','Dup test',1000) on conflict do nothing;
  -- five identical, very large invoices (one paid in part on the day): a collapsed denominator would give 50%, the correct share is ~10%
  for k in 1..5 loop
    perform save_sale(null, cu, current_date, jsonb_build_array(jsonb_build_object('product_id',(select id from products where sku='DUP'),'quantity',1,'unit_price',100000000)), 0,0,null,null,null,true,
      case when k = 1 then jsonb_build_object('account_id',(select id from accounts where name='Imp Cash'),'amount',50000000) end);
  end loop;
  perform pg_temp.check('forecast cash share = same-day payments ÷ ALL recent invoices (identical totals are not collapsed)',
    abs((cash_forecast()->>'cash_share_pct')::numeric - least(100, round(100 *
      (select coalesce(sum(pa.amount),0) from payment_allocations pa join transactions t on t.id=pa.payment_txn_id join sales s on s.id=pa.sale_id where not pa.reversed and t.txn_date=s.sale_date and s.status='confirmed' and not s.is_opening and s.sale_date > current_date-90)
      / (select sum(total) from sales where status='confirmed' and not is_opening and sale_date > current_date-90), 0))) < 0.01
    and (cash_forecast()->>'cash_share_pct')::numeric < 15);

  -- ===== the books still balance after all that =====
  r := integrity_check();
  perform pg_temp.check('integrity check passes after imports', not exists (select 1 from jsonb_array_elements(r) x where not (x->>'ok')::boolean));
  if exists (select 1 from jsonb_array_elements(r) x where not (x->>'ok')::boolean) then raise notice 'INTEGRITY DETAIL: %', (select jsonb_agg(x) from jsonb_array_elements(r) x where not (x->>'ok')::boolean); end if;
  perform pg_temp.check('dashboard closing cash still equals the sum of balances', abs(pg_temp.n(dashboard_summary(current_date,current_date),'closing') - (select sum(current_balance) from account_balances where status='active')) < 0.01);
  select jsonb_agg(jsonb_build_object('name','C'||g,'phone','0'||g)) into big from generate_series(1,2001) g;
  perform pg_temp.fails('import size is capped', format('select pg_temp.imp(%L,%L,true)', 'customers', big::text), '2,000');
  perform pg_temp.fails('unknown import type', $q$select pg_temp.imp('nonsense','[{"a":1}]',true)$q$, 'unknown import type');
  perform pg_temp.fails('empty file', $q$select pg_temp.imp('customers','[]',true)$q$, 'no data rows');
end $$;

-- ===== import is owner-only =====
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select pg_temp.fails('manager cannot import', $q$select pg_temp.imp('customers','[{"name":"X"}]',true)$q$, 'FORBIDDEN');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.fails('cashier cannot import', $q$select pg_temp.imp('customers','[{"name":"X"}]',true)$q$, 'FORBIDDEN');
select pg_temp.check('import log is owner-only', (select count(*) from import_batches)=0);

-- =====================================================================
-- ROLE MATRIX: every sensitive operation × every role, against shipped defaults
-- =====================================================================
create or replace function pg_temp.try(sql text, uid uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  execute sql;
  return 'allowed';
exception when others then
  return case when sqlerrm like 'FORBIDDEN%' or sqlerrm like 'permission denied%' then 'denied' else 'allowed' end;
end $$;

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
do $$ declare
  op record; role_name text; uid uuid; got text; want text; bad int := 0; total int := 0;
  owner_ uuid := '11111111-1111-1111-1111-111111111111'; mgr uuid := '44444444-4444-4444-4444-444444444444'; cash uuid := '22222222-2222-2222-2222-222222222222'; sup uuid := '55555555-5555-5555-5555-555555555555'; store uuid := '33333333-3333-3333-3333-333333333333';
begin
  for op in select * from (values
    -- label, sql, allowed roles (o=owner m=manager c=cashier s=supervisor k=storekeeper)
    ('view dashboard', $q$select dashboard_summary(current_date,current_date)$q$, 'om'),
    ('record transaction', $q$select record_transaction('income',current_date,gen_random_uuid(),1,'x')$q$, 'omc'),
    ('reverse transaction', $q$select reverse_transaction(gen_random_uuid(),'because')$q$, 'om'),
    ('edit transaction', $q$select edit_transaction(gen_random_uuid(),current_date,'x',1,gen_random_uuid(),null,null,null,null,'because')$q$, 'om'),
    ('create sale', $q$select save_sale(null,gen_random_uuid(),current_date,'[]'::jsonb)$q$, 'omc'),
    ('cancel sale', $q$select cancel_sale(gen_random_uuid(),'because')$q$, 'om'),
    ('record customer payment', $q$select record_customer_payment(gen_random_uuid(),gen_random_uuid(),1,current_date)$q$, 'omc'),
    ('record supplier invoice', $q$select record_supplier_invoice(gen_random_uuid(),'x',current_date,null,'expense',null,'x',1)$q$, 'om'),
    ('pay supplier', $q$select record_supplier_payment(gen_random_uuid(),gen_random_uuid(),1,current_date)$q$, 'om'),
    ('receive materials', $q$select record_material_purchase(gen_random_uuid(),current_date,null,null,'[]'::jsonb)$q$, 'omk'),
    ('adjust stock', $q$select adjust_stock(gen_random_uuid(),1,'because')$q$, 'omk'),
    ('record damaged stock', $q$select record_damage(gen_random_uuid(),1,'because')$q$, 'omk'),
    ('create production batch', $q$select create_batch(gen_random_uuid(),current_date,1)$q$, 'oms'),
    ('use materials in a batch', $q$select add_batch_material(gen_random_uuid(),gen_random_uuid(),1)$q$, 'oms'),
    ('complete a batch', $q$select complete_batch(gen_random_uuid(),1,0)$q$, 'oms'),
    ('update delivery status', $q$select set_delivery_status(gen_random_uuid(),'loading')$q$, 'omk'),
    ('record expense', $q$select record_expense(current_date,gen_random_uuid(),'x',1)$q$, 'om'),
    ('approve expense', $q$select approve_expense(gen_random_uuid(),true)$q$, 'om'),
    ('create payroll', $q$select create_payroll(gen_random_uuid(),current_date-1,current_date,1)$q$, 'o'),
    ('pay payroll', $q$select pay_payroll(gen_random_uuid(),gen_random_uuid())$q$, 'o'),
    ('payroll summary', $q$select payroll_summary(current_date-30,current_date)$q$, 'o'),
    ('set a budget', $q$select save_budget(null,'month',current_date,'total',null,null,1000)$q$, 'om'),
    ('submit daily closing', $q$select submit_closing(gen_random_uuid(),current_date,0)$q$, 'omc'),
    ('approve daily closing', $q$select review_closing(gen_random_uuid(),true)$q$, 'om'),
    ('reopen daily closing', $q$select reopen_closing(gen_random_uuid(),'because')$q$, 'om'),
    ('reconcile account', $q$select reconcile_account(gen_random_uuid(),current_date,0)$q$, 'omc'),
    ('profit & loss', $q$select profit_and_loss(current_date-30,current_date)$q$, 'om'),
    ('balance sheet', $q$select balance_sheet()$q$, 'om'),
    ('cash-flow forecast', $q$select cash_forecast()$q$, 'om'),
    ('plan forecast item', $q$select save_forecast_item(null,current_date+9,'x y',1,'out','other')$q$, 'om'),
    ('cashbook', $q$select cashbook_report(current_date-1,current_date)$q$, 'omc'),
    ('sales report', $q$select sales_report('day',current_date-1,current_date)$q$, 'omc'),
    ('production report', $q$select production_report(current_date-1,current_date)$q$, 'omsk'),
    ('customer statement', $q$select customer_statement(gen_random_uuid(),current_date-1,current_date)$q$, 'omc'),
    ('supplier statement', $q$select supplier_statement(gen_random_uuid(),current_date-1,current_date)$q$, 'om'),
    ('integrity check', $q$select integrity_check()$q$, 'o'),
    ('import data', $q$select pg_temp.imp('customers','[{"name":"zz"}]',true)$q$, 'o'),
    ('list users', $q$select list_users()$q$, 'o'),
    ('change user roles', $q$select set_user_access(gen_random_uuid(),'cashier',true)$q$, 'o'),
    ('load demo data', $q$select seed_demo_data()$q$, 'o')
  ) as v(label, sql, who) loop
    foreach role_name in array array['o','m','c','s','k'] loop
      uid := case role_name when 'o' then owner_ when 'm' then mgr when 'c' then cash when 's' then sup else store end;
      want := case when position(role_name in op.who) > 0 then 'allowed' else 'denied' end;
      got := pg_temp.try(op.sql, uid); total := total + 1;
      if got <> want then bad := bad + 1; raise notice 'FAIL : role matrix — % as % expected %, got %', op.label, role_name, want, got; end if;
    end loop;
  end loop;
  raise notice '% : role matrix, % operation × role cells verified', case when bad = 0 then 'PASS' else 'FAIL' end, total;
end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

-- read matrix: which tables each role can see (RLS), 1 = sees rows
create or replace function pg_temp.sees(tbl text, uid uuid) returns boolean language plpgsql as $$
declare n int;
begin perform set_config('request.jwt.claim.sub', uid::text, false); execute format('select count(*) from %s', tbl) into n; return n > 0;
exception when others then return false; end $$;
do $$ declare
  t record; role_name text; uid uuid; got boolean; want boolean; bad int := 0; total int := 0;
begin
  for t in select * from (values
    ('transactions','omc'),('audit_logs','o'),('employees','o'),('payroll_records','o'),('budgets','om'),('products','omcsk'),('sales','omc'),('sale_items','omc'),
    ('production_batches','omsk'),('inventory_movements','omsk'),('raw_materials','omsk'),('supplier_invoices','om'),('customer_balances','omc'),('supplier_balances','om'),
    ('daily_closings','omc'),('expenses','om'),('forecast_items','om'),('import_batches','o'),('role_permissions','omcsk'),('payables','om'),('receivables','omc'),('profile_names','omcsk'),('reconciliations','omc')
  ) as v(tbl, who) loop
    foreach role_name in array array['o','m','c','s','k'] loop
      uid := case role_name when 'o' then '11111111-1111-1111-1111-111111111111' when 'm' then '44444444-4444-4444-4444-444444444444' when 'c' then '22222222-2222-2222-2222-222222222222' when 's' then '55555555-5555-5555-5555-555555555555' else '33333333-3333-3333-3333-333333333333' end::uuid;
      want := position(role_name in t.who) > 0; got := pg_temp.sees(t.tbl, uid); total := total + 1;
      if got <> want then bad := bad + 1; raise notice 'FAIL : read matrix — % as % expected %, got %', t.tbl, role_name, want, got; end if;
    end loop;
  end loop;
  raise notice '% : read matrix, % table × role cells verified', case when bad = 0 then 'PASS' else 'FAIL' end, total;
end $$;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.check('a role cannot read other people''s profiles', (select count(*) from profiles where id <> '33333333-3333-3333-3333-333333333333')=0);

-- =====================================================================
-- SECURITY LOCKDOWN
-- =====================================================================
reset role; set role anon;
select pg_temp.fails('anonymous users cannot read transactions', 'select count(*) from transactions', 'permission denied');
select pg_temp.fails('anonymous users cannot read settings', 'select count(*) from settings', 'permission denied');
select pg_temp.fails('anonymous users cannot call dashboard', 'select dashboard_summary(current_date,current_date)', 'permission denied');
select pg_temp.fails('anonymous users cannot read the balances view', 'select count(*) from account_balances', 'permission denied');
reset role;
select pg_temp.check('anon holds no table privileges anywhere in the public schema', (select count(*) from information_schema.table_privileges where grantee='anon' and table_schema='public')=0);
select pg_temp.check('anon can execute no public function', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute'))=0);
select pg_temp.check('signed-in users cannot execute any internal helper (_name) except the date helper', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like E'\\_%' and p.proname <> '_kampala_today' and has_function_privilege('authenticated', p.oid, 'execute'))=0);
select pg_temp.check('ledger and ledger-adjacent tables have no direct write access for signed-in users', not exists (
  select 1 from unnest(array['transactions','sales','sale_items','payment_allocations','supplier_invoices','supplier_payment_allocations','expenses','expense_payments','payroll_records','inventory_movements','material_movements',
    'production_batches','production_materials','production_costs','budgets','daily_closings','reconciliations','audit_logs','import_batches','forecast_items']) t
  where has_table_privilege('authenticated', 'public.'||t, 'INSERT') or has_table_privilege('authenticated', 'public.'||t, 'UPDATE') or has_table_privilege('authenticated', 'public.'||t, 'DELETE')));
select pg_temp.check('every public table has row-level security enabled', not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity));
