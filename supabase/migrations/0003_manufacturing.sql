-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 3: manufacturing
-- Finished-goods inventory, raw materials, production batches, costing,
-- controlled stock deduction at dispatch, COGS.
--
-- COSTING MODEL (weighted average, perpetual)
--  * Every product / raw material keeps a running quantity and weighted-average
--    unit cost. Receipts (purchase, production, return, opening) blend into the
--    average; issues (consumption, dispatch, damage) leave at the current average.
--  * Raw-material purchases go to inventory (an asset), NOT expense. Materials hit
--    cost only when consumed by a production batch (at average cost). Cement, sand,
--    aggregate and stone dust are therefore blocked as direct expenses
--    (categories.tracks_inventory) so they can never be counted twice.
--  * Batch cost = materials consumed + labour/other costs attributed to the batch.
--    Those costs are paid as ledger expenses tagged with batch_id and are
--    excluded from period operating expenses; they reach profit as COGS when the
--    finished goods are dispatched. Cost incurred vs cash paid are tracked separately.
--  * Finished goods enter stock at batch_cost / accepted_qty (rejects are absorbed).
--  * Stock leaves ONCE, when a sale is dispatched/delivered (sales.stock_deducted_at).
--    Dispatch records COGS at the average cost of that moment.
--  * Stock never goes negative silently: only an authorised user can override, and the
--    movement is flagged.
-- =====================================================================

-- ---------- categories: inventory-tracked flag ----------------------
alter table public.transaction_categories add column if not exists tracks_inventory boolean not null default false;
update public.transaction_categories set tracks_inventory = true where kind = 'expense' and name in ('Cement','Sand','Aggregate','Stone dust');

create or replace function public.guard_inventory_category() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then return new; end if;
  if new.type = 'expense' and new.category_id is not null and new.batch_id is null and not new.is_reversal
     and exists (select 1 from transaction_categories c where c.id = new.category_id and c.tracks_inventory) then
    raise exception 'INVALID: this category is inventory-tracked. Record material purchases under Inventory → Receive materials so they are stocked and costed once, when used in production.';
  end if;
  return new;
end $$;
create trigger trg_guard_inventory_category before insert or update of category_id on public.transactions
  for each row execute function public.guard_inventory_category();

-- ---------- finished goods ------------------------------------------
alter table public.products add column if not exists current_stock numeric(16,3) not null default 0;
alter table public.products add column if not exists avg_cost numeric(16,4) not null default 0;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_date date not null,
  kind text not null check (kind in ('opening','production','sale','return','damage','adjustment')),
  quantity numeric(16,3) not null check (quantity <> 0),            -- signed: + in, - out
  unit_cost numeric(16,4) not null default 0,
  balance_after numeric(16,3) not null,
  source_type text,                                                  -- production_batch | sale | manual
  source_id uuid,
  note text,
  flagged_negative boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index inv_mov_product_idx on public.inventory_movements(product_id, movement_date, created_at);
create index inv_mov_date_idx on public.inventory_movements(movement_date);
create index inv_mov_source_idx on public.inventory_movements(source_type, source_id);

alter table public.sales add column if not exists stock_deducted_at timestamptz;

-- ---------- raw materials -------------------------------------------
create sequence public.material_seq;
create table public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  material_no text unique not null default ('MAT-' || lpad(nextval('public.material_seq')::text, 4, '0')),
  name text not null unique check (length(btrim(name)) > 0),
  unit text not null,
  min_stock numeric(16,3) not null default 0 check (min_stock >= 0),
  current_stock numeric(16,3) not null default 0,
  unit_cost numeric(16,4) not null default 0,                         -- weighted average
  default_supplier_id uuid references public.suppliers(id),
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_materials_touch before update on public.raw_materials for each row execute function public.touch_updated();

create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.raw_materials(id),
  movement_date date not null,
  kind text not null check (kind in ('opening','purchase','consumption','return','damage','adjustment')),
  quantity numeric(16,3) not null check (quantity <> 0),
  unit_cost numeric(16,4) not null default 0,
  balance_after numeric(16,3) not null,
  source_type text,                                                  -- supplier_invoice | production_batch | manual
  source_id uuid,
  supplier_id uuid references public.suppliers(id),
  note text,
  flagged_negative boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index mat_mov_idx on public.material_movements(material_id, movement_date, created_at);
create index mat_mov_source_idx on public.material_movements(source_type, source_id);

insert into public.raw_materials(name, unit) values ('Cement','bags'),('Sand','tonnes'),('Aggregate','tonnes'),('Stone dust','tonnes'),('Water','litres'),('Fuel','litres') on conflict do nothing;

-- ---------- production ----------------------------------------------
create sequence public.batch_seq;
create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text unique not null default ('BATCH-' || lpad(nextval('public.batch_seq')::text, 6, '0')),
  production_date date not null,
  product_id uuid not null references public.products(id),
  qty_planned numeric(16,3) not null check (qty_planned > 0),
  qty_produced numeric(16,3) not null default 0 check (qty_produced >= 0),
  qty_rejected numeric(16,3) not null default 0 check (qty_rejected >= 0),
  qty_accepted numeric(16,3) generated always as (qty_produced - qty_rejected) stored,
  status text not null default 'planned' check (status in ('planned','in_progress','completed','cancelled')),
  supervisor text,
  material_cost numeric(16,2) not null default 0,
  other_cost numeric(16,2) not null default 0,                        -- labour + other, not voided
  total_cost numeric(16,2) generated always as (material_cost + other_cost) stored,
  cost_per_unit numeric(16,4),
  completed_date date,
  notes text,
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (qty_rejected <= qty_produced)
);
create index batches_date_idx on public.production_batches(production_date);
create index batches_product_idx on public.production_batches(product_id);
create trigger trg_batches_touch before update on public.production_batches for each row execute function public.touch_updated();

create table public.production_materials (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id),
  material_id uuid not null references public.raw_materials(id),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_cost numeric(16,4) not null,
  total_cost numeric(16,2) not null,
  reversed boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index pm_batch_idx on public.production_materials(batch_id);

-- labour and other production costs: incurred (always) vs paid (optional, later)
create table public.production_costs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id),
  kind text not null check (kind in ('labour','other')),
  description text not null,
  worker_name text,
  amount numeric(16,2) not null check (amount > 0),
  paid boolean not null default false,
  paid_txn_id uuid references public.transactions(id),
  voided boolean not null default false,
  void_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index pc_batch_idx on public.production_costs(batch_id);

-- ---------- ledger guards for stock tables --------------------------
create or replace function public.guard_stock_tables() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('frane.stock_write', true), '') <> 'on' then
    raise exception 'LEDGER_PROTECTED: stock can only be changed through controlled functions';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_guard_inv_mov before insert or update or delete on public.inventory_movements for each row execute function public.guard_stock_tables();
create trigger trg_guard_mat_mov before insert or update or delete on public.material_movements for each row execute function public.guard_stock_tables();

-- cached stock columns may only be written by stock functions
create or replace function public.guard_stock_cache() returns trigger language plpgsql as $$
begin
  if (new.current_stock is distinct from old.current_stock or new.avg_cost is distinct from old.avg_cost) and coalesce(current_setting('frane.stock_write', true), '') <> 'on' then
    raise exception 'LEDGER_PROTECTED: stock quantity and cost are maintained by stock movements';
  end if;
  return new;
end $$;
create trigger trg_guard_product_cache before update on public.products for each row execute function public.guard_stock_cache();
create or replace function public.guard_material_cache() returns trigger language plpgsql as $$
begin
  if (new.current_stock is distinct from old.current_stock or new.unit_cost is distinct from old.unit_cost) and coalesce(current_setting('frane.stock_write', true), '') <> 'on' then
    raise exception 'LEDGER_PROTECTED: stock quantity and cost are maintained by stock movements';
  end if;
  return new;
end $$;
create trigger trg_guard_material_cache before update on public.raw_materials for each row execute function public.guard_material_cache();

-- products audit: log configuration edits, not every stock movement
drop trigger if exists trg_audit_products on public.products;
create trigger trg_audit_products after insert or delete or update of sku, name, category_id, dimensions, description, unit, selling_price, production_cost_estimate, min_stock, status
  on public.products for each row execute function public.audit_row();
create trigger trg_audit_materials after insert or delete or update of name, unit, min_stock, default_supplier_id, status on public.raw_materials for each row execute function public.audit_row();

-- ---------- internal stock posting (weighted average) ---------------
create or replace function public._post_stock(
  p_product uuid, p_date date, p_kind text, p_qty numeric, p_unit_cost numeric, p_source_type text, p_source_id uuid, p_note text, p_allow_negative boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare p products; v_cost numeric; v_new numeric; v_avg numeric; v_neg boolean := false; v_id uuid;
begin
  if p_qty is null or p_qty = 0 then raise exception 'INVALID: quantity must not be zero'; end if;
  select * into p from products where id = p_product for update;
  if not found then raise exception 'INVALID: product not found'; end if;
  v_new := p.current_stock + p_qty;
  if p_qty > 0 then
    v_cost := coalesce(p_unit_cost, p.avg_cost);
    v_avg := case when v_new > 0 then round((greatest(p.current_stock, 0) * p.avg_cost + p_qty * v_cost) / (greatest(p.current_stock, 0) + p_qty), 4) else v_cost end;
  else
    v_cost := p.avg_cost; v_avg := p.avg_cost;
    if v_new < 0 then
      if not p_allow_negative then raise exception 'INSUFFICIENT_STOCK: only % % of % in stock', p.current_stock, p.unit, p.name; end if;
      v_neg := true;
    end if;
  end if;
  perform set_config('frane.stock_write','on',true);
  insert into inventory_movements(product_id, movement_date, kind, quantity, unit_cost, balance_after, source_type, source_id, note, flagged_negative, created_by)
    values (p_product, p_date, p_kind, p_qty, v_cost, v_new, p_source_type, p_source_id, p_note, v_neg, auth.uid()) returning id into v_id;
  update products set current_stock = v_new, avg_cost = v_avg where id = p_product;
  return v_id;
end $$;

create or replace function public._post_material(
  p_material uuid, p_date date, p_kind text, p_qty numeric, p_unit_cost numeric, p_source_type text, p_source_id uuid, p_supplier uuid, p_note text, p_allow_negative boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare m raw_materials; v_cost numeric; v_new numeric; v_avg numeric; v_neg boolean := false; v_id uuid;
begin
  if p_qty is null or p_qty = 0 then raise exception 'INVALID: quantity must not be zero'; end if;
  select * into m from raw_materials where id = p_material for update;
  if not found then raise exception 'INVALID: material not found'; end if;
  v_new := m.current_stock + p_qty;
  if p_qty > 0 then
    v_cost := coalesce(p_unit_cost, m.unit_cost);
    v_avg := case when v_new > 0 then round((greatest(m.current_stock, 0) * m.unit_cost + p_qty * v_cost) / (greatest(m.current_stock, 0) + p_qty), 4) else v_cost end;
  else
    v_cost := m.unit_cost; v_avg := m.unit_cost;
    if v_new < 0 then
      if not p_allow_negative then raise exception 'INSUFFICIENT_STOCK: only % % of % in stock', m.current_stock, m.unit, m.name; end if;
      v_neg := true;
    end if;
  end if;
  perform set_config('frane.stock_write','on',true);
  insert into material_movements(material_id, movement_date, kind, quantity, unit_cost, balance_after, source_type, source_id, supplier_id, note, flagged_negative, created_by)
    values (p_material, p_date, p_kind, p_qty, v_cost, v_new, p_source_type, p_source_id, p_supplier, p_note, v_neg, auth.uid()) returning id into v_id;
  update raw_materials set current_stock = v_new, unit_cost = v_avg where id = p_material;
  return v_id;
end $$;

create or replace function public._check_stock_date(p_date date) returns void language plpgsql stable as $$
begin if p_date is null or p_date > public._kampala_today() + 1 then raise exception 'INVALID: date cannot be in the future'; end if; end $$;

-- ---------- finished goods: manual movements ------------------------
create or replace function public.record_opening_stock(p_product uuid, p_qty numeric, p_unit_cost numeric, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','create') then raise exception 'FORBIDDEN: you may not record stock'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  if coalesce(p_unit_cost,0) < 0 then raise exception 'INVALID: cost cannot be negative'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_stock(p_product, coalesce(p_date, public._kampala_today()), 'opening', p_qty, coalesce(p_unit_cost,0), 'manual', null, 'Opening stock', false);
  perform public._audit('opening_stock','inventory_movements',v_id::text,null,jsonb_build_object('product',p_product,'qty',p_qty,'unit_cost',p_unit_cost),null);
  return v_id;
end $$;

create or replace function public.adjust_stock(p_product uuid, p_delta numeric, p_reason text, p_date date default null, p_allow_negative boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','edit') then raise exception 'FORBIDDEN: stock adjustments need manager rights'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required for stock adjustments'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_stock(p_product, coalesce(p_date, public._kampala_today()), 'adjustment', p_delta, null, 'manual', null, btrim(p_reason), p_allow_negative);
  perform public._audit('stock_adjustment','inventory_movements',v_id::text,null,jsonb_build_object('product',p_product,'delta',p_delta),btrim(p_reason));
  return v_id;
end $$;

create or replace function public.record_damage(p_product uuid, p_qty numeric, p_reason text, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','create') then raise exception 'FORBIDDEN: you may not record damaged stock'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_stock(p_product, coalesce(p_date, public._kampala_today()), 'damage', -p_qty, null, 'manual', null, btrim(p_reason), false);
  perform public._audit('damage','inventory_movements',v_id::text,null,jsonb_build_object('product',p_product,'qty',p_qty),btrim(p_reason));
  return v_id;
end $$;

-- A customer returns dispatched goods: back into stock at the cost they left at.
create or replace function public.record_return(p_product uuid, p_qty numeric, p_sale uuid, p_reason text, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cost numeric; v_out numeric; v_back numeric; v_id uuid;
begin
  if not (public.has_perm('inventory','create') or public.has_perm('sales','edit')) then raise exception 'FORBIDDEN: you may not record returns'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  if p_sale is not null then
    select coalesce(-sum(quantity),0), coalesce(sum(-quantity * unit_cost) / nullif(sum(-quantity),0), 0) into v_out, v_cost
      from inventory_movements where source_type = 'sale' and source_id = p_sale and product_id = p_product and kind = 'sale';
    select coalesce(sum(quantity),0) into v_back from inventory_movements where source_type = 'sale' and source_id = p_sale and product_id = p_product and kind = 'return';
    if v_out = 0 then raise exception 'INVALID: that product was not dispatched on this sale'; end if;
    if p_qty > v_out - v_back then raise exception 'INVALID: only % unit(s) can still be returned for this sale', v_out - v_back; end if;
  end if;
  v_id := public._post_stock(p_product, coalesce(p_date, public._kampala_today()), 'return', p_qty, v_cost, case when p_sale is null then 'manual' else 'sale' end, p_sale, btrim(p_reason), false);
  perform public._audit('return','inventory_movements',v_id::text,null,jsonb_build_object('product',p_product,'qty',p_qty,'sale',p_sale),btrim(p_reason));
  return v_id;
end $$;

-- ---------- controlled fulfilment (replaces Phase 2 set_delivery_status)
drop function if exists public.set_delivery_status(uuid, text);
create or replace function public.set_delivery_status(p_id uuid, p_status text, p_allow_negative boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare s sales; it record; v_note text;
begin
  if not (public.has_perm('sales','edit') or public.has_perm('inventory','edit')) then raise exception 'FORBIDDEN: you may not update delivery'; end if;
  if p_status not in ('pending','loading','dispatched','delivered') then raise exception 'INVALID: unknown delivery status'; end if;
  if p_allow_negative and not public.has_perm('inventory','edit') then raise exception 'FORBIDDEN: only a manager can dispatch stock that is not on hand'; end if;
  select * into s from sales where id = p_id for update;
  if not found or s.status <> 'confirmed' then raise exception 'INVALID: only confirmed invoices have delivery tracking'; end if;
  if s.stock_deducted_at is not null and p_status in ('pending','loading') then
    raise exception 'INVALID: goods already left stock — record a return instead of moving this order back';
  end if;
  if p_status in ('dispatched','delivered') and s.stock_deducted_at is null then
    v_note := 'Dispatched on ' || s.sale_no;
    for it in select product_id, sum(quantity) qty from sale_items where sale_id = p_id and product_id is not null group by product_id order by product_id loop
      perform public._post_stock(it.product_id, public._kampala_today(), 'sale', -it.qty, null, 'sale', p_id, v_note, p_allow_negative);
    end loop;
    update sales set stock_deducted_at = now() where id = p_id;
  end if;
  update sales set delivery_status = p_status where id = p_id;
  perform public._audit('delivery','sales',p_id::text,jsonb_build_object('delivery_status',s.delivery_status),jsonb_build_object('delivery_status',p_status,'stock_deducted',p_status in ('dispatched','delivered')),null);
end $$;

-- ---------- raw materials -------------------------------------------
create or replace function public.record_material_opening(p_material uuid, p_qty numeric, p_unit_cost numeric, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','create') then raise exception 'FORBIDDEN: you may not record stock'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  if coalesce(p_unit_cost,0) < 0 then raise exception 'INVALID: cost cannot be negative'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_material(p_material, coalesce(p_date, public._kampala_today()), 'opening', p_qty, coalesce(p_unit_cost,0), 'manual', null, null, 'Opening stock', false);
  perform public._audit('opening_stock','material_movements',v_id::text,null,jsonb_build_object('material',p_material,'qty',p_qty,'unit_cost',p_unit_cost),null);
  return v_id;
end $$;

create or replace function public.adjust_material(p_material uuid, p_delta numeric, p_reason text, p_date date default null, p_allow_negative boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','edit') then raise exception 'FORBIDDEN: stock adjustments need manager rights'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required for stock adjustments'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_material(p_material, coalesce(p_date, public._kampala_today()), 'adjustment', p_delta, null, 'manual', null, null, btrim(p_reason), p_allow_negative);
  perform public._audit('material_adjustment','material_movements',v_id::text,null,jsonb_build_object('material',p_material,'delta',p_delta),btrim(p_reason));
  return v_id;
end $$;

create or replace function public.record_material_damage(p_material uuid, p_qty numeric, p_reason text, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('inventory','create') then raise exception 'FORBIDDEN: you may not record damaged stock'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  perform public._check_stock_date(coalesce(p_date, public._kampala_today()));
  v_id := public._post_material(p_material, coalesce(p_date, public._kampala_today()), 'damage', -p_qty, null, 'manual', null, null, btrim(p_reason), false);
  perform public._audit('material_damage','material_movements',v_id::text,null,jsonb_build_object('material',p_material,'qty',p_qty),btrim(p_reason));
  return v_id;
end $$;

-- Goods receipt + supplier invoice in one step: stock goes up, a payable is created
-- (not an expense). Optional immediate payment needs supplier-payment rights.
create or replace function public.record_material_purchase(
  p_supplier uuid, p_date date, p_invoice_no text, p_due date, p_lines jsonb, p_notes text default null, p_payment jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sup suppliers; v_line jsonb; v_mat raw_materials; v_qty numeric; v_tot numeric; v_sum numeric := 0; v_id uuid; v_days int; v_existing uuid; v_names text[] := '{}'; v_pay numeric; v_txn uuid;
begin
  if not (public.has_perm('inventory','create') or public.has_perm('suppliers','create')) then raise exception 'FORBIDDEN: you may not receive materials'; end if;
  if p_payment is not null and coalesce((p_payment->>'amount')::numeric,0) > 0 and not public.has_perm('suppliers','create') then raise exception 'FORBIDDEN: only accounts staff can pay suppliers'; end if;
  select * into v_sup from suppliers where id = p_supplier;
  if not found then raise exception 'INVALID: select a supplier'; end if;
  perform public._check_stock_date(p_date);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'INVALID: add at least one material line'; end if;
  if p_idempotency_key is not null then
    select id into v_existing from supplier_invoices where idempotency_key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;
  -- validate and total first
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_mat from raw_materials where id = (v_line->>'material_id')::uuid;
    if not found then raise exception 'INVALID: material not found'; end if;
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID: quantity for % must be greater than zero', v_mat.name; end if;
    v_tot := coalesce((v_line->>'line_total')::numeric, v_qty * (v_line->>'unit_cost')::numeric);
    if v_tot is null or v_tot <= 0 then raise exception 'INVALID: enter a cost for %', v_mat.name; end if;
    v_sum := v_sum + round(v_tot,2); v_names := v_names || (v_mat.name || ' ' || v_qty || ' ' || v_mat.unit);
  end loop;
  select coalesce((value->>'supplier_days')::int,30) into v_days from settings where key = 'credit_terms';
  insert into supplier_invoices(supplier_id, supplier_invoice_no, invoice_date, due_date, kind, description, amount, notes, idempotency_key, created_by)
    values (p_supplier, nullif(btrim(p_invoice_no),''), p_date, coalesce(p_due, p_date + coalesce(v_days,30)), 'materials', left('Materials: ' || array_to_string(v_names, ', '), 300), v_sum, nullif(btrim(p_notes),''), p_idempotency_key, auth.uid())
    returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    v_tot := round(coalesce((v_line->>'line_total')::numeric, v_qty * (v_line->>'unit_cost')::numeric),2);
    perform public._post_material((v_line->>'material_id')::uuid, p_date, 'purchase', v_qty, round(v_tot / v_qty, 4), 'supplier_invoice', v_id, p_supplier, 'Purchase ' || coalesce(nullif(btrim(p_invoice_no),''), ''), false);
  end loop;
  if p_payment is not null and coalesce((p_payment->>'amount')::numeric,0) > 0 then
    v_pay := round((p_payment->>'amount')::numeric,2);
    if v_pay > v_sum then raise exception 'INVALID: payment cannot exceed the invoice amount'; end if;
    v_txn := public._post_txn('supplier_payment', p_date, (p_payment->>'account_id')::uuid, v_pay, 'Payment to ' || v_sup.name || ' — ' || (select purchase_no from supplier_invoices where id = v_id),
               null, p_supplier, null, nullif(p_payment->>'method',''), nullif(p_payment->>'reference',''), null, '[]'::jsonb, null, null);
    perform public._allocate_supplier(v_txn, p_supplier, jsonb_build_array(jsonb_build_object('invoice_id', v_id, 'amount', v_pay)), false);
  end if;
  perform public._audit('receive_materials','supplier_invoices',v_id::text,null,jsonb_build_object('supplier',v_sup.name,'amount',v_sum,'lines',p_lines),null);
  return v_id;
end $$;

-- materials invoices must go through goods receipt so stock and payables agree
create or replace function public.record_supplier_invoice(
  p_supplier_id uuid, p_invoice_no text, p_date date, p_due_date date, p_kind text, p_category_id uuid, p_description text, p_amount numeric,
  p_notes text default null, p_attachments jsonb default '[]'::jsonb, p_payment jsonb default null, p_idempotency_key uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sup suppliers; v_id uuid; v_days int; v_txn uuid; v_pay numeric; v_existing uuid; v_cat transaction_categories;
begin
  if not public.has_perm('suppliers','create') then raise exception 'FORBIDDEN: you may not record supplier invoices'; end if;
  if p_kind = 'materials' then raise exception 'INVALID: raw-material purchases are recorded with “Receive materials” so stock and the payable are created together'; end if;
  select * into v_sup from suppliers where id = p_supplier_id;
  if not found then raise exception 'INVALID: select a supplier'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_kind <> 'expense' then raise exception 'INVALID: kind must be expense'; end if;
  if p_description is null or btrim(p_description) = '' then raise exception 'INVALID: description is required'; end if;
  select * into v_cat from transaction_categories where id = p_category_id;
  if not found or v_cat.kind <> 'expense' then raise exception 'INVALID: choose an expense category'; end if;
  if v_cat.tracks_inventory then raise exception 'INVALID: % is inventory-tracked — use Receive materials', v_cat.name; end if;
  if p_idempotency_key is not null then
    select id into v_existing from supplier_invoices where idempotency_key = p_idempotency_key;
    if found then return v_existing; end if;
  end if;
  select coalesce((value->>'supplier_days')::int,30) into v_days from settings where key = 'credit_terms';
  insert into supplier_invoices(supplier_id, supplier_invoice_no, invoice_date, due_date, kind, category_id, description, amount, notes, attachments, idempotency_key, created_by)
  values (p_supplier_id, nullif(btrim(p_invoice_no),''), p_date, coalesce(p_due_date, p_date + coalesce(v_days,30)), 'expense', p_category_id,
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

-- cancelling a materials invoice must take the stock back out (only if still on hand)
create or replace function public.cancel_supplier_invoice(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare i supplier_invoices; m record;
begin
  if not public.has_perm('suppliers','edit') then raise exception 'FORBIDDEN: you may not cancel supplier invoices'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into i from supplier_invoices where id = p_id for update;
  if not found or i.status = 'cancelled' then raise exception 'INVALID: invoice not found or already cancelled'; end if;
  if i.amount_paid > 0 then raise exception 'INVALID: this invoice has payments — reverse the payments first'; end if;
  if i.kind = 'materials' then
    for m in select material_id, sum(quantity) q, sum(quantity * unit_cost) / nullif(sum(quantity),0) c from material_movements where source_type = 'supplier_invoice' and source_id = p_id and kind = 'purchase' group by material_id loop
      perform public._post_material(m.material_id, public._kampala_today(), 'adjustment', -m.q, null, 'supplier_invoice', p_id, i.supplier_id, 'Invoice cancelled: ' || btrim(p_reason), false);
    end loop;
  end if;
  update supplier_invoices set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  perform public._audit('cancel','supplier_invoices',p_id::text,to_jsonb(i),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

-- ---------- production workflow -------------------------------------
create or replace function public._recompute_batch(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update production_batches set
    material_cost = coalesce((select sum(total_cost) from production_materials where batch_id = p_id and not reversed), 0),
    other_cost = coalesce((select sum(amount) from production_costs where batch_id = p_id and not voided), 0)
  where id = p_id;
end $$;

create or replace function public.create_batch(p_product uuid, p_date date, p_qty_planned numeric, p_supervisor text default null, p_notes text default null, p_start boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('production','create') then raise exception 'FORBIDDEN: you may not create production batches'; end if;
  if p_qty_planned is null or p_qty_planned <= 0 then raise exception 'INVALID: planned quantity must be greater than zero'; end if;
  perform public._check_stock_date(p_date);
  if not exists (select 1 from products where id = p_product and status = 'active') then raise exception 'INVALID: select an active product'; end if;
  insert into production_batches(production_date, product_id, qty_planned, supervisor, notes, status, created_by)
    values (p_date, p_product, p_qty_planned, nullif(btrim(p_supervisor),''), nullif(btrim(p_notes),''), case when p_start then 'in_progress' else 'planned' end, auth.uid()) returning id into v_id;
  perform public._audit('create','production_batches',v_id::text,null,jsonb_build_object('product',p_product,'planned',p_qty_planned),null);
  return v_id;
end $$;

create or replace function public.start_batch(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare b production_batches;
begin
  if not public.has_perm('production','edit') then raise exception 'FORBIDDEN'; end if;
  select * into b from production_batches where id = p_id for update;
  if not found or b.status <> 'planned' then raise exception 'INVALID: only planned batches can be started'; end if;
  update production_batches set status = 'in_progress' where id = p_id;
  perform public._audit('start','production_batches',p_id::text,null,null,null);
end $$;

create or replace function public.add_batch_material(p_batch uuid, p_material uuid, p_qty numeric, p_allow_negative boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare b production_batches; m raw_materials; v_mov uuid; v_cost numeric; v_id uuid;
begin
  if not public.has_perm('production','create') then raise exception 'FORBIDDEN: you may not record material use'; end if;
  if p_allow_negative and not public.has_perm('inventory','edit') then raise exception 'FORBIDDEN: only a manager can use material that is not on hand'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID: quantity must be greater than zero'; end if;
  select * into b from production_batches where id = p_batch for update;
  if not found or b.status <> 'in_progress' then raise exception 'INVALID: materials can only be added to a batch that is in progress'; end if;
  select * into m from raw_materials where id = p_material;
  if not found then raise exception 'INVALID: material not found'; end if;
  v_cost := m.unit_cost;
  v_mov := public._post_material(p_material, public._kampala_today(), 'consumption', -p_qty, null, 'production_batch', p_batch, null, 'Used in ' || b.batch_no, p_allow_negative);
  insert into production_materials(batch_id, material_id, quantity, unit_cost, total_cost, created_by) values (p_batch, p_material, p_qty, v_cost, round(p_qty * v_cost, 2), auth.uid()) returning id into v_id;
  perform public._recompute_batch(p_batch);
  perform public._audit('use_material','production_batches',p_batch::text,null,jsonb_build_object('material',m.name,'qty',p_qty,'unit_cost',v_cost),null);
  return v_id;
end $$;

create or replace function public.remove_batch_material(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare pm production_materials; b production_batches;
begin
  if not public.has_perm('production','create') then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into pm from production_materials where id = p_id for update;
  if not found or pm.reversed then raise exception 'INVALID: entry not found or already removed'; end if;
  select * into b from production_batches where id = pm.batch_id for update;
  if b.status <> 'in_progress' then raise exception 'INVALID: this batch is closed'; end if;
  perform public._post_material(pm.material_id, public._kampala_today(), 'return', pm.quantity, pm.unit_cost, 'production_batch', pm.batch_id, null, 'Removed from ' || b.batch_no || ': ' || btrim(p_reason), false);
  update production_materials set reversed = true where id = p_id;
  perform public._recompute_batch(pm.batch_id);
  perform public._audit('remove_material','production_batches',pm.batch_id::text,to_jsonb(pm),null,btrim(p_reason));
end $$;

create or replace function public.add_batch_cost(
  p_batch uuid, p_kind text, p_description text, p_amount numeric, p_worker text default null, p_payment jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b production_batches; v_id uuid; v_txn uuid; v_acc accounts; v_cat transaction_categories; v_pay_date date;
begin
  if not public.has_perm('production','create') then raise exception 'FORBIDDEN: you may not record production costs'; end if;
  if p_kind not in ('labour','other') then raise exception 'INVALID: kind must be labour or other'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_description is null or btrim(p_description) = '' then raise exception 'INVALID: description is required'; end if;
  select * into b from production_batches where id = p_batch for update;
  if not found or b.status not in ('planned','in_progress') then raise exception 'INVALID: costs can only be added before the batch is completed'; end if;
  insert into production_costs(batch_id, kind, description, worker_name, amount, created_by) values (p_batch, p_kind, btrim(p_description), nullif(btrim(p_worker),''), round(p_amount,2), auth.uid()) returning id into v_id;
  if p_payment is not null and coalesce((p_payment->>'account_id'),'') <> '' then
    perform public._pay_cost(v_id, (p_payment->>'account_id')::uuid, nullif(p_payment->>'category_id','')::uuid, coalesce(nullif(p_payment->>'date','')::date, public._kampala_today()), nullif(p_payment->>'method',''), nullif(p_payment->>'reference',''));
  end if;
  perform public._recompute_batch(p_batch);
  perform public._audit('add_cost','production_batches',p_batch::text,null,jsonb_build_object('kind',p_kind,'amount',p_amount,'paid',p_payment is not null),null);
  return v_id;
end $$;

-- cash paid for a batch cost: a ledger expense tagged with the batch (kept out of period opex)
create or replace function public._pay_cost(p_cost uuid, p_account uuid, p_category uuid, p_date date, p_method text, p_ref text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c production_costs; b production_batches; v_acc accounts; v_cat transaction_categories; v_txn uuid;
begin
  if not public.has_perm('transactions','create') then raise exception 'FORBIDDEN: only staff who can record payments may pay production costs'; end if;
  select * into c from production_costs where id = p_cost for update;
  if not found or c.voided or c.paid then raise exception 'INVALID: cost not found, voided or already paid'; end if;
  select * into b from production_batches where id = c.batch_id;
  select * into v_cat from transaction_categories where id = p_category;
  if not found or v_cat.kind <> 'expense' or not v_cat.is_active then raise exception 'INVALID: choose an expense category (e.g. Labour, Casual labour)'; end if;
  perform public._check_stock_date(p_date);
  select * into v_acc from accounts where id = p_account for update;
  if not found or v_acc.status <> 'active' then raise exception 'INVALID: select an active account'; end if;
  if not v_acc.allow_negative and public._account_balance(p_account) - c.amount < 0 then raise exception 'INSUFFICIENT_FUNDS: % has only UGX % available', v_acc.name, public._account_balance(p_account); end if;
  perform set_config('frane.ledger_write','on',true);
  insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,reference,batch_id,recorded_by)
    values (p_date,'expense','out',p_category,b.batch_no || ' ' || c.kind || ': ' || c.description,c.amount,p_account,p_method,nullif(btrim(p_ref),''),b.id,auth.uid()) returning id into v_txn;
  update production_costs set paid = true, paid_txn_id = v_txn where id = p_cost;
  return v_txn;
end $$;

create or replace function public.pay_batch_cost(p_cost uuid, p_account uuid, p_category uuid, p_date date default null, p_method text default null, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_txn uuid;
begin
  v_txn := public._pay_cost(p_cost, p_account, p_category, coalesce(p_date, public._kampala_today()), p_method, p_ref);
  perform public._audit('pay_cost','production_costs',p_cost::text,null,jsonb_build_object('txn',v_txn),null);
  return v_txn;
end $$;

create or replace function public.void_batch_cost(p_cost uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare c production_costs; b production_batches;
begin
  if not public.has_perm('production','create') then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into c from production_costs where id = p_cost for update;
  if not found or c.voided then raise exception 'INVALID: cost not found or already voided'; end if;
  select * into b from production_batches where id = c.batch_id for update;
  if b.status not in ('planned','in_progress') then raise exception 'INVALID: this batch is closed'; end if;
  if c.paid then raise exception 'INVALID: this cost has been paid — reverse the payment transaction first'; end if;
  update production_costs set voided = true, void_reason = btrim(p_reason) where id = p_cost;
  perform public._recompute_batch(c.batch_id);
  perform public._audit('void_cost','production_costs',p_cost::text,to_jsonb(c),null,btrim(p_reason));
end $$;

create or replace function public.on_txn_reversed_prod() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'posted' and new.status = 'reversed' then
    update production_costs set paid = false, paid_txn_id = null where paid_txn_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_txn_reversed_prod after update of status on public.transactions for each row execute function public.on_txn_reversed_prod();

create or replace function public.complete_batch(p_id uuid, p_produced numeric, p_rejected numeric, p_date date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b production_batches; v_acc numeric; v_cpu numeric; v_date date := coalesce(p_date, public._kampala_today());
begin
  if not public.has_perm('production','edit') then raise exception 'FORBIDDEN: you may not complete batches'; end if;
  if p_produced is null or p_produced <= 0 then raise exception 'INVALID: enter the quantity actually produced'; end if;
  if coalesce(p_rejected,0) < 0 or coalesce(p_rejected,0) > p_produced then raise exception 'INVALID: rejected quantity must be between 0 and the produced quantity'; end if;
  perform public._check_stock_date(v_date);
  select * into b from production_batches where id = p_id for update;
  if not found or b.status <> 'in_progress' then raise exception 'INVALID: only batches in progress can be completed'; end if;
  perform public._recompute_batch(p_id);
  select * into b from production_batches where id = p_id;
  v_acc := p_produced - coalesce(p_rejected,0);
  v_cpu := case when v_acc > 0 then round(b.total_cost / v_acc, 4) else null end;
  update production_batches set qty_produced = p_produced, qty_rejected = coalesce(p_rejected,0), status = 'completed', completed_date = v_date, cost_per_unit = v_cpu where id = p_id;
  if v_acc > 0 then
    perform public._post_stock(b.product_id, v_date, 'production', v_acc, coalesce(v_cpu, 0), 'production_batch', p_id, 'Produced in ' || b.batch_no, false);
    if v_cpu > 0 then update products set production_cost_estimate = round(v_cpu, 2) where id = b.product_id; end if;
  end if;
  perform public._audit('complete','production_batches',p_id::text,null,jsonb_build_object('produced',p_produced,'rejected',coalesce(p_rejected,0),'total_cost',b.total_cost,'cost_per_unit',v_cpu),null);
  return jsonb_build_object('accepted', v_acc, 'total_cost', b.total_cost, 'cost_per_unit', v_cpu, 'costing_complete', b.total_cost > 0);
end $$;

create or replace function public.cancel_batch(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b production_batches; pm record; c production_costs;
begin
  if not public.has_perm('production','edit') then raise exception 'FORBIDDEN'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required'; end if;
  select * into b from production_batches where id = p_id for update;
  if not found or b.status not in ('planned','in_progress') then raise exception 'INVALID: only planned or in-progress batches can be cancelled'; end if;
  for pm in select * from production_materials where batch_id = p_id and not reversed loop
    perform public._post_material(pm.material_id, public._kampala_today(), 'return', pm.quantity, pm.unit_cost, 'production_batch', p_id, null, 'Returned: ' || b.batch_no || ' cancelled', false);
    update production_materials set reversed = true where id = pm.id;
  end loop;
  for c in select * from production_costs where batch_id = p_id and not voided loop
    if not c.paid then update production_costs set voided = true, void_reason = 'Batch cancelled' where id = c.id; end if;
  end loop;
  -- paid costs are real cash already spent: release them to operating expenses (the batch produced nothing)
  perform set_config('frane.ledger_write','on',true);
  update transactions set batch_id = null where batch_id = p_id;
  perform public._recompute_batch(p_id);
  update production_batches set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id;
  perform public._audit('cancel','production_batches',p_id::text,to_jsonb(b),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;

-- ---------- reports --------------------------------------------------
create or replace function public.production_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_day jsonb; v_prod jsonb; v_mat jsonb;
begin
  if not (public.has_perm('production','view') or public.has_perm('reports','view')) then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'produced', pr, 'accepted', ac, 'rejected', rj) order by d),'[]'::jsonb) into v_day from (
    select completed_date d, sum(qty_produced) pr, sum(qty_accepted) ac, sum(qty_rejected) rj from production_batches where status = 'completed' and completed_date between p_from and p_to group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('product', n, 'batches', c, 'produced', pr, 'accepted', ac, 'rejected', rj, 'cost', cost, 'cost_per_unit', case when ac > 0 then round(cost / ac, 2) end) order by ac desc),'[]'::jsonb) into v_prod from (
    select p.name n, count(*) c, sum(b.qty_produced) pr, sum(b.qty_accepted) ac, sum(b.qty_rejected) rj, sum(b.total_cost) cost from production_batches b join products p on p.id = b.product_id
    where b.status = 'completed' and b.completed_date between p_from and p_to group by p.name) y;
  select coalesce(jsonb_agg(jsonb_build_object('material', n, 'unit', u, 'quantity', q, 'cost', c) order by c desc),'[]'::jsonb) into v_mat from (
    select m.name n, m.unit u, sum(pm.quantity) q, sum(pm.total_cost) c from production_materials pm join production_batches b on b.id = pm.batch_id join raw_materials m on m.id = pm.material_id
    where not pm.reversed and b.status in ('in_progress','completed') and b.production_date between p_from and p_to group by m.name, m.unit) z;
  return jsonb_build_object('by_day', v_day, 'by_product', v_prod, 'materials', v_mat);
end $$;

-- ---------- COGS & dashboard ----------------------------------------
create or replace view public._cogs_events as
  select m.movement_date as d, (-m.quantity * m.unit_cost)::numeric as amount,
         case when m.kind in ('sale','return') then 'Cost of goods sold' else 'Stock losses & adjustments' end as label,
         (m.kind = 'sale' and m.unit_cost = 0) as incomplete
    from public.inventory_movements m where m.kind in ('sale','return','damage','adjustment')
  union all
  select b.completed_date, b.total_cost, 'Production write-off', false from public.production_batches b where b.status = 'completed' and b.qty_accepted = 0;
revoke all on public._cogs_events from public, anon, authenticated;

-- operating expenses exclude costs attributed to production batches (they become COGS)
create or replace view public._expense_events as
  select t.txn_date as d, t.amount, coalesce(c.name, 'Uncategorised') as label from public.transactions t left join public.transaction_categories c on c.id = t.category_id
   where t.type = 'expense' and t.status = 'posted' and not t.is_reversal and t.batch_id is null
  union all select i.invoice_date, i.amount, coalesce(c.name, 'Uncategorised') from public.supplier_invoices i left join public.transaction_categories c on c.id = i.category_id
   where i.kind = 'expense' and i.status = 'open';
revoke all on public._expense_events from public, anon, authenticated;

alter function public.dashboard_summary(date, date) rename to _dashboard_core;

create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_core jsonb; v_today date := public._kampala_today(); v_month_start date := date_trunc('month', p_to)::date; v_extra jsonb;
begin
  v_core := public._dashboard_core(p_from, p_to);
  select jsonb_build_object(
    'cogs', (select coalesce(sum(amount),0) from _cogs_events where d between p_from and p_to),
    'month_cogs', (select coalesce(sum(amount),0) from _cogs_events where d between v_month_start and p_to),
    'cogs_incomplete', (select count(*) from _cogs_events where incomplete and d between p_from and p_to),
    'cogs_daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'amount', a) order by d),'[]'::jsonb) from (select d, sum(amount) a from _cogs_events where d between p_from and p_to group by d) x),
    'cogs_monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'amount', a) order by m),'[]'::jsonb) from (select to_char(date_trunc('month', d),'YYYY-MM') m, sum(amount) a from _cogs_events where d >= (date_trunc('month', p_to) - interval '11 months')::date and d <= p_to group by 1) x),
    'cogs_by_label', (select coalesce(jsonb_agg(jsonb_build_object('name', l, 'amount', a)),'[]'::jsonb) from (select label l, sum(amount) a from _cogs_events where d between p_from and p_to group by 1 having sum(amount) <> 0) x),
    'produced_today', (select coalesce(jsonb_agg(jsonb_build_object('category', c, 'qty', q)),'[]'::jsonb) from (select coalesce(pc.name,'Uncategorised') c, sum(m.quantity) q from inventory_movements m join products p on p.id = m.product_id left join product_categories pc on pc.id = p.category_id where m.kind = 'production' and m.movement_date = v_today group by 1) x),
    'sold_today', (select coalesce(jsonb_agg(jsonb_build_object('category', c, 'qty', q)),'[]'::jsonb) from (select coalesce(pc.name,'Other') c, sum(si.quantity) q from sale_items si join sales s on s.id = si.sale_id and s.status = 'confirmed' and s.sale_date = v_today left join products p on p.id = si.product_id left join product_categories pc on pc.id = p.category_id group by 1) x),
    'stock_units', (select coalesce(sum(current_stock),0) from products where status = 'active'),
    'stock_value', (select coalesce(sum(greatest(current_stock,0) * avg_cost),0) from products),
    'material_value', (select coalesce(sum(greatest(current_stock,0) * unit_cost),0) from raw_materials),
    'low_stock_products', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', current_stock, 'min', min_stock) order by name),'[]'::jsonb) from (select * from products where status = 'active' and min_stock > 0 and current_stock <= min_stock order by name limit 8) x),
    'low_stock_materials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', current_stock, 'min', min_stock, 'unit', unit) order by name),'[]'::jsonb) from (select * from raw_materials where status = 'active' and min_stock > 0 and current_stock <= min_stock order by name limit 8) x),
    'batches_in_progress', (select count(*) from production_batches where status = 'in_progress'),
    'negative_stock_count', (select count(*) from products where current_stock < 0) + (select count(*) from raw_materials where current_stock < 0),
    'sales_by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'qty', q, 'amount', a) order by a desc),'[]'::jsonb) from (select coalesce(p.name, si.description) n, sum(si.quantity) q, sum(si.line_total) a from sale_items si join sales s on s.id = si.sale_id and s.status = 'confirmed' and s.sale_date between p_from and p_to left join products p on p.id = si.product_id group by 1 order by 3 desc limit 10) x),
    'production_by_product', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc),'[]'::jsonb) from (select p.name n, sum(b.qty_accepted) q from production_batches b join products p on p.id = b.product_id where b.status = 'completed' and b.completed_date between p_from and p_to group by 1 order by 2 desc limit 10) x),
    'inventory_movement', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'in', i, 'out', o) order by d),'[]'::jsonb) from (select movement_date d, coalesce(sum(quantity) filter (where quantity > 0),0) i, coalesce(-sum(quantity) filter (where quantity < 0),0) o from inventory_movements where kind <> 'opening' and movement_date between p_from and p_to group by 1) x)
  ) into v_extra;
  return v_core || v_extra;
end $$;

-- demo data: cement is now inventory-tracked, so the demo books transport instead
create or replace function public.seed_demo_data() returns void
language plpgsql security definer set search_path = public as $$
declare v_cash uuid; v_bank uuid; v_mm uuid; v_cat_sales uuid; v_cat_exp uuid; v_cat_lab uuid; v_cat_fuel uuid; d int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: owner only'; end if;
  if exists (select 1 from accounts where is_demo) then raise exception 'INVALID: demo data is already loaded'; end if;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values ('[DEMO] Cash Box','cash',2000000,'Demo data — safe to remove',true,auth.uid()) returning id into v_cash;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values ('[DEMO] Bank Account','bank',5000000,'Demo data — safe to remove',true,auth.uid()) returning id into v_bank;
  insert into accounts(name,type,opening_balance,description,is_demo,created_by) values ('[DEMO] Mobile Money','mobile_money',500000,'Demo data — safe to remove',true,auth.uid()) returning id into v_mm;
  select id into v_cat_sales from transaction_categories where name='Cash sales' and kind='income';
  select id into v_cat_exp from transaction_categories where name='Transport' and kind='expense';
  select id into v_cat_lab from transaction_categories where name='Casual labour' and kind='expense';
  select id into v_cat_fuel from transaction_categories where name='Fuel' and kind='expense';
  perform set_config('frane.ledger_write','on',true);
  for d in 0..20 loop
    insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,is_demo,recorded_by)
    values (public._kampala_today()-d,'income','in',v_cat_sales,'[DEMO] Block sales',1200000+(d*37%5)*150000,v_cash,'Cash',true,auth.uid()),
           (public._kampala_today()-d,'expense','out',v_cat_exp,'[DEMO] Transport',(500000+(d*53%4)*100000),v_bank,'Bank Transfer',true,auth.uid()),
           (public._kampala_today()-d,'expense','out',v_cat_lab,'[DEMO] Casual labour',180000,v_cash,'Cash',true,auth.uid());
    if d % 5 = 0 then
      insert into transactions(txn_date,type,direction,category_id,description,amount,account_id,payment_method,is_demo,recorded_by)
      values (public._kampala_today()-d,'expense','out',v_cat_fuel,'[DEMO] Fuel',90000,v_mm,'Mobile Money',true,auth.uid());
    end if;
  end loop;
  perform public._audit('create','demo_data',null,null,jsonb_build_object('action','seed_demo_data'),null);
end $$;

-- ---------- RLS & grants --------------------------------------------
alter table public.inventory_movements enable row level security;
alter table public.raw_materials enable row level security;
alter table public.material_movements enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_materials enable row level security;
alter table public.production_costs enable row level security;

create policy invmov_read on public.inventory_movements for select using (public.has_perm('inventory','view') or public.has_perm('production','view'));
create policy matmov_read on public.material_movements for select using (public.has_perm('inventory','view') or public.has_perm('production','view'));
create policy materials_read on public.raw_materials for select using (public.has_perm('inventory','view') or public.has_perm('production','view'));
create policy materials_ins on public.raw_materials for insert with check (public.has_perm('inventory','create'));
create policy materials_upd on public.raw_materials for update using (public.has_perm('inventory','edit')) with check (public.has_perm('inventory','edit'));
create policy batches_read on public.production_batches for select using (public.has_perm('production','view'));
create policy pm_read on public.production_materials for select using (public.has_perm('production','view'));
create policy pc_read on public.production_costs for select using (public.has_perm('production','view'));
-- finished-goods stock needs to be visible wherever products are used for selling
revoke all on public.inventory_movements, public.material_movements, public.production_batches, public.production_materials, public.production_costs from anon, authenticated;
grant select on public.inventory_movements, public.material_movements, public.production_batches, public.production_materials, public.production_costs to authenticated;

-- storekeepers must be able to pick a supplier when receiving materials
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers for select using (public.has_perm('suppliers','view') or public.has_perm('transactions','create') or public.has_perm('inventory','create'));

-- stock/cost columns are written only by stock functions: column-level privileges
revoke insert, update on public.products from authenticated;
grant insert (sku, name, category_id, dimensions, description, unit, selling_price, production_cost_estimate, min_stock, status) on public.products to authenticated;
grant update (sku, name, category_id, dimensions, description, unit, selling_price, production_cost_estimate, min_stock, status) on public.products to authenticated;
revoke all on public.raw_materials from anon, authenticated;
grant select on public.raw_materials to authenticated;
grant insert (name, unit, min_stock, default_supplier_id, status, notes) on public.raw_materials to authenticated;
grant update (name, unit, min_stock, default_supplier_id, status, notes) on public.raw_materials to authenticated;
grant usage on sequence public.material_seq to authenticated;

-- ---------- function privileges: explicit allow-list -----------------
-- Supabase grants EXECUTE on new functions to `authenticated` by default. Internal helpers
-- (_post_txn, _post_stock, _audit, ...) bypass permission checks, so revoke everything and
-- re-grant only the public API.
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
  public.complete_batch(uuid,numeric,numeric,date), public.cancel_batch(uuid,text), public.production_report(date,date)
  to authenticated;
