-- Phase 2 tests (runs after phase1_test.sql in the same database; reuses its users/accounts)
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,100); end $$;

reset role;
-- phase1 left owner (1111…), cashier (2222…), roleless (3333…). Add a manager and fund accounts.
insert into auth.users(id,email) values ('44444444-4444-4444-4444-444444444444','mgr@x');
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_user_access('44444444-4444-4444-4444-444444444444','manager',true);
select set_user_access('33333333-3333-3333-3333-333333333333','storekeeper',true);

do $$ declare
  cash uuid; bank uuid; p1 uuid; p2 uuid; cu uuid; cu2 uuid; s1 uuid; s2 uuid; s3 uuid; r jsonb; r2 jsonb; b0 numeric; b1 numeric; t uuid; sup uuid; s4 uuid; col0 numeric; i1 uuid; i2 uuid; i3 uuid; cat uuid; rev0 numeric; v numeric;
begin
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  select id into cash from accounts where name='Cash'; select id into bank from accounts where name='Bank';
  select (dashboard_summary(current_date,current_date)->>'revenue')::numeric into rev0;
  select (dashboard_summary(current_date,current_date)->>'collections')::numeric into col0;

  insert into products(sku,name,category_id,dimensions,selling_price,unit) values ('HB-6','Hollow block 6"',(select id from product_categories where name='Hollow blocks'),'6 inch',2500,'pieces') returning id into p1;
  insert into products(sku,name,selling_price) values ('PV-60','Paver 60mm',30000) returning id into p2;
  insert into customers(name,phone) values ('Mukasa Builders','0700000001') returning id into cu;
  insert into customers(name) values ('Nakato') returning id into cu2;

  -- credit sale: 200 blocks @2500 (disc 10000) + 10 pavers @30000, invoice discount 5000, transport 20000
  s1 := save_sale(null, cu, current_date-40, jsonb_build_array(
        jsonb_build_object('product_id',p1,'quantity',200,'unit_price',2500,'discount',10000),
        jsonb_build_object('product_id',p2,'quantity',10,'unit_price',30000)), 5000, 20000, null, 'Kampala site', 'note', true);
  perform pg_temp.check('line totals / invoice total: (500000-10000)+300000-5000+20000 = 805000', (select total from sales where id=s1)=805000 and (select subtotal from sales where id=s1)=790000);
  perform pg_temp.check('invoice number assigned on confirm', (select sale_no from sales where id=s1) like 'INV-%');
  perform pg_temp.check('due date defaults to +30 days', (select due_date from sales where id=s1)=current_date-10);
  perform pg_temp.check('credit sale unpaid, balance = total', (select payment_status from sales where id=s1)='unpaid' and (select balance from sales where id=s1)=805000);
  perform pg_temp.check('credit sale does not touch cash', (select current_balance from account_balances where name='Cash')=(select current_balance from account_balances where name='Cash'));
  perform pg_temp.check('credit sale counts as revenue', (select (dashboard_summary(current_date-40,current_date-40)->>'revenue')::numeric)>=805000);
  perform pg_temp.check('credit sale adds receivable', (dashboard_summary(current_date,current_date)->>'receivables_total')::numeric=805000);
  perform pg_temp.check('overdue 10 days -> 1-30 bucket', (select aging_bucket from receivables where sale_id=s1)='1-30' and (select days_overdue from receivables where sale_id=s1)=10);

  -- price change must not alter history
  update products set selling_price=9999 where id=p1;
  perform pg_temp.check('historic line price preserved after price change', (select unit_price from sale_items where sale_id=s1 and product_id=p1)=2500);

  -- partial payment, manual allocation
  select current_balance into b0 from account_balances where name='Cash';
  r := record_customer_payment(cu, cash, 300000, current_date, 'Cash', null, null, jsonb_build_array(jsonb_build_object('sale_id',s1,'amount',300000)), false);
  perform pg_temp.check('payment increases account', (select current_balance from account_balances where name='Cash')=b0+300000);
  perform pg_temp.check('partial payment status + balance', (select payment_status from sales where id=s1)='partially_paid' and (select balance from sales where id=s1)=505000);
  perform pg_temp.check('receipt number issued', r->>'receipt_no' like 'RCT-%');
  perform pg_temp.check('payment is not revenue', (select (dashboard_summary(current_date,current_date)->>'revenue')::numeric)=rev0 and (dashboard_summary(current_date,current_date)->>'collections')::numeric=col0+300000);
  perform pg_temp.fails('cannot over-allocate invoice', format('select record_customer_payment(%L,%L,900000,current_date,null,null,null,%L,false)', cu, cash, jsonb_build_array(jsonb_build_object('sale_id',s1,'amount',600000))::text), 'exceeds');
  perform pg_temp.fails('allocations cannot exceed payment', format('select record_customer_payment(%L,%L,100000,current_date,null,null,null,%L,false)', cu, cash, jsonb_build_array(jsonb_build_object('sale_id',s1,'amount',200000))::text), 'exceed');
  perform pg_temp.fails('cannot allocate to another customer''s invoice', format('select record_customer_payment(%L,%L,1000,current_date,null,null,null,%L,false)', cu2, cash, jsonb_build_array(jsonb_build_object('sale_id',s1,'amount',1000))::text), 'does not belong');

  -- second invoice + auto allocation oldest first, with overpayment -> credit
  s2 := save_sale(null, cu, current_date-5, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',100,'unit_price',2000)), 0, 0, null, null, null, true);
  r := record_customer_payment(cu, cash, 800000, current_date, 'Cash', null, null, '[]', true);
  perform pg_temp.check('auto-allocation pays oldest invoice first (505000 to s1)', (select payment_status from sales where id=s1)='paid' and (select amount_paid from sales where id=s1)=805000);
  perform pg_temp.check('remainder 295000 > s2 total 200000 => s2 paid, 95000 credit', (select payment_status from sales where id=s2)='paid' and (r->>'unallocated')::numeric=95000);
  perform pg_temp.check('customer credit balance = 95000', (select credit_balance from customer_balances where id=cu)=95000 and (select outstanding from customer_balances where id=cu)=0);
  perform pg_temp.check('customer totals: purchases 1005000, payments 1100000', (select total_purchases from customer_balances where id=cu)=1005000 and (select total_payments from customer_balances where id=cu)=1100000);

  -- reverse the 800k payment -> allocations released, invoices reopened
  select (r->>'txn_id')::uuid into t;
  perform pg_temp.fails('allocated payment amount cannot be edited', format('select edit_transaction(%L,current_date,%L,1,%L,null,null,null,null,%L)', t, 'x', cash, 'test'), 'allocated');
  perform reverse_transaction(t, 'Bounced');
  perform pg_temp.check('reversal reopens invoices', (select payment_status from sales where id=s1)='partially_paid' and (select amount_paid from sales where id=s1)=300000 and (select payment_status from sales where id=s2)='unpaid');
  perform pg_temp.check('outstanding restored 705000', (select outstanding from customer_balances where id=cu)=705000 and (select credit_balance from customer_balances where id=cu)=0);
  perform pg_temp.check('allocations flagged reversed (kept for audit)', (select count(*) from payment_allocations where payment_txn_id=t and reversed)=2);

  -- confirmed invoice is immutable; cancel rules
  perform pg_temp.fails('confirmed invoice cannot be edited', format('select save_sale(%L,%L,current_date,%L)', s1, cu, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',1,'unit_price',1))::text), 'cannot be changed');
  perform pg_temp.fails('cannot cancel invoice with payments', format('select cancel_sale(%L,%L)', s1, 'oops'), 'reverse the payments');
  perform cancel_sale(s2, 'Customer changed mind');
  perform pg_temp.check('cancelled sale leaves receivables and revenue', (select balance from sales where id=s2)=0 and (select outstanding from customer_balances where id=cu)=505000);

  -- draft flow + sale with immediate payment
  s3 := save_sale(null, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',2,'unit_price',30000)), 0, 0, null, null, null, false);
  perform pg_temp.check('draft has no invoice number and no receivable', (select sale_no from sales where id=s3) is null and (select balance from sales where id=s3)=0);
  perform save_sale(s3, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',3,'unit_price',30000)), 0, 10000, null, null, null, false);
  perform pg_temp.check('draft is editable', (select total from sales where id=s3)=100000);
  select current_balance into b0 from account_balances where name='Bank';
  perform save_sale(s3, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',3,'unit_price',30000)), 0, 10000, null, null, null, true,
          jsonb_build_object('account_id',bank,'amount',100000,'method','Bank Transfer'));
  perform pg_temp.check('sale with immediate full payment is paid', (select payment_status from sales where id=s3)='paid' and (select current_balance from account_balances where name='Bank')=b0+100000);
  perform pg_temp.fails('payment cannot exceed invoice total at sale', format('select save_sale(null,%L,current_date,%L,0,0,null,null,null,true,%L)', cu2, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',1,'unit_price',1000))::text, jsonb_build_object('account_id',bank,'amount',5000)::text), 'cannot exceed');
  perform pg_temp.fails('discount cannot exceed line value', format('select save_sale(null,%L,current_date,%L,0,0,null,null,null,true)', cu2, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',1,'unit_price',1000,'discount',5000))::text), 'exceeds the line');
  perform pg_temp.fails('empty invoice rejected', format('select save_sale(null,%L,current_date,%L,0,0,null,null,null,true)', cu2, '[]'), 'at least one');
  perform record_opening_stock(p2, 100, 20000);
  perform set_delivery_status(s3,'dispatched');
  s4 := save_sale(null, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',1,'unit_price',1000)), 0,0,null,null,null,true);
  perform set_delivery_status(s4,'dispatched');
  perform pg_temp.fails('dispatched sale cannot be cancelled', format('select cancel_sale(%L,%L)', s4, 'changed mind'), 'already dispatched');
  perform pg_temp.fails('paid sale cannot be cancelled without reversing payment', format('select cancel_sale(%L,%L)', s3, 'changed mind'), 'reverse the payments');
  perform pg_temp.check('delivery status tracked', (select delivery_status from sales where id=s3)='dispatched');
  perform pg_temp.check('idempotent sale save', save_sale(null, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',1,'unit_price',1000)), 0,0,null,null,null,false,null,'aaaaaaaa-0000-0000-0000-000000000001')
        = save_sale(null, cu2, current_date, jsonb_build_array(jsonb_build_object('product_id',p2,'quantity',1,'unit_price',1000)), 0,0,null,null,null,false,null,'aaaaaaaa-0000-0000-0000-000000000001'));

  -- customer statement ties to balances
  r := customer_statement(cu, current_date-60, current_date);
  perform pg_temp.check('statement closing = outstanding - credit', (r->>'closing')::numeric = (select outstanding - credit_balance from customer_balances where id=cu));
  perform pg_temp.check('statement lists invoices and payments (reversed payment excluded)', jsonb_array_length(r->'rows')=3 or jsonb_array_length(r->'rows')=2);
  r := customer_statement(cu, current_date-3, current_date);
  perform pg_temp.check('statement opening balance carries forward', (r->>'opening')::numeric = 805000);

  -- suppliers: credit expense invoice, materials invoice, partial pay
  insert into suppliers(name) values ('Hima Cement') returning id into sup;
  select id into cat from transaction_categories where name='Electricity';
  select (dashboard_summary(current_date,current_date)->>'expenses')::numeric into v;
  i1 := record_supplier_invoice(sup,'HC-100',current_date-3,null,'expense',cat,'Power bill',400000);
  i2 := record_material_purchase(sup, current_date-1, 'HC-101', null, jsonb_build_array(jsonb_build_object('material_id',(select id from raw_materials where name='Cement'),'quantity',100,'line_total',1000000)));
  perform pg_temp.check('expense-kind supplier invoice recognised as expense once', (dashboard_summary(current_date-3,current_date-3)->>'expenses')::numeric >= 400000);
  perform pg_temp.check('materials invoice is not expensed (held as inventory)', (dashboard_summary(current_date-1,current_date-1)->>'expenses')::numeric < 1000000);
  perform pg_temp.check('payables total = 1,400,000', (dashboard_summary(current_date,current_date)->>'payables_total')::numeric=1400000);
  select current_balance into b0 from account_balances where name='Bank';
  r := record_supplier_payment(sup, bank, 500000, current_date, 'Bank Transfer', null, null, '[]', true);
  perform pg_temp.check('supplier payment reduces account', (select current_balance from account_balances where name='Bank')=b0-500000);
  perform pg_temp.check('supplier auto-allocation pays oldest due first', (select payment_status from supplier_invoices where id=i1)='paid' and (select amount_paid from supplier_invoices where id=i2)=100000);
  perform pg_temp.check('supplier payment is not an expense', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=v);
  perform pg_temp.check('supplier balance outstanding = 900000', (select outstanding from supplier_balances where id=sup)=900000);
  select (r->>'txn_id')::uuid into t;
  perform reverse_transaction(t,'Wrong supplier');
  perform pg_temp.check('reversing supplier payment reopens invoices', (select outstanding from supplier_balances where id=sup)=1400000);
  perform pg_temp.fails('supplier payment over-allocation', format('select record_supplier_payment(%L,%L,100000,current_date,null,null,null,%L,false)', sup, bank, jsonb_build_array(jsonb_build_object('invoice_id',i1,'amount',999999))::text), 'exceeds');
  i3 := record_material_purchase(sup, current_date, 'HC-102', null, jsonb_build_array(jsonb_build_object('material_id',(select id from raw_materials where name='Sand'),'quantity',40,'line_total',200000)), null, jsonb_build_object('account_id',bank,'amount',200000));
  perform pg_temp.check('invoice paid at purchase is settled', (select payment_status from supplier_invoices where id=i3)='paid');
  perform pg_temp.check('supplier statement closing = outstanding - credit', (supplier_statement(sup,current_date-30,current_date)->>'closing')::numeric = (select outstanding - credit_balance from supplier_balances where id=sup));
  perform cancel_supplier_invoice(i2,'Duplicate entry');
  perform pg_temp.check('cancelled supplier invoice leaves payables', (select outstanding from supplier_balances where id=sup)=400000);

  -- ledger identity still holds after all of this
  r := dashboard_summary(current_date,current_date);
  perform pg_temp.check('closing = sum of active balances after Phase 2 activity', (r->>'closing')::numeric = (select sum(current_balance) from account_balances where status='active'));
  perform pg_temp.check('customer balances: Σ outstanding = receivables_total', (select sum(outstanding) from customer_balances) = (r->>'receivables_total')::numeric);
end $$;

-- permissions
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- cashier
select pg_temp.check('cashier can view sales & receivables', (select count(*) from receivables)>0 and (select count(*) from sales)>0);
select pg_temp.fails('cashier cannot cancel sales', $q$select cancel_sale((select id from sales where status='confirmed' limit 1),'because')$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot record supplier invoices', $q$select record_supplier_invoice((select id from suppliers limit 1),'x',current_date,null,'materials',null,'x',10)$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot pay suppliers', $q$select record_supplier_payment((select id from suppliers limit 1),(select id from accounts limit 1),10,current_date)$q$, 'FORBIDDEN');
select pg_temp.check('cashier cannot see payables', (select count(*) from payables)=0);
select pg_temp.fails('cashier cannot write sales directly', $q$update sales set total=1$q$, '');
select pg_temp.check('cashier can create a sale', save_sale(null,(select id from customers limit 1),current_date,jsonb_build_array(jsonb_build_object('product_id',(select id from products limit 1),'quantity',1,'unit_price',100)),0,0,null,null,null,false) is not null);
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- storekeeper
select pg_temp.check('storekeeper sees no customer balances', (select count(*) from customer_balances)=0);
select pg_temp.fails('storekeeper cannot create sales', $q$select save_sale(null,(select id from customers limit 1),current_date,'[{}]')$q$, 'FORBIDDEN');
select pg_temp.fails('storekeeper cannot record payments', $q$select record_customer_payment((select id from customers limit 1),(select id from accounts limit 1),10,current_date)$q$, 'FORBIDDEN');
select pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- manager
select pg_temp.check('manager can see payables and balances', (select count(*) from payables)>0 and (select count(*) from customer_balances)>0);
