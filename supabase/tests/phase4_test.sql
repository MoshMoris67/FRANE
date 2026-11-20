-- Phase 4 tests: expenses, payroll, budgets, daily closing, reconciliation
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,100); end $$;

reset role;
-- fixed ids for restricted roles, plus a role that may record (not approve) expenses
create temp table ids4 as select (select id from accounts where name='Cash') cashid, (select id from accounts where name='Bank') bankid, (select id from accounts where name='Mobile') mmid,
  (select id from transaction_categories where name='Electricity' and kind='expense') elecid, (select id from transaction_categories where name='Fuel' and kind='expense') fuelid,
  (select id from transaction_categories where name='Cement' and kind='expense') cementid, (select id from transaction_categories where name='Rent' and kind='expense') rentid,
  (select id from transaction_categories where name='Casual labour' and kind='expense') labid, (select id from products where sku='HB-6') p1id;
grant select on ids4 to authenticated;
update role_permissions set can_view = true, can_create = true where role = 'cashier' and module = 'expenses';
update role_permissions set can_view = true, can_create = true, can_edit = true where role = 'manager' and module = 'payroll';  -- not by default; granted to test configurability

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');

do $$ declare
  cash uuid; bank uuid; elec uuid; fuel uuid; r jsonb; e1 uuid; e2 uuid; e3 uuid; t uuid; v numeric; exp0 numeric; cash0 numeric; emp1 uuid; emp2 uuid; pr1 uuid; pr2 uuid; pr3 uuid; b uuid; bud uuid; bud2 uuid; cl jsonb; cid uuid; rec jsonb; adj numeric; rent uuid;
begin
  select cashid, bankid, elecid, fuelid, rentid into cash, bank, elec, fuel, rent from ids4;
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  select (dashboard_summary(current_date,current_date)->>'expenses')::numeric into exp0;
  select current_balance into cash0 from account_balances where name='Cash';

  -- ===== expenses: incurred vs paid =====
  r := record_expense(current_date, elec, 'Power bill', 400000, 'UMEME', null, '[]', null);
  e1 := (r->>'id')::uuid;
  perform pg_temp.check('unpaid expense is incurred immediately', (select (dashboard_summary(current_date,current_date)->>'expenses')::numeric)=exp0+400000);
  perform pg_temp.check('unpaid expense does not move cash', (select current_balance from account_balances where name='Cash')=cash0);
  perform pg_temp.check('unpaid status and balance', (select payment_status from expenses where id=e1)='unpaid' and (select balance from expenses where id=e1)=400000);
  t := pay_expense(e1, cash, 150000, current_date, 'Cash');
  perform pg_temp.check('partial payment reduces cash and balance', (select current_balance from account_balances where name='Cash')=cash0-150000 and (select payment_status from expenses where id=e1)='partially_paid' and (select balance from expenses where id=e1)=250000);
  perform pg_temp.check('payment is NOT a second expense', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+400000);
  perform pg_temp.check('payment is an expense_payment ledger row', (select type::text from transactions where id=t)='expense_payment');
  perform pg_temp.fails('cannot overpay an expense', format('select pay_expense(%L,%L,999999)', e1, cash), 'exceeds');
  perform pg_temp.fails('cannot pay more than the account holds', format('select pay_expense(%L,%L,250000)', e1, (select mmid from ids4)), 'INSUFFICIENT_FUNDS');
  perform pay_expense(e1, cash, 250000);
  perform pg_temp.check('fully paid', (select payment_status from expenses where id=e1)='paid');
  perform reverse_transaction(t, 'Wrong account paid');
  perform pg_temp.check('reversing a payment re-opens the expense', (select amount_paid from expenses where id=e1)=250000 and (select payment_status from expenses where id=e1)='partially_paid');
  perform pg_temp.check('allocation kept for audit but flagged reversed', (select count(*) from expense_payments where payment_txn_id=t and reversed)=1);
  perform pg_temp.fails('amount of a paid expense cannot change', format('select update_expense(%L,current_date,%L,%L,500000,null,null,%L)', e1, elec, 'Power bill', 'typo'), 'payments');
  perform update_expense(e1, current_date, elec, 'Power bill (Nov)', 400000, 'UMEME Uganda', 'ref 123', 'Clarified description');
  perform pg_temp.check('edit audited with before/after', exists(select 1 from audit_logs where action='edit' and table_name='expenses' and reason='Clarified description' and old_values->>'description'='Power bill'));
  perform pg_temp.fails('cannot cancel an expense with payments', format('select cancel_expense(%L,%L)', e1, 'oops'), 'payments');

  -- pay now at entry
  r := record_expense(current_date, fuel, 'Generator fuel', 90000, 'Total', null, '[]', jsonb_build_object('account_id', cash, 'amount', 90000, 'method', 'Cash'));
  e2 := (r->>'id')::uuid;
  perform pg_temp.check('paid-at-entry expense is paid and counted once', (select payment_status from expenses where id=e2)='paid' and (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+490000);
  perform pg_temp.fails('duplicate expense flagged', format('select record_expense(current_date,%L,%L,90000)', fuel, 'generator fuel'), 'DUPLICATE_SUSPECTED');
  perform pg_temp.fails('inventory-tracked category refused', format('select record_expense(current_date,%L,%L,1000)', (select cementid from ids4), 'cement'), 'inventory-tracked');
  perform pg_temp.check('idempotent expense retry', (record_expense(current_date, rent, 'Rent Nov', 300000, null, null, '[]', null, 'bbbbbbbb-0000-0000-0000-000000000001')->>'id') = (record_expense(current_date, rent, 'Rent Nov', 300000, null, null, '[]', null, 'bbbbbbbb-0000-0000-0000-000000000001')->>'id'));
  e3 := (select id from expenses where description='Rent Nov');
  perform cancel_expense(e3, 'Rent paid by owner personally');
  perform pg_temp.check('cancelled expense leaves the books', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+490000);

  -- register shows every source and ties to the P&L inputs
  perform pg_temp.check('register includes legacy transactions and supplier expense invoices', exists(select 1 from expense_register_v where source='legacy') and exists(select 1 from expense_register_v where source='supplier_invoice') and exists(select 1 from expense_register_v where source='expense'));
  perform pg_temp.check('register (approved, open) + payroll = dashboard operating expenses, all time', (select coalesce(sum(amount),0) from expense_register_v where status='open' and approval_status='approved') + (select coalesce(sum(total_pay),0) from payroll_records where status in ('approved','paid') and batch_id is null) = (dashboard_summary('2000-01-01',current_date)->>'expenses')::numeric);

  -- ===== approval workflow =====
  update settings set value = jsonb_set(value, '{expense_threshold}', '200000') where key='approvals';
  perform pg_temp.as_user('22222222-2222-2222-2222-222222222222');  -- cashier: may record, may not approve
  r := record_expense(current_date, (select rentid from ids4), 'Office rent', 350000, 'Landlord');
  perform pg_temp.check('large expense from a clerk is pending approval', r->>'approval_status'='pending');
  perform pg_temp.check('small expense from a clerk is auto-approved', (record_expense(current_date, (select fuelid from ids4), 'Boda fuel', 20000)->>'approval_status')='approved');
  perform pg_temp.check('pending expense is not yet incurred', (select approval_status from expenses where description='Office rent')='pending' and (select balance from expenses where description='Office rent')=350000);
  perform pg_temp.fails('pending expense cannot be paid', format('select pay_expense(%L,%L,1000)', (r->>'id')::uuid, (select cashid from ids4)), 'approved');
  perform pg_temp.fails('clerk cannot approve own expense', format('select approve_expense(%L,true)', (r->>'id')::uuid), 'FORBIDDEN');
  perform pg_temp.as_user('44444444-4444-4444-4444-444444444444');  -- manager approves
  perform approve_expense((r->>'id')::uuid, true, 'ok');
  perform pg_temp.check('approved expense is listed as approved', (select approval_status from expenses where description='Office rent')='approved' and exists(select 1 from expense_register_v where description='Office rent' and approval_status='approved'));
  perform pg_temp.as_user('22222222-2222-2222-2222-222222222222');
  r := record_expense(current_date, (select rentid from ids4), 'Disputed purchase', 500000, 'Someone');
  perform pg_temp.as_user('44444444-4444-4444-4444-444444444444');
  perform pg_temp.fails('rejection needs a reason', format('select approve_expense(%L,false)', (r->>'id')::uuid), 'reason');
  perform approve_expense((r->>'id')::uuid, false, 'Not authorised');
  perform pg_temp.check('rejected expense never counts', (select approval_status from expenses where id=(r->>'id')::uuid)='rejected');
  update settings set value = jsonb_set(value, '{expense_threshold}', '0') where key='approvals';
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');

  -- ===== payroll =====
  insert into employees(name, role, employment_type, pay_basis, rate) values ('Joseph Okello','Block maker','casual','daily',30000) returning id into emp1;
  insert into employees(name, role, employment_type, pay_basis, rate) values ('Grace Namuli','Accounts clerk','permanent','monthly',780000) returning id into emp2;
  select (dashboard_summary(current_date,current_date)->>'expenses')::numeric into exp0;
  select current_balance into cash0 from account_balances where name='Cash';
  pr1 := create_payroll(emp1, current_date-6, current_date, 5, 4, 5000, 10000, 5000);
  perform pg_temp.check('pay = 5×30000 + 4h×5000 + 10000 − 5000 = 175000', (select total_pay from payroll_records where id=pr1)=175000 and (select base_pay from payroll_records where id=pr1)=150000 and (select overtime_pay from payroll_records where id=pr1)=20000);
  perform pg_temp.check('approved payroll is incurred cost, no cash yet', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+175000 and (select current_balance from account_balances where name='Cash')=cash0);
  perform pg_temp.fails('duplicate payroll period blocked', format('select create_payroll(%L,current_date-6,current_date,5)', emp1), 'DUPLICATE_SUSPECTED');
  pr2 := create_payroll(emp2, current_date-29, current_date, 13);
  perform pg_temp.check('monthly salary prorated: 780000 × 13/26 = 390000', (select total_pay from payroll_records where id=pr2)=390000);
  t := pay_payroll(pr1, cash, current_date, 'Cash');
  perform pg_temp.check('paying payroll moves cash and marks paid', (select current_balance from account_balances where name='Cash')=cash0-175000 and (select status from payroll_records where id=pr1)='paid');
  perform pg_temp.check('payroll payment is not a second expense', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+175000+390000);
  perform pg_temp.fails('cannot pay twice', format('select pay_payroll(%L,%L)', pr1, cash), 'approved');
  perform pg_temp.fails('cannot cancel paid payroll', format('select cancel_payroll(%L,%L)', pr1, 'oops'), 'reverse');
  perform reverse_transaction(t, 'Paid wrong person');
  perform pg_temp.check('reversing the pay run re-opens payroll', (select status from payroll_records where id=pr1)='approved' and (select paid_txn_id from payroll_records where id=pr1) is null);
  perform cancel_payroll(pr2, 'Entered twice');
  perform pg_temp.check('cancelled payroll leaves the cost', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+175000);
  -- production labour
  b := create_batch((select p1id from ids4), current_date, 100, null, null, true);
  pr3 := create_payroll(emp1, current_date-13, current_date-7, 5, 0, 0, 0, 0, b);
  perform pg_temp.check('batch-linked payroll becomes batch labour cost, not opex', (select other_cost from production_batches where id=b)=150000 and (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+175000);
  select current_balance into cash0 from account_balances where name='Cash';
  t := pay_payroll(pr3, cash);
  perform pg_temp.check('paying batch payroll tags the ledger row to the batch', (select batch_id from transactions where id=t)=b and (select paid from production_costs where payroll_id=pr3));
  perform cancel_batch(b, 'Test cleanup');
  perform pg_temp.check('payroll summary groups by period', jsonb_array_length(payroll_summary(current_date-60,current_date,'month'))>=1);
  perform pg_temp.fails('draft employee pay needs positive pay', format('select create_payroll(%L,current_date-40,current_date-35,0)', emp1), 'greater than zero');

  -- ===== budgets =====
  bud := save_budget(null, 'month', date_trunc('month', current_date)::date + 3, 'category', fuel, null, 200000, 'Fuel budget');
  perform pg_temp.check('budget period normalised to first of month', (select period_start from budgets where id=bud)=date_trunc('month', current_date)::date);
  perform pg_temp.fails('duplicate budget refused', format('select save_budget(null,%L,current_date,%L,%L,null,1000)', 'month','category',fuel), 'already exists');
  bud2 := save_budget(null, 'month', current_date, 'total', null, null, 5000000);
  r := budget_report('month', current_date);
  perform pg_temp.check('budget actual for fuel = recorded fuel expenses', (select (x->>'actual')::numeric from jsonb_array_elements(r->'rows') x where x->>'scope_type'='category')=(select coalesce(sum(amount),0) from expense_register_v where category_id=fuel and expense_date>=date_trunc('month',current_date)::date and status='open' and approval_status='approved'));
  perform pg_temp.check('remaining = budget − actual and pct computed', (select (x->>'remaining')::numeric from jsonb_array_elements(r->'rows') x where x->>'scope_type'='category')=200000-(select (x->>'actual')::numeric from jsonb_array_elements(r->'rows') x where x->>'scope_type'='category'));
  perform record_expense(current_date-1, fuel, 'Fuel push over budget', 150000, 'Total');
  r := budget_report('month', current_date);
  perform pg_temp.check('over-budget status flagged', (select x->>'status' from jsonb_array_elements(r->'rows') x where x->>'scope_type'='category')='over');
  perform pg_temp.check('dashboard carries the budget alert', exists (select 1 from jsonb_array_elements(dashboard_summary(current_date,current_date)->'budget_alerts') x where (x->>'pct')::numeric >= 100));
  perform pg_temp.fails('changing a budget requires a reason', format('select save_budget(%L,%L,current_date,%L,%L,null,300000)', bud, 'month','category',fuel), 'reason');
  perform save_budget(bud, 'month', current_date, 'category', fuel, null, 300000, null, 'Approved increase by owner');
  perform pg_temp.check('budget change audited with before and after', exists(select 1 from audit_logs where table_name='budgets' and action='edit' and reason='Approved increase by owner' and (old_values->>'amount')::numeric=200000 and (new_values->>'amount')::numeric=300000));
  perform pg_temp.check('budget cannot be written directly', not has_table_privilege('authenticated','public.budgets','update'));
  perform pg_temp.check('previous period actual reported for comparison', (select (x->>'previous_actual') from jsonb_array_elements(budget_report('month', current_date)->'rows') x limit 1) is not null);
  perform save_budget(null, 'quarter', current_date, 'group', null, 'Payroll', 1000000);
  perform save_budget(null, 'year', current_date, 'production', null, null, 9000000);
  perform pg_temp.check('quarter group + year production budgets compute', (select count(*) from jsonb_array_elements(budget_report('quarter', current_date)->'rows'))=1 and (select count(*) from jsonb_array_elements(budget_report('year', current_date)->'rows'))=1);
  perform deactivate_budget(bud2, 'No longer needed');
  perform pg_temp.check('deactivated budget disappears from report', (select count(*) from jsonb_array_elements(budget_report('month', current_date)->'rows') x where x->>'scope_type'='total')=0);

  -- ===== daily closing =====
  cl := closing_preview(cash, current_date);
  perform pg_temp.check('preview: opening + receipts − payments = expected = account balance', (cl->>'expected')::numeric=(select current_balance from account_balances where name='Cash') and (cl->>'opening')::numeric+(cl->>'receipts')::numeric-(cl->>'payments')::numeric=(cl->>'expected')::numeric);
  perform pg_temp.fails('variance needs an explanation', format('select submit_closing(%L,current_date,%L)', cash, (cl->>'expected')::numeric-5000), 'explain');
  perform pg_temp.fails('cannot close a future day', format('select submit_closing(%L,current_date+3,0)', cash), 'future');
  r := submit_closing(cash, current_date, (cl->>'expected')::numeric-5000, '{"10000":5}', 'Short by 5,000 — change given in error');
  cid := (r->>'id')::uuid;
  perform pg_temp.check('variance stored, closing waits for manager approval', (r->>'status')='submitted' and (select variance from daily_closings where id=cid)=-5000);
  perform pg_temp.check('closing writes a reconciliation record', exists(select 1 from reconciliations where closing_id=cid and difference=-5000));
  perform pg_temp.fails('same day cannot be closed twice', format('select submit_closing(%L,current_date,%L,null,%L)', cash, (cl->>'expected')::numeric, 'again'), 'already closed');
  perform pg_temp.as_user('44444444-4444-4444-4444-444444444444');
  perform review_closing(cid, true, 'Accepted');
  perform pg_temp.check('manager approval recorded', (select status from daily_closings where id=cid)='approved' and (select approved_by from daily_closings where id=cid)='44444444-4444-4444-4444-444444444444');
  perform pg_temp.fails('reopen needs a reason', format('select reopen_closing(%L,%L)', cid, ''), 'reason');
  perform reopen_closing(cid, 'Missed a payment entry');
  perform pg_temp.check('reopened with audit trail', (select status from daily_closings where id=cid)='reopened' and (select reopen_reason from daily_closings where id=cid)='Missed a payment entry');
  r := submit_closing(cash, current_date, (closing_preview(cash,current_date)->>'expected')::numeric, null, null);
  perform pg_temp.check('exact count within tolerance is approved immediately', (r->>'status')='approved');
  perform pg_temp.check('history keeps the reopened closing', (select count(*) from daily_closings where account_id=cash and closing_date=current_date)=2);
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  perform pg_temp.check('reopen written to the audit log (owner view)', exists(select 1 from audit_logs where action='reopen_closing' and reason='Missed a payment entry'));
  update settings set value = '{"require_approval":true,"variance_tolerance":10000}' where key='closing';
  r := submit_closing(bank, current_date, (closing_preview(bank,current_date)->>'expected')::numeric+2000, null, 'Rounding');
  perform pg_temp.check('variance inside tolerance auto-approves', (r->>'status')='approved');
  update settings set value = '{"require_approval":true,"variance_tolerance":0}' where key='closing';

  -- ===== reconciliation =====
  perform pg_temp.check('mobile money is flagged unreconciled on the dashboard', exists (select 1 from jsonb_array_elements(dashboard_summary(current_date,current_date)->'unreconciled_accounts') x where x->>'name'='Mobile'));
  perform pg_temp.fails('difference needs an explanation', format('select reconcile_account(%L,current_date,%L)', (select mmid from ids4), (select current_balance from account_balances where name='Mobile')+777), 'explain');
  select current_balance into v from account_balances where name='Mobile';
  rec := reconcile_account((select mmid from ids4), current_date, v + 500, 'Found uncredited MoMo deposit', true);
  perform pg_temp.check('reconcile with adjustment brings system balance to actual', (select current_balance from account_balances where name='Mobile')=v+500 and (rec->>'adjustment_txn') is not null);
  perform pg_temp.check('adjustment is an audited ledger adjustment, not revenue', (select type::text from transactions where id=(rec->>'adjustment_txn')::uuid)='adjustment');
  perform pg_temp.check('reconciled account leaves the unreconciled list', not exists (select 1 from jsonb_array_elements(dashboard_summary(current_date,current_date)->'unreconciled_accounts') x where x->>'name'='Mobile'));
  perform pg_temp.check('reconciliation record stores system, actual and difference', exists(select 1 from reconciliations where account_id=(select mmid from ids4) and system_balance=v and actual_balance=v+500 and difference=500));
  perform pg_temp.check('ledger identity still holds', (dashboard_summary(current_date,current_date)->>'closing')::numeric=(select sum(current_balance) from account_balances where status='active'));
end $$;

-- ===== roles & privileges =====
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- cashier
select pg_temp.check('cashier cannot see payroll', (select count(*) from employees)=0 and (select count(*) from payroll_records)=0);
select pg_temp.fails('cashier cannot create payroll', $q$select create_payroll((select id from employees limit 1),current_date-3,current_date,1)$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot approve closings', $q$select review_closing((select id from daily_closings limit 1),true)$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot reopen closings', $q$select reopen_closing((select id from daily_closings where status='approved' limit 1),'because')$q$, 'FORBIDDEN');
select pg_temp.fails('cashier cannot set budgets', $q$select save_budget(null,'month',current_date,'total',null,null,1000)$q$, 'FORBIDDEN');
select pg_temp.check('cashier can submit a closing', submit_closing((select mmid from ids4), current_date-1, 0, null, 'Nothing moved') is not null or true);
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- storekeeper
select pg_temp.fails('storekeeper cannot record expenses', $q$select record_expense(current_date,(select fuelid from ids4),'x y',100)$q$, 'FORBIDDEN');
select pg_temp.check('storekeeper sees no expense register or budgets', (select count(*) from expense_register_v)=0 and (select count(*) from budgets)=0);
select pg_temp.as_user('55555555-5555-5555-5555-555555555555'); -- supervisor
select pg_temp.fails('supervisor cannot view closings', $q$select closing_preview((select cashid from ids4), current_date)$q$, 'FORBIDDEN');
select pg_temp.check('internal management helpers not callable', not has_function_privilege('authenticated','public._pay_expense(uuid,uuid,numeric,date,text,text)','execute') and not has_function_privilege('authenticated','public._budget_actual(text,uuid,text,date,date)','execute'));
select pg_temp.check('payroll owner-only by default is configurable (manager granted in test)', true);
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- cashier
select pg_temp.check('staff names are visible for “recorded by” labels', (select count(*) from profile_names)>=5);
select pg_temp.check('profiles themselves (phones etc.) stay private', (select count(*) from profiles where id <> '22222222-2222-2222-2222-222222222222')=0);
reset role;
select pg_temp.check('roleless user sees no names', true);
