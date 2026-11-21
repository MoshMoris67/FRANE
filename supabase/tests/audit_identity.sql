-- Accounting identity audit. Runs on a FRESH database (zero opening balances):
--   net assets (assets − liabilities)  ==  owner contributions − drawings + cumulative profit (P&L)
-- after a deliberately messy mix of every money flow. Any double-count or leak breaks the identity.
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','owner@x');
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into accounts(name,type,opening_balance) values ('Cash','cash',0),('Bank','bank',0),('Mobile','mobile_money',0);

do $$ declare
  cash uuid; bank uuid; mm uuid; sup uuid; cem uuid; p1 uuid; p2 uuid; cu uuid; cu2 uuid; s1 uuid; s2 uuid; s3 uuid; b1 uuid; inv uuid; i2 uuid; e1 uuid; e2 uuid; t uuid; r jsonb; emp uuid; pr uuid; g uuid;
  c_inc uuid; c_loan uuid; c_rent uuid; c_fuel uuid; c_lab uuid; bs jsonb; pl jsonb; net_assets numeric; contrib numeric; draws numeric; profit numeric; rec numeric; ic jsonb; bad int; ex jsonb;
begin
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  select id into cash from accounts where name='Cash'; select id into bank from accounts where name='Bank'; select id into mm from accounts where name='Mobile';
  select id into c_rent from transaction_categories where name='Rent'; select id into c_fuel from transaction_categories where name='Fuel'; select id into c_lab from transaction_categories where name='Casual labour' and kind='expense';
  insert into suppliers(name) values ('Hima Cement') returning id into sup; select id into cem from raw_materials where name='Cement';
  insert into products(sku,name,selling_price) values ('HB-6','Hollow block',2500) returning id into p1; insert into products(sku,name,selling_price) values ('PV','Paver',30000) returning id into p2;
  insert into customers(name) values ('Mukasa Builders') returning id into cu; insert into customers(name) values ('Nakato') returning id into cu2;

  -- capital, loan, drawings, transfer
  perform record_transaction('owner_contribution', current_date-30, cash, 5000000, 'Capital', null);
  perform record_transaction('owner_contribution', current_date-30, bank, 5000000, 'Capital', null);
  perform record_transaction('loan_received', current_date-29, bank, 3000000, 'Bank loan', null);
  perform record_transaction('loan_repayment', current_date-10, bank, 500000, 'Loan instalment', null);
  perform record_transaction('owner_withdrawal', current_date-9, cash, 400000, 'Drawings', null);
  perform record_transfer(current_date-8, cash, mm, 600000, 'Float to mobile money');
  t := record_transaction('owner_withdrawal', current_date-8, cash, 77000, 'Entered by mistake', null); perform reverse_transaction(t, 'mistake');

  -- materials on credit, part payment, then over-payment (supplier advance)
  inv := record_material_purchase(sup, current_date-25, 'HC-1', null, jsonb_build_array(jsonb_build_object('material_id',cem,'quantity',100,'unit_cost',32000)));
  perform record_supplier_payment(sup, bank, 1500000, current_date-20, 'Bank', null, null, '[]', true);
  perform record_supplier_payment(sup, bank, 2000000, current_date-5, 'Bank', null, null, '[]', true);   -- 1.7m settles, 0.3m advance

  -- expenses: paid now, accrued then part-paid, accrued then cancelled
  r := record_expense(current_date-20, c_rent, 'Yard rent', 300000, 'Landlord', null, '[]', jsonb_build_object('account_id',cash,'amount',300000,'method','Cash'));
  r := record_expense(current_date-15, c_fuel, 'Generator fuel', 200000, 'Total', null, '[]', null); e1 := (r->>'id')::uuid;
  perform pay_expense(e1, cash, 80000, current_date-14, 'Cash');
  r := record_expense(current_date-12, c_fuel, 'Wrong fuel bill', 90000, 'Total', null, '[]', null); e2 := (r->>'id')::uuid; perform cancel_expense(e2, 'duplicate');

  -- production: consume 40 bags (cost 1.28m), labour accrued 150k unpaid + 50k paid, 1000 made, 50 rejected
  b1 := create_batch(p1, current_date-18, 1000, 'Sam', null); perform start_batch(b1);
  perform add_batch_material(b1, cem, 40);
  perform add_batch_cost(b1,'labour','Block makers',150000,'Team A');
  perform add_batch_cost(b1,'other','Loading',50000,null,jsonb_build_object('account_id',cash,'category_id',c_lab));
  perform complete_batch(b1, 1000, 50, current_date-17);

  -- sales: credit, partial payments, over-payment, cancellation of an unpaid invoice, return, damage, write-down
  s1 := save_sale(null, cu, current_date-16, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',400,'unit_price',2500,'discount',20000)), 10000, 25000, null, null, null, true);
  perform set_delivery_status(s1,'delivered');
  perform record_customer_payment(cu, cash, 300000, current_date-15, 'Cash', null, null, '[]', true);
  perform record_customer_payment(cu, mm, 200000, current_date-6, 'Mobile', null, null, '[]', true);
  s2 := save_sale(null, cu, current_date-12, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',100,'unit_price',2600)), 0, 0, null, null, null, true);
  perform set_delivery_status(s2,'delivered');
  perform record_customer_payment(cu, cash, 2000000, current_date-4, 'Cash', null, null, '[]', true);           -- settles both, rest is customer credit
  s3 := save_sale(null, cu2, current_date-3, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',50,'unit_price',2500)), 0, 0, null, null, null, true);
  perform cancel_sale(s3, 'cancelled before dispatch');
  perform record_return(p1, 20, s1, 'Cracked on delivery', current_date-2);
  perform record_damage(p1, 30, 'Dropped in yard', current_date-2);
  perform adjust_stock(p1, -15, 'Stock-take shortage', current_date-1);
  -- sale paid in full at the counter, then payment reversed
  s3 := save_sale(null, cu2, current_date-1, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',30,'unit_price',2500)), 0, 0, null, null, null, true, jsonb_build_object('account_id',cash,'amount',75000,'method','Cash'));
  perform set_delivery_status(s3,'delivered');


  -- second wave: edge cases that tend to double-count
  perform pay_batch_cost((select id from production_costs where batch_id=b1 and not paid and not voided limit 1), cash, c_lab, current_date-1, 'Cash');   -- accrued labour paid later: no P&L effect
  i2 := record_supplier_invoice(sup, 'UM-77', current_date-7, current_date+7, 'expense', c_rent, 'Power bill', 400000);
  perform record_supplier_payment(sup, bank, 150000, current_date-3, 'Bank', null, null, jsonb_build_array(jsonb_build_object('invoice_id',i2,'amount',150000)), false);
  select id into t from transactions where type='supplier_payment' and amount=150000 and not is_reversal; perform reverse_transaction(t, 'wrong supplier');
  select id into t from transactions where type='customer_payment' and amount=200000 and not is_reversal; perform reverse_transaction(t, 'bounced');
  perform record_transaction('refund', current_date-1, cash, 100000, 'Refund of customer credit', null, null, null, cu);
  r := record_expense(current_date-2, c_fuel, 'Needs approval', 5000000, 'Big Oil', null, '[]', null);

  -- payroll
  insert into employees(name, role, employment_type, pay_basis, rate) values ('Joseph','Block maker','casual','daily',30000) returning id into emp;
  pr := create_payroll(emp, current_date-6, current_date, 5, 4, 5000, 10000, 5000); perform pay_payroll(pr, cash, current_date, 'Cash');

  -- ================= identity =================
  bs := balance_sheet(); pl := profit_and_loss('2000-01-01', current_date);
  net_assets := (bs->'equity'->>'net_assets')::numeric; contrib := (bs->'equity'->>'owner_contributions')::numeric; draws := (bs->'equity'->>'owner_withdrawals')::numeric; profit := (pl->>'net_profit')::numeric;
  raise notice 'NOTE assets=% liabilities=% net_assets=% contrib=% draws=% profit=% -> expected net_assets=% diff=%', bs->'assets'->>'total', bs->'liabilities'->>'total', net_assets, contrib, draws, profit, contrib-draws+profit, net_assets-(contrib-draws+profit);
  perform pg_temp.check('IDENTITY: net assets = contributions − drawings + cumulative profit', abs(net_assets-(contrib-draws+profit)) < 1);
  perform pg_temp.check('owner contributions 10,000,000 / reversed drawings excluded (400,000 only)', contrib=10000000 and draws=400000);
  perform pg_temp.check('loan liability = 3,000,000 − 500,000', (bs->'liabilities'->>'loans')::numeric=2500000);
  ic := integrity_check(); select count(*) into bad from jsonb_array_elements(ic) x where not (x->>'ok')::boolean;
  perform pg_temp.check('integrity_check: all checks pass', bad=0);
  if bad>0 then raise notice 'NOTE failing checks: %', (select jsonb_agg(x->>'name') from jsonb_array_elements(ic) x where not (x->>'ok')::boolean); end if;
  raise notice 'NOTE pl=%', pl;
  -- cross-report consistency (dashboard vs P&L vs cash-flow statement vs account balances) over the same window
  declare d jsonb; cf jsonb; sum_acc numeric; begin
    d := dashboard_summary(current_date-60, current_date); cf := cash_flow_statement(current_date-60, current_date);
    select sum(current_balance) into sum_acc from account_balances;
    perform pg_temp.check('dashboard revenue = P&L revenue', (d->>'revenue')::numeric = (pl->'revenue'->>'total')::numeric);
    perform pg_temp.check('dashboard COGS = P&L COGS', (d->>'cogs')::numeric = (pl->'cogs'->>'total')::numeric);
    perform pg_temp.check('dashboard operating expenses = P&L operating + other expenses', (d->>'expenses')::numeric = (pl->'operating_expenses'->>'total')::numeric + (pl->'other_expenses'->>'total')::numeric);
    perform pg_temp.check('dashboard profit (rev − cogs − exp) = P&L net profit − other income', (d->>'revenue')::numeric - (d->>'cogs')::numeric - (d->>'expenses')::numeric = (pl->>'net_profit')::numeric - (pl->'other_income'->>'total')::numeric);
    perform pg_temp.check('closing cash: dashboard = cash-flow statement = sum of accounts', (d->>'closing')::numeric = (cf->>'closing')::numeric and (cf->>'closing')::numeric = sum_acc);
    perform pg_temp.check('opening + inflows − outflows = closing', (d->>'opening')::numeric + (d->>'inflows')::numeric - (d->>'outflows')::numeric = (d->>'closing')::numeric);
    perform pg_temp.check('cash-flow lines add to net movement', (select sum((l->>'net')::numeric) from jsonb_array_elements(cf->'lines') l) = (cf->>'net')::numeric);
    perform pg_temp.check('receivables on dashboard = receivables on balance sheet', (d->>'receivables_total')::numeric = (bs->'assets'->>'receivables')::numeric);
    perform pg_temp.check('stock value on dashboard = finished goods on balance sheet', abs((d->>'stock_value')::numeric - (bs->'assets'->>'finished_goods')::numeric) < 1);
    perform pg_temp.check('payables on dashboard = supplier payables on balance sheet', (d->>'payables_total')::numeric = (bs->'liabilities'->>'supplier_payables')::numeric);
  end;
end $$;
