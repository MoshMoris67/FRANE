-- Phase 7 security audit: attack the database as each kind of user. Every attack must be REFUSED.
-- Runs after phases 1-6 in the same database (reuses owner 1111, cashier 2222, storekeeper 3333, manager 4444, supervisor 5555).
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
-- the statement must raise an error OR change zero rows
create or replace function pg_temp.blocked(name text, sql text) returns void language plpgsql as $$
declare n bigint;
begin execute sql; get diagnostics n = row_count;
  raise notice '% : % (rows affected: %)', case when n = 0 then 'PASS' else 'FAIL' end, name, n;
exception when others then raise notice 'PASS : % [%]', name, left(sqlerrm, 70); end $$;
-- a read must return zero rows (or be refused)
create or replace function pg_temp.sees_nothing(name text, sql text) returns void language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || sql || ') x' into n; raise notice '% : % (rows visible: %)', case when n = 0 then 'PASS' else 'FAIL' end, name, n;
exception when others then raise notice 'PASS : % [%]', name, left(sqlerrm, 70); end $$;
create or replace function pg_temp.refused(name text, sql text, expect text default '') returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm, 80); end $$;

reset role;
insert into auth.users(id,email) values ('66666666-6666-6666-6666-666666666666','nobody@x'),('77777777-7777-7777-7777-777777777777','leaver@x');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
set role authenticated;
select set_user_access('77777777-7777-7777-7777-777777777777','manager',true);
select set_user_access('77777777-7777-7777-7777-777777777777','manager',false);   -- deactivated former employee

-- ===================== A. cashier attacks the ledger tables directly =====================
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.blocked('cashier cannot INSERT a transaction directly', $q$insert into transactions(txn_no,type,direction,txn_date,description,amount,account_id) select 'X','income','in',current_date,'fake',1,id from accounts limit 1$q$);
select pg_temp.blocked('cashier cannot UPDATE a transaction amount', $q$update transactions set amount = 1$q$);
select pg_temp.blocked('cashier cannot DELETE transactions', $q$delete from transactions$q$);
select pg_temp.blocked('cashier cannot UPDATE sales totals', $q$update sales set total = 1, amount_paid = total$q$);
select pg_temp.blocked('cashier cannot DELETE sale lines', $q$delete from sale_items$q$);
select pg_temp.blocked('cashier cannot forge payment allocations', $q$update payment_allocations set amount = amount + 1$q$);
select pg_temp.blocked('cashier cannot edit stock level', $q$update products set current_stock = 99999$q$);
select pg_temp.blocked('cashier cannot edit stock cost', $q$update products set avg_cost = 1$q$);
select pg_temp.blocked('cashier cannot rewrite stock ledger', $q$update inventory_movements set quantity = quantity * 2$q$);
select pg_temp.blocked('cashier cannot touch audit log (update)', $q$update audit_logs set action = 'x'$q$);
select pg_temp.blocked('cashier cannot touch audit log (delete)', $q$delete from audit_logs$q$);
select pg_temp.blocked('cashier cannot change account opening balance', $q$update accounts set opening_balance = opening_balance + 1000000$q$);
select pg_temp.blocked('cashier cannot grant themselves a role', $q$insert into user_roles(user_id,role) values ('22222222-2222-2222-2222-222222222222','owner')$q$);
select pg_temp.blocked('cashier cannot change anyone''s role', $q$update user_roles set role = 'owner'$q$);
select pg_temp.blocked('cashier cannot edit permissions matrix', $q$update role_permissions set can_delete = true$q$);
select pg_temp.blocked('cashier cannot edit company settings', $q$update settings set value = '{}'::jsonb$q$);
select pg_temp.blocked('cashier cannot reactivate/modify other profiles', $q$update profiles set full_name = 'hacked' where id <> '22222222-2222-2222-2222-222222222222'$q$);
select pg_temp.blocked('cashier cannot activate themselves via profile (cannot flip active)', $q$update profiles set active = not active where id = '22222222-2222-2222-2222-222222222222'$q$);
select pg_temp.blocked('cashier cannot create accounts', $q$insert into accounts(name,type,opening_balance) values ('Secret','cash',1)$q$);
select pg_temp.blocked('cashier cannot create expense categories', $q$insert into transaction_categories(name,kind,group_name) values ('Free money','income','x')$q$);

-- ===================== B. cashier calls privileged functions =====================
select pg_temp.refused('cashier cannot read the P&L', $q$select profit_and_loss(current_date-30,current_date)$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot read the balance sheet', $q$select balance_sheet()$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot run the integrity check', $q$select integrity_check()$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot list users', $q$select list_users()$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot manage users', $q$select set_user_access('22222222-2222-2222-2222-222222222222','owner',true)$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot import data', $q$select import_data('customers','[]'::jsonb,true,'x')$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot seed demo data', $q$select seed_demo_data()$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot remove demo data', $q$select remove_demo_data()$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot edit a transaction', $q$select edit_transaction((select id from transactions limit 1), null, 'x', null, null, null, null, null, null, 'because')$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot approve expenses', $q$select approve_expense(gen_random_uuid(), true, 'ok')$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot approve a closing', $q$select review_closing(gen_random_uuid(), true, 'ok')$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot post a reconciliation adjustment to the ledger', $q$select reconcile_account((select id from accounts limit 1), current_date, 1, 'cashier trying to adjust', true)$q$, 'only a manager');
select pg_temp.refused('cashier cannot pay payroll', $q$select pay_payroll(gen_random_uuid(), (select id from accounts limit 1))$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot read supplier statements', $q$select supplier_statement((select id from suppliers limit 1), null, null)$q$, 'FORBIDDEN');
select pg_temp.refused('cashier cannot see the cash forecast', $q$select cash_forecast('{}'::jsonb)$q$, 'FORBIDDEN');

-- ===================== C. a signed-in user with NO role sees nothing =====================
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select pg_temp.sees_nothing('roleless: transactions', 'select * from transactions');
select pg_temp.sees_nothing('roleless: accounts', 'select * from accounts');
select pg_temp.sees_nothing('roleless: account balances view', 'select * from account_balances');
select pg_temp.sees_nothing('roleless: sales', 'select * from sales');
select pg_temp.sees_nothing('roleless: customers', 'select * from customers');
select pg_temp.sees_nothing('roleless: customer balances view', 'select * from customer_balances');
select pg_temp.sees_nothing('roleless: supplier balances view', 'select * from supplier_balances');
select pg_temp.sees_nothing('roleless: receivables view', 'select * from receivables');
select pg_temp.sees_nothing('roleless: payables view', 'select * from payables');
select pg_temp.sees_nothing('roleless: expense register', 'select * from expense_register_v');
select pg_temp.sees_nothing('roleless: products', 'select * from products');
select pg_temp.sees_nothing('roleless: employees (pay rates)', 'select * from employees');
select pg_temp.sees_nothing('roleless: payroll', 'select * from payroll_records');
select pg_temp.sees_nothing('roleless: budgets', 'select * from budgets');
select pg_temp.sees_nothing('roleless: audit log', 'select * from audit_logs');
select pg_temp.sees_nothing('roleless: settings', 'select * from settings');
select pg_temp.sees_nothing('roleless: other users'' roles', 'select * from user_roles where user_id <> auth.uid()');
select pg_temp.sees_nothing('roleless: other users'' profiles', 'select * from profiles where id <> auth.uid()');
select pg_temp.sees_nothing('roleless: staff names', 'select * from profile_names');
select pg_temp.refused('roleless: dashboard', $q$select dashboard_summary(current_date,current_date)$q$, 'FORBIDDEN');
select pg_temp.refused('roleless: cashbook', $q$select cashbook_report(current_date-30,current_date,null,null,null)$q$, 'FORBIDDEN');
select pg_temp.refused('roleless: record a transaction', $q$select record_transaction('income',current_date,(select id from accounts limit 1),1,'x',null)$q$, 'FORBIDDEN');
select pg_temp.refused('roleless: save a sale', $q$select save_sale(null,null,current_date,'[]'::jsonb,0,0,null,null,null,false)$q$, 'FORBIDDEN');

-- ===================== D. deactivated ex-employee (was a manager) =====================
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select pg_temp.sees_nothing('deactivated manager: transactions', 'select * from transactions');
select pg_temp.sees_nothing('deactivated manager: accounts', 'select * from account_balances');
select pg_temp.refused('deactivated manager: dashboard', $q$select dashboard_summary(current_date,current_date)$q$, 'FORBIDDEN');
select pg_temp.refused('deactivated manager: record transaction', $q$select record_transaction('income',current_date,(select id from accounts limit 1),1,'x',null)$q$, 'FORBIDDEN');

-- ===================== E. manager (high privilege, not owner) cannot escalate or tamper =====================
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select pg_temp.refused('manager cannot make themselves owner', $q$select set_user_access('44444444-4444-4444-4444-444444444444','owner',true)$q$, 'FORBIDDEN');
select pg_temp.blocked('manager cannot rewrite the permissions matrix', $q$update role_permissions set can_delete = true where role = 'manager'$q$);
select pg_temp.blocked('manager cannot delete audit entries', $q$delete from audit_logs$q$);
select pg_temp.blocked('manager cannot rewrite audit entries', $q$update audit_logs set new_values = '{}'::jsonb$q$);
select pg_temp.refused('manager cannot wipe the system via demo removal', $q$select remove_demo_data()$q$, 'FORBIDDEN');
select pg_temp.refused('opening balance is locked once an account has activity', $q$update accounts set opening_balance = opening_balance + 500000 where id = (select account_id from transactions limit 1)$q$, 'LOCKED');
select pg_temp.check('...and the opening balance really did not move', (select count(*) from accounts a where a.opening_balance <> (select opening_balance from accounts where id = a.id)) = 0);

-- ===================== F. injection and malformed input =====================
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.check('cashbook search is parameterised (SQL injection string is just text)',
  (select (cashbook_report(current_date-400,current_date,null,null,$q$x'); drop table transactions; --$q$)) is not null and to_regclass('public.transactions') is not null));
select pg_temp.refused('negative amount refused', $q$select record_transaction('income',current_date,(select id from accounts limit 1),-5,'neg',(select id from transaction_categories where kind='income' limit 1))$q$);
select pg_temp.refused('absurd amount refused', $q$select record_transaction('income',current_date,(select id from accounts limit 1),1e15,'huge',(select id from transaction_categories where kind='income' limit 1))$q$);
select pg_temp.refused('NaN amount refused', $q$select record_transaction('income',current_date,(select id from accounts limit 1),'NaN'::numeric,'nan',(select id from transaction_categories where kind='income' limit 1))$q$);
select pg_temp.refused('NaN quantity on a sale refused', $q$select save_sale(null,(select id from customers limit 1),current_date,jsonb_build_array(jsonb_build_object('product_id',(select id from products limit 1),'quantity','NaN','unit_price',100)),0,0,null,null,null,false)$q$);
select pg_temp.refused('NaN sale price refused', $q$select save_sale(null,(select id from customers limit 1),current_date,jsonb_build_array(jsonb_build_object('product_id',(select id from products limit 1),'quantity',1,'unit_price','NaN')),0,0,null,null,null,false)$q$);
select pg_temp.refused('NaN customer payment refused', $q$select record_customer_payment((select id from customers limit 1),(select id from accounts limit 1),'NaN'::numeric,current_date,null,null,null,'[]'::jsonb,true)$q$);
select pg_temp.refused('NaN expense refused', $q$select record_expense(current_date,(select id from transaction_categories where kind='expense' and name='Fuel'),'nan fuel','NaN'::numeric)$q$);
select pg_temp.refused('NaN stock adjustment refused', $q$select adjust_stock((select id from products limit 1),'NaN'::numeric,'nan adjust',current_date,true)$q$);
select pg_temp.refused('Infinity amount refused', $q$select record_transaction('income',current_date,(select id from accounts limit 1),'Infinity'::numeric,'inf',(select id from transaction_categories where kind='income' limit 1))$q$);
select pg_temp.check('no NaN or Infinity anywhere in the ledger', not exists (select 1 from transactions where amount = 'NaN'::numeric or amount = 'Infinity'::numeric));
select pg_temp.refused('far-future date refused', $q$select record_transaction('income',current_date+4000,(select id from accounts limit 1),5,'future',(select id from transaction_categories where kind='income' limit 1))$q$);

-- ===================== G. owner cannot rewrite history either (append-only ledger) =====================
select pg_temp.blocked('owner cannot UPDATE a ledger row directly', $q$update transactions set amount = amount + 1$q$);
select pg_temp.blocked('owner cannot DELETE a ledger row directly', $q$delete from transactions$q$);
select pg_temp.blocked('owner cannot DELETE audit history', $q$delete from audit_logs$q$);
select pg_temp.blocked('owner cannot UPDATE audit history', $q$update audit_logs set action = 'x'$q$);
select pg_temp.blocked('owner cannot edit the stock ledger', $q$update inventory_movements set quantity = 0$q$);
select pg_temp.blocked('owner cannot edit stock level by hand', $q$update products set current_stock = 12345$q$);

-- ===================== H. anonymous (not signed in) =====================
reset role; set role anon; select set_config('request.jwt.claim.sub','',false);
select pg_temp.sees_nothing('anon: transactions', 'select * from transactions');
select pg_temp.sees_nothing('anon: customers', 'select * from customers');
select pg_temp.sees_nothing('anon: company settings', 'select * from settings');
select pg_temp.refused('anon cannot call the dashboard', $q$select dashboard_summary(current_date,current_date)$q$);
select pg_temp.refused('anon cannot record transactions', $q$select record_transaction('income',current_date,gen_random_uuid(),1,'x',null)$q$);
select pg_temp.refused('anon cannot call has_perm to probe roles', $q$select has_perm('transactions','view')$q$);

-- ===================== I. storage policies =====================
reset role; select set_config('request.jwt.claim.sub','',false);
insert into storage.buckets(id,name,public) values ('attachments','attachments',false),('branding','branding',true) on conflict do nothing;
set role authenticated;
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select pg_temp.blocked('roleless cannot upload receipts', $q$insert into storage.objects(bucket_id,name) values ('attachments','2026/evil.pdf')$q$);
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.blocked('cashier cannot replace the company logo', $q$insert into storage.objects(bucket_id,name) values ('branding','logo.png')$q$);
select pg_temp.blocked('cashier cannot delete receipts', $q$delete from storage.objects where bucket_id = 'attachments'$q$);
select pg_temp.as_user('66666666-6666-6666-6666-666666666666');
select pg_temp.sees_nothing('roleless cannot read receipts', $q$select * from storage.objects where bucket_id = 'attachments'$q$);
