-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 1 foundation schema
-- Accounts, transactions (immutable ledger), cashbook, dashboard,
-- RBAC + RLS, audit trail, storage for attachments.
--
-- DESIGN RULES
--  * The transactions table is an append-only ledger. Rows can only be
--    created/changed through the SECURITY DEFINER functions below
--    (record_transaction, record_transfer, edit_transaction,
--    reverse_transaction). Direct INSERT/UPDATE/DELETE is denied by RLS
--    AND by a trigger. Posted transactions are never deleted.
--  * Account balance = opening_balance + sum(in) - sum(out) over ALL
--    ledger rows of the account (reversed originals and their reversal
--    rows net to zero, so the ledger always ties to the balance).
--  * Revenue / expense reporting uses only rows with status='posted'
--    and is_reversal=false, so reversed pairs disappear from P&L.
--  * Transfers, loans, owner capital, owner drawings and customer /
--    supplier payments are NEVER counted as revenue or expense.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------------------------------------------------
create type public.app_role as enum ('owner','manager','cashier','supervisor','storekeeper');
create type public.account_type as enum ('cash','bank','mobile_money','other');
create type public.txn_type as enum (
  'income','expense','transfer','customer_payment','supplier_payment',
  'loan_received','loan_repayment','owner_contribution','owner_withdrawal',
  'refund','adjustment');
create type public.txn_direction as enum ('in','out');
create type public.txn_status as enum ('posted','reversed');
create type public.category_kind as enum ('income','expense');

-- ---------- identity & access ---------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now()
);

-- "permissions": per role, per module, per action
create table public.role_permissions (
  role public.app_role not null,
  module text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  primary key (role, module)
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  user_name text,
  action text not null,
  table_name text not null,
  record_id text,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

-- ---------- access helpers ------------------------------------------
create or replace function public.has_perm(p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active)
     and (
       exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role = 'owner')
       or exists (
         select 1 from user_roles ur
         join role_permissions rp on rp.role = ur.role and rp.module = p_module
         where ur.user_id = auth.uid()
           and case p_action
                 when 'view'   then rp.can_view
                 when 'create' then rp.can_create
                 when 'edit'   then rp.can_edit
                 when 'delete' then rp.can_delete
                 else false end)
     );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles ur join profiles p on p.id = ur.user_id
                 where ur.user_id = auth.uid() and ur.role = 'owner' and p.active);
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', (select role from user_roles where user_id = auth.uid()),
    'active', coalesce((select active from profiles where id = auth.uid()), false),
    'modules', coalesce((
      select jsonb_object_agg(m.module, jsonb_build_object(
        'view', public.has_perm(m.module,'view'), 'create', public.has_perm(m.module,'create'),
        'edit', public.has_perm(m.module,'edit'), 'delete', public.has_perm(m.module,'delete')))
      from (select distinct module from role_permissions) m), '{}'::jsonb));
$$;

-- Generic audit trigger for configuration tables
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'key', to_jsonb(old)->>'user_id');
    insert into audit_logs(user_id,user_name,action,table_name,record_id,old_values)
      values (auth.uid(), v_name, 'delete', tg_table_name, v_id, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key', to_jsonb(new)->>'user_id');
    if to_jsonb(old) is distinct from to_jsonb(new) then
      insert into audit_logs(user_id,user_name,action,table_name,record_id,old_values,new_values)
        values (auth.uid(), v_name, 'update', tg_table_name, v_id, to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key', to_jsonb(new)->>'user_id');
    insert into audit_logs(user_id,user_name,action,table_name,record_id,new_values)
      values (auth.uid(), v_name, 'create', tg_table_name, v_id, to_jsonb(new));
    return new;
  end if;
end $$;

-- First user to sign up becomes the Owner; everyone else waits for a role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  if not exists (select 1 from user_roles) then
    insert into user_roles(user_id, role) values (new.id, 'owner');
  end if;
  return new;
end $$;
-- (trigger on auth.users is created at the bottom, after all tables exist)

-- ---------- master data ---------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type public.account_type not null,
  opening_balance numeric(16,2) not null default 0,
  account_ref text,
  description text,
  status text not null default 'active' check (status in ('active','inactive')),
  allow_negative boolean not null default false,
  is_demo boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.category_kind not null,
  group_name text,                      -- e.g. 'Production' / 'Operating'
  description text,
  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

-- Minimal party tables (full modules arrive in Phase 2)
create sequence public.customer_seq;
create sequence public.supplier_seq;
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_no text unique not null default ('CUS-' || lpad(nextval('public.customer_seq')::text, 5, '0')),
  name text not null,
  phone text,
  location text,
  customer_type text not null default 'individual'
    check (customer_type in ('individual','contractor','construction_company','dealer','other')),
  notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_no text unique not null default ('SUP-' || lpad(nextval('public.supplier_seq')::text, 5, '0')),
  name text not null,
  phone text,
  location text,
  supplied_materials text,
  notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- the ledger ----------------------------------------------
create sequence public.txn_seq;
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  txn_no text unique not null default ('TXN-' || lpad(nextval('public.txn_seq')::text, 6, '0')),
  txn_date date not null,
  type public.txn_type not null,
  direction public.txn_direction not null,
  category_id uuid references public.transaction_categories(id),
  description text not null check (length(btrim(description)) > 0),
  amount numeric(16,2) not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  payment_method text,
  reference text,
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  sale_id uuid,        -- FK added with the Sales module (Phase 2)
  batch_id uuid,       -- FK added with Production (Phase 3)
  transfer_group_id uuid,
  status public.txn_status not null default 'posted',
  is_reversal boolean not null default false,
  reversal_of uuid references public.transactions(id),
  reversal_reason text,
  reversed_at timestamptz,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  idempotency_key uuid unique,
  is_demo boolean not null default false,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type <> 'transfer' or transfer_group_id is not null),
  check (not is_reversal or reversal_of is not null)
);
create index txn_account_date_idx on public.transactions (account_id, txn_date, created_at);
create index txn_date_idx on public.transactions (txn_date);
create index txn_type_idx on public.transactions (type) where status = 'posted';
create index txn_category_idx on public.transactions (category_id);
create index txn_customer_idx on public.transactions (customer_id) where customer_id is not null;
create index txn_supplier_idx on public.transactions (supplier_id) where supplier_id is not null;
create index txn_group_idx on public.transactions (transfer_group_id) where transfer_group_id is not null;

-- Defence in depth: the ledger can only be written by the controlled functions.
create or replace function public.guard_transactions() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('frane.ledger_write', true), '') <> 'on' then
    raise exception 'LEDGER_PROTECTED: transactions can only be changed through controlled functions';
  end if;
  if tg_op = 'DELETE' and not old.is_demo then
    raise exception 'LEDGER_PROTECTED: posted transactions can never be deleted; reverse them instead';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_transactions before insert or update or delete on public.transactions
  for each row execute function public.guard_transactions();

-- Accounts: cannot be deactivated with a non-zero balance
create or replace function public.guard_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  new.updated_at := now();
  if new.status = 'inactive' and old.status = 'active' then
    select opening_balance + coalesce((select sum(case direction when 'in' then amount else -amount end)
             from transactions where account_id = new.id), 0)
      into v_bal from accounts where id = new.id;
    if v_bal <> 0 then
      raise exception 'ACCOUNT_NOT_EMPTY: account balance is % — transfer or reconcile it to zero before deactivating', v_bal;
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_account before update on public.accounts for each row execute function public.guard_account();

-- Audit triggers on configuration tables
create trigger trg_audit_accounts after insert or update or delete on public.accounts for each row execute function public.audit_row();
create trigger trg_audit_categories after insert or update or delete on public.transaction_categories for each row execute function public.audit_row();
create trigger trg_audit_settings after insert or update or delete on public.settings for each row execute function public.audit_row();
create trigger trg_audit_perms after insert or update or delete on public.role_permissions for each row execute function public.audit_row();
create trigger trg_audit_roles after insert or update or delete on public.user_roles for each row execute function public.audit_row();
create trigger trg_audit_profiles after update on public.profiles for each row execute function public.audit_row();

-- ---------- balances view -------------------------------------------
-- Runs with owner rights on purpose (RLS would otherwise hide ledger rows from
-- roles that may see balances but not individual transactions).
create or replace view public.account_balances as
select a.id, a.name, a.type, a.status, a.opening_balance, a.account_ref, a.description, a.allow_negative,
       a.opening_balance + coalesce(sum(case t.direction when 'in' then t.amount else -t.amount end), 0) as current_balance,
       count(t.id) as txn_count,
       max(t.txn_date) as last_txn_date
from public.accounts a left join public.transactions t on t.account_id = a.id
where public.has_perm('accounts','view') or public.has_perm('transactions','view') or public.has_perm('cashbook','view') or public.has_perm('dashboard','view')
group by a.id;

-- ---------- controlled ledger functions -----------------------------
create or replace function public._kampala_today() returns date language sql stable as $$
  select (now() at time zone 'Africa/Kampala')::date $$;

create or replace function public._account_balance(p_account uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select a.opening_balance + coalesce((select sum(case direction when 'in' then amount else -amount end)
         from transactions where account_id = a.id), 0) from accounts a where a.id = p_account $$;

create or replace function public._audit(p_action text, p_table text, p_id text, p_old jsonb, p_new jsonb, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs(user_id,user_name,action,table_name,record_id,old_values,new_values,reason)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), p_action, p_table, p_id, p_old, p_new, p_reason) $$;

create or replace function public.record_transaction(
  p_type public.txn_type, p_date date, p_account_id uuid, p_amount numeric,
  p_description text, p_category_id uuid default null, p_payment_method text default null,
  p_reference text default null, p_customer_id uuid default null, p_supplier_id uuid default null,
  p_notes text default null, p_attachments jsonb default '[]'::jsonb,
  p_idempotency_key uuid default null, p_direction public.txn_direction default null,
  p_force boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_dir public.txn_direction; v_acc accounts; v_cat transaction_categories; v_id uuid; v_existing uuid;
begin
  if not public.has_perm('transactions','create') then raise exception 'FORBIDDEN: you may not record transactions'; end if;
  if p_type = 'transfer' then raise exception 'INVALID: use record_transfer for transfers'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null then raise exception 'INVALID: date is required'; end if;
  if p_date > public._kampala_today() + 1 then raise exception 'INVALID: transaction date cannot be in the future'; end if;
  if p_description is null or length(btrim(p_description)) = 0 then raise exception 'INVALID: description is required'; end if;

  if p_idempotency_key is not null then
    select id into v_existing from transactions where idempotency_key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;

  v_dir := case p_type
    when 'income' then 'in' when 'customer_payment' then 'in' when 'loan_received' then 'in'
    when 'owner_contribution' then 'in'
    when 'expense' then 'out' when 'supplier_payment' then 'out' when 'loan_repayment' then 'out'
    when 'owner_withdrawal' then 'out' when 'refund' then 'out'
    when 'adjustment' then p_direction end;
  if v_dir is null then raise exception 'INVALID: adjustments must specify a direction (in/out)'; end if;
  if p_type = 'adjustment' then
    if not public.has_perm('transactions','edit') then raise exception 'FORBIDDEN: adjustments need manager approval rights'; end if;
    if p_notes is null or length(btrim(p_notes)) < 3 then raise exception 'INVALID: adjustments require a reason in notes'; end if;
  end if;

  select * into v_acc from accounts where id = p_account_id for update;
  if not found then raise exception 'INVALID: account not found'; end if;
  if v_acc.status <> 'active' then raise exception 'INVALID: account is inactive'; end if;

  if p_type in ('income','expense') then
    if p_category_id is null then raise exception 'INVALID: category is required for % transactions', p_type; end if;
    select * into v_cat from transaction_categories where id = p_category_id;
    if not found or v_cat.kind::text <> p_type::text then raise exception 'INVALID: category does not match transaction type'; end if;
    if not v_cat.is_active then raise exception 'INVALID: category is inactive'; end if;
  elsif p_category_id is not null then
    raise exception 'INVALID: categories apply only to income and expense transactions';
  end if;
  if p_type = 'customer_payment' and p_customer_id is null then raise exception 'INVALID: select the customer who paid'; end if;
  if p_type = 'supplier_payment' and p_supplier_id is null then raise exception 'INVALID: select the supplier being paid'; end if;
  if p_type = 'customer_payment' and p_supplier_id is not null then raise exception 'INVALID: customer payments cannot reference a supplier'; end if;

  if v_dir = 'out' and not v_acc.allow_negative and public._account_balance(p_account_id) - p_amount < 0 then
    raise exception 'INSUFFICIENT_FUNDS: % has only UGX % available', v_acc.name, public._account_balance(p_account_id);
  end if;

  if not p_force and exists (
      select 1 from transactions t where t.txn_date = p_date and t.type = p_type and t.account_id = p_account_id
        and t.amount = p_amount and lower(btrim(t.description)) = lower(btrim(p_description))
        and t.status = 'posted' and not t.is_reversal) then
    raise exception 'DUPLICATE_SUSPECTED: an identical transaction (same date, account, amount and description) already exists';
  end if;

  perform set_config('frane.ledger_write','on',true);
  insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,reference,
                           customer_id,supplier_id,notes,attachments,idempotency_key,recorded_by)
  values (p_date,p_type,v_dir,p_category_id,btrim(p_description),round(p_amount,2),p_account_id,p_payment_method,nullif(btrim(p_reference),''),
          p_customer_id,p_supplier_id,nullif(btrim(p_notes),''),coalesce(p_attachments,'[]'::jsonb),p_idempotency_key,auth.uid())
  returning id into v_id;
  perform public._audit('create','transactions',v_id::text,null,(select to_jsonb(t) from transactions t where id=v_id),null);
  return v_id;
end $$;

create or replace function public.record_transfer(
  p_date date, p_from uuid, p_to uuid, p_amount numeric, p_description text default null,
  p_reference text default null, p_notes text default null, p_idempotency_key uuid default null,
  p_force boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_a accounts; v_b accounts; v_group uuid := gen_random_uuid(); v_out uuid; v_desc text; v_existing uuid;
begin
  if not public.has_perm('transactions','create') then raise exception 'FORBIDDEN: you may not record transfers'; end if;
  if p_from = p_to then raise exception 'INVALID: source and destination accounts must differ'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: invalid transfer date'; end if;
  if p_idempotency_key is not null then
    select transfer_group_id into v_existing from transactions where idempotency_key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;
  -- lock in id order to avoid deadlocks
  perform 1 from accounts where id in (p_from,p_to) order by id for update;
  select * into v_a from accounts where id = p_from;
  select * into v_b from accounts where id = p_to;
  if v_a.id is null or v_b.id is null then raise exception 'INVALID: account not found'; end if;
  if v_a.status <> 'active' or v_b.status <> 'active' then raise exception 'INVALID: both accounts must be active'; end if;
  if not v_a.allow_negative and public._account_balance(p_from) - p_amount < 0 then
    raise exception 'INSUFFICIENT_FUNDS: % has only UGX % available', v_a.name, public._account_balance(p_from);
  end if;
  if not p_force and exists (select 1 from transactions t where t.type='transfer' and t.txn_date=p_date and t.account_id=p_from
        and t.direction='out' and t.amount=p_amount and t.status='posted' and not t.is_reversal
        and exists (select 1 from transactions t2 where t2.transfer_group_id=t.transfer_group_id and t2.account_id=p_to)) then
    raise exception 'DUPLICATE_SUSPECTED: an identical transfer already exists for this date';
  end if;
  v_desc := coalesce(nullif(btrim(p_description),''), 'Transfer ' || v_a.name || ' → ' || v_b.name);
  perform set_config('frane.ledger_write','on',true);
  insert into transactions(txn_date,type,direction,description,amount,account_id,reference,notes,transfer_group_id,idempotency_key,recorded_by)
    values (p_date,'transfer','out',v_desc,round(p_amount,2),p_from,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_group,p_idempotency_key,auth.uid())
    returning id into v_out;
  insert into transactions(txn_date,type,direction,description,amount,account_id,reference,notes,transfer_group_id,recorded_by)
    values (p_date,'transfer','in',v_desc,round(p_amount,2),p_to,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_group,auth.uid());
  perform public._audit('create','transactions',v_group::text,null,
    jsonb_build_object('type','transfer','from',v_a.name,'to',v_b.name,'amount',p_amount,'date',p_date),null);
  return v_group;
end $$;

create or replace function public.reverse_transaction(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_t transactions; r transactions; v_new uuid; v_first uuid; v_acc accounts; v_today date := public._kampala_today();
begin
  if not public.has_perm('transactions','edit') then raise exception 'FORBIDDEN: you may not reverse transactions'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to reverse a transaction'; end if;
  select * into v_t from transactions where id = p_id for update;
  if not found then raise exception 'INVALID: transaction not found'; end if;
  if v_t.status = 'reversed' then raise exception 'INVALID: transaction is already reversed'; end if;
  if v_t.is_reversal then raise exception 'INVALID: a reversal entry cannot itself be reversed'; end if;

  for r in select * from transactions
           where (v_t.transfer_group_id is not null and transfer_group_id = v_t.transfer_group_id and not is_reversal)
              or id = v_t.id order by id for update loop
    select * into v_acc from accounts where id = r.account_id for update;
    -- reversing an inflow takes money out of the account
    if r.direction = 'in' and not v_acc.allow_negative and public._account_balance(r.account_id) - r.amount < 0 then
      raise exception 'INSUFFICIENT_FUNDS: reversing would take % below zero', v_acc.name;
    end if;
    perform set_config('frane.ledger_write','on',true);
    insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,reference,
                             customer_id,supplier_id,sale_id,batch_id,transfer_group_id,is_reversal,reversal_of,reversal_reason,notes,recorded_by)
    values (v_today,r.type,case r.direction when 'in' then 'out'::txn_direction else 'in'::txn_direction end,
            r.category_id,'REVERSAL of '||r.txn_no||': '||r.description,r.amount,r.account_id,r.payment_method,r.reference,
            r.customer_id,r.supplier_id,r.sale_id,r.batch_id,r.transfer_group_id,true,r.id,btrim(p_reason),null,auth.uid())
    returning id into v_new;
    update transactions set status='reversed', reversal_reason=btrim(p_reason), reversed_at=now() where id = r.id;
    if v_first is null then v_first := v_new; end if;
    perform public._audit('reverse','transactions',r.id::text,to_jsonb(r),jsonb_build_object('reversal_id',v_new),btrim(p_reason));
  end loop;
  return v_first;
end $$;

create or replace function public.edit_transaction(
  p_id uuid, p_date date, p_description text, p_amount numeric, p_account_id uuid, p_category_id uuid,
  p_payment_method text, p_reference text, p_notes text, p_reason text, p_attachments jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old transactions; v_acc accounts; v_cat transaction_categories; v_delta numeric;
begin
  if not public.has_perm('transactions','edit') then raise exception 'FORBIDDEN: you may not edit transactions'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to edit a transaction'; end if;
  select * into v_old from transactions where id = p_id for update;
  if not found then raise exception 'INVALID: transaction not found'; end if;
  if v_old.status = 'reversed' or v_old.is_reversal then raise exception 'INVALID: reversed transactions and reversal entries cannot be edited'; end if;
  if v_old.type = 'transfer' then raise exception 'INVALID: transfers cannot be edited — reverse and re-enter'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_description is null or length(btrim(p_description)) = 0 then raise exception 'INVALID: description is required'; end if;
  if p_date > public._kampala_today() + 1 then raise exception 'INVALID: transaction date cannot be in the future'; end if;

  perform 1 from accounts where id in (v_old.account_id, p_account_id) order by id for update;
  select * into v_acc from accounts where id = p_account_id;
  if v_acc.id is null or v_acc.status <> 'active' then raise exception 'INVALID: account is missing or inactive'; end if;

  if v_old.type in ('income','expense') then
    select * into v_cat from transaction_categories where id = p_category_id;
    if not found or v_cat.kind::text <> v_old.type::text then raise exception 'INVALID: category does not match transaction type'; end if;
  else
    p_category_id := null;
  end if;

  -- balance safety for the account(s) affected
  if v_old.direction = 'out' then
    if p_account_id = v_old.account_id then
      v_delta := p_amount - v_old.amount;
      if v_delta > 0 and not v_acc.allow_negative and public._account_balance(p_account_id) - v_delta < 0 then
        raise exception 'INSUFFICIENT_FUNDS: edit would take % below zero', v_acc.name; end if;
    elsif not v_acc.allow_negative and public._account_balance(p_account_id) - p_amount < 0 then
      raise exception 'INSUFFICIENT_FUNDS: % cannot cover this amount', v_acc.name;
    end if;
  else
    -- inflow: moving/reducing it removes money from the old account
    if p_account_id <> v_old.account_id or p_amount < v_old.amount then
      select * into v_acc from accounts where id = v_old.account_id;
      v_delta := case when p_account_id <> v_old.account_id then v_old.amount else v_old.amount - p_amount end;
      if not v_acc.allow_negative and public._account_balance(v_old.account_id) - v_delta < 0 then
        raise exception 'INSUFFICIENT_FUNDS: edit would take % below zero', v_acc.name; end if;
    end if;
  end if;

  perform set_config('frane.ledger_write','on',true);
  update transactions set txn_date=p_date, description=btrim(p_description), amount=round(p_amount,2), account_id=p_account_id,
    category_id=p_category_id, payment_method=p_payment_method, reference=nullif(btrim(p_reference),''),
    notes=nullif(btrim(p_notes),''), attachments=coalesce(p_attachments, attachments)
  where id = p_id;
  perform public._audit('edit','transactions',p_id::text,to_jsonb(v_old),(select to_jsonb(t) from transactions t where id=p_id),btrim(p_reason));
end $$;

-- ---------- cashbook -------------------------------------------------
create or replace function public.cashbook_report(
  p_from date, p_to date, p_account_id uuid default null, p_category_id uuid default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_close numeric; v_rows jsonb; v_in numeric; v_out numeric;
begin
  if not (public.has_perm('cashbook','view') or public.has_perm('transactions','view')) then raise exception 'FORBIDDEN'; end if;
  select coalesce(sum(a.opening_balance),0)
       + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end) from transactions t
                   where t.txn_date < p_from and (p_account_id is null or t.account_id = p_account_id)),0)
    into v_open from accounts a where (p_account_id is null or a.id = p_account_id);

  with scope as (
    select t.*, sum(case t.direction when 'in' then t.amount else -t.amount end)
             over (order by t.txn_date, t.created_at, t.id rows between unbounded preceding and current row) as run
    from transactions t
    where (p_account_id is null or t.account_id = p_account_id) and t.txn_date between p_from and p_to
  ), filtered as (
    select s.*, a.name as account_name, c.name as category_name from scope s
    join accounts a on a.id = s.account_id left join transaction_categories c on c.id = s.category_id
    where (p_category_id is null or s.category_id = p_category_id)
      and (p_search is null or p_search = '' or s.description ilike '%'||p_search||'%' or s.reference ilike '%'||p_search||'%'
           or s.txn_no ilike '%'||p_search||'%' or c.name ilike '%'||p_search||'%' or s.notes ilike '%'||p_search||'%')
    order by s.txn_date, s.created_at, s.id limit 5000
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'txn_no', txn_no, 'date', txn_date, 'type', type, 'reference', reference, 'description', description,
           'account', account_name, 'category', category_name,
           'money_in', case when direction='in' then amount else 0 end,
           'money_out', case when direction='out' then amount else 0 end,
           'balance', v_open + run, 'status', status, 'is_reversal', is_reversal) order by txn_date, created_at, id), '[]'::jsonb),
         coalesce(sum(case when direction='in' then amount end),0), coalesce(sum(case when direction='out' then amount end),0)
    into v_rows, v_in, v_out from filtered;

  select v_open + coalesce(sum(case t.direction when 'in' then t.amount else -t.amount end),0) into v_close
    from transactions t where t.txn_date between p_from and p_to and (p_account_id is null or t.account_id = p_account_id);
  return jsonb_build_object('opening', v_open, 'total_in', v_in, 'total_out', v_out, 'closing', v_close, 'rows', v_rows);
end $$;

-- ---------- dashboard -----------------------------------------------
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_in numeric; v_out numeric; v_accounts jsonb; v_daily jsonb; v_monthly jsonb;
        v_exp jsonb; v_inc jsonb; v_recent jsonb; v_month_start date := date_trunc('month', p_to)::date;
begin
  if not public.has_perm('dashboard','view') then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'balance',current_balance) order by name),'[]'::jsonb)
    into v_accounts from account_balances where status = 'active';

  select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end)
         from transactions t join accounts a2 on a2.id=t.account_id and a2.status='active'
         where t.txn_date < p_from and t.type <> 'transfer' ),0)
    into v_open from accounts a where a.status='active';
  -- transfers net to zero across active accounts, so they are excluded from period flows;
  -- opening is computed on the same basis so Opening + In - Out = Closing always ties.
  select coalesce(sum(case when t.direction='in' then t.amount end),0), coalesce(sum(case when t.direction='out' then t.amount end),0)
    into v_in, v_out from transactions t join accounts a on a.id=t.account_id and a.status='active'
    where t.txn_date between p_from and p_to and t.type <> 'transfer';

  select coalesce(jsonb_agg(d order by d->>'date'),'[]'::jsonb) into v_daily from (
    select jsonb_build_object('date', t.txn_date,
      'money_in', coalesce(sum(case when t.direction='in' then t.amount end) filter (where t.type<>'transfer'),0),
      'money_out', coalesce(sum(case when t.direction='out' then t.amount end) filter (where t.type<>'transfer'),0),
      'revenue', coalesce(sum(t.amount) filter (where t.type='income' and t.status='posted' and not t.is_reversal),0),
      'expenses', coalesce(sum(t.amount) filter (where t.type='expense' and t.status='posted' and not t.is_reversal),0)) as d
    from transactions t where t.txn_date between p_from and p_to group by t.txn_date) x;

  select coalesce(jsonb_agg(m order by m->>'month'),'[]'::jsonb) into v_monthly from (
    select jsonb_build_object('month', to_char(date_trunc('month', t.txn_date),'YYYY-MM'),
      'revenue', coalesce(sum(t.amount) filter (where t.type='income' and t.status='posted' and not t.is_reversal),0),
      'expenses', coalesce(sum(t.amount) filter (where t.type='expense' and t.status='posted' and not t.is_reversal),0),
      'money_in', coalesce(sum(t.amount) filter (where t.direction='in' and t.type<>'transfer'),0),
      'money_out', coalesce(sum(t.amount) filter (where t.direction='out' and t.type<>'transfer'),0)) as m
    from transactions t
    where t.txn_date >= (date_trunc('month', p_to) - interval '11 months')::date and t.txn_date <= p_to
    group by date_trunc('month', t.txn_date)) y;

  select coalesce(jsonb_agg(jsonb_build_object('name',n,'amount',s) order by s desc),'[]'::jsonb) into v_exp from (
    select coalesce(c.name,'Uncategorised') n, sum(t.amount) s from transactions t left join transaction_categories c on c.id=t.category_id
    where t.type='expense' and t.status='posted' and not t.is_reversal and t.txn_date between p_from and p_to group by 1) e;
  select coalesce(jsonb_agg(jsonb_build_object('name',n,'amount',s) order by s desc),'[]'::jsonb) into v_inc from (
    select coalesce(c.name,'Uncategorised') n, sum(t.amount) s from transactions t left join transaction_categories c on c.id=t.category_id
    where t.type='income' and t.status='posted' and not t.is_reversal and t.txn_date between p_from and p_to group by 1) e;

  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'txn_no',t.txn_no,'date',t.txn_date,'type',t.type,'direction',t.direction,
           'description',t.description,'amount',t.amount,'account',a.name,'status',t.status) order by t.created_at desc),'[]'::jsonb)
    into v_recent from (select * from transactions order by created_at desc limit 8) t join accounts a on a.id=t.account_id;

  return jsonb_build_object(
    'accounts', v_accounts, 'opening', v_open, 'inflows', v_in, 'outflows', v_out, 'closing', v_open + v_in - v_out,
    'revenue', (select coalesce(sum(amount),0) from transactions where type='income' and status='posted' and not is_reversal and txn_date between p_from and p_to),
    'expenses', (select coalesce(sum(amount),0) from transactions where type='expense' and status='posted' and not is_reversal and txn_date between p_from and p_to),
    'collections', (select coalesce(sum(amount),0) from transactions where type='customer_payment' and status='posted' and not is_reversal and txn_date between p_from and p_to),
    'month_revenue', (select coalesce(sum(amount),0) from transactions where type='income' and status='posted' and not is_reversal and txn_date between v_month_start and p_to),
    'month_expenses', (select coalesce(sum(amount),0) from transactions where type='expense' and status='posted' and not is_reversal and txn_date between v_month_start and p_to),
    'daily', v_daily, 'monthly', v_monthly, 'expense_by_category', v_exp, 'income_by_category', v_inc, 'recent', v_recent);
end $$;

-- ---------- user administration (owner only) ------------------------
create or replace function public.list_users()
returns table (id uuid, email text, full_name text, phone text, active boolean, role public.app_role, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.has_perm('users','view') then raise exception 'FORBIDDEN'; end if;
  return query select p.id, u.email::text, p.full_name, p.phone, p.active, ur.role, p.created_at
    from profiles p join auth.users u on u.id = p.id left join user_roles ur on ur.user_id = p.id order by p.created_at;
end $$;

create or replace function public.set_user_access(p_user uuid, p_role public.app_role, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_owners int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: only the Owner can manage users'; end if;
  if p_user = auth.uid() and (p_role is distinct from 'owner' or not p_active) then
    raise exception 'INVALID: you cannot remove your own owner access'; end if;
  select count(*) into v_owners from user_roles ur join profiles p on p.id=ur.user_id where ur.role='owner' and p.active and ur.user_id <> p_user;
  if v_owners = 0 and (p_role is distinct from 'owner' or not p_active) then raise exception 'INVALID: at least one active owner is required'; end if;
  update profiles set active = p_active where id = p_user;
  if p_role is null then delete from user_roles where user_id = p_user;
  else insert into user_roles(user_id, role, assigned_by) values (p_user, p_role, auth.uid())
       on conflict (user_id) do update set role = excluded.role, assigned_by = auth.uid(), assigned_at = now(); end if;
end $$;

-- ---------- RLS ------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.accounts enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.transactions enable row level security;

create policy profiles_self on public.profiles for select using (id = auth.uid() or public.has_perm('users','view'));
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and active = (select active from public.profiles where id = auth.uid()));
create policy user_roles_read on public.user_roles for select using (user_id = auth.uid() or public.has_perm('users','view'));
create policy perms_read on public.role_permissions for select using (auth.uid() is not null);
create policy perms_write on public.role_permissions for all using (public.is_owner()) with check (public.is_owner());
create policy settings_read on public.settings for select using (exists (select 1 from public.user_roles where user_id = auth.uid()));
create policy settings_write on public.settings for all using (public.has_perm('settings','edit')) with check (public.has_perm('settings','edit'));
create policy audit_read on public.audit_logs for select using (public.has_perm('audit','view'));
create policy accounts_read on public.accounts for select using (public.has_perm('accounts','view') or public.has_perm('transactions','create') or public.has_perm('cashbook','view'));
create policy accounts_ins on public.accounts for insert with check (public.has_perm('accounts','create'));
create policy accounts_upd on public.accounts for update using (public.has_perm('accounts','edit')) with check (public.has_perm('accounts','edit'));
create policy cats_read on public.transaction_categories for select using (exists (select 1 from public.user_roles where user_id = auth.uid()));
create policy cats_ins on public.transaction_categories for insert with check (public.has_perm('settings','edit'));
create policy cats_upd on public.transaction_categories for update using (public.has_perm('settings','edit')) with check (public.has_perm('settings','edit'));
create policy customers_read on public.customers for select using (public.has_perm('customers','view') or public.has_perm('transactions','create'));
create policy customers_ins on public.customers for insert with check (public.has_perm('customers','create') or public.has_perm('transactions','create'));
create policy customers_upd on public.customers for update using (public.has_perm('customers','edit'));
create policy suppliers_read on public.suppliers for select using (public.has_perm('suppliers','view') or public.has_perm('transactions','create'));
create policy suppliers_ins on public.suppliers for insert with check (public.has_perm('suppliers','create') or public.has_perm('transactions','create'));
create policy suppliers_upd on public.suppliers for update using (public.has_perm('suppliers','edit'));
-- transactions: read-only through RLS; all writes go through the SECURITY DEFINER functions
create policy txn_read on public.transactions for select using (public.has_perm('transactions','view') or public.has_perm('cashbook','view'));

-- ---------- grants ---------------------------------------------------
revoke all on public.transactions from anon, authenticated;
grant select on public.transactions to authenticated;
grant select, insert, update on public.accounts, public.transaction_categories, public.customers, public.suppliers to authenticated;
grant select, insert, update, delete on public.settings, public.role_permissions to authenticated;
grant select on public.profiles, public.user_roles, public.audit_logs to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select on public.account_balances to authenticated;
grant usage on sequence public.customer_seq, public.supplier_seq to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.has_perm(text,text), public.is_owner(), public.my_permissions(),
  public.record_transaction(public.txn_type,date,uuid,numeric,text,uuid,text,text,uuid,uuid,text,jsonb,uuid,public.txn_direction,boolean),
  public.record_transfer(date,uuid,uuid,numeric,text,text,text,uuid,boolean),
  public.reverse_transaction(uuid,text),
  public.edit_transaction(uuid,date,text,numeric,uuid,uuid,text,text,text,text,jsonb),
  public.cashbook_report(date,date,uuid,uuid,text), public.dashboard_summary(date,date),
  public.list_users(), public.set_user_access(uuid,public.app_role,boolean) to authenticated;

-- ---------- storage for receipts / supporting documents ------------
insert into storage.buckets (id, name, public) values ('attachments','attachments',false) on conflict (id) do nothing;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (public.has_perm('transactions','view') or public.has_perm('cashbook','view')));
create policy attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.has_perm('transactions','create'));

-- ---------- seed: permissions ---------------------------------------
-- (owner is implicit and always has everything; shown here for the configurable roles)
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete)
select r::public.app_role, m, v, c, e, false from (values
 ('manager','dashboard',true,false,false),('manager','cashbook',true,false,false),('manager','transactions',true,true,true),
 ('manager','accounts',true,true,true),('manager','sales',true,true,true),('manager','customers',true,true,true),
 ('manager','inventory',true,true,true),('manager','production',true,true,true),('manager','expenses',true,true,true),
 ('manager','suppliers',true,true,true),('manager','debts',true,true,true),('manager','budgets',true,true,true),
 ('manager','reports',true,false,false),('manager','daily_closing',true,true,true),('manager','settings',true,false,false),
 ('manager','payroll',false,false,false),('manager','audit',false,false,false),('manager','users',false,false,false),
 ('cashier','dashboard',false,false,false),('cashier','cashbook',true,false,false),('cashier','transactions',true,true,false),
 ('cashier','accounts',true,false,false),('cashier','sales',true,true,false),('cashier','customers',true,true,false),
 ('cashier','debts',true,true,false),('cashier','daily_closing',true,true,false),('cashier','reports',true,false,false),
 ('cashier','settings',false,false,false),('cashier','payroll',false,false,false),('cashier','audit',false,false,false),('cashier','users',false,false,false),
 ('cashier','inventory',false,false,false),('cashier','production',false,false,false),('cashier','expenses',false,false,false),
 ('cashier','suppliers',false,false,false),('cashier','budgets',false,false,false),
 ('supervisor','production',true,true,true),('supervisor','inventory',true,false,false),('supervisor','reports',true,false,false),
 ('supervisor','dashboard',false,false,false),('supervisor','cashbook',false,false,false),('supervisor','transactions',false,false,false),
 ('supervisor','accounts',false,false,false),('supervisor','sales',false,false,false),('supervisor','customers',false,false,false),
 ('supervisor','expenses',false,false,false),('supervisor','suppliers',false,false,false),('supervisor','debts',false,false,false),
 ('supervisor','budgets',false,false,false),('supervisor','daily_closing',false,false,false),('supervisor','settings',false,false,false),
 ('supervisor','payroll',false,false,false),('supervisor','audit',false,false,false),('supervisor','users',false,false,false),
 ('storekeeper','inventory',true,true,true),('storekeeper','production',true,false,false),
 ('storekeeper','dashboard',false,false,false),('storekeeper','cashbook',false,false,false),('storekeeper','transactions',false,false,false),
 ('storekeeper','accounts',false,false,false),('storekeeper','sales',false,false,false),('storekeeper','customers',false,false,false),
 ('storekeeper','expenses',false,false,false),('storekeeper','suppliers',false,false,false),('storekeeper','debts',false,false,false),
 ('storekeeper','budgets',false,false,false),('storekeeper','reports',false,false,false),('storekeeper','daily_closing',false,false,false),
 ('storekeeper','settings',false,false,false),('storekeeper','payroll',false,false,false),('storekeeper','audit',false,false,false),('storekeeper','users',false,false,false)
) as x(r, m, v, c, e);


-- ---------- seed: settings & categories -----------------------------
insert into public.settings(key, value) values
 ('company', '{"name":"FRANE CONCRETE FACTORY","address":"","phone":"","email":"","tax_id":"","tagline":"Concrete blocks & pavers"}'),
 ('locale', '{"currency":"UGX","date_format":"DD/MM/YYYY","timezone":"Africa/Kampala"}'),
 ('payment_methods', '["Cash","Mobile Money","Bank Transfer","Cheque"]'),
 ('numbering', '{"invoice_prefix":"INV","receipt_prefix":"RCT"}'),
 ('approvals', '{"transaction_amount_threshold":0}')
on conflict (key) do nothing;

insert into public.transaction_categories(name, kind, group_name, is_system, sort_order) values
 ('Cash sales','income','Sales',true,10),('Credit sales','income','Sales',true,20),
 ('Customer debt collections','income','Collections',true,30),('Transport charges','income','Sales',true,40),('Other income','income','Other',true,90),
 ('Cement','expense','Production',true,10),('Sand','expense','Production',true,20),('Aggregate','expense','Production',true,30),
 ('Stone dust','expense','Production',true,40),('Water','expense','Production',true,50),('Electricity','expense','Operating',true,60),
 ('Fuel','expense','Production',true,70),('Labour','expense','Production',true,80),('Casual labour','expense','Production',true,90),
 ('Machine repairs','expense','Operating',true,100),('Equipment','expense','Production',true,110),('Transport','expense','Operating',true,120),
 ('Delivery','expense','Operating',true,130),('Loading','expense','Operating',true,140),('Packaging','expense','Operating',true,150),
 ('Rent','expense','Operating',true,160),('Licenses','expense','Operating',true,170),('Taxes','expense','Operating',true,180),
 ('Administrative expenses','expense','Operating',true,190),('Communications','expense','Operating',true,200),
 ('Security','expense','Operating',true,210),('Other expenses','expense','Other',true,999)
on conflict do nothing;

-- ---------- demo data (clearly flagged, removable) ------------------
create or replace function public.seed_demo_data() returns void
language plpgsql security definer set search_path = public as $$
declare v_cash uuid; v_bank uuid; v_mm uuid; v_cat_sales uuid; v_cat_cem uuid; v_cat_lab uuid; v_cat_fuel uuid; d int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: owner only'; end if;
  if exists (select 1 from accounts where is_demo) then raise exception 'INVALID: demo data is already loaded'; end if;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values
    ('[DEMO] Cash Box','cash',2000000,'Demo data — safe to remove',true,auth.uid()) returning id into v_cash;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values
    ('[DEMO] Bank Account','bank',5000000,'Demo data — safe to remove',true,auth.uid()) returning id into v_bank;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values
    ('[DEMO] Mobile Money','mobile_money',500000,'Demo data — safe to remove',true,auth.uid()) returning id into v_mm;
  select id into v_cat_sales from transaction_categories where name='Cash sales' and kind='income';
  select id into v_cat_cem from transaction_categories where name='Cement' and kind='expense';
  select id into v_cat_lab from transaction_categories where name='Casual labour' and kind='expense';
  select id into v_cat_fuel from transaction_categories where name='Fuel' and kind='expense';
  perform set_config('frane.ledger_write','on',true);
  for d in 0..20 loop
    insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,is_demo,recorded_by)
    values (public._kampala_today()-d,'income','in',v_cat_sales,'[DEMO] Block sales',1200000+(d*37%5)*150000,v_cash,'Cash',true,auth.uid()),
           (public._kampala_today()-d,'expense','out',v_cat_cem,'[DEMO] Cement purchase',(500000+(d*53%4)*100000),v_bank,'Bank Transfer',true,auth.uid()),
           (public._kampala_today()-d,'expense','out',v_cat_lab,'[DEMO] Casual labour',180000,v_cash,'Cash',true,auth.uid());
    if d % 5 = 0 then
      insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,is_demo,recorded_by)
      values (public._kampala_today()-d,'expense','out',v_cat_fuel,'[DEMO] Fuel',90000,v_mm,'Mobile Money',true,auth.uid());
    end if;
  end loop;
  perform public._audit('create','demo_data',null,null,jsonb_build_object('action','seed_demo_data'),null);
end $$;

create or replace function public.remove_demo_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: owner only'; end if;
  if exists (select 1 from transactions where is_demo and exists
      (select 1 from accounts a where a.id = account_id and not a.is_demo)) then
    raise exception 'INVALID: demo transactions exist on real accounts; remove manually via reversal';
  end if;
  perform set_config('frane.ledger_write','on',true);
  delete from transactions where is_demo;
  delete from accounts where is_demo;
  perform public._audit('delete','demo_data',null,null,jsonb_build_object('action','remove_demo_data'),null);
end $$;
revoke execute on function public.seed_demo_data(), public.remove_demo_data() from public, anon;
grant execute on function public.seed_demo_data(), public.remove_demo_data() to authenticated;

-- ---------- auth hook (last: needs all tables) ---------------------
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
