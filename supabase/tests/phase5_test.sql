-- Phase 5 tests: P&L, profitability, cash-flow statement, balance sheet, summaries, forecast, integrity
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,100); end $$;
create or replace function pg_temp.n(j jsonb, k text) returns numeric language sql as $$ select coalesce((j->>k)::numeric,0) $$;

reset role;
create temp table ids5 as select (select id from accounts where name='Cash') cashid, (select id from accounts where name='Bank') bankid, (select id from accounts where name='Mobile') mmid,
  (select id from transaction_categories where name='Customer debt collections' and kind='income') colid, (select id from transaction_categories where name='Cash sales' and kind='income') salesid,
  (select id from transaction_categories where name='Other income' and kind='income') otherid, (select id from transaction_categories where name='Rent' and kind='expense') rentid,
  (select id from transaction_categories where name='Electricity' and kind='expense') elecid, (select id from suppliers where name='Hima Cement') supid;
grant select on ids5 to authenticated;
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

do $$ declare
  cash uuid; bank uuid; colc uuid; salesc uuid; otherc uuid; rentc uuid; elecc uuid; sup uuid; r jsonb; r2 jsonb; d jsonb; net0 numeric; p9 uuid; cu uuid; s9 uuid; row_ jsonb; bal numeric; txc0 int; f jsonb; f2 jsonb; item uuid; lo0 numeric; ex jsonb; i1 uuid; tot numeric;
begin
  select cashid, bankid, colid, salesid, otherid, rentid, elecid, supid into cash, bank, colc, salesc, otherc, rentc, elecc, sup from ids5;
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');

  -- ===== P&L ties to the same events the dashboard uses =====
  r := profit_and_loss('2000-01-01', current_date); d := dashboard_summary('2000-01-01', current_date);
  perform pg_temp.check('net = revenue − COGS − opex + other income − other expenses', abs(pg_temp.n(r,'net_profit') - ((r->'revenue'->>'total')::numeric - (r->'cogs'->>'total')::numeric - (r->'operating_expenses'->>'total')::numeric + (r->'other_income'->>'total')::numeric - (r->'other_expenses'->>'total')::numeric)) < 0.01);
  perform pg_temp.check('gross profit = revenue − COGS', abs(pg_temp.n(r,'gross_profit') - ((r->'revenue'->>'total')::numeric - (r->'cogs'->>'total')::numeric)) < 0.01);
  perform pg_temp.check('opex + other expenses = dashboard expenses', abs((r->'operating_expenses'->>'total')::numeric + (r->'other_expenses'->>'total')::numeric - pg_temp.n(d,'expenses')) < 0.01);
  perform pg_temp.check('COGS = dashboard COGS', abs((r->'cogs'->>'total')::numeric - pg_temp.n(d,'cogs')) < 0.01);
  perform pg_temp.check('revenue + other income + excluded collections = dashboard revenue', abs((r->'revenue'->>'total')::numeric + (r->'other_income'->>'total')::numeric + (r->'memo'->>'collections_booked_as_income_excluded')::numeric - pg_temp.n(d,'revenue')) < 0.01);
  perform pg_temp.check('invoiced sales = Σ confirmed invoices', abs((r->'revenue'->>'invoiced_sales')::numeric - (select coalesce(sum(total),0) from sales where status='confirmed')) < 0.01);
  perform pg_temp.check('product sales + transport = invoiced sales', abs((r->'revenue'->>'product_sales')::numeric + (r->'revenue'->>'transport')::numeric - (r->'revenue'->>'invoiced_sales')::numeric) < 0.01);

  -- ===== things that must NOT move profit =====
  net0 := pg_temp.n(r,'net_profit');
  perform record_transaction('income', current_date, cash, 10000, 'Debt collection booked as income', colc);
  perform record_transaction('loan_received', current_date, bank, 500000, 'Bank loan');
  perform record_transaction('loan_repayment', current_date, bank, 100000, 'Principal');
  perform record_transaction('owner_contribution', current_date, cash, 200000, 'Capital');
  perform record_transaction('owner_withdrawal', current_date, cash, 50000, 'Drawings');
  perform record_transfer(current_date, cash, (select mmid from ids5), 30000);
  perform record_supplier_payment(sup, bank, 20000, current_date);
  perform record_material_purchase(sup, current_date, 'P5-1', null, jsonb_build_array(jsonb_build_object('material_id',(select id from raw_materials where name='Cement'),'quantity',10,'unit_cost',30000)));
  r2 := profit_and_loss('2000-01-01', current_date);
  perform pg_temp.check('collections, loans, owner flows, transfers, supplier payments and stock purchases leave profit unchanged', abs(pg_temp.n(r2,'net_profit') - net0) < 0.01);
  perform pg_temp.check('collection booked as income is excluded and disclosed', (r2->'memo'->>'collections_booked_as_income_excluded')::numeric = (r->'memo'->>'collections_booked_as_income_excluded')::numeric + 10000);
  perform pg_temp.check('owner / loan flows disclosed in the memo, outside profit', (r2->'memo'->>'loans_received')::numeric = (r->'memo'->>'loans_received')::numeric + 500000 and (r2->'memo'->>'owner_withdrawals')::numeric = (r->'memo'->>'owner_withdrawals')::numeric + 50000);
  -- things that MUST move profit
  perform record_transaction('income', current_date, cash, 70000, 'Manual cash sale', salesc);
  perform record_transaction('income', current_date, cash, 8000, 'Scrap sale', otherc);
  perform record_expense(current_date, rentc, 'P5 rent', 120000);
  r := profit_and_loss('2000-01-01', current_date);
  perform pg_temp.check('manual sales, other income and a new expense move profit by +70000 +8000 −120000', abs(pg_temp.n(r,'net_profit') - (net0 + 70000 + 8000 - 120000)) < 0.01);
  perform pg_temp.check('other income reported separately from revenue', (select count(*) from jsonb_array_elements(r->'other_income'->'lines') l where l->>'label'='Other income')=1);

  -- period filter
  perform pg_temp.check('a period with no activity is zero', pg_temp.n(profit_and_loss('2001-01-01','2001-12-31'),'net_profit')=0);

  -- ===== product profitability =====
  select id into cu from customers where name='Mukasa Builders';
  insert into products(sku,name,selling_price) values ('P9','Profit test block',1000) returning id into p9;
  perform record_opening_stock(p9, 100, 600);
  s9 := save_sale(null, cu, current_date, jsonb_build_array(jsonb_build_object('product_id',p9,'quantity',10,'unit_price',1000)), 0, 0, null, null, null, true);
  r := product_profitability(current_date, current_date);
  select x into row_ from jsonb_array_elements(r->'rows') x where x->>'product'='Profit test block';
  perform pg_temp.check('undispatched sale is costed at average cost and marked estimated', (row_->>'cost')::numeric=6000 and (row_->>'estimated_cost_share_pct')::numeric=100 and (row_->>'revenue')::numeric=10000 and (row_->>'margin_pct')::numeric=40);
  perform set_delivery_status(s9, 'dispatched');
  r := product_profitability(current_date, current_date);
  select x into row_ from jsonb_array_elements(r->'rows') x where x->>'product'='Profit test block';
  perform pg_temp.check('dispatched sale uses the actual dispatch cost (not estimate)', (row_->>'cost')::numeric=6000 and (row_->>'estimated_cost_share_pct')::numeric=0 and (row_->>'gross_profit')::numeric=4000);
  r := product_profitability('2000-01-01', current_date);
  perform pg_temp.check('product revenue + transport = Σ invoices (discounts allocated, nothing lost)', abs((select sum((x->>'revenue')::numeric) from jsonb_array_elements(r->'rows') x) + (r->>'transport_revenue')::numeric - (select sum(total) from sales where status='confirmed')) < 1);
  perform pg_temp.check('gross profit = revenue − cost on every row', not exists (select 1 from jsonb_array_elements(r->'rows') x where abs((x->>'gross_profit')::numeric - ((x->>'revenue')::numeric - (x->>'cost')::numeric)) > 0.011));
  update products set selling_price = 5555 where id = p9;
  perform pg_temp.check('price change after sale does not alter historic revenue', (select (x->>'revenue')::numeric from jsonb_array_elements(product_profitability(current_date,current_date)->'rows') x where x->>'product'='Profit test block')=10000);

  -- ===== cash-flow statement =====
  r := cash_flow_statement('2000-01-01', current_date);
  perform pg_temp.check('cash flow: opening + inflows − outflows = closing = Σ active balances', abs((r->>'closing')::numeric - (select sum(current_balance) from account_balances where status='active')) < 0.01 and abs((r->>'opening')::numeric + (r->>'net')::numeric - (r->>'closing')::numeric) < 0.01);
  perform pg_temp.check('lines add up to the totals', abs((select sum((x->>'inflow')::numeric) from jsonb_array_elements(r->'lines') x) - (r->>'inflows')::numeric) < 0.01 and abs((select sum((x->>'outflow')::numeric) from jsonb_array_elements(r->'lines') x) - (r->>'outflows')::numeric) < 0.01);
  perform pg_temp.check('financing activities separated from operating', exists (select 1 from jsonb_array_elements(r->'lines') x where x->>'section'='Financing' and x->>'label'='Loans received') and exists (select 1 from jsonb_array_elements(r->'lines') x where x->>'section'='Operating' and x->>'label'='Receipts from customers'));
  perform pg_temp.check('transfers are not in the statement', not exists (select 1 from jsonb_array_elements(r->'lines') x where x->>'label' ilike '%transfer%'));
  perform pg_temp.check('payroll payments shown on their own line', exists (select 1 from jsonb_array_elements(r->'lines') x where x->>'label'='Payroll paid'));

  -- ===== balance sheet =====
  r := balance_sheet();
  perform pg_temp.check('balance sheet: cash = Σ account balances', abs((r->'assets'->>'cash_and_bank_total')::numeric - (select sum(current_balance) from account_balances where status='active')) < 0.01);
  perform pg_temp.check('balance sheet: receivables = Σ invoice balances', abs((r->'assets'->>'receivables')::numeric - (select sum(balance) from sales where status='confirmed')) < 0.01);
  perform pg_temp.check('balance sheet: payables = Σ open supplier invoices', abs((r->'liabilities'->>'supplier_payables')::numeric - (select sum(balance) from supplier_invoices where status='open')) < 0.01);
  perform pg_temp.check('balance sheet: stock value = Σ qty × average cost', abs((r->'assets'->>'finished_goods')::numeric - (select sum(greatest(current_stock,0)*avg_cost) from products)) < 0.01 and abs((r->'assets'->>'raw_materials')::numeric - (select sum(greatest(current_stock,0)*unit_cost) from raw_materials)) < 0.01);
  perform pg_temp.check('balance sheet: loan = received − repaid principal', (r->'liabilities'->>'loans')::numeric = greatest((select sum(case type when 'loan_received' then amount else -amount end) from transactions where type in ('loan_received','loan_repayment') and status='posted' and not is_reversal),0));
  perform pg_temp.check('balance sheet balances: assets − liabilities = net assets; and carries its caveats', abs((r->'assets'->>'total')::numeric - (r->'liabilities'->>'total')::numeric - (r->'equity'->>'net_assets')::numeric) < 0.01 and jsonb_array_length(r->'notes') >= 2);

  -- ===== period summaries =====
  r := period_summary('month', '2000-01-01', current_date); d := dashboard_summary('2000-01-01', current_date);
  perform pg_temp.check('monthly summary: last closing cash = Σ account balances', abs((r->'rows'->-1->>'closing_cash')::numeric - (select sum(current_balance) from account_balances where status='active')) < 0.01);
  perform pg_temp.check('monthly summary totals = dashboard revenue and expenses', abs((select sum((x->>'revenue')::numeric) from jsonb_array_elements(r->'rows') x) - pg_temp.n(d,'revenue')) < 0.01 and abs((select sum((x->>'expenses')::numeric) from jsonb_array_elements(r->'rows') x) - pg_temp.n(d,'expenses')) < 0.01);
  perform pg_temp.check('daily summary works', jsonb_array_length(period_summary('day', current_date-30, current_date)->'rows') >= 1);

  -- ===== sales report =====
  select coalesce(sum(total),0) into tot from sales where status='confirmed';
  perform pg_temp.check('sales by customer / day / month / salesperson all total the invoices', (select abs(sum((x->>'net')::numeric) - tot) < 0.01 from jsonb_array_elements(sales_report('customer','2000-01-01',current_date)->'rows') x)
     and (select abs(sum((x->>'net')::numeric) - tot) < 0.01 from jsonb_array_elements(sales_report('day','2000-01-01',current_date)->'rows') x) and (select abs(sum((x->>'net')::numeric) - tot) < 0.01 from jsonb_array_elements(sales_report('month','2000-01-01',current_date)->'rows') x)
     and (select abs(sum((x->>'net')::numeric) - tot) < 0.01 from jsonb_array_elements(sales_report('salesperson','2000-01-01',current_date)->'rows') x));
  perform pg_temp.check('sales by product totals the line values', abs((select sum((x->>'net')::numeric) from jsonb_array_elements(sales_report('product','2000-01-01',current_date)->'rows') x) - (select sum(si.line_total) from sale_items si join sales s on s.id=si.sale_id where s.status='confirmed')) < 0.01);
  perform pg_temp.check('sales report filters by product', (select count(*) from jsonb_array_elements(sales_report('product','2000-01-01',current_date,p9)->'rows'))=1);
  perform pg_temp.fails('unknown grouping refused', $q$select sales_report('nonsense', current_date, current_date)$q$, 'unknown grouping');

  -- ===== forecast =====
  select count(*) into txc0 from transactions; select sum(current_balance) into bal from account_balances where status='active';
  f := cash_forecast();
  perform pg_temp.check('forecast: 90 days, flagged as forecast, opening = actual balances', jsonb_array_length(f->'daily')=90 and (f->>'is_forecast')::boolean and abs((f->>'opening')::numeric - bal) < 0.01);
  perform pg_temp.check('forecast never writes to the ledger', (select count(*) from transactions)=txc0 and (select sum(current_balance) from account_balances where status='active')=bal);
  perform pg_temp.check('open receivables are NOT assumed collected in full or on time', (select sum((x->>'in_collections')::numeric) from jsonb_array_elements(f->'daily') x) < (select sum(balance) from sales where status='confirmed') and (select sum(balance) from sales where status='confirmed') > 0);
  f2 := cash_forecast('{"collect_pct_current":100,"collect_pct_1_30":100,"collect_pct_31_60":100,"collect_pct_61_90":100,"collect_pct_90_plus":100,"collect_delay_days":1,"new_sales_enabled":false}');
  perform pg_temp.check('forecast assumptions are adjustable (100% collection, no new sales)', abs((select sum((x->>'in_collections')::numeric) from jsonb_array_elements(f2->'daily') x) - (select sum(balance) from sales where status='confirmed' and due_date <= current_date + 80)) < 100 and (select sum((x->>'in_new_sales')::numeric) from jsonb_array_elements(f2->'daily') x)=0);
  i1 := record_supplier_invoice(sup,'F-5',current_date,current_date+5,'expense',elecc,'Forecast test bill',123000);
  f := cash_forecast('{"recurring_expenses_enabled":false,"recurring_payroll_enabled":false}');
  perform pg_temp.check('supplier invoice due in 5 days is forecast as an outflow on day 5', (f->'daily'->4->>'out_suppliers')::numeric >= 123000 and (f->'daily'->4->>'date')::date = current_date+5);
  lo0 := (f->'lowest_point'->>'balance')::numeric;
  item := save_forecast_item(null, current_date+10, 'Buy a delivery truck', 900000000, 'out', 'planned_expense');
  f := cash_forecast('{"recurring_expenses_enabled":false,"recurring_payroll_enabled":false}');
  perform pg_temp.check('planned expense creates a flagged cash shortage', f->'first_shortage' is not null and jsonb_typeof(f->'first_shortage')='object' and (f->'first_shortage'->>'day')::int >= 10);
  perform pg_temp.check('dashboard carries the projected-shortage alert', jsonb_typeof(dashboard_summary(current_date,current_date)->'forecast_shortage')='object');
  perform save_forecast_item(item, current_date+10, 'Buy a delivery truck', 900000000, 'out', 'planned_expense', false);
  f := cash_forecast('{"recurring_expenses_enabled":false,"recurring_payroll_enabled":false}');
  perform pg_temp.check('deactivating the planned item removes the shortage', abs((f->'lowest_point'->>'balance')::numeric - lo0) < 1);
  perform pg_temp.fails('planned items must be in the future', $q$select save_forecast_item(null, current_date, 'x y', 100, 'out', 'other')$q$, 'future');

  -- ===== integrity =====
  ex := integrity_check();
  perform pg_temp.check('integrity: every invariant holds after all phases of test activity', not exists (select 1 from jsonb_array_elements(ex) x where not (x->>'ok')::boolean));
  if exists (select 1 from jsonb_array_elements(ex) x where not (x->>'ok')::boolean) then raise notice 'INTEGRITY DETAIL: %', (select jsonb_agg(x) from jsonb_array_elements(ex) x where not (x->>'ok')::boolean); end if;
  perform pg_temp.check('integrity check lists at least 15 invariants', jsonb_array_length(ex) >= 15);
end $$;

-- ===== roles & privileges =====
select pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- manager: dashboard + reports + budgets
select pg_temp.check('manager can read P&L, balance sheet and forecast', profit_and_loss(current_date-30,current_date) is not null and balance_sheet() is not null and cash_forecast() is not null);
select pg_temp.check('manager can plan forecast items', save_forecast_item(null, current_date+20, 'Planned repair', 5000, 'out', 'planned_expense') is not null);
select pg_temp.fails('manager cannot run the integrity check', $q$select integrity_check()$q$, 'FORBIDDEN');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- cashier: reports view only
select pg_temp.fails('cashier cannot read the P&L', $q$select profit_and_loss(current_date-30,current_date)$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot read the balance sheet or forecast', $q$select balance_sheet()$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot plan forecast items', $q$select save_forecast_item(null, current_date+20, 'x y', 5, 'out', 'other')$q$, 'FORBIDDEN');
select pg_temp.check('cashier can still run sales reports', sales_report('day', current_date-30, current_date) is not null);
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- storekeeper
select pg_temp.fails('storekeeper cannot read sales reports', $q$select sales_report('day', current_date-30, current_date)$q$, 'FORBIDDEN');
select pg_temp.fails('storekeeper cannot read cash flow', $q$select cash_flow_statement(current_date-30,current_date)$q$, 'FORBIDDEN');
select pg_temp.check('analytics internals are not callable', not has_function_privilege('authenticated','public._cash_forecast_core(jsonb)','execute') and not has_function_privilege('authenticated','public._fin_access()','execute') and not has_function_privilege('authenticated','public._dashboard_mgmt(date,date)','execute'));
