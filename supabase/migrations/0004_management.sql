-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 4: management
-- Expenses (accrual register, approvals, partial payments), payroll & labour,
-- budgets, daily closing, account reconciliation.
--
-- MODEL
--  * An expense is INCURRED when it is recorded (and approved). Cash paid is a
--    separate ledger row of type 'expense_payment', allocated to the expense —
--    so incurred vs paid are always distinguishable and nothing counts twice.
--    (Phase 1 'expense' transactions and Phase 2 supplier expense invoices still
--    count as incurred; the expense register shows all three sources together.)
--  * Payroll cost is incurred when a payroll record is approved (cost = take-home
--    pay after allowances/deductions); payment is an 'expense_payment'. Payroll
--    linked to an open production batch becomes that batch's labour cost instead
--    of operating expense.
--  * Budgets are changed only through save_budget (reason + before/after audit).
--  * Daily closing compares system balance with a physical count, requires an
--    explanation for any variance, and can require manager approval. Closings
--    are never deleted; reopening needs a reason and is audited.
-- =====================================================================

alter type public.txn_type add value if not exists 'expense_payment';

-- ---------- settings -------------------------------------------------
update public.settings set value = value || '{"expense_threshold":0}'::jsonb where key = 'approvals' and not (value ? 'expense_threshold');
insert into public.settings(key, value) values
  ('closing', '{"require_approval":true,"variance_tolerance":0}'),
  ('budget_alerts', '{"threshold_pct":80}'),
  ('reconciliation', '{"stale_days":7}'),
  ('payroll', '{"standard_month_days":26}')
on conflict (key) do nothing;

-- ---------- expenses -------------------------------------------------
create sequence public.expense_seq;
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text unique not null default ('EXP-' || lpad(nextval('public.expense_seq')::text, 6, '0')),
  expense_date date not null,
  category_id uuid not null references public.transaction_categories(id),
  description text not null check (length(btrim(description)) > 0),
  amount numeric(16,2) not null check (amount > 0),
  payee text,
  amount_paid numeric(16,2) not null default 0 check (amount_paid >= 0),
  balance numeric(16,2) generated always as (case when status = 'open' then amount - amount_paid else 0 end) stored,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  approval_note text,
  status text not null default 'open' check (status in ('open','cancelled')),
  cancel_reason text,
  attachments jsonb not null default '[]'::jsonb,
  notes text,
  idempotency_key uuid unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= amount)
);
create index expenses_date_idx on public.expenses(expense_date) where status = 'open';
create index expenses_cat_idx on public.expenses(category_id);
create trigger trg_expenses_touch before update on public.expenses for each row execute function public.touch_updated();

create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id),
  payment_txn_id uuid not null references public.transactions(id),
  amount numeric(16,2) not null check (amount > 0),
  reversed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index ep_expense_idx on public.expense_payments(expense_id) where not reversed;
create index ep_txn_idx on public.expense_payments(payment_txn_id);

-- ---------- employees & payroll -------------------------------------
create sequence public.employee_seq;
create sequence public.payroll_seq;
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text unique not null default ('EMP-' || lpad(nextval('public.employee_seq')::text, 4, '0')),
  name text not null check (length(btrim(name)) > 0),
  role text,
  phone text,
  employment_type text not null default 'casual' check (employment_type in ('permanent','casual','daily','production')),
  pay_basis text not null default 'daily' check (pay_basis in ('daily','monthly')),
  rate numeric(16,2) not null default 0 check (rate >= 0),           -- daily wage or monthly salary
  status text not null default 'active' check (status in ('active','inactive')),
  start_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_employees_touch before update on public.employees for each row execute function public.touch_updated();

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  payroll_no text unique not null default ('PAY-' || lpad(nextval('public.payroll_seq')::text, 6, '0')),
  employee_id uuid not null references public.employees(id),
  period_start date not null,
  period_end date not null,
  workdays numeric(6,2),
  rate numeric(16,2) not null,                                         -- snapshot at time of payroll
  pay_basis text not null,
  base_pay numeric(16,2) not null,
  overtime_hours numeric(8,2) not null default 0 check (overtime_hours >= 0),
  overtime_rate numeric(16,2) not null default 0 check (overtime_rate >= 0),
  overtime_pay numeric(16,2) not null default 0,
  allowances numeric(16,2) not null default 0 check (allowances >= 0),
  deductions numeric(16,2) not null default 0 check (deductions >= 0),
  total_pay numeric(16,2) not null check (total_pay > 0),
  batch_id uuid references public.production_batches(id),
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  approved_by uuid references public.profiles(id),
  paid_txn_id uuid references public.transactions(id),
  paid_date date,
  payment_account_id uuid references public.accounts(id),
  cancel_reason text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index payroll_period_uq on public.payroll_records(employee_id, period_start, period_end) where status <> 'cancelled';
create index payroll_period_idx on public.payroll_records(period_end);
create trigger trg_payroll_touch before update on public.payroll_records for each row execute function public.touch_updated();
alter table public.production_costs add column if not exists payroll_id uuid references public.payroll_records(id);
create trigger trg_audit_employees after insert or update or delete on public.employees for each row execute function public.audit_row();

-- ---------- budgets --------------------------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  period_type text not null check (period_type in ('month','quarter','year')),
  period_start date not null,
  scope_type text not null check (scope_type in ('total','group','category','production')),
  category_id uuid references public.transaction_categories(id),
  group_name text,                                                     -- department / category group / product category
  amount numeric(16,2) not null check (amount > 0),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope_type <> 'category' or category_id is not null),
  check (scope_type <> 'group' or group_name is not null)
);
create unique index budgets_uq on public.budgets (period_type, period_start, scope_type, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(group_name, '')) where active;
create trigger trg_budgets_touch before update on public.budgets for each row execute function public.touch_updated();

-- ---------- closing & reconciliation --------------------------------
create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null,
  account_id uuid not null references public.accounts(id),
  opening_balance numeric(16,2) not null,
  receipts numeric(16,2) not null,
  payments numeric(16,2) not null,
  expected_balance numeric(16,2) not null,
  counted_balance numeric(16,2) not null,
  variance numeric(16,2) generated always as (counted_balance - expected_balance) stored,
  denominations jsonb,
  explanation text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','reopened')),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  review_note text,
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now()
);
create unique index closings_active_uq on public.daily_closings(account_id, closing_date) where status in ('submitted','approved');
create index closings_date_idx on public.daily_closings(closing_date);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  reconciliation_date date not null,
  system_balance numeric(16,2) not null,
  actual_balance numeric(16,2) not null,
  difference numeric(16,2) generated always as (actual_balance - system_balance) stored,
  notes text,
  adjustment_txn_id uuid references public.transactions(id),
  closing_id uuid references public.daily_closings(id),
  reconciled_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index recon_account_idx on public.reconciliations(account_id, reconciliation_date);

-- ---------- ledger posting: add expense payments ---------------------
create or replace function public._post_txn(
  p_type public.txn_type, p_date date, p_account uuid, p_amount numeric, p_desc text,
  p_customer uuid, p_supplier uuid, p_sale uuid, p_method text, p_ref text, p_notes text,
  p_attach jsonb, p_idem uuid, p_receipt text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_dir public.txn_direction; v_acc accounts; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: payment date cannot be in the future'; end if;
  v_dir := case p_type::text when 'customer_payment' then 'in' when 'supplier_payment' then 'out' when 'expense_payment' then 'out' end;
  if v_dir is null then raise exception 'INVALID: unsupported payment type'; end if;
  select * into v_acc from accounts where id = p_account for update;
  if not found or v_acc.status <> 'active' then raise exception 'INVALID: select an active account'; end if;
  if v_dir = 'out' and not v_acc.allow_negative and public._account_balance(p_account) - p_amount < 0 then
    raise exception 'INSUFFICIENT_FUNDS: % has only UGX % available', v_acc.name, public._account_balance(p_account);
  end if;
  perform set_config('frane.ledger_write','on',true);
  insert into transactions(txn_date,type,direction,description,amount,account_id,payment_method,reference,customer_id,supplier_id,sale_id,notes,attachments,idempotency_key,receipt_no,recorded_by)
  values (p_date,p_type,v_dir,p_desc,round(p_amount,2),p_account,p_method,nullif(btrim(p_ref),''),p_customer,p_supplier,p_sale,nullif(btrim(p_notes),''),coalesce(p_attach,'[]'::jsonb),p_idem,p_receipt,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.guard_allocated_edit() returns trigger language plpgsql as $$
begin
  if new.amount <> old.amount and (exists (select 1 from payment_allocations where payment_txn_id = old.id and not reversed)
      or exists (select 1 from supplier_payment_allocations where payment_txn_id = old.id and not reversed)
      or exists (select 1 from expense_payments where payment_txn_id = old.id and not reversed)
      or exists (select 1 from payroll_records where paid_txn_id = old.id)) then
    raise exception 'INVALID: this payment is linked to invoices, expenses or payroll — reverse it and record it again to change the amount';
  end if;
  return new;
end $$;

-- ---------- expense functions ----------------------------------------
create or replace function public._refresh_expense(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount),0) into v_paid from expense_payments where expense_id = p_id and not reversed;
  update expenses set amount_paid = v_paid, payment_status = case when v_paid >= amount then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end where id = p_id;
end $$;

create or replace function public._pay_expense(p_expense uuid, p_account uuid, p_amount numeric, p_date date, p_method text, p_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e expenses; v_txn uuid;
begin
  if not public.has_perm('transactions','create') then raise exception 'FORBIDDEN: you may not record payments'; end if;
  select * into e from expenses where id = p_expense for update;
  if not found or e.status <> 'open' then raise exception 'INVALID: expense not found or cancelled'; end if;
  if e.approval_status <> 'approved' then raise exception 'INVALID: this expense must be approved before it can be paid'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_amount > e.amount - e.amount_paid then raise exception 'INVALID: payment of % exceeds the % still owing on %', p_amount, e.amount - e.amount_paid, e.expense_no; end if;
  v_txn := public._post_txn('expense_payment', p_date, p_account, p_amount, 'Payment: ' || e.expense_no || ' ' || e.description, null, null, null, p_method, p_ref, null, '[]'::jsonb, null, null);
  insert into expense_payments(expense_id, payment_txn_id, amount, created_by) values (p_expense, v_txn, round(p_amount,2), auth.uid());
  perform public._refresh_expense(p_expense);
  return v_txn;
end $$;

create or replace function public.record_expense(
  p_date date, p_category uuid, p_description text, p_amount numeric, p_payee text default null, p_notes text default null,
  p_attachments jsonb default '[]'::jsonb, p_payment jsonb default null, p_idempotency_key uuid default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cat transaction_categories; v_id uuid; v_no text; v_thr numeric; v_status text := 'approved'; v_existing expenses; v_skipped boolean := false; v_pay numeric;
begin
  if not public.has_perm('expenses','create') then raise exception 'FORBIDDEN: you may not record expenses'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: expense date cannot be in the future'; end if;
  if p_description is null or btrim(p_description) = '' then raise exception 'INVALID: description is required'; end if;
  select * into v_cat from transaction_categories where id = p_category;
  if not found or v_cat.kind <> 'expense' or not v_cat.is_active then raise exception 'INVALID: choose an active expense category'; end if;
  if v_cat.tracks_inventory then raise exception 'INVALID: this category is inventory-tracked. Record material purchases under Inventory → Receive materials so they are stocked and costed once, when used in production.'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from expenses where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('id', v_existing.id, 'expense_no', v_existing.expense_no, 'approval_status', v_existing.approval_status, 'duplicate', true); end if;
  end if;
  if not p_force and exists (select 1 from expenses x where x.expense_date = p_date and x.category_id = p_category and x.amount = round(p_amount,2) and lower(btrim(x.description)) = lower(btrim(p_description)) and x.status = 'open') then
    raise exception 'DUPLICATE_SUSPECTED: an identical expense (same date, category, amount and description) already exists';
  end if;
  select coalesce((value->>'expense_threshold')::numeric, 0) into v_thr from settings where key = 'approvals';
  if coalesce(v_thr,0) > 0 and p_amount >= v_thr and not public.has_perm('expenses','edit') then v_status := 'pending'; end if;
  insert into expenses(expense_date, category_id, description, amount, payee, approval_status, approved_by, approved_at, attachments, notes, idempotency_key, created_by)
    values (p_date, p_category, btrim(p_description), round(p_amount,2), nullif(btrim(p_payee),''), v_status, case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end,
            coalesce(p_attachments,'[]'::jsonb), nullif(btrim(p_notes),''), p_idempotency_key, auth.uid()) returning id, expense_no into v_id, v_no;
  if p_payment is not null and coalesce((p_payment->>'amount')::numeric,0) > 0 then
    if v_status <> 'approved' then v_skipped := true;
    else
      v_pay := round((p_payment->>'amount')::numeric,2);
      perform public._pay_expense(v_id, (p_payment->>'account_id')::uuid, v_pay, coalesce(nullif(p_payment->>'date','')::date, p_date), nullif(p_payment->>'method',''), nullif(p_payment->>'reference',''));
    end if;
  end if;
  perform public._audit('create','expenses',v_id::text,null,(select to_jsonb(e) from expenses e where id = v_id),null);
  return jsonb_build_object('id', v_id, 'expense_no', v_no, 'approval_status', v_status, 'payment_skipped', v_skipped);
end $$;

create or replace function public.pay_expense(p_expense uuid, p_account uuid, p_amount numeric, p_date date default null, p_method text default null, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_txn uuid;
begin
  v_txn := public._pay_expense(p_expense, p_account, p_amount, coalesce(p_date, public._kampala_today()), p_method, p_ref);
  perform public._audit('pay','expenses',p_expense::text,null,jsonb_build_object('txn',v_txn,'amount',p_amount),null);
  return v_txn;
end $$;

create or replace function public.approve_expense(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not public.has_perm('expenses','edit') then raise exception 'FORBIDDEN: you may not approve expenses'; end if;
  select * into e from expenses where id = p_id for update;
  if not found or e.status <> 'open' or e.approval_status <> 'pending' then raise exception 'INVALID: only pending expenses can be approved or rejected'; end if;
  if e.created_by = auth.uid() and not public.is_owner() then raise exception 'FORBIDDEN: someone else must approve an expense you recorded'; end if;
  if not p_approve and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'INVALID: give a reason for rejecting'; end if;
  update expenses set approval_status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(), approval_note = nullif(btrim(p_note),'') where id = p_id;
  perform public._audit(case when p_approve then 'approve' else 'reject' end,'expenses',p_id::text,jsonb_build_object('approval_status','pending'),jsonb_build_object('approval_status',case when p_approve then 'approved' else 'rejected' end),p_note);
end $$;

create or replace function public.update_expense(p_id uuid, p_date date, p_category uuid, p_description text, p_amount numeric, p_payee text, p_notes text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses; v_cat transaction_categories;
begin
  if not public.has_perm('expenses','edit') then raise exception 'FORBIDDEN: you may not edit expenses'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to edit an expense'; end if;
  select * into e from expenses where id = p_id for update;
  if not found or e.status <> 'open' then raise exception 'INVALID: expense not found or cancelled'; end if;
  if p_amount <> e.amount and e.amount_paid > 0 then raise exception 'INVALID: this expense has payments — the amount cannot change'; end if;
  if p_amount is null or p_amount <= 0 or p_amount < e.amount_paid then raise exception 'INVALID: invalid amount'; end if;
  if p_date > public._kampala_today() + 1 then raise exception 'INVALID: expense date cannot be in the future'; end if;
  select * into v_cat from transaction_categories where id = p_category;
  if not found or v_cat.kind <> 'expense' then raise exception 'INVALID: choose an expense category'; end if;
  if v_cat.tracks_inventory and p_category <> e.category_id then raise exception 'INVALID: inventory-tracked categories are recorded through Receive materials'; end if;
  update expenses set expense_date = p_date, category_id = p_category, description = btrim(p_description), amount = round(p_amount,2), payee = nullif(btrim(p_payee),''), notes = nullif(btrim(p_notes),'') where id = p_id;
  perform public._refresh_expense(p_id);
  perform public._audit('edit','expenses',p_id::text,to_jsonb(e),(select to_jsonb(x) from expenses x where id = p_id),btrim(p_reason));
end $$;

create or replace function public.cancel_expense(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  if not public.has_perm('expenses','edit') then raise exception 'FORBIDDEN: you may not cancel expenses'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into e from expenses where id = p_id for update;
  if not found or e.status <> 'open' then raise exception 'INVALID: expense not found or already cancelled'; end if;
  if e.amount_paid > 0 then raise exception 'INVALID: this expense has payments — reverse the payment transactions first'; end if;
  update expenses set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  perform public._audit('cancel','expenses',p_id::text,to_jsonb(e),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

-- ---------- payroll functions ----------------------------------------
create or replace function public.create_payroll(
  p_employee uuid, p_start date, p_end date, p_workdays numeric, p_overtime_hours numeric default 0, p_overtime_rate numeric default 0,
  p_allowances numeric default 0, p_deductions numeric default 0, p_batch uuid default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp employees; v_std numeric; v_base numeric; v_ot numeric; v_total numeric; v_id uuid; v_status text; b production_batches;
begin
  if not public.has_perm('payroll','create') then raise exception 'FORBIDDEN: payroll is restricted to authorised staff'; end if;
  select * into emp from employees where id = p_employee;
  if not found or emp.status <> 'active' then raise exception 'INVALID: select an active employee'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'INVALID: invalid pay period'; end if;
  if p_end > public._kampala_today() + 1 then raise exception 'INVALID: the pay period cannot end in the future'; end if;
  if coalesce(p_workdays,0) < 0 or coalesce(p_overtime_hours,0) < 0 or coalesce(p_overtime_rate,0) < 0 or coalesce(p_allowances,0) < 0 or coalesce(p_deductions,0) < 0 then raise exception 'INVALID: values cannot be negative'; end if;
  select coalesce((value->>'standard_month_days')::numeric, 26) into v_std from settings where key = 'payroll';
  v_base := case emp.pay_basis when 'daily' then round(emp.rate * coalesce(p_workdays,0), 2)
                               else round(emp.rate * least(coalesce(p_workdays, v_std), v_std) / v_std, 2) end;
  v_ot := round(coalesce(p_overtime_hours,0) * coalesce(p_overtime_rate,0), 2);
  v_total := v_base + v_ot + coalesce(p_allowances,0) - coalesce(p_deductions,0);
  if v_total <= 0 then raise exception 'INVALID: total pay must be greater than zero (check days worked and rate)'; end if;
  if exists (select 1 from payroll_records where employee_id = p_employee and period_start = p_start and period_end = p_end and status <> 'cancelled') then
    raise exception 'DUPLICATE_SUSPECTED: payroll for % already exists for this period', emp.name; end if;
  if p_batch is not null then
    select * into b from production_batches where id = p_batch for update;
    if not found or b.status not in ('planned','in_progress') then raise exception 'INVALID: labour can only be linked to a planned or in-progress batch'; end if;
  end if;
  v_status := case when public.has_perm('payroll','edit') then 'approved' else 'pending' end;
  insert into payroll_records(employee_id, period_start, period_end, workdays, rate, pay_basis, base_pay, overtime_hours, overtime_rate, overtime_pay, allowances, deductions, total_pay, batch_id, status, approved_by, notes, created_by)
    values (p_employee, p_start, p_end, p_workdays, emp.rate, emp.pay_basis, v_base, coalesce(p_overtime_hours,0), coalesce(p_overtime_rate,0), v_ot, coalesce(p_allowances,0), coalesce(p_deductions,0), v_total, p_batch, v_status,
            case when v_status = 'approved' then auth.uid() end, nullif(btrim(p_notes),''), auth.uid()) returning id into v_id;
  if p_batch is not null then
    insert into production_costs(batch_id, kind, description, worker_name, amount, payroll_id, created_by)
      values (p_batch, 'labour', 'Payroll ' || (select payroll_no from payroll_records where id = v_id), emp.name, v_total, v_id, auth.uid());
    perform public._recompute_batch(p_batch);
  end if;
  perform public._audit('create','payroll_records',v_id::text,null,jsonb_build_object('employee',emp.name,'total',v_total,'status',v_status),null);
  return v_id;
end $$;

create or replace function public.approve_payroll(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r payroll_records;
begin
  if not public.has_perm('payroll','edit') then raise exception 'FORBIDDEN: only authorised staff may approve payroll'; end if;
  select * into r from payroll_records where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'INVALID: only pending payroll can be approved'; end if;
  if r.created_by = auth.uid() and not public.is_owner() then raise exception 'FORBIDDEN: someone else must approve payroll you prepared'; end if;
  update payroll_records set status = 'approved', approved_by = auth.uid() where id = p_id;
  perform public._audit('approve','payroll_records',p_id::text,jsonb_build_object('status','pending'),jsonb_build_object('status','approved'),null);
end $$;

create or replace function public.pay_payroll(p_id uuid, p_account uuid, p_date date default null, p_method text default null, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r payroll_records; emp employees; v_txn uuid; v_date date := coalesce(p_date, public._kampala_today());
begin
  if not public.has_perm('payroll','edit') then raise exception 'FORBIDDEN: only authorised staff may pay payroll'; end if;
  select * into r from payroll_records where id = p_id for update;
  if not found or r.status <> 'approved' then raise exception 'INVALID: only approved payroll can be paid'; end if;
  select * into emp from employees where id = r.employee_id;
  v_txn := public._post_txn('expense_payment', v_date, p_account, r.total_pay, 'Payroll ' || r.payroll_no || ' — ' || emp.name, null, null, null, p_method, p_ref, null, '[]'::jsonb, null, null);
  if r.batch_id is not null then
    perform set_config('frane.ledger_write','on',true);
    update transactions set batch_id = r.batch_id where id = v_txn;
    update production_costs set paid = true, paid_txn_id = v_txn where payroll_id = p_id and not voided;
  end if;
  update payroll_records set status = 'paid', paid_txn_id = v_txn, paid_date = v_date, payment_account_id = p_account where id = p_id;
  perform public._audit('pay','payroll_records',p_id::text,null,jsonb_build_object('txn',v_txn,'amount',r.total_pay),null);
  return v_txn;
end $$;

create or replace function public.cancel_payroll(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare r payroll_records; b production_batches;
begin
  if not public.has_perm('payroll','edit') then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into r from payroll_records where id = p_id for update;
  if not found or r.status = 'cancelled' then raise exception 'INVALID: payroll not found or already cancelled'; end if;
  if r.status = 'paid' then raise exception 'INVALID: this payroll has been paid — reverse the payment transaction first'; end if;
  if r.batch_id is not null then
    select * into b from production_batches where id = r.batch_id for update;
    if b.status not in ('planned','in_progress') then raise exception 'INVALID: the production batch is closed, so this labour cost is part of its stock value'; end if;
    update production_costs set voided = true, void_reason = 'Payroll cancelled' where payroll_id = p_id;
    perform public._recompute_batch(r.batch_id);
  end if;
  update payroll_records set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  perform public._audit('cancel','payroll_records',p_id::text,to_jsonb(r),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

create or replace function public.payroll_summary(p_from date, p_to date, p_group text default 'month') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('payroll','view') then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('period', k, 'headcount', hc, 'records', n, 'total', t, 'paid', coalesce(pd,0), 'unpaid', coalesce(up,0)) order by k) from (
    select case p_group when 'day' then period_end::text when 'week' then date_trunc('week', period_end)::date::text else to_char(period_end,'YYYY-MM') end k,
           count(distinct employee_id) hc, count(*) n, sum(total_pay) t, sum(total_pay) filter (where status = 'paid') pd, sum(total_pay) filter (where status in ('pending','approved')) up
      from payroll_records where status <> 'cancelled' and period_end between p_from and p_to group by 1) x), '[]'::jsonb);
end $$;

-- payment reversal releases expense allocations and re-opens payroll
create or replace function public.on_txn_reversed_mgmt() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if old.status = 'posted' and new.status = 'reversed' then
    for r in select distinct expense_id from expense_payments where payment_txn_id = new.id and not reversed loop
      update expense_payments set reversed = true where payment_txn_id = new.id and expense_id = r.expense_id and not reversed;
      perform public._refresh_expense(r.expense_id);
    end loop;
    update payroll_records set status = 'approved', paid_txn_id = null, paid_date = null, payment_account_id = null where paid_txn_id = new.id and status = 'paid';
  end if;
  return new;
end $$;
create trigger trg_txn_reversed_mgmt after update of status on public.transactions for each row execute function public.on_txn_reversed_mgmt();

-- ---------- expense / cost events (appends category + group columns) --
create or replace view public._expense_events as
  select t.txn_date as d, t.amount, coalesce(c.name, 'Uncategorised') as label, t.category_id, c.group_name from public.transactions t left join public.transaction_categories c on c.id = t.category_id
   where t.type = 'expense' and t.status = 'posted' and not t.is_reversal and t.batch_id is null
  union all select i.invoice_date, i.amount, coalesce(c.name, 'Uncategorised'), i.category_id, c.group_name from public.supplier_invoices i left join public.transaction_categories c on c.id = i.category_id
   where i.kind = 'expense' and i.status = 'open'
  union all select e.expense_date, e.amount, coalesce(c.name, 'Uncategorised'), e.category_id, c.group_name from public.expenses e left join public.transaction_categories c on c.id = e.category_id
   where e.status = 'open' and e.approval_status = 'approved'
  union all select p.period_end, p.total_pay, 'Payroll', null::uuid, 'Payroll'::text from public.payroll_records p where p.status in ('approved','paid') and p.batch_id is null;
revoke all on public._expense_events from public, anon, authenticated;

-- one list of every expense, whichever way it was recorded
create or replace view public.expense_register as
  select 'expense'::text as source, e.id, e.expense_no as ref_no, e.expense_date, e.category_id, c.name as category_name, c.group_name, e.description, e.payee,
         e.amount, e.amount_paid, e.balance, e.payment_status, e.approval_status, e.status, e.notes, e.attachments, e.created_at
    from public.expenses e join public.transaction_categories c on c.id = e.category_id
  union all
  select 'supplier_invoice', i.id, i.purchase_no, i.invoice_date, i.category_id, c.name, c.group_name, i.description, s.name,
         i.amount, i.amount_paid, i.balance, i.payment_status, 'approved', i.status, i.notes, i.attachments, i.created_at
    from public.supplier_invoices i join public.suppliers s on s.id = i.supplier_id left join public.transaction_categories c on c.id = i.category_id where i.kind = 'expense'
  union all
  select 'legacy', t.id, t.txn_no, t.txn_date, t.category_id, c.name, c.group_name, t.description, null, t.amount, t.amount, 0::numeric, 'paid', 'approved', case when t.status = 'posted' then 'open' else 'cancelled' end, t.notes, t.attachments, t.created_at
    from public.transactions t left join public.transaction_categories c on c.id = t.category_id where t.type = 'expense' and not t.is_reversal and t.batch_id is null
  ;
-- (the has_perm filter is applied through a wrapper so the view definition stays a plain union)
create or replace view public.expense_register_v as select * from public.expense_register where public.has_perm('expenses','view');
revoke all on public.expense_register from public, anon, authenticated;

-- ---------- budgets --------------------------------------------------
create or replace function public._period_end(p_type text, p_start date) returns date language sql immutable as $$
  select case p_type when 'month' then (p_start + interval '1 month')::date - 1 when 'quarter' then (p_start + interval '3 months')::date - 1 else (p_start + interval '1 year')::date - 1 end $$;
create or replace function public._period_start(p_type text, p_date date) returns date language sql immutable as $$
  select case p_type when 'month' then date_trunc('month', p_date)::date when 'quarter' then date_trunc('quarter', p_date)::date else date_trunc('year', p_date)::date end $$;

create or replace function public._budget_actual(p_scope text, p_cat uuid, p_group text, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'total' then (select coalesce(sum(amount),0) from _expense_events where d between p_from and p_to)
    when 'category' then (select coalesce(sum(amount),0) from _expense_events where d between p_from and p_to and category_id = p_cat)
    when 'group' then (select coalesce(sum(amount),0) from _expense_events where d between p_from and p_to and group_name = p_group)
    when 'production' then (select coalesce(sum(b.total_cost),0) from production_batches b join products p on p.id = b.product_id left join product_categories pc on pc.id = p.category_id
                            where b.status <> 'cancelled' and b.production_date between p_from and p_to and (p_group is null or pc.name = p_group))
  end $$;

create or replace function public.save_budget(
  p_id uuid, p_period_type text, p_period_start date, p_scope text, p_category uuid, p_group text, p_amount numeric, p_notes text default null, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_start date; v_old budgets; v_id uuid;
begin
  if p_period_type not in ('month','quarter','year') or p_scope not in ('total','group','category','production') then raise exception 'INVALID: invalid budget type'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: budget amount must be greater than zero'; end if;
  v_start := public._period_start(p_period_type, p_period_start);
  if p_scope = 'category' and p_category is null then raise exception 'INVALID: choose an expense category'; end if;
  if p_scope = 'group' and (p_group is null or btrim(p_group) = '') then raise exception 'INVALID: choose a department / group'; end if;
  if p_id is null then
    if not public.has_perm('budgets','create') then raise exception 'FORBIDDEN: you may not create budgets'; end if;
    begin
      insert into budgets(period_type, period_start, scope_type, category_id, group_name, amount, notes, created_by)
        values (p_period_type, v_start, p_scope, case when p_scope = 'category' then p_category end, case when p_scope in ('group','production') then nullif(btrim(p_group),'') end, round(p_amount,2), nullif(btrim(p_notes),''), auth.uid()) returning id into v_id;
    exception when unique_violation then raise exception 'INVALID: a budget for this period and scope already exists — edit it instead';
    end;
    perform public._audit('create','budgets',v_id::text,null,(select to_jsonb(b) from budgets b where id = v_id),null);
  else
    if not public.has_perm('budgets','edit') then raise exception 'FORBIDDEN: you may not change budgets'; end if;
    if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to change a budget'; end if;
    select * into v_old from budgets where id = p_id for update;
    if not found then raise exception 'INVALID: budget not found'; end if;
    update budgets set amount = round(p_amount,2), notes = nullif(btrim(p_notes),'') where id = p_id;
    v_id := p_id;
    perform public._audit('edit','budgets',p_id::text,to_jsonb(v_old),(select to_jsonb(b) from budgets b where id = p_id),btrim(p_reason));
  end if;
  return v_id;
end $$;

create or replace function public.deactivate_budget(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare v_old budgets;
begin
  if not public.has_perm('budgets','edit') then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into v_old from budgets where id = p_id for update;
  if not found or not v_old.active then raise exception 'INVALID: budget not found'; end if;
  update budgets set active = false where id = p_id;
  perform public._audit('deactivate','budgets',p_id::text,to_jsonb(v_old),jsonb_build_object('active',false),btrim(p_reason));
end $$;

create or replace function public.budget_report(p_type text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start date := public._period_start(p_type, p_date); v_end date; v_pstart date; v_pend date; v_thr numeric; v_rows jsonb;
begin
  if not public.has_perm('budgets','view') then raise exception 'FORBIDDEN'; end if;
  v_end := public._period_end(p_type, v_start);
  v_pstart := public._period_start(p_type, v_start - 1); v_pend := v_start - 1;
  select coalesce((value->>'threshold_pct')::numeric, 80) into v_thr from settings where key = 'budget_alerts';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'scope_type', scope_type, 'category_id', category_id, 'group_name', group_name, 'label', lbl, 'notes', notes, 'budget', amount, 'actual', act,
      'remaining', amount - act, 'variance', act - amount, 'pct_used', round(act * 100 / amount, 1), 'previous_actual', prev,
      'status', case when act > amount then 'over' when act * 100 / amount >= coalesce(v_thr,80) then 'warning' else 'ok' end) order by scope_type, lbl), '[]'::jsonb) into v_rows
  from (select b.id, b.scope_type, b.category_id, b.group_name, b.notes, b.amount,
          coalesce(c.name, b.group_name, case b.scope_type when 'total' then 'Total operating expenses' else 'Production costs' end) || case when b.scope_type = 'production' and b.group_name is not null then ' (production)' when b.scope_type = 'group' then ' (department)' else '' end lbl,
          public._budget_actual(b.scope_type, b.category_id, b.group_name, v_start, v_end) act,
          public._budget_actual(b.scope_type, b.category_id, b.group_name, v_pstart, v_pend) prev
        from budgets b left join transaction_categories c on c.id = b.category_id where b.active and b.period_type = p_type and b.period_start = v_start) z;
  return jsonb_build_object('period_type', p_type, 'period_start', v_start, 'period_end', v_end, 'threshold_pct', v_thr, 'rows', v_rows);
end $$;

-- ---------- daily closing & reconciliation ---------------------------
create or replace function public._balance_at(p_account uuid, p_date date) returns numeric language sql stable security definer set search_path = public as $$
  select a.opening_balance + coalesce((select sum(case direction when 'in' then amount else -amount end) from transactions where account_id = a.id and txn_date <= p_date), 0) from accounts a where a.id = p_account $$;

create or replace function public.closing_preview(p_account uuid, p_date date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_in numeric; v_out numeric; a accounts;
begin
  if not (public.has_perm('daily_closing','view') or public.has_perm('daily_closing','create')) then raise exception 'FORBIDDEN'; end if;
  select * into a from accounts where id = p_account;
  if not found then raise exception 'INVALID: account not found'; end if;
  v_open := public._balance_at(p_account, p_date - 1);
  select coalesce(sum(amount) filter (where direction = 'in'),0), coalesce(sum(amount) filter (where direction = 'out'),0) into v_in, v_out from transactions where account_id = p_account and txn_date = p_date;
  return jsonb_build_object('account', a.name, 'account_type', a.type, 'opening', v_open, 'receipts', v_in, 'payments', v_out, 'expected', v_open + v_in - v_out,
    'existing', (select jsonb_build_object('id', id, 'status', status) from daily_closings where account_id = p_account and closing_date = p_date and status in ('submitted','approved')));
end $$;

create or replace function public.submit_closing(p_account uuid, p_date date, p_counted numeric, p_denoms jsonb default null, p_explanation text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_exp numeric; v_var numeric; v_cfg jsonb; v_tol numeric; v_req boolean; v_status text; v_id uuid;
begin
  if not public.has_perm('daily_closing','create') then raise exception 'FORBIDDEN: you may not close the day'; end if;
  if p_date is null or p_date > public._kampala_today() then raise exception 'INVALID: you cannot close a future day'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'INVALID: enter the counted balance'; end if;
  v_prev := public.closing_preview(p_account, p_date);
  if v_prev->'existing' is not null and jsonb_typeof(v_prev->'existing') <> 'null' then raise exception 'INVALID: this account is already closed for that day — reopen it first'; end if;
  v_exp := (v_prev->>'expected')::numeric; v_var := round(p_counted,2) - v_exp;
  if v_var <> 0 and (p_explanation is null or length(btrim(p_explanation)) < 3) then raise exception 'INVALID: explain the variance of UGX % before submitting', v_var; end if;
  select value into v_cfg from settings where key = 'closing';
  v_req := coalesce((v_cfg->>'require_approval')::boolean, true); v_tol := coalesce((v_cfg->>'variance_tolerance')::numeric, 0);
  v_status := case when not v_req or abs(v_var) <= v_tol then 'approved' else 'submitted' end;
  insert into daily_closings(closing_date, account_id, opening_balance, receipts, payments, expected_balance, counted_balance, denominations, explanation, status, closed_by, approved_by, approved_at, review_note)
    values (p_date, p_account, (v_prev->>'opening')::numeric, (v_prev->>'receipts')::numeric, (v_prev->>'payments')::numeric, v_exp, round(p_counted,2), p_denoms, nullif(btrim(p_explanation),''), v_status, auth.uid(),
            case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end, case when v_status = 'approved' then 'Within tolerance / approval not required' end) returning id into v_id;
  insert into reconciliations(account_id, reconciliation_date, system_balance, actual_balance, notes, closing_id, reconciled_by)
    values (p_account, p_date, v_exp, round(p_counted,2), 'Daily closing', v_id, auth.uid());
  perform public._audit('close_day','daily_closings',v_id::text,null,jsonb_build_object('account',p_account,'date',p_date,'expected',v_exp,'counted',p_counted,'variance',v_var,'status',v_status),nullif(btrim(p_explanation),''));
  return jsonb_build_object('id', v_id, 'status', v_status, 'variance', v_var);
end $$;

create or replace function public.review_closing(p_id uuid, p_approve boolean, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare c daily_closings;
begin
  if not public.has_perm('daily_closing','edit') then raise exception 'FORBIDDEN: only a manager may approve closings'; end if;
  select * into c from daily_closings where id = p_id for update;
  if not found or c.status <> 'submitted' then raise exception 'INVALID: only submitted closings can be reviewed'; end if;
  if c.closed_by = auth.uid() and not public.is_owner() then raise exception 'FORBIDDEN: someone else must approve a closing you submitted'; end if;
  if not p_approve and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'INVALID: give a reason for rejecting'; end if;
  update daily_closings set status = case when p_approve then 'approved' else 'rejected' end, approved_by = auth.uid(), approved_at = now(), review_note = nullif(btrim(p_note),'') where id = p_id;
  perform public._audit(case when p_approve then 'approve_closing' else 'reject_closing' end,'daily_closings',p_id::text,jsonb_build_object('status','submitted'),jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end),p_note);
end $$;

create or replace function public.reopen_closing(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare c daily_closings;
begin
  if not public.has_perm('daily_closing','edit') then raise exception 'FORBIDDEN: only authorised users may reopen a closed day'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to reopen'; end if;
  select * into c from daily_closings where id = p_id for update;
  if not found or c.status not in ('submitted','approved') then raise exception 'INVALID: this closing is not open for reopening'; end if;
  update daily_closings set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = btrim(p_reason) where id = p_id;
  perform public._audit('reopen_closing','daily_closings',p_id::text,to_jsonb(c),jsonb_build_object('status','reopened'),btrim(p_reason));
end $$;

create or replace function public.reconcile_account(p_account uuid, p_date date, p_actual numeric, p_notes text default null, p_adjust boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sys numeric; v_diff numeric; v_id uuid; v_txn uuid; v_acc accounts;
begin
  if not (public.has_perm('daily_closing','create') or public.has_perm('accounts','edit')) then raise exception 'FORBIDDEN: you may not reconcile accounts'; end if;
  if p_date is null or p_date > public._kampala_today() then raise exception 'INVALID: invalid reconciliation date'; end if;
  if p_actual is null then raise exception 'INVALID: enter the actual balance'; end if;
  select * into v_acc from accounts where id = p_account;
  if not found then raise exception 'INVALID: account not found'; end if;
  v_sys := public._balance_at(p_account, p_date); v_diff := round(p_actual,2) - v_sys;
  if v_diff <> 0 and (p_notes is null or length(btrim(p_notes)) < 3) then raise exception 'INVALID: explain the difference of UGX %', v_diff; end if;
  if p_adjust and v_diff <> 0 then
    if not public.has_perm('transactions','edit') then raise exception 'FORBIDDEN: only a manager can post a reconciliation adjustment'; end if;
    v_txn := public.record_transaction('adjustment', p_date, p_account, abs(v_diff), 'Reconciliation adjustment — ' || v_acc.name, null, null, null, null, null, 'Reconciliation: ' || btrim(p_notes), '[]'::jsonb, null,
                                       case when v_diff > 0 then 'in' else 'out' end::public.txn_direction, true);
  end if;
  insert into reconciliations(account_id, reconciliation_date, system_balance, actual_balance, notes, adjustment_txn_id, reconciled_by)
    values (p_account, p_date, v_sys, round(p_actual,2), nullif(btrim(p_notes),''), v_txn, auth.uid()) returning id into v_id;
  perform public._audit('reconcile','reconciliations',v_id::text,null,jsonb_build_object('account',v_acc.name,'system',v_sys,'actual',p_actual,'difference',v_diff,'adjusted',v_txn is not null),nullif(btrim(p_notes),''));
  return jsonb_build_object('id', v_id, 'system_balance', v_sys, 'difference', v_diff, 'adjustment_txn', v_txn);
end $$;

-- ---------- dashboard (adds management signals) ----------------------
alter function public.dashboard_summary(date, date) rename to _dashboard_ops;
create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_core jsonb; v_today date := public._kampala_today(); v_thr numeric; v_stale int; v_extra jsonb; v_pay boolean := public.has_perm('payroll','view');
begin
  v_core := public._dashboard_ops(p_from, p_to);
  select coalesce((value->>'threshold_pct')::numeric, 80) into v_thr from settings where key = 'budget_alerts';
  select coalesce((value->>'stale_days')::int, 7) into v_stale from settings where key = 'reconciliation';
  select jsonb_build_object(
    'budget_alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', lbl, 'period_type', pt, 'budget', amount, 'actual', act, 'pct', pct) order by pct desc), '[]'::jsonb) from (
        select b.id, b.period_type pt, b.amount, coalesce(c.name, b.group_name, case b.scope_type when 'total' then 'Total operating expenses' else 'Production costs' end) lbl, a.act, round(a.act * 100 / b.amount, 0) pct
          from budgets b left join transaction_categories c on c.id = b.category_id
          cross join lateral (select public._budget_actual(b.scope_type, b.category_id, b.group_name, b.period_start, public._period_end(b.period_type, b.period_start)) act) a
         where b.active and v_today between b.period_start and public._period_end(b.period_type, b.period_start)) x where pct >= v_thr limit 8),
    'unreconciled_accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'last', lr.last)), '[]'::jsonb) from accounts a
        left join lateral (select max(reconciliation_date) last from reconciliations where account_id = a.id) lr on true
        where a.status = 'active' and exists (select 1 from transactions t where t.account_id = a.id) and (lr.last is null or lr.last < v_today - v_stale)),
    'pending_expense_approvals', (select count(*) from expenses where status = 'open' and approval_status = 'pending'),
    'unpaid_expenses', (select coalesce(sum(balance),0) from expenses where status = 'open' and approval_status = 'approved'),
    'payroll_unpaid', case when v_pay then (select coalesce(sum(total_pay),0) from payroll_records where status = 'approved') end,
    'payroll_pending', case when v_pay then (select count(*) from payroll_records where status = 'pending') end,
    'closings_pending', (select count(*) from daily_closings where status = 'submitted')
  ) into v_extra;
  return v_core || v_extra;
end $$;

-- ---------- RLS & grants --------------------------------------------
alter table public.expenses enable row level security;
alter table public.expense_payments enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_records enable row level security;
alter table public.budgets enable row level security;
alter table public.daily_closings enable row level security;
alter table public.reconciliations enable row level security;

create policy expenses_read on public.expenses for select using (public.has_perm('expenses','view'));
create policy ep_read on public.expense_payments for select using (public.has_perm('expenses','view'));
create policy employees_read on public.employees for select using (public.has_perm('payroll','view'));
create policy employees_ins on public.employees for insert with check (public.has_perm('payroll','create'));
create policy employees_upd on public.employees for update using (public.has_perm('payroll','edit')) with check (public.has_perm('payroll','edit'));
create policy payroll_read on public.payroll_records for select using (public.has_perm('payroll','view'));
create policy budgets_read on public.budgets for select using (public.has_perm('budgets','view'));
create policy closings_read on public.daily_closings for select using (public.has_perm('daily_closing','view'));
create policy recon_read on public.reconciliations for select using (public.has_perm('daily_closing','view') or public.has_perm('accounts','view'));

revoke all on public.expenses, public.expense_payments, public.payroll_records, public.budgets, public.daily_closings, public.reconciliations, public.employees from anon, authenticated;
grant select on public.expenses, public.expense_payments, public.payroll_records, public.budgets, public.daily_closings, public.reconciliations to authenticated;
grant select on public.employees to authenticated;
grant insert (name, role, phone, employment_type, pay_basis, rate, status, start_date, notes) on public.employees to authenticated;
grant update (name, role, phone, employment_type, pay_basis, rate, status, start_date, notes) on public.employees to authenticated;
grant select on public.expense_register_v to authenticated;
grant usage on sequence public.employee_seq to authenticated;

-- staff names (only id + name) visible to any signed-in staff member, for "recorded by" / "salesperson" labels.
-- profiles itself stays owner-only so phone numbers etc. are not exposed.
create or replace view public.profile_names as
  select p.id, p.full_name from public.profiles p where exists (select 1 from public.user_roles ur where ur.user_id = auth.uid());
grant select on public.profile_names to authenticated;

-- receipts: anyone who may record or view expenses can attach/open supporting documents
drop policy if exists attachments_read on storage.objects;
drop policy if exists attachments_write on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (public.has_perm('transactions','view') or public.has_perm('cashbook','view') or public.has_perm('expenses','view')));
create policy attachments_write on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (public.has_perm('transactions','create') or public.has_perm('expenses','create')));

-- ---------- function privileges: explicit allow-list -----------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.has_perm(text,text), public.is_owner(), public.my_permissions(), public._kampala_today(),
  public.record_transaction(public.txn_type,date,uuid,numeric,text,uuid,text,text,uuid,uuid,text,jsonb,uuid,public.txn_direction,boolean),
  public.record_transfer(date,uuid,uuid,numeric,text,text,text,uuid,boolean), public.reverse_transaction(uuid,text),
  public.edit_transaction(uuid,date,text,numeric,uuid,uuid,text,text,text,text,jsonb),
  public.cashbook_report(date,date,uuid,uuid,text), public.dashboard_summary(date,date),
  public.list_users(), public.set_user_access(uuid,public.app_role,boolean), public.seed_demo_data(), public.remove_demo_data(),
  public.save_sale(uuid,uuid,date,jsonb,numeric,numeric,date,text,text,boolean,jsonb,uuid), public.cancel_sale(uuid,text), public.update_sale_details(uuid,date,text,text),
  public.record_customer_payment(uuid,uuid,numeric,date,text,text,text,jsonb,boolean,uuid), public.allocate_customer_payment(uuid,jsonb,boolean),
  public.record_supplier_invoice(uuid,text,date,date,text,uuid,text,numeric,text,jsonb,jsonb,uuid), public.cancel_supplier_invoice(uuid,text),
  public.record_supplier_payment(uuid,uuid,numeric,date,text,text,text,jsonb,boolean,uuid),
  public.customer_statement(uuid,date,date), public.supplier_statement(uuid,date,date),
  public.set_delivery_status(uuid,text,boolean),
  public.record_opening_stock(uuid,numeric,numeric,date), public.adjust_stock(uuid,numeric,text,date,boolean), public.record_damage(uuid,numeric,text,date), public.record_return(uuid,numeric,uuid,text,date),
  public.record_material_opening(uuid,numeric,numeric,date), public.adjust_material(uuid,numeric,text,date,boolean), public.record_material_damage(uuid,numeric,text,date),
  public.record_material_purchase(uuid,date,text,date,jsonb,text,jsonb,uuid),
  public.create_batch(uuid,date,numeric,text,text,boolean), public.start_batch(uuid), public.add_batch_material(uuid,uuid,numeric,boolean), public.remove_batch_material(uuid,text),
  public.add_batch_cost(uuid,text,text,numeric,text,jsonb), public.pay_batch_cost(uuid,uuid,uuid,date,text,text), public.void_batch_cost(uuid,text),
  public.complete_batch(uuid,numeric,numeric,date), public.cancel_batch(uuid,text), public.production_report(date,date),
  -- phase 4
  public.record_expense(date,uuid,text,numeric,text,text,jsonb,jsonb,uuid,boolean), public.pay_expense(uuid,uuid,numeric,date,text,text), public.approve_expense(uuid,boolean,text),
  public.update_expense(uuid,date,uuid,text,numeric,text,text,text), public.cancel_expense(uuid,text),
  public.create_payroll(uuid,date,date,numeric,numeric,numeric,numeric,numeric,uuid,text), public.approve_payroll(uuid), public.pay_payroll(uuid,uuid,date,text,text), public.cancel_payroll(uuid,text), public.payroll_summary(date,date,text),
  public.save_budget(uuid,text,date,text,uuid,text,numeric,text,text), public.deactivate_budget(uuid,text), public.budget_report(text,date),
  public.closing_preview(uuid,date), public.submit_closing(uuid,date,numeric,jsonb,text), public.review_closing(uuid,boolean,text), public.reopen_closing(uuid,text),
  public.reconcile_account(uuid,date,numeric,text,boolean)
  to authenticated;
