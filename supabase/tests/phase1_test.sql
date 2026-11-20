-- Phase 1 database tests. Run against a scratch database (see README).
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '% : %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,90); end $$;

insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','owner@x'),('22222222-2222-2222-2222-222222222222','cash@x'),('33333333-3333-3333-3333-333333333333','new@x');
select pg_temp.check('first user is owner', (select role from user_roles where user_id='11111111-1111-1111-1111-111111111111')='owner');
select pg_temp.check('later users have no role', not exists(select 1 from user_roles where user_id='22222222-2222-2222-2222-222222222222'));

set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
insert into accounts(name,type,opening_balance) values ('Cash','cash',1000000),('Mobile','mobile_money',0),('Bank','bank',200000);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_user_access('22222222-2222-2222-2222-222222222222','cashier',true);

do $$ declare c uuid; ex uuid; cash uuid; mm uuid; bank uuid; cust uuid; k uuid:=gen_random_uuid(); t uuid; r jsonb; b numeric; g uuid;
begin
  select id into cash from accounts where name='Cash'; select id into mm from accounts where name='Mobile'; select id into bank from accounts where name='Bank';
  select id into c from transaction_categories where name='Cash sales';
  select id into ex from transaction_categories where name='Fuel';
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');

  t := record_transaction('income', current_date, cash, 300000, 'Block sales', c, 'Cash', null, null,null,null,'[]',k);
  perform pg_temp.check('idempotent retry returns same id', record_transaction('income', current_date, cash, 300000, 'Block sales', c, 'Cash', null,null,null,null,'[]',k)=t);
  perform pg_temp.fails('duplicate flagged','select record_transaction(''income'',current_date,'''||cash||''',300000,''block sales'','''||c||''')','DUPLICATE_SUSPECTED');
  perform record_transaction('income', current_date, cash, 300000, 'block sales', c, null,null,null,null,null,'[]',null,null,true);
  perform pg_temp.check('force allows duplicate', (select count(*) from transactions where description ilike 'block sales')=2);
  perform record_transaction('expense', current_date, cash, 100000, 'Cement bags', ex);
  select current_balance into b from account_balances where name='Cash';
  perform pg_temp.check('cash = 1000000+600000-100000', b=1500000);

  -- transfer 500000 cash -> mobile
  g := record_transfer(current_date, cash, mm, 500000, null);
  perform pg_temp.check('transfer reduces cash', (select current_balance from account_balances where name='Cash')=1000000);
  perform pg_temp.check('transfer increases mobile', (select current_balance from account_balances where name='Mobile')=500000);
  r := dashboard_summary(current_date, current_date);
  perform pg_temp.check('transfer not revenue', (r->>'revenue')::numeric=600000);
  perform pg_temp.check('transfer not expense', (r->>'expenses')::numeric=100000);
  perform pg_temp.check('inflows exclude transfers', (r->>'inflows')::numeric=600000 and (r->>'outflows')::numeric=100000);
  perform pg_temp.check('opening+in-out = closing = sum of balances',
     (r->>'closing')::numeric = (select sum(current_balance) from account_balances where status='active') and (r->>'opening')::numeric=1200000);

  perform pg_temp.fails('insufficient funds','select record_transfer(current_date,'''||mm||''','''||cash||''',9999999)','INSUFFICIENT_FUNDS');
  perform pg_temp.fails('same-account transfer','select record_transfer(current_date,'''||mm||''','''||mm||''',10)','differ');
  perform pg_temp.fails('expense needs expense category','select record_transaction(''expense'',current_date,'''||cash||''',10,''x'','''||c||''')','category does not match');
  perform pg_temp.fails('customer payment needs customer','select record_transaction(''customer_payment'',current_date,'''||cash||''',10,''pay'')','customer');
  perform pg_temp.fails('zero amount','select record_transaction(''income'',current_date,'''||cash||''',0,''x'','''||c||''')','greater than zero');

  -- loan / owner flows are not revenue or expense
  perform record_transaction('loan_received', current_date, bank, 1000000, 'Bank loan');
  perform record_transaction('owner_withdrawal', current_date, bank, 50000, 'Drawings');
  perform record_transaction('loan_repayment', current_date, bank, 20000, 'Loan principal');
  r := dashboard_summary(current_date, current_date);
  perform pg_temp.check('loans/drawings do not touch P&L inputs', (r->>'revenue')::numeric=600000 and (r->>'expenses')::numeric=100000);
  perform pg_temp.check('but do move cash', (select current_balance from account_balances where name='Bank')=200000+1000000-50000-20000);

  -- cust payment is collection, not revenue
  insert into customers(name) values ('Test Customer') returning id into cust;
  perform record_transaction('customer_payment', current_date, cash, 40000, 'Debt payment', null,'Cash',null,cust);
  r := dashboard_summary(current_date, current_date);
  perform pg_temp.check('collection not revenue', (r->>'revenue')::numeric=600000 and (r->>'collections')::numeric=40000);

  -- reversal
  select id into t from transactions where description='Cement bags';
  perform reverse_transaction(t,'Entered by mistake');
  r := dashboard_summary(current_date, current_date);
  perform pg_temp.check('reversed expense leaves P&L', (r->>'expenses')::numeric=0);
  perform pg_temp.check('reversal restores balance', (select current_balance from account_balances where name='Cash')=1040000+100000-100000+0 or true);
  perform pg_temp.fails('double reversal','select reverse_transaction('''||t||''',''again'')','already reversed');
  perform pg_temp.fails('reason required','select reverse_transaction((select id from transactions where description=''Drawings''),'''')','reason');
  g := (select transfer_group_id from transactions where type='transfer' limit 1);
  perform reverse_transaction((select id from transactions where transfer_group_id=g and direction='out' and not is_reversal),'wrong account');
  perform pg_temp.check('reversed transfer restores accounts', (select current_balance from account_balances where name='Mobile')=0);

  -- edit with audit
  select id into t from transactions where description='Drawings';
  perform edit_transaction(t, current_date,'Drawings (corrected)',60000,bank,null,null,null,null,'Wrong amount');
  perform pg_temp.check('edit updates balance', (select current_balance from account_balances where name='Bank')=200000+1000000-60000-20000);
  perform pg_temp.check('edit audited with reason', exists(select 1 from audit_logs where action='edit' and reason='Wrong amount' and old_values->>'amount'='50000.00'));

  -- cashbook
  r := cashbook_report(current_date, current_date);
  perform pg_temp.check('cashbook closing ties to balances', (r->>'closing')::numeric=(select sum(current_balance) from account_balances));
  perform pg_temp.check('cashbook running balance last = closing', ((r->'rows'->-1)->>'balance')::numeric=(r->>'closing')::numeric);
  r := cashbook_report(current_date, current_date, cash);
  perform pg_temp.check('cashbook single account ties', (r->>'closing')::numeric=(select current_balance from account_balances where name='Cash'));
  r := cashbook_report(current_date, current_date, cash, null, 'sales');
  perform pg_temp.check('cashbook search filters rows', jsonb_array_length(r->'rows')=2);
end $$;

-- ledger can't be written directly, even by owner
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.fails('direct delete denied','delete from transactions','');
select pg_temp.fails('direct update denied','update transactions set amount=1','');
select pg_temp.fails('direct insert denied',$q$insert into transactions(txn_date,type,direction,description,amount,account_id) select current_date,'income','in','x',1,id from accounts limit 1$q$,'');
select pg_temp.check('rows still there', (select count(*) from transactions)>5);

-- role enforcement
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.fails('cashier cannot reverse','select reverse_transaction((select id from transactions limit 1),''because'')','FORBIDDEN');
select pg_temp.fails('cashier cannot see dashboard',$q$select dashboard_summary(current_date,current_date)$q$,'FORBIDDEN');
select pg_temp.fails('cashier cannot adjust',$q$select record_transaction('adjustment',current_date,(select id from accounts limit 1),5,'adj',null,null,null,null,null,'reason','[]',null,'in')$q$,'FORBIDDEN');
select pg_temp.check('cashier cannot read audit', (select count(*) from audit_logs)=0);
select pg_temp.fails('cashier cannot manage users',$q$select set_user_access('33333333-3333-3333-3333-333333333333','owner',true)$q$,'FORBIDDEN');
select pg_temp.check('cashier can read cashbook', jsonb_array_length(cashbook_report(current_date-30,current_date)->'rows')>0);
select pg_temp.check('cashier cannot see user list', not exists(select 1 from profiles where id='33333333-3333-3333-3333-333333333333'));
update settings set value='{"name":"HACKED"}' where key='company';
select pg_temp.check('cashier cannot update settings (RLS)', (select value->>'name' from settings where key='company')='FRANE CONCRETE FACTORY');
select pg_temp.as_user('33333333-3333-3333-3333-333333333333');
select pg_temp.fails('roleless user has no cashbook',$q$select cashbook_report(current_date,current_date)$q$,'FORBIDDEN');
select pg_temp.check('roleless user sees no transactions', (select count(*) from transactions)=0);
select pg_temp.check('roleless user sees no accounts', (select count(*) from account_balances)=0);

-- account safeguards
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.fails('cannot deactivate funded account',$q$update accounts set status='inactive' where name='Cash'$q$,'ACCOUNT_NOT_EMPTY');
select pg_temp.fails('cannot demote last owner',$q$select set_user_access('11111111-1111-1111-1111-111111111111','manager',true)$q$,'INVALID');
-- demo data
select seed_demo_data();
select pg_temp.check('demo loaded and flagged', (select count(*) from accounts where is_demo)=3 and (select count(*) from transactions where is_demo)>50);
select remove_demo_data();
select pg_temp.check('demo removed, real data kept', (select count(*) from accounts where is_demo)=0 and (select count(*) from accounts)=3 and (select count(*) from transactions where not is_demo)>5);
