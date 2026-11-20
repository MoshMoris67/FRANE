-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 2: commercial operations
-- Products (catalogue), customers, sales/invoices, customer payments with
-- allocation, receivables, suppliers, supplier invoices, supplier payments
-- with allocation, payables, statements, dashboard integration.
--
-- DESIGN
--  * Money still lives only in `transactions`. A customer/supplier payment IS a
--    ledger row (type customer_payment / supplier_payment); the *_allocations
--    tables say which invoices it settled. One book, no dual entry.
--  * Revenue = confirmed sales (invoice date) + other `income` transactions.
--    Customer payments are collections, never revenue (no double counting).
--  * Credit sales raise receivables, not cash. Cash moves only when a payment
--    is recorded to an account.
--  * Expense incurred on credit = supplier invoice of kind 'expense'
--    (recognised on invoice date). Paying it is a supplier_payment (not a 2nd expense).
--    Kind 'materials' is held for raw-material inventory (Phase 3) and is not
--    expensed until consumed in production.
--  * Invoice line prices are copied onto sale_items, so later price changes never
--    alter history. Confirmed invoices are immutable (cancel with reason instead).
--  * Stock is NOT deducted here. Delivery status is tracked; stock deduction follows
--    the controlled fulfilment process in Phase 3.
-- =====================================================================

alter table public.transactions add column receipt_no text unique;
create sequence public.sale_seq;
create sequence public.receipt_seq;
create sequence public.purchase_seq;

-- ---------- catalogue (stock fields arrive in Phase 3) --------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order int not null default 100
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(btrim(sku)) > 0),
  name text not null check (length(btrim(name)) > 0),
  category_id uuid references public.product_categories(id),
  dimensions text,
  description text,
  unit text not null default 'pieces',
  selling_price numeric(16,2) not null default 0 check (selling_price >= 0),
  production_cost_estimate numeric(16,2) not null default 0 check (production_cost_estimate >= 0),
  min_stock numeric(16,2) not null default 0 check (min_stock >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);
create or replace function public.touch_updated() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger trg_products_touch before update on public.products for each row execute function public.touch_updated();

insert into public.product_categories(name, sort_order) values
 ('Concrete blocks',10),('Pavers',20),('Solid blocks',30),('Hollow blocks',40),('Decorative concrete products',50),('Other concrete products',90)
on conflict do nothing;

-- ---------- parties --------------------------------------------------
alter table public.customers add column if not exists email text;
alter table public.suppliers add column if not exists contact_person text;
create index if not exists customers_name_idx on public.customers (lower(name));

-- ---------- sales ----------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_no text unique,                       -- assigned on confirmation (no numbering gaps from drafts)
  sale_date date not null,
  customer_id uuid not null references public.customers(id),
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','loading','dispatched','delivered','cancelled')),
  subtotal numeric(16,2) not null default 0,
  discount numeric(16,2) not null default 0 check (discount >= 0),
  transport_charge numeric(16,2) not null default 0 check (transport_charge >= 0),
  total numeric(16,2) not null default 0 check (total >= 0),
  amount_paid numeric(16,2) not null default 0 check (amount_paid >= 0),
  balance numeric(16,2) generated always as (case when status = 'confirmed' then total - amount_paid else 0 end) stored,
  due_date date,
  salesperson_id uuid references public.profiles(id),
  delivery_address text,
  notes text,
  cancel_reason text,
  cancelled_at timestamptz,
  idempotency_key uuid unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= total or status <> 'confirmed')
);
create index sales_customer_idx on public.sales(customer_id, sale_date);
create index sales_date_idx on public.sales(sale_date) where status = 'confirmed';
create index sales_open_idx on public.sales(due_date) where status = 'confirmed' and balance > 0;
create trigger trg_sales_touch before update on public.sales for each row execute function public.touch_updated();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  line_no int not null,
  product_id uuid references public.products(id),
  description text not null,
  unit text not null default 'pieces',
  quantity numeric(16,3) not null check (quantity > 0),
  unit_price numeric(16,2) not null check (unit_price >= 0),   -- price preserved at time of sale
  discount numeric(16,2) not null default 0 check (discount >= 0),
  line_total numeric(16,2) not null check (line_total >= 0),
  unique (sale_id, line_no)
);
create index sale_items_product_idx on public.sale_items(product_id);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_txn_id uuid not null references public.transactions(id),
  sale_id uuid not null references public.sales(id),
  amount numeric(16,2) not null check (amount > 0),
  reversed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index pa_sale_idx on public.payment_allocations(sale_id) where not reversed;
create index pa_txn_idx on public.payment_allocations(payment_txn_id);

alter table public.transactions add constraint transactions_sale_fk foreign key (sale_id) references public.sales(id);

-- ---------- supplier invoices & allocations --------------------------
create table public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  purchase_no text unique not null default ('PUR-' || lpad(nextval('public.purchase_seq')::text, 6, '0')),
  supplier_id uuid not null references public.suppliers(id),
  supplier_invoice_no text,
  invoice_date date not null,
  due_date date,
  kind text not null default 'materials' check (kind in ('materials','expense')),
  category_id uuid references public.transaction_categories(id),
  description text not null,
  amount numeric(16,2) not null check (amount > 0),
  amount_paid numeric(16,2) not null default 0 check (amount_paid >= 0),
  status text not null default 'open' check (status in ('open','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  balance numeric(16,2) generated always as (case when status = 'open' then amount - amount_paid else 0 end) stored,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  cancel_reason text,
  idempotency_key uuid unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= amount),
  check (kind <> 'expense' or category_id is not null)
);
create index si_supplier_idx on public.supplier_invoices(supplier_id, invoice_date);
create index si_open_idx on public.supplier_invoices(due_date) where status = 'open' and balance > 0;
create trigger trg_si_touch before update on public.supplier_invoices for each row execute function public.touch_updated();

create table public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_txn_id uuid not null references public.transactions(id),
  invoice_id uuid not null references public.supplier_invoices(id),
  amount numeric(16,2) not null check (amount > 0),
  reversed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index spa_inv_idx on public.supplier_payment_allocations(invoice_id) where not reversed;
create index spa_txn_idx on public.supplier_payment_allocations(payment_txn_id);

-- ---------- settings -------------------------------------------------
insert into public.settings(key, value) values ('credit_terms', '{"customer_days":30,"supplier_days":30}') on conflict (key) do nothing;

-- ---------- audit triggers ------------------------------------------
create trigger trg_audit_products after insert or update or delete on public.products for each row execute function public.audit_row();
create trigger trg_audit_customers after update on public.customers for each row execute function public.audit_row();
create trigger trg_audit_suppliers after update on public.suppliers for each row execute function public.audit_row();

-- ---------- internal helpers ----------------------------------------
create or replace function public._refresh_sale(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount),0) into v_paid from payment_allocations where sale_id = p_id and not reversed;
  update sales set amount_paid = v_paid,
    payment_status = case when status = 'confirmed' and total > 0 and v_paid >= total then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end
  where id = p_id;
end $$;

create or replace function public._refresh_supplier_invoice(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount),0) into v_paid from supplier_payment_allocations where invoice_id = p_id and not reversed;
  update supplier_invoices set amount_paid = v_paid,
    payment_status = case when v_paid >= amount then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end
  where id = p_id;
end $$;

-- Ledger posting without permission checks; callers check permissions.
create or replace function public._post_txn(
  p_type public.txn_type, p_date date, p_account uuid, p_amount numeric, p_desc text,
  p_customer uuid, p_supplier uuid, p_sale uuid, p_method text, p_ref text, p_notes text,
  p_attach jsonb, p_idem uuid, p_receipt text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_dir public.txn_direction; v_acc accounts; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: payment date cannot be in the future'; end if;
  v_dir := case p_type when 'customer_payment' then 'in' when 'supplier_payment' then 'out' end;
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

create or replace function public._allocate_customer(p_txn uuid, p_customer uuid, p_allocs jsonb, p_auto boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare t transactions; avail numeric; a jsonb; s sales; amt numeric; used numeric := 0;
begin
  select * into t from transactions where id = p_txn for update;
  if not found or t.type <> 'customer_payment' or t.customer_id is distinct from p_customer or t.status <> 'posted' or t.is_reversal then
    raise exception 'INVALID: payment cannot be allocated to this customer'; end if;
  avail := t.amount - coalesce((select sum(amount) from payment_allocations where payment_txn_id = p_txn and not reversed),0);
  if p_auto then
    for s in select * from sales where customer_id = p_customer and status = 'confirmed' and total - amount_paid > 0 order by sale_date, created_at for update loop
      exit when avail <= 0;
      amt := least(avail, s.total - s.amount_paid);
      insert into payment_allocations(payment_txn_id, sale_id, amount, created_by) values (p_txn, s.id, amt, auth.uid());
      avail := avail - amt; used := used + amt; perform public._refresh_sale(s.id);
    end loop;
  else
    for a in select * from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) loop
      amt := round(coalesce((a->>'amount')::numeric,0),2);
      continue when amt = 0;
      if amt < 0 then raise exception 'INVALID: allocation amounts must be positive'; end if;
      select * into s from sales where id = (a->>'sale_id')::uuid for update;
      if not found or s.customer_id <> p_customer or s.status <> 'confirmed' then raise exception 'INVALID: invoice does not belong to this customer or is not confirmed'; end if;
      if amt > s.total - s.amount_paid then raise exception 'INVALID: allocation of % exceeds the % balance on %', amt, s.total - s.amount_paid, s.sale_no; end if;
      if amt > avail then raise exception 'INVALID: allocations exceed the payment amount'; end if;
      insert into payment_allocations(payment_txn_id, sale_id, amount, created_by) values (p_txn, s.id, amt, auth.uid());
      avail := avail - amt; used := used + amt; perform public._refresh_sale(s.id);
    end loop;
  end if;
  return used;
end $$;

create or replace function public._allocate_supplier(p_txn uuid, p_supplier uuid, p_allocs jsonb, p_auto boolean)
returns numeric language plpgsql security definer set search_path = public as $$
declare t transactions; avail numeric; a jsonb; i supplier_invoices; amt numeric; used numeric := 0;
begin
  select * into t from transactions where id = p_txn for update;
  if not found or t.type <> 'supplier_payment' or t.supplier_id is distinct from p_supplier or t.status <> 'posted' or t.is_reversal then
    raise exception 'INVALID: payment cannot be allocated to this supplier'; end if;
  avail := t.amount - coalesce((select sum(amount) from supplier_payment_allocations where payment_txn_id = p_txn and not reversed),0);
  if p_auto then
    for i in select * from supplier_invoices where supplier_id = p_supplier and status = 'open' and amount - amount_paid > 0 order by coalesce(due_date, invoice_date), created_at for update loop
      exit when avail <= 0;
      amt := least(avail, i.amount - i.amount_paid);
      insert into supplier_payment_allocations(payment_txn_id, invoice_id, amount, created_by) values (p_txn, i.id, amt, auth.uid());
      avail := avail - amt; used := used + amt; perform public._refresh_supplier_invoice(i.id);
    end loop;
  else
    for a in select * from jsonb_array_elements(coalesce(p_allocs,'[]'::jsonb)) loop
      amt := round(coalesce((a->>'amount')::numeric,0),2);
      continue when amt = 0;
      if amt < 0 then raise exception 'INVALID: allocation amounts must be positive'; end if;
      select * into i from supplier_invoices where id = (a->>'invoice_id')::uuid for update;
      if not found or i.supplier_id <> p_supplier or i.status <> 'open' then raise exception 'INVALID: invoice does not belong to this supplier or is cancelled'; end if;
      if amt > i.amount - i.amount_paid then raise exception 'INVALID: allocation of % exceeds the % balance on %', amt, i.amount - i.amount_paid, i.purchase_no; end if;
      if amt > avail then raise exception 'INVALID: allocations exceed the payment amount'; end if;
      insert into supplier_payment_allocations(payment_txn_id, invoice_id, amount, created_by) values (p_txn, i.id, amt, auth.uid());
      avail := avail - amt; used := used + amt; perform public._refresh_supplier_invoice(i.id);
    end loop;
  end if;
  return used;
end $$;

-- When a payment is reversed, its allocations are released and invoices re-opened.
create or replace function public.on_txn_reversed() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if old.status = 'posted' and new.status = 'reversed' then
    for r in select distinct sale_id from payment_allocations where payment_txn_id = new.id and not reversed loop
      update payment_allocations set reversed = true where payment_txn_id = new.id and sale_id = r.sale_id and not reversed;
      perform public._refresh_sale(r.sale_id);
    end loop;
    for r in select distinct invoice_id from supplier_payment_allocations where payment_txn_id = new.id and not reversed loop
      update supplier_payment_allocations set reversed = true where payment_txn_id = new.id and invoice_id = r.invoice_id and not reversed;
      perform public._refresh_supplier_invoice(r.invoice_id);
    end loop;
  end if;
  return new;
end $$;
create trigger trg_txn_reversed after update of status on public.transactions for each row execute function public.on_txn_reversed();

create or replace function public.guard_allocated_edit() returns trigger language plpgsql as $$
begin
  if new.amount <> old.amount and (exists (select 1 from payment_allocations where payment_txn_id = old.id and not reversed)
      or exists (select 1 from supplier_payment_allocations where payment_txn_id = old.id and not reversed)) then
    raise exception 'INVALID: this payment is allocated to invoices — reverse it and record it again to change the amount';
  end if;
  return new;
end $$;
create trigger trg_txn_alloc_guard before update of amount on public.transactions for each row execute function public.guard_allocated_edit();

-- ---------- sales functions -----------------------------------------
create or replace function public.save_sale(
  p_sale_id uuid, p_customer_id uuid, p_date date, p_items jsonb, p_discount numeric default 0, p_transport numeric default 0,
  p_due_date date default null, p_delivery_address text default null, p_notes text default null,
  p_confirm boolean default false, p_payment jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sale sales; v_id uuid; v_item jsonb; v_n int := 0; v_prod products; v_qty numeric; v_price numeric; v_disc numeric; v_line numeric;
  v_sub numeric := 0; v_total numeric; v_cust customers; v_days int; v_prefix text; v_pay numeric; v_txn uuid; v_rcpt text; v_acc uuid; v_existing uuid;
begin
  if not public.has_perm('sales','create') then raise exception 'FORBIDDEN: you may not create sales'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'INVALID: add at least one product line'; end if;
  if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: invalid sale date'; end if;
  if coalesce(p_discount,0) < 0 or coalesce(p_transport,0) < 0 then raise exception 'INVALID: discount and transport cannot be negative'; end if;
  select * into v_cust from customers where id = p_customer_id;
  if not found then raise exception 'INVALID: select a customer'; end if;
  if v_cust.status <> 'active' then raise exception 'INVALID: customer is inactive'; end if;

  if p_sale_id is null then
    if p_idempotency_key is not null then
      select id into v_existing from sales where idempotency_key = p_idempotency_key;
      if found then return v_existing; end if;
    end if;
    insert into sales(sale_date, customer_id, salesperson_id, created_by, idempotency_key) values (p_date, p_customer_id, auth.uid(), auth.uid(), p_idempotency_key) returning id into v_id;
  else
    select * into v_sale from sales where id = p_sale_id for update;
    if not found then raise exception 'INVALID: sale not found'; end if;
    if v_sale.status <> 'draft' then raise exception 'INVALID: confirmed invoices cannot be changed — cancel and re-issue, or edit delivery/notes only'; end if;
    v_id := p_sale_id;
    delete from sale_items where sale_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_qty := (v_item->>'quantity')::numeric; v_price := (v_item->>'unit_price')::numeric; v_disc := coalesce((v_item->>'discount')::numeric,0);
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID: line % quantity must be greater than zero', v_n; end if;
    if v_price is null or v_price < 0 or v_disc < 0 then raise exception 'INVALID: line % has a negative price or discount', v_n; end if;
    v_line := round(v_qty * v_price - v_disc, 2);
    if v_line < 0 then raise exception 'INVALID: line % discount exceeds the line value', v_n; end if;
    v_prod := null;
    if nullif(v_item->>'product_id','') is not null then
      select * into v_prod from products where id = (v_item->>'product_id')::uuid;
      if not found then raise exception 'INVALID: line % product not found', v_n; end if;
    end if;
    if v_prod.id is null and coalesce(btrim(v_item->>'description'),'') = '' then raise exception 'INVALID: line % needs a product or description', v_n; end if;
    insert into sale_items(sale_id, line_no, product_id, description, unit, quantity, unit_price, discount, line_total)
    values (v_id, v_n, v_prod.id,
            coalesce(nullif(btrim(v_item->>'description'),''), v_prod.name || coalesce(' ' || v_prod.dimensions,'')),
            coalesce(v_prod.unit, nullif(v_item->>'unit',''), 'pieces'), v_qty, round(v_price,2), round(v_disc,2), v_line);
    v_sub := v_sub + v_line;
  end loop;

  if coalesce(p_discount,0) > v_sub then raise exception 'INVALID: invoice discount exceeds the subtotal'; end if;
  v_total := v_sub - coalesce(p_discount,0) + coalesce(p_transport,0);
  select coalesce((value->>'customer_days')::int, 30) into v_days from settings where key = 'credit_terms';

  update sales set customer_id = p_customer_id, sale_date = p_date, subtotal = v_sub, discount = round(coalesce(p_discount,0),2),
    transport_charge = round(coalesce(p_transport,0),2), total = round(v_total,2),
    due_date = coalesce(p_due_date, p_date + coalesce(v_days,30)), delivery_address = nullif(btrim(p_delivery_address),''), notes = nullif(btrim(p_notes),'')
  where id = v_id;

  if p_confirm then
    if v_total <= 0 then raise exception 'INVALID: invoice total must be greater than zero'; end if;
    select coalesce(value->>'invoice_prefix','INV') into v_prefix from settings where key = 'numbering';
    update sales set status = 'confirmed', sale_no = coalesce(sale_no, coalesce(v_prefix,'INV') || '-' || lpad(nextval('public.sale_seq')::text, 6, '0')) where id = v_id;

    if p_payment is not null and coalesce((p_payment->>'amount')::numeric,0) > 0 then
      v_pay := round((p_payment->>'amount')::numeric,2); v_acc := (p_payment->>'account_id')::uuid;
      if v_pay > v_total then raise exception 'INVALID: payment at sale cannot exceed the invoice total'; end if;
      select coalesce(value->>'receipt_prefix','RCT') into v_prefix from settings where key = 'numbering';
      v_rcpt := coalesce(v_prefix,'RCT') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0');
      v_txn := public._post_txn('customer_payment', p_date, v_acc, v_pay,
                 'Payment for ' || (select sale_no from sales where id = v_id) || ' — ' || v_cust.name, p_customer_id, null, v_id,
                 nullif(p_payment->>'method',''), nullif(p_payment->>'reference',''), null, '[]'::jsonb, null, v_rcpt);
      perform public._allocate_customer(v_txn, p_customer_id, jsonb_build_array(jsonb_build_object('sale_id', v_id, 'amount', v_pay)), false);
    end if;
    perform public._audit('confirm','sales',v_id::text,null,(select to_jsonb(s) from sales s where id = v_id),null);
  else
    perform public._audit(case when p_sale_id is null then 'create_draft' else 'update_draft' end,'sales',v_id::text,null,jsonb_build_object('total',v_total),null);
  end if;
  return v_id;
end $$;

create or replace function public.cancel_sale(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not public.has_perm('sales','edit') then raise exception 'FORBIDDEN: you may not cancel sales'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to cancel a sale'; end if;
  select * into s from sales where id = p_id for update;
  if not found then raise exception 'INVALID: sale not found'; end if;
  if s.status = 'cancelled' then raise exception 'INVALID: sale is already cancelled'; end if;
  if s.amount_paid > 0 then raise exception 'INVALID: this invoice has payments — reverse the payments first, then cancel'; end if;
  if s.delivery_status in ('dispatched','delivered') then raise exception 'INVALID: goods were already dispatched — cannot cancel'; end if;
  update sales set status = 'cancelled', delivery_status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now() where id = p_id;
  perform public._audit('cancel','sales',p_id::text,to_jsonb(s),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

create or replace function public.set_delivery_status(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not (public.has_perm('sales','edit') or public.has_perm('inventory','edit')) then raise exception 'FORBIDDEN: you may not update delivery'; end if;
  if p_status not in ('pending','loading','dispatched','delivered') then raise exception 'INVALID: unknown delivery status'; end if;
  select * into s from sales where id = p_id for update;
  if not found or s.status <> 'confirmed' then raise exception 'INVALID: only confirmed invoices have delivery tracking'; end if;
  update sales set delivery_status = p_status where id = p_id;
  perform public._audit('delivery','sales',p_id::text,jsonb_build_object('delivery_status',s.delivery_status),jsonb_build_object('delivery_status',p_status),null);
end $$;

create or replace function public.update_sale_details(p_id uuid, p_due_date date, p_notes text, p_delivery_address text) returns void
language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not public.has_perm('sales','edit') then raise exception 'FORBIDDEN: you may not edit sales'; end if;
  select * into s from sales where id = p_id for update;
  if not found or s.status = 'cancelled' then raise exception 'INVALID: sale not found or cancelled'; end if;
  update sales set due_date = coalesce(p_due_date, due_date), notes = nullif(btrim(p_notes),''), delivery_address = nullif(btrim(p_delivery_address),'') where id = p_id;
  perform public._audit('update_details','sales',p_id::text,jsonb_build_object('due_date',s.due_date,'notes',s.notes),jsonb_build_object('due_date',p_due_date,'notes',p_notes),null);
end $$;

-- ---------- customer payments ---------------------------------------
create or replace function public.record_customer_payment(
  p_customer_id uuid, p_account_id uuid, p_amount numeric, p_date date, p_method text default null, p_reference text default null,
  p_notes text default null, p_allocations jsonb default '[]'::jsonb, p_auto boolean default true, p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cust customers; v_txn uuid; v_rcpt text; v_prefix text; v_used numeric; v_existing transactions;
begin
  if not (public.has_perm('debts','create') or public.has_perm('sales','create')) then raise exception 'FORBIDDEN: you may not record customer payments'; end if;
  select * into v_cust from customers where id = p_customer_id;
  if not found then raise exception 'INVALID: select a customer'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from transactions where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('txn_id', v_existing.id, 'receipt_no', v_existing.receipt_no, 'allocated',
        (select coalesce(sum(amount),0) from payment_allocations where payment_txn_id = v_existing.id and not reversed), 'unallocated', 0, 'duplicate', true); end if;
  end if;
  select coalesce(value->>'receipt_prefix','RCT') into v_prefix from settings where key = 'numbering';
  v_rcpt := coalesce(v_prefix,'RCT') || '-' || lpad(nextval('public.receipt_seq')::text, 6, '0');
  v_txn := public._post_txn('customer_payment', p_date, p_account_id, p_amount, 'Payment from ' || v_cust.name, p_customer_id, null, null, p_method, p_reference, p_notes, '[]'::jsonb, p_idempotency_key, v_rcpt);
  v_used := public._allocate_customer(v_txn, p_customer_id, p_allocations, p_auto);
  perform public._audit('create','transactions',v_txn::text,null,jsonb_build_object('type','customer_payment','customer',v_cust.name,'amount',p_amount,'allocated',v_used,'receipt',v_rcpt),null);
  return jsonb_build_object('txn_id', v_txn, 'receipt_no', v_rcpt, 'allocated', v_used, 'unallocated', round(p_amount,2) - v_used);
end $$;

-- apply an existing unallocated payment (customer credit) to invoices
create or replace function public.allocate_customer_payment(p_txn_id uuid, p_allocations jsonb, p_auto boolean default false) returns numeric
language plpgsql security definer set search_path = public as $$
declare t transactions;
begin
  if not (public.has_perm('debts','create') or public.has_perm('sales','create')) then raise exception 'FORBIDDEN'; end if;
  select * into t from transactions where id = p_txn_id;
  if not found or t.type <> 'customer_payment' then raise exception 'INVALID: payment not found'; end if;
  return public._allocate_customer(p_txn_id, t.customer_id, p_allocations, p_auto);
end $$;

-- ---------- supplier invoices & payments -----------------------------
create or replace function public.record_supplier_invoice(
  p_supplier_id uuid, p_invoice_no text, p_date date, p_due_date date, p_kind text, p_category_id uuid, p_description text, p_amount numeric,
  p_notes text default null, p_attachments jsonb default '[]'::jsonb, p_payment jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup suppliers; v_id uuid; v_days int; v_txn uuid; v_pay numeric; v_existing uuid; v_cat transaction_categories;
begin
  if not public.has_perm('suppliers','create') then raise exception 'FORBIDDEN: you may not record supplier invoices'; end if;
  select * into v_sup from suppliers where id = p_supplier_id;
  if not found then raise exception 'INVALID: select a supplier'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_kind not in ('materials','expense') then raise exception 'INVALID: kind must be materials or expense'; end if;
  if p_description is null or btrim(p_description) = '' then raise exception 'INVALID: description is required'; end if;
  if p_kind = 'expense' then
    select * into v_cat from transaction_categories where id = p_category_id;
    if not found or v_cat.kind <> 'expense' then raise exception 'INVALID: choose an expense category'; end if;
  end if;
  if p_idempotency_key is not null then
    select id into v_existing from supplier_invoices where idempotency_key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;
  select coalesce((value->>'supplier_days')::int,30) into v_days from settings where key = 'credit_terms';
  insert into supplier_invoices(supplier_id, supplier_invoice_no, invoice_date, due_date, kind, category_id, description, amount, notes, attachments, idempotency_key, created_by)
  values (p_supplier_id, nullif(btrim(p_invoice_no),''), p_date, coalesce(p_due_date, p_date + coalesce(v_days,30)), p_kind, case when p_kind='expense' then p_category_id end,
          btrim(p_description), round(p_amount,2), nullif(btrim(p_notes),''), coalesce(p_attachments,'[]'::jsonb), p_idempotency_key, auth.uid())
  returning id into v_id;
  if p_payment is not null and coalesce((p_payment->>'amount')::numeric,0) > 0 then
    v_pay := round((p_payment->>'amount')::numeric,2);
    if v_pay > p_amount then raise exception 'INVALID: payment cannot exceed the invoice amount'; end if;
    v_txn := public._post_txn('supplier_payment', p_date, (p_payment->>'account_id')::uuid, v_pay,
               'Payment to ' || v_sup.name || ' — ' || (select purchase_no from supplier_invoices where id = v_id), null, p_supplier_id, null,
               nullif(p_payment->>'method',''), nullif(p_payment->>'reference',''), null, '[]'::jsonb, null, null);
    perform public._allocate_supplier(v_txn, p_supplier_id, jsonb_build_array(jsonb_build_object('invoice_id', v_id, 'amount', v_pay)), false);
  end if;
  perform public._audit('create','supplier_invoices',v_id::text,null,(select to_jsonb(i) from supplier_invoices i where id = v_id),null);
  return v_id;
end $$;

create or replace function public.cancel_supplier_invoice(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare i supplier_invoices;
begin
  if not public.has_perm('suppliers','edit') then raise exception 'FORBIDDEN: you may not cancel supplier invoices'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into i from supplier_invoices where id = p_id for update;
  if not found or i.status = 'cancelled' then raise exception 'INVALID: invoice not found or already cancelled'; end if;
  if i.amount_paid > 0 then raise exception 'INVALID: this invoice has payments — reverse the payments first'; end if;
  update supplier_invoices set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  perform public._audit('cancel','supplier_invoices',p_id::text,to_jsonb(i),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

create or replace function public.record_supplier_payment(
  p_supplier_id uuid, p_account_id uuid, p_amount numeric, p_date date, p_method text default null, p_reference text default null,
  p_notes text default null, p_allocations jsonb default '[]'::jsonb, p_auto boolean default true, p_idempotency_key uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sup suppliers; v_txn uuid; v_used numeric; v_existing transactions;
begin
  if not public.has_perm('suppliers','create') then raise exception 'FORBIDDEN: you may not pay suppliers'; end if;
  select * into v_sup from suppliers where id = p_supplier_id;
  if not found then raise exception 'INVALID: select a supplier'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from transactions where idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('txn_id', v_existing.id, 'allocated', 0, 'unallocated', 0, 'duplicate', true); end if;
  end if;
  v_txn := public._post_txn('supplier_payment', p_date, p_account_id, p_amount, 'Payment to ' || v_sup.name, null, p_supplier_id, null, p_method, p_reference, p_notes, '[]'::jsonb, p_idempotency_key, null);
  v_used := public._allocate_supplier(v_txn, p_supplier_id, p_allocations, p_auto);
  perform public._audit('create','transactions',v_txn::text,null,jsonb_build_object('type','supplier_payment','supplier',v_sup.name,'amount',p_amount,'allocated',v_used),null);
  return jsonb_build_object('txn_id', v_txn, 'allocated', v_used, 'unallocated', round(p_amount,2) - v_used);
end $$;

-- ---------- balance & aging views -----------------------------------
create or replace view public.customer_balances as
select c.id, c.customer_no, c.name, c.phone, c.email, c.location, c.customer_type, c.notes, c.status, c.created_at,
  coalesce(s.invoiced,0) as total_purchases, coalesce(s.outstanding,0) as outstanding, coalesce(s.overdue,0) as overdue, s.last_sale,
  coalesce(p.paid,0) as total_payments, p.last_payment,
  coalesce(p.paid,0) - coalesce(a.allocated,0) - coalesce(r.refunds,0) as credit_balance
from public.customers c
left join lateral (select sum(total) invoiced, sum(total - amount_paid) outstanding,
     sum(case when due_date < public._kampala_today() then total - amount_paid else 0 end) overdue, max(sale_date) last_sale
     from public.sales where customer_id = c.id and status = 'confirmed') s on true
left join lateral (select sum(amount) paid, max(txn_date) last_payment from public.transactions
     where customer_id = c.id and type = 'customer_payment' and status = 'posted' and not is_reversal) p on true
left join lateral (select sum(pa.amount) allocated from public.payment_allocations pa join public.transactions t on t.id = pa.payment_txn_id
     where t.customer_id = c.id and not pa.reversed) a on true
left join lateral (select sum(amount) refunds from public.transactions where customer_id = c.id and type = 'refund' and status = 'posted' and not is_reversal) r on true
where public.has_perm('customers','view') or public.has_perm('debts','view') or public.has_perm('sales','view');

create or replace view public.supplier_balances as
select s.id, s.supplier_no, s.name, s.phone, s.location, s.contact_person, s.supplied_materials, s.notes, s.status, s.created_at,
  coalesce(i.invoiced,0) as total_purchases, coalesce(i.outstanding,0) as outstanding, coalesce(i.overdue,0) as overdue, i.last_invoice,
  coalesce(p.paid,0) as total_payments, p.last_payment,
  coalesce(p.paid,0) - coalesce(a.allocated,0) as credit_balance
from public.suppliers s
left join lateral (select sum(amount) invoiced, sum(amount - amount_paid) outstanding,
     sum(case when due_date < public._kampala_today() then amount - amount_paid else 0 end) overdue, max(invoice_date) last_invoice
     from public.supplier_invoices where supplier_id = s.id and status = 'open') i on true
left join lateral (select sum(amount) paid, max(txn_date) last_payment from public.transactions
     where supplier_id = s.id and type = 'supplier_payment' and status = 'posted' and not is_reversal) p on true
left join lateral (select sum(pa.amount) allocated from public.supplier_payment_allocations pa join public.transactions t on t.id = pa.payment_txn_id
     where t.supplier_id = s.id and not pa.reversed) a on true
where public.has_perm('suppliers','view');

create or replace view public.receivables as
select s.id as sale_id, s.sale_no, s.customer_id, c.name as customer_name, c.phone as customer_phone, s.sale_date, s.due_date, s.total, s.amount_paid, s.balance,
  greatest(0, public._kampala_today() - s.due_date) as days_overdue,
  case when s.due_date is null or s.due_date >= public._kampala_today() then 'current'
       when public._kampala_today() - s.due_date <= 30 then '1-30' when public._kampala_today() - s.due_date <= 60 then '31-60'
       when public._kampala_today() - s.due_date <= 90 then '61-90' else '90+' end as aging_bucket,
  case when s.balance > 0 and s.due_date < public._kampala_today() then 'overdue' else s.payment_status end as effective_status
from public.sales s join public.customers c on c.id = s.customer_id
where s.status = 'confirmed' and s.balance > 0 and (public.has_perm('debts','view') or public.has_perm('sales','view'));

create or replace view public.payables as
select i.id as invoice_id, i.purchase_no, i.supplier_invoice_no, i.supplier_id, s.name as supplier_name, i.invoice_date, i.due_date, i.kind, i.description, i.amount, i.amount_paid, i.balance,
  greatest(0, public._kampala_today() - i.due_date) as days_overdue,
  case when i.due_date is null or i.due_date >= public._kampala_today() then 'current'
       when public._kampala_today() - i.due_date <= 30 then '1-30' when public._kampala_today() - i.due_date <= 60 then '31-60'
       when public._kampala_today() - i.due_date <= 90 then '61-90' else '90+' end as aging_bucket,
  case when i.balance > 0 and i.due_date < public._kampala_today() then 'overdue' else i.payment_status end as effective_status
from public.supplier_invoices i join public.suppliers s on s.id = i.supplier_id
where i.status = 'open' and i.balance > 0 and public.has_perm('suppliers','view');

-- ---------- statements ----------------------------------------------
create or replace function public.customer_statement(p_customer uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rows jsonb; v_cust customers;
begin
  if not (public.has_perm('customers','view') or public.has_perm('debts','view') or public.has_perm('sales','view')) then raise exception 'FORBIDDEN'; end if;
  select * into v_cust from customers where id = p_customer;
  if not found then raise exception 'INVALID: customer not found'; end if;
  with ev as (
    select s.sale_date d, s.created_at ts, 'invoice'::text kind, s.sale_no ref, 'Invoice ' || s.sale_no descr, s.total debit, 0::numeric credit
      from sales s where s.customer_id = p_customer and s.status = 'confirmed'
    union all select t.txn_date, t.created_at, 'payment', coalesce(t.receipt_no, t.txn_no), 'Payment received' || coalesce(' (' || t.payment_method || ')',''), 0, t.amount
      from transactions t where t.customer_id = p_customer and t.type = 'customer_payment' and t.status = 'posted' and not t.is_reversal
    union all select t.txn_date, t.created_at, 'refund', t.txn_no, 'Refund paid', t.amount, 0
      from transactions t where t.customer_id = p_customer and t.type = 'refund' and t.status = 'posted' and not t.is_reversal),
  pre as (select coalesce(sum(debit - credit),0) o from ev where d < p_from),
  rws as (select e.*, (select o from pre) + sum(debit - credit) over (order by d, ts, ref rows between unbounded preceding and current row) run
            from ev e where d between p_from and p_to)
  select (select o from pre),
         coalesce(jsonb_agg(jsonb_build_object('date', d, 'kind', kind, 'ref', ref, 'description', descr, 'debit', debit, 'credit', credit, 'balance', run) order by d, ts, ref), '[]'::jsonb)
    into v_open, v_rows from rws;
  return jsonb_build_object('customer', jsonb_build_object('id', v_cust.id, 'name', v_cust.name, 'phone', v_cust.phone, 'location', v_cust.location, 'customer_no', v_cust.customer_no),
    'opening', v_open, 'rows', v_rows, 'closing', coalesce((v_rows->-1->>'balance')::numeric, v_open));
end $$;

create or replace function public.supplier_statement(p_supplier uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rows jsonb; v_sup suppliers;
begin
  if not public.has_perm('suppliers','view') then raise exception 'FORBIDDEN'; end if;
  select * into v_sup from suppliers where id = p_supplier;
  if not found then raise exception 'INVALID: supplier not found'; end if;
  with ev as (
    select i.invoice_date d, i.created_at ts, i.purchase_no ref, 'Invoice ' || coalesce(i.supplier_invoice_no, i.purchase_no) || ' — ' || i.description descr, i.amount credit, 0::numeric debit
      from supplier_invoices i where i.supplier_id = p_supplier and i.status = 'open'
    union all select t.txn_date, t.created_at, t.txn_no, 'Payment made' || coalesce(' (' || t.payment_method || ')',''), 0, t.amount
      from transactions t where t.supplier_id = p_supplier and t.type = 'supplier_payment' and t.status = 'posted' and not t.is_reversal),
  pre as (select coalesce(sum(credit - debit),0) o from ev where d < p_from),
  rws as (select e.*, (select o from pre) + sum(credit - debit) over (order by d, ts, ref rows between unbounded preceding and current row) run
            from ev e where d between p_from and p_to)
  select (select o from pre),
         coalesce(jsonb_agg(jsonb_build_object('date', d, 'ref', ref, 'description', descr, 'invoiced', credit, 'paid', debit, 'balance', run) order by d, ts, ref), '[]'::jsonb)
    into v_open, v_rows from rws;
  return jsonb_build_object('supplier', jsonb_build_object('id', v_sup.id, 'name', v_sup.name, 'phone', v_sup.phone, 'supplier_no', v_sup.supplier_no),
    'opening', v_open, 'rows', v_rows, 'closing', coalesce((v_rows->-1->>'balance')::numeric, v_open));
end $$;

-- ---------- revenue / expense event views (internal) ---------------
create or replace view public._revenue_events as
  select t.txn_date as d, t.amount, coalesce(c.name, 'Other income') as label from public.transactions t left join public.transaction_categories c on c.id = t.category_id
   where t.type = 'income' and t.status = 'posted' and not t.is_reversal
  union all select s.sale_date, s.total, 'Invoiced sales' from public.sales s where s.status = 'confirmed';
create or replace view public._expense_events as
  select t.txn_date as d, t.amount, coalesce(c.name, 'Uncategorised') as label from public.transactions t left join public.transaction_categories c on c.id = t.category_id
   where t.type = 'expense' and t.status = 'posted' and not t.is_reversal
  union all select i.invoice_date, i.amount, coalesce(c.name, 'Uncategorised') from public.supplier_invoices i left join public.transaction_categories c on c.id = i.category_id
   where i.kind = 'expense' and i.status = 'open';
revoke all on public._revenue_events, public._expense_events from public, anon, authenticated;

-- ---------- dashboard (replaces Phase 1 version) ---------------------
create or replace function public.dashboard_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_in numeric; v_out numeric; v_accounts jsonb; v_daily jsonb; v_monthly jsonb;
        v_exp jsonb; v_inc jsonb; v_recent jsonb; v_month_start date := date_trunc('month', p_to)::date; v_today date := public._kampala_today();
begin
  if not public.has_perm('dashboard','view') then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type,'balance',current_balance) order by name),'[]'::jsonb)
    into v_accounts from account_balances where status = 'active';

  select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end)
         from transactions t join accounts a2 on a2.id=t.account_id and a2.status='active' where t.txn_date < p_from and t.type <> 'transfer'),0)
    into v_open from accounts a where a.status = 'active';
  select coalesce(sum(case when t.direction='in' then t.amount end),0), coalesce(sum(case when t.direction='out' then t.amount end),0)
    into v_in, v_out from transactions t join accounts a on a.id=t.account_id and a.status='active' where t.txn_date between p_from and p_to and t.type <> 'transfer';

  select coalesce(jsonb_agg(jsonb_build_object('date', dd, 'money_in', mi, 'money_out', mo, 'revenue', rv, 'expenses', ex) order by dd),'[]'::jsonb) into v_daily from (
    select dd, coalesce(sum(mi),0) mi, coalesce(sum(mo),0) mo, coalesce(sum(rv),0) rv, coalesce(sum(ex),0) ex from (
      select t.txn_date dd, case when t.direction='in' and t.type<>'transfer' then t.amount end mi, case when t.direction='out' and t.type<>'transfer' then t.amount end mo, null::numeric rv, null::numeric ex
        from transactions t where t.txn_date between p_from and p_to
      union all select d, null, null, amount, null from _revenue_events where d between p_from and p_to
      union all select d, null, null, null, amount from _expense_events where d between p_from and p_to) u group by dd) x;

  select coalesce(jsonb_agg(jsonb_build_object('month', mm, 'revenue', rv, 'expenses', ex, 'money_in', mi, 'money_out', mo) order by mm),'[]'::jsonb) into v_monthly from (
    select mm, coalesce(sum(rv),0) rv, coalesce(sum(ex),0) ex, coalesce(sum(mi),0) mi, coalesce(sum(mo),0) mo from (
      select to_char(date_trunc('month', t.txn_date),'YYYY-MM') mm, null::numeric rv, null::numeric ex,
             case when t.direction='in' and t.type<>'transfer' then t.amount end mi, case when t.direction='out' and t.type<>'transfer' then t.amount end mo
        from transactions t where t.txn_date >= (date_trunc('month', p_to) - interval '11 months')::date and t.txn_date <= p_to
      union all select to_char(date_trunc('month', d),'YYYY-MM'), amount, null, null, null from _revenue_events where d >= (date_trunc('month', p_to) - interval '11 months')::date and d <= p_to
      union all select to_char(date_trunc('month', d),'YYYY-MM'), null, amount, null, null from _expense_events where d >= (date_trunc('month', p_to) - interval '11 months')::date and d <= p_to) u group by mm) y;

  select coalesce(jsonb_agg(jsonb_build_object('name',label,'amount',s) order by s desc),'[]'::jsonb) into v_exp from (select label, sum(amount) s from _expense_events where d between p_from and p_to group by 1) e;
  select coalesce(jsonb_agg(jsonb_build_object('name',label,'amount',s) order by s desc),'[]'::jsonb) into v_inc from (select label, sum(amount) s from _revenue_events where d between p_from and p_to group by 1) e;

  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'txn_no',t.txn_no,'date',t.txn_date,'type',t.type,'direction',t.direction,
           'description',t.description,'amount',t.amount,'account',a.name,'status',t.status) order by t.created_at desc),'[]'::jsonb)
    into v_recent from (select * from transactions order by created_at desc limit 8) t join accounts a on a.id=t.account_id;

  return jsonb_build_object(
    'accounts', v_accounts, 'opening', v_open, 'inflows', v_in, 'outflows', v_out, 'closing', v_open + v_in - v_out,
    'revenue', (select coalesce(sum(amount),0) from _revenue_events where d between p_from and p_to),
    'expenses', (select coalesce(sum(amount),0) from _expense_events where d between p_from and p_to),
    'collections', (select coalesce(sum(amount),0) from transactions where type='customer_payment' and status='posted' and not is_reversal and txn_date between p_from and p_to),
    'month_revenue', (select coalesce(sum(amount),0) from _revenue_events where d between v_month_start and p_to),
    'month_expenses', (select coalesce(sum(amount),0) from _expense_events where d between v_month_start and p_to),
    'receivables_total', (select coalesce(sum(balance),0) from sales where status='confirmed'),
    'receivables_overdue', (select coalesce(sum(balance),0) from sales where status='confirmed' and due_date < v_today),
    'receivables_overdue_count', (select count(*) from sales where status='confirmed' and balance > 0 and due_date < v_today),
    'payables_total', (select coalesce(sum(balance),0) from supplier_invoices where status='open'),
    'payables_overdue', (select coalesce(sum(balance),0) from supplier_invoices where status='open' and due_date < v_today),
    'payables_due_soon', (select coalesce(sum(balance),0) from supplier_invoices where status='open' and balance > 0 and due_date between v_today and v_today + 7),
    'pending_orders', (select count(*) from sales where status='confirmed' and delivery_status in ('pending','loading')),
    'sales_today', (select coalesce(sum(total),0) from sales where status='confirmed' and sale_date = v_today),
    'largest_debtors', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'outstanding',outstanding) order by outstanding desc),'[]'::jsonb)
                        from (select id, name, outstanding from customer_balances where outstanding > 0 order by outstanding desc limit 5) z),
    'daily', v_daily, 'monthly', v_monthly, 'expense_by_category', v_exp, 'income_by_category', v_inc, 'recent', v_recent);
end $$;

-- ---------- RLS & grants --------------------------------------------
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_payment_allocations enable row level security;

create policy pcat_read on public.product_categories for select using (exists (select 1 from public.user_roles where user_id = auth.uid()));
create policy pcat_write on public.product_categories for all using (public.has_perm('inventory','edit')) with check (public.has_perm('inventory','edit'));
create policy products_read on public.products for select using (exists (select 1 from public.user_roles where user_id = auth.uid()));
create policy products_ins on public.products for insert with check (public.has_perm('inventory','create'));
create policy products_upd on public.products for update using (public.has_perm('inventory','edit')) with check (public.has_perm('inventory','edit'));
create policy sales_read on public.sales for select using (public.has_perm('sales','view') or public.has_perm('customers','view') or public.has_perm('debts','view'));
create policy sale_items_read on public.sale_items for select using (public.has_perm('sales','view') or public.has_perm('customers','view') or public.has_perm('debts','view'));
create policy pa_read on public.payment_allocations for select using (public.has_perm('sales','view') or public.has_perm('customers','view') or public.has_perm('debts','view'));
create policy si_read on public.supplier_invoices for select using (public.has_perm('suppliers','view'));
create policy spa_read on public.supplier_payment_allocations for select using (public.has_perm('suppliers','view'));

revoke all on public.sales, public.sale_items, public.payment_allocations, public.supplier_invoices, public.supplier_payment_allocations from anon, authenticated;
grant select on public.sales, public.sale_items, public.payment_allocations, public.supplier_invoices, public.supplier_payment_allocations to authenticated;
grant select, insert, update on public.products, public.product_categories to authenticated;
grant select on public.customer_balances, public.supplier_balances, public.receivables, public.payables to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.save_sale(uuid,uuid,date,jsonb,numeric,numeric,date,text,text,boolean,jsonb,uuid),
  public.cancel_sale(uuid,text), public.set_delivery_status(uuid,text), public.update_sale_details(uuid,date,text,text),
  public.record_customer_payment(uuid,uuid,numeric,date,text,text,text,jsonb,boolean,uuid),
  public.allocate_customer_payment(uuid,jsonb,boolean),
  public.record_supplier_invoice(uuid,text,date,date,text,uuid,text,numeric,text,jsonb,jsonb,uuid),
  public.cancel_supplier_invoice(uuid,text),
  public.record_supplier_payment(uuid,uuid,numeric,date,text,text,text,jsonb,boolean,uuid),
  public.customer_statement(uuid,date,date), public.supplier_statement(uuid,date,date),
  public.has_perm(text,text), public.is_owner(), public.my_permissions(),
  public.record_transaction(public.txn_type,date,uuid,numeric,text,uuid,text,text,uuid,uuid,text,jsonb,uuid,public.txn_direction,boolean),
  public.record_transfer(date,uuid,uuid,numeric,text,text,text,uuid,boolean), public.reverse_transaction(uuid,text),
  public.edit_transaction(uuid,date,text,numeric,uuid,uuid,text,text,text,text,jsonb),
  public.cashbook_report(date,date,uuid,uuid,text), public.dashboard_summary(date,date),
  public.list_users(), public.set_user_access(uuid,public.app_role,boolean),
  public.seed_demo_data(), public.remove_demo_data() to authenticated;

-- views call this as the invoking user
grant execute on function public._kampala_today() to authenticated;
