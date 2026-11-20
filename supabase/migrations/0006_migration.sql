-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 6: data migration & hardening
-- Bulk import (dry-run first, all-or-nothing, owner only), opening balances,
-- historical records, company logo storage.
--
-- IMPORT RULES (so migrated data never corrupts the books)
--  * Opening receivables/payables are real debts but NOT revenue/expense: sales.is_opening
--    and supplier_invoices.kind='opening' are excluded from revenue, expenses, forecast
--    run-rates and sales reports.
--  * Historical sales/expenses DO count in their historical periods, but their payments are
--    recorded as opening_paid (money received/paid before the system started): no ledger
--    transaction is created, so account balances (which already include that history through
--    their opening balances) never double count. Historical sales are marked delivered with
--    stock already deducted (reflected in the opening stock you enter).
--  * Every import is validated with the real database rules in a dry run first; a commit is
--    all-or-nothing (any row error rolls the whole file back) and the same file cannot be
--    imported twice.
-- =====================================================================

alter table public.sales add column if not exists is_opening boolean not null default false;
alter table public.sales add column if not exists is_historical boolean not null default false;
alter table public.sales add column if not exists opening_paid numeric(16,2) not null default 0 check (opening_paid >= 0);
alter table public.expenses add column if not exists opening_paid numeric(16,2) not null default 0 check (opening_paid >= 0);
alter table public.supplier_invoices drop constraint if exists supplier_invoices_kind_check;
alter table public.supplier_invoices add constraint supplier_invoices_kind_check check (kind in ('materials','expense','opening'));
create sequence if not exists public.opening_seq;
create sequence if not exists public.hist_seq;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  filename text,
  row_count int not null,
  created_count int not null,
  skipped_count int not null,
  payload_hash text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.import_batches enable row level security;
create policy import_batches_read on public.import_batches for select using (public.is_owner());
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;

-- ---------- revenue excludes opening balances -----------------------
create or replace view public._revenue_events as
  select t.txn_date as d, t.amount, coalesce(c.name, 'Other income') as label from public.transactions t left join public.transaction_categories c on c.id = t.category_id
   where t.type = 'income' and t.status = 'posted' and not t.is_reversal
  union all select s.sale_date, s.total, 'Invoiced sales' from public.sales s where s.status = 'confirmed' and not s.is_opening;
revoke all on public._revenue_events from public, anon, authenticated;

-- ---------- paid amounts include money received before go-live ------
create or replace function public._refresh_sale(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount),0) + (select opening_paid from sales where id = p_id) into v_paid from payment_allocations where sale_id = p_id and not reversed;
  update sales set amount_paid = v_paid,
    payment_status = case when status = 'confirmed' and total > 0 and v_paid >= total then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end
  where id = p_id;
end $$;
create or replace function public._refresh_expense(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric;
begin
  select coalesce(sum(amount),0) + (select opening_paid from expenses where id = p_id) into v_paid from expense_payments where expense_id = p_id and not reversed;
  update expenses set amount_paid = v_paid, payment_status = case when v_paid >= amount then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end where id = p_id;
end $$;

create or replace function public.cancel_sale(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not public.has_perm('sales','edit') then raise exception 'FORBIDDEN: you may not cancel sales'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'INVALID: a reason is required to cancel a sale'; end if;
  select * into s from sales where id = p_id for update;
  if not found then raise exception 'INVALID: sale not found'; end if;
  if s.status = 'cancelled' then raise exception 'INVALID: sale is already cancelled'; end if;
  if s.amount_paid - s.opening_paid > 0 then raise exception 'INVALID: this invoice has payments — reverse the payments first, then cancel'; end if;
  if s.delivery_status in ('dispatched','delivered') and not (s.is_opening or s.is_historical) then raise exception 'INVALID: goods were already dispatched — cannot cancel'; end if;
  update sales set status = 'cancelled', delivery_status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now() where id = p_id;
  perform public._audit('cancel','sales',p_id::text,to_jsonb(s),jsonb_build_object('status','cancelled'),btrim(p_reason));
end $$;


create or replace function public.profit_and_loss(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prod numeric; v_trans numeric; v_sales numeric; v_manual numeric; v_coll numeric;
  v_cogs jsonb; v_cogs_t numeric; v_opex jsonb; v_opex_t numeric; v_oi jsonb; v_oi_t numeric; v_oe jsonb; v_oe_t numeric;
  v_gross numeric; v_net numeric; v_incomplete int; v_pending numeric;
begin
  perform public._fin_access();
  if p_from is null or p_to is null or p_from > p_to then raise exception 'INVALID: invalid period'; end if;
  select coalesce(sum(subtotal - discount),0), coalesce(sum(transport_charge),0), coalesce(sum(total),0) into v_prod, v_trans, v_sales
    from sales where status = 'confirmed' and not is_opening and sale_date between p_from and p_to;
  select coalesce(sum(t.amount) filter (where c.group_name = 'Sales'),0), coalesce(sum(t.amount) filter (where c.group_name = 'Collections'),0) into v_manual, v_coll
    from transactions t join transaction_categories c on c.id = t.category_id where t.type = 'income' and t.status = 'posted' and not t.is_reversal and t.txn_date between p_from and p_to;
  select coalesce(jsonb_agg(jsonb_build_object('label', l, 'amount', a) order by a desc),'[]'::jsonb), coalesce(sum(a),0) into v_cogs, v_cogs_t
    from (select label l, sum(amount) a from _cogs_events where d between p_from and p_to group by 1 having sum(amount) <> 0) x;
  select coalesce(jsonb_agg(jsonb_build_object('group', g, 'total', t, 'lines', ln) order by t desc),'[]'::jsonb), coalesce(sum(t),0) into v_opex, v_opex_t from (
    select g, sum(a) t, jsonb_agg(jsonb_build_object('label', l, 'amount', a) order by a desc) ln from (
      select coalesce(group_name,'Operating') g, label l, sum(amount) a from _expense_events where d between p_from and p_to and coalesce(group_name,'') <> 'Other' group by 1,2) y group by g) z;
  select coalesce(jsonb_agg(jsonb_build_object('label', l, 'amount', a) order by a desc),'[]'::jsonb), coalesce(sum(a),0) into v_oi, v_oi_t from (
    select coalesce(c.name,'Other income') l, sum(t.amount) a from transactions t join transaction_categories c on c.id = t.category_id
     where t.type = 'income' and t.status = 'posted' and not t.is_reversal and t.txn_date between p_from and p_to and coalesce(c.group_name,'') not in ('Sales','Collections') group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('label', l, 'amount', a) order by a desc),'[]'::jsonb), coalesce(sum(a),0) into v_oe, v_oe_t from (
    select label l, sum(amount) a from _expense_events where d between p_from and p_to and group_name = 'Other' group by 1) x;
  v_gross := v_sales + v_manual - v_cogs_t;
  v_net := v_gross - v_opex_t + v_oi_t - v_oe_t;
  select count(*) into v_incomplete from _cogs_events where incomplete and d between p_from and p_to;
  select coalesce(sum(amount),0) into v_pending from expenses where status = 'open' and approval_status = 'pending' and expense_date between p_from and p_to;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', jsonb_build_object('product_sales', v_prod, 'transport', v_trans, 'invoiced_sales', v_sales, 'manual_sales_entries', v_manual, 'total', v_sales + v_manual),
    'cogs', jsonb_build_object('lines', v_cogs, 'total', v_cogs_t),
    'gross_profit', v_gross, 'gross_margin_pct', case when v_sales + v_manual > 0 then round(v_gross * 100 / (v_sales + v_manual), 1) end,
    'operating_expenses', jsonb_build_object('groups', v_opex, 'total', v_opex_t),
    'other_income', jsonb_build_object('lines', v_oi, 'total', v_oi_t),
    'other_expenses', jsonb_build_object('lines', v_oe, 'total', v_oe_t),
    'net_profit', v_net,
    'memo', jsonb_build_object(
      'cash_collected_from_customers', (select coalesce(sum(amount),0) from transactions where type = 'customer_payment' and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'collections_booked_as_income_excluded', v_coll,
      'receivables_outstanding_now', (select coalesce(sum(balance),0) from sales where status = 'confirmed'),
      'expense_cash_paid', (select coalesce(sum(amount),0) from transactions where type::text in ('expense','expense_payment') and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'materials_purchased_into_stock', (select coalesce(sum(quantity * unit_cost),0) from material_movements where kind = 'purchase' and movement_date between p_from and p_to),
      'materials_consumed_in_production', (select coalesce(sum(-quantity * unit_cost),0) from material_movements where kind = 'consumption' and movement_date between p_from and p_to),
      'finished_goods_value_produced', (select coalesce(sum(quantity * unit_cost),0) from inventory_movements where kind = 'production' and movement_date between p_from and p_to),
      'owner_contributions', (select coalesce(sum(amount),0) from transactions where type = 'owner_contribution' and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'owner_withdrawals', (select coalesce(sum(amount),0) from transactions where type = 'owner_withdrawal' and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'loans_received', (select coalesce(sum(amount),0) from transactions where type = 'loan_received' and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'loan_repayments', (select coalesce(sum(amount),0) from transactions where type = 'loan_repayment' and status = 'posted' and not is_reversal and txn_date between p_from and p_to),
      'supplier_payments', (select coalesce(sum(amount),0) from transactions where type = 'supplier_payment' and status = 'posted' and not is_reversal and txn_date between p_from and p_to)),
    'flags', jsonb_build_object('uncosted_dispatches', v_incomplete, 'pending_expenses_excluded', v_pending,
        'estimated', v_incomplete > 0 or (v_sales > 0 and v_cogs_t = 0),
        'negative_stock_items', (select count(*) from products where current_stock < 0) + (select count(*) from raw_materials where current_stock < 0)));
end $$;


create or replace function public.sales_report(p_group text, p_from date, p_to date, p_product uuid default null, p_customer uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not (public.has_perm('sales','view') and (public.has_perm('reports','view') or public.has_perm('dashboard','view'))) then raise exception 'FORBIDDEN'; end if;
  if p_group not in ('day','month','product','customer','salesperson') then raise exception 'INVALID: unknown grouping'; end if;
  if p_group = 'product' then
    select coalesce(jsonb_agg(jsonb_build_object('label', n, 'invoices', c, 'quantity', q, 'gross', g, 'discount', d, 'transport', 0, 'net', net, 'paid', null, 'outstanding', null) order by net desc),'[]'::jsonb) into v_rows from (
      select coalesce(p.name, si.description) n, count(distinct s.id) c, sum(si.quantity) q, sum(si.quantity * si.unit_price) g, sum(si.discount) d, sum(si.line_total) net
        from sale_items si join sales s on s.id = si.sale_id and s.status = 'confirmed' and s.sale_date between p_from and p_to left join products p on p.id = si.product_id
       where (p_product is null or si.product_id = p_product) and (p_customer is null or s.customer_id = p_customer) group by 1) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('label', k, 'invoices', c, 'quantity', q, 'gross', g, 'discount', d, 'transport', t, 'net', net, 'paid', pd, 'outstanding', ob)
             order by case when p_group in ('day','month') then k end, net desc),'[]'::jsonb) into v_rows from (
      select case p_group when 'day' then s.sale_date::text when 'month' then to_char(s.sale_date,'YYYY-MM') when 'customer' then c.name else coalesce(pr.full_name, 'Unassigned') end k,
             count(*) c, coalesce(sum((select sum(quantity) from sale_items where sale_id = s.id)),0) q, sum(s.subtotal) g, sum(s.discount) d, sum(s.transport_charge) t, sum(s.total) net, sum(s.amount_paid) pd, sum(s.balance) ob
        from sales s join customers c on c.id = s.customer_id left join profiles pr on pr.id = s.salesperson_id
       where s.status = 'confirmed' and not s.is_opening and s.sale_date between p_from and p_to and (p_customer is null or s.customer_id = p_customer)
         and (p_product is null or exists (select 1 from sale_items si where si.sale_id = s.id and si.product_id = p_product))
       group by 1) x;
  end if;
  return jsonb_build_object('group', p_group, 'from', p_from, 'to', p_to, 'rows', v_rows);
end $$;


create or replace function public._cash_forecast_core(p_assumptions jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_a jsonb; v_today date := public._kampala_today(); v_open numeric; v_hist int; v_avg numeric; v_share numeric; v_days int; v_delay int; v_pdelay int; v_paydelay int; v_edelay int;
  v_rec_exp numeric; v_rec_pay numeric; v_daily jsonb; v_short jsonb; v_min jsonb; v_newsales boolean; v_recexp boolean; v_recpay boolean; v_cur numeric; v_1 numeric; v_2 numeric; v_3 numeric; v_4 numeric;
begin
  v_a := '{"collect_pct_current":90,"collect_pct_1_30":70,"collect_pct_31_60":40,"collect_pct_61_90":20,"collect_pct_90_plus":5,"collect_delay_days":7,"new_sales_enabled":true,"history_days":30,"payables_delay_days":3,"payroll_pay_delay_days":3,"unpaid_expense_delay_days":7,"recurring_expenses_enabled":true,"recurring_payroll_enabled":true}'::jsonb
         || coalesce((select value from settings where key = 'forecast'), '{}'::jsonb) || coalesce(p_assumptions, '{}'::jsonb);
  v_cur := (v_a->>'collect_pct_current')::numeric; v_1 := (v_a->>'collect_pct_1_30')::numeric; v_2 := (v_a->>'collect_pct_31_60')::numeric; v_3 := (v_a->>'collect_pct_61_90')::numeric; v_4 := (v_a->>'collect_pct_90_plus')::numeric;
  v_delay := (v_a->>'collect_delay_days')::int; v_hist := greatest((v_a->>'history_days')::int, 7); v_pdelay := (v_a->>'payables_delay_days')::int; v_paydelay := (v_a->>'payroll_pay_delay_days')::int; v_edelay := (v_a->>'unpaid_expense_delay_days')::int;
  v_newsales := coalesce((v_a->>'new_sales_enabled')::boolean, true); v_recexp := coalesce((v_a->>'recurring_expenses_enabled')::boolean, true); v_recpay := coalesce((v_a->>'recurring_payroll_enabled')::boolean, true);
  select coalesce((value->>'customer_days')::int, 30) into v_days from settings where key = 'credit_terms';

  select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case direction when 'in' then amount else -amount end) from transactions t join accounts a2 on a2.id = t.account_id and a2.status = 'active'),0)
    into v_open from accounts a where a.status = 'active';
  select coalesce(sum(total),0) / v_hist into v_avg from sales where status = 'confirmed' and not is_opening and sale_date > v_today - v_hist and sale_date <= v_today;
  -- share of invoiced value historically paid on the dn of sale (data-driven unless overridden)
  v_share := coalesce(nullif(v_a->>'new_sales_cash_pct','')::numeric,
     (select least(100, round(100 * coalesce((select sum(pa.amount) from payment_allocations pa join transactions t on t.id = pa.payment_txn_id join sales s on s.id = pa.sale_id
                                               where not pa.reversed and t.txn_date = s.sale_date and s.status = 'confirmed' and not s.is_opening and s.sale_date > v_today - 90), 0)
                                      / nullif((select sum(total) from sales where status = 'confirmed' and sale_date > v_today - 90), 0), 0))),
     50);
  select coalesce(sum(amount),0) / 90.0 into v_rec_exp from transactions where status = 'posted' and not is_reversal and txn_date > v_today - 90 and txn_date <= v_today and batch_id is null
     and (type = 'expense' or (type::text = 'expense_payment' and not exists (select 1 from payroll_records p where p.paid_txn_id = transactions.id)));
  select coalesce(sum(total_pay),0) / 60.0 into v_rec_pay from payroll_records where status = 'paid' and paid_date > v_today - 60 and paid_date <= v_today;

  with days as (select g dn, v_today + g dt from generate_series(1,90) g),
  coll as (
    select greatest(1, (case when s.due_date >= v_today then s.due_date else v_today end) + v_delay - v_today) dn,
           s.balance * case when greatest(0, v_today - s.due_date) = 0 then v_cur when v_today - s.due_date <= 30 then v_1 when v_today - s.due_date <= 60 then v_2 when v_today - s.due_date <= 90 then v_3 else v_4 end / 100 amt
      from sales s where s.status = 'confirmed' and s.balance > 0),
  sup as (select greatest(1, case when i.due_date >= v_today then i.due_date - v_today else v_pdelay end) dn, i.balance amt from supplier_invoices i where i.status = 'open' and i.balance > 0),
  unpaid_exp as (select greatest(1, e.expense_date + v_edelay - v_today) dn, e.balance amt from expenses e where e.status = 'open' and e.approval_status = 'approved' and e.balance > 0),
  unpaid_pay as (select greatest(1, v_paydelay) dn, coalesce(sum(total_pay),0) amt from payroll_records where status = 'approved'),
  planned as (select (item_date - v_today) dn, direction, amount from forecast_items where active and item_date > v_today and item_date <= v_today + 90),
  coll_a as (select dn, sum(amt) amt from coll group by dn),
  sup_a as (select dn, sum(amt) amt from sup group by dn),
  exp_a as (select dn, sum(amt) amt from unpaid_exp group by dn),
  pay_a as (select dn, sum(amt) amt from unpaid_pay group by dn),
  plan_a as (select dn, sum(amount) filter (where direction = 'in') pin, sum(amount) filter (where direction = 'out') pout from planned group by dn),
  rows_ as (
    select d.dn, d.dt,
      coalesce(ca.amt,0)::numeric as in_collections,
      (case when v_newsales then v_avg * v_share / 100 + case when d.dn >= 1 + v_days + v_delay then v_avg * (1 - v_share / 100) * v_cur / 100 else 0 end else 0 end)::numeric as in_new_sales,
      coalesce(pl.pin,0)::numeric as in_planned,
      coalesce(sa.amt,0)::numeric as out_suppliers,
      (coalesce(pa.amt,0) + case when v_recpay and d.dn > v_paydelay then v_rec_pay else 0 end)::numeric as out_payroll,
      (coalesce(ea.amt,0) + case when v_recexp then v_rec_exp else 0 end)::numeric as out_expenses,
      coalesce(pl.pout,0)::numeric as out_planned
    from days d left join coll_a ca on ca.dn = d.dn left join sup_a sa on sa.dn = d.dn left join exp_a ea on ea.dn = d.dn left join pay_a pa on pa.dn = d.dn left join plan_a pl on pl.dn = d.dn),
  calc as (select r.*, in_collections + in_new_sales + in_planned - out_suppliers - out_payroll - out_expenses - out_planned as net,
                  v_open + sum(in_collections + in_new_sales + in_planned - out_suppliers - out_payroll - out_expenses - out_planned) over (order by dn) as balance from rows_ r)
  select jsonb_agg(jsonb_build_object('day', dn, 'date', dt, 'in_collections', round(in_collections,0), 'in_new_sales', round(in_new_sales,0), 'in_planned', in_planned, 'out_suppliers', round(out_suppliers,0),
           'out_payroll', round(out_payroll,0), 'out_expenses', round(out_expenses,0), 'out_planned', out_planned, 'net', round(net,0), 'balance', round(balance,0)) order by dn),
         (select jsonb_build_object('day', dn, 'date', dt, 'balance', round(balance,0)) from calc where balance < 0 order by dn limit 1),
         (select jsonb_build_object('day', dn, 'date', dt, 'balance', round(balance,0)) from calc order by balance, dn limit 1)
    into v_daily, v_short, v_min from calc;
  return jsonb_build_object('is_forecast', true, 'as_of', v_today, 'opening', v_open, 'avg_daily_sales', round(v_avg,0), 'cash_share_pct', v_share, 'recurring_daily_expenses', round(v_rec_exp,0), 'recurring_daily_payroll', round(v_rec_pay,0),
    'assumptions', v_a, 'daily', v_daily, 'first_shortage', v_short, 'lowest_point', v_min);
end $$;


create or replace function public.customer_statement(p_customer uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rows jsonb; v_cust customers;
begin
  if not (public.has_perm('customers','view') or public.has_perm('debts','view') or public.has_perm('sales','view')) then raise exception 'FORBIDDEN'; end if;
  select * into v_cust from customers where id = p_customer;
  if not found then raise exception 'INVALID: customer not found'; end if;
  with ev as (
    select s.sale_date d, s.created_at ts, 'invoice'::text kind, s.sale_no ref, case when s.is_opening then 'Opening balance ' else 'Invoice ' end || s.sale_no descr, s.total debit, 0::numeric credit
      from sales s where s.customer_id = p_customer and s.status = 'confirmed'
    union all select t.txn_date, t.created_at, 'payment', coalesce(t.receipt_no, t.txn_no), 'Payment received' || coalesce(' (' || t.payment_method || ')',''), 0, t.amount
      from transactions t where t.customer_id = p_customer and t.type = 'customer_payment' and t.status = 'posted' and not t.is_reversal
    union all select s.sale_date, s.created_at, 'payment', s.sale_no, 'Payments received before the system start', 0, s.opening_paid from sales s where s.customer_id = p_customer and s.status = 'confirmed' and s.opening_paid > 0
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


create or replace function public.integrity_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; n int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: owner only'; end if;
  select count(*) into n from sales s where s.status <> 'draft' and s.amount_paid <> coalesce((select sum(amount) from payment_allocations where sale_id = s.id and not reversed),0) + s.opening_paid;
  v := v || jsonb_build_object('name','Invoice paid amounts equal their live payment allocations','ok', n = 0,'detail', n || ' mismatch(es)');
  select count(*) into n from sales where amount_paid > total and status = 'confirmed';
  v := v || jsonb_build_object('name','No invoice is over-paid','ok', n = 0,'detail', n || ' invoice(s)');
  select count(*) into n from supplier_invoices i where i.amount_paid <> coalesce((select sum(amount) from supplier_payment_allocations where invoice_id = i.id and not reversed),0);
  v := v || jsonb_build_object('name','Supplier invoice paid amounts equal allocations','ok', n = 0,'detail', n || ' mismatch(es)');
  select count(*) into n from expenses e where e.amount_paid <> coalesce((select sum(amount) from expense_payments where expense_id = e.id and not reversed),0) + e.opening_paid;
  v := v || jsonb_build_object('name','Expense paid amounts equal allocations','ok', n = 0,'detail', n || ' mismatch(es)');
  select count(*) into n from transactions t where (select coalesce(sum(amount),0) from payment_allocations where payment_txn_id = t.id and not reversed) + (select coalesce(sum(amount),0) from supplier_payment_allocations where payment_txn_id = t.id and not reversed) + (select coalesce(sum(amount),0) from expense_payments where payment_txn_id = t.id and not reversed) > t.amount;
  v := v || jsonb_build_object('name','No payment is allocated for more than its amount','ok', n = 0,'detail', n || ' payment(s)');
  select count(*) into n from transactions t where t.status = 'reversed' and (exists (select 1 from payment_allocations where payment_txn_id = t.id and not reversed) or exists (select 1 from supplier_payment_allocations where payment_txn_id = t.id and not reversed) or exists (select 1 from expense_payments where payment_txn_id = t.id and not reversed));
  v := v || jsonb_build_object('name','Reversed payments hold no live allocations','ok', n = 0,'detail', n || ' payment(s)');
  select count(*) into n from products p where p.current_stock <> coalesce((select sum(quantity) from inventory_movements where product_id = p.id),0);
  v := v || jsonb_build_object('name','Finished-goods stock equals its movement ledger','ok', n = 0,'detail', n || ' product(s)');
  select count(*) into n from raw_materials m where m.current_stock <> coalesce((select sum(quantity) from material_movements where material_id = m.id),0);
  v := v || jsonb_build_object('name','Raw-material stock equals its movement ledger','ok', n = 0,'detail', n || ' material(s)');
  select (select count(*) from products where current_stock < 0) + (select count(*) from raw_materials where current_stock < 0) into n;
  v := v || jsonb_build_object('name','No item is below zero stock','ok', n = 0,'detail', n || ' item(s) negative — find the missing receipt or production entry');
  select count(*) into n from production_batches b where b.status = 'completed' and b.qty_accepted <> coalesce((select sum(quantity) from inventory_movements where kind = 'production' and source_id = b.id),0);
  v := v || jsonb_build_object('name','Completed batches stocked exactly their accepted quantity','ok', n = 0,'detail', n || ' batch(es)');
  select count(*) into n from production_batches b where b.material_cost <> coalesce((select sum(total_cost) from production_materials where batch_id = b.id and not reversed),0);
  v := v || jsonb_build_object('name','Batch material cost equals recorded consumption','ok', n = 0,'detail', n || ' batch(es)');
  select count(*) into n from (select transfer_group_id from transactions where type = 'transfer' and not is_reversal group by 1 having count(*) <> 2 or sum(case direction when 'in' then amount else -amount end) <> 0) x;
  v := v || jsonb_build_object('name','Every transfer has two balanced legs','ok', n = 0,'detail', n || ' transfer(s)');
  select count(*) into n from (select s.id, si.product_id, sum(si.quantity) q from sales s join sale_items si on si.sale_id = s.id where s.stock_deducted_at is not null and not s.is_historical and not s.is_opening and si.product_id is not null group by 1,2) x
    where x.q <> coalesce((select sum(-m.quantity) from inventory_movements m where m.source_type = 'sale' and m.source_id = x.id and m.product_id = x.product_id and m.kind = 'sale'),0);
  v := v || jsonb_build_object('name','Dispatched orders deducted stock exactly once','ok', n = 0,'detail', n || ' order(s)');
  select count(*) into n from sales where (status = 'confirmed' and sale_no is null) or (status = 'draft' and sale_no is not null);
  v := v || jsonb_build_object('name','Invoice numbers exist only on confirmed sales','ok', n = 0,'detail', n || ' sale(s)');
  select count(*) into n from (select 1 from (select sum(outstanding) a from customer_balances) c, (select sum(balance) b from sales where status = 'confirmed') s where abs(coalesce(c.a,0) - coalesce(s.b,0)) > 0.005) x;
  v := v || jsonb_build_object('name','Customer balances add up to receivables','ok', n = 0,'detail', n || ' difference(s)');
  select count(*) into n from (select 1 from public.dashboard_summary(public._kampala_today(), public._kampala_today()) d where abs((d->>'closing')::numeric - (select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case direction when 'in' then amount else -amount end) from transactions t join accounts a2 on a2.id = t.account_id and a2.status = 'active'),0) from accounts a where a.status = 'active')) > 0.005) x;
  v := v || jsonb_build_object('name','Dashboard closing cash equals the sum of account balances','ok', n = 0,'detail', n || ' difference(s)');
  return v;
end $$;


create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_core jsonb := public._dashboard_mgmt(p_from, p_to); v_f jsonb;
begin
  v_f := public._cash_forecast_core(null);
  return v_core || jsonb_build_object('sales_today', (select coalesce(sum(total),0) from sales where status = 'confirmed' and not is_opening and sale_date = public._kampala_today()), 'forecast_shortage',
    (select case when (x->'first_shortage') is not null and jsonb_typeof(x->'first_shortage') <> 'null' and (x->'first_shortage'->>'day')::int <= 30 then x->'first_shortage' end from (select v_f x) q),
    'forecast_lowest_30', (select jsonb_build_object('date', e->>'date', 'balance', (e->>'balance')::numeric) from jsonb_array_elements(v_f->'daily') e where (e->>'day')::int <= 30 order by (e->>'balance')::numeric limit 1));
end $$;


create or replace function public.production_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_day jsonb; v_prod jsonb; v_mat jsonb;
begin
  if not public.has_perm('production','view') then raise exception 'FORBIDDEN'; end if;
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


-- =====================================================================
-- IMPORT ENGINE
-- =====================================================================
create or replace function public._imp_res(p_row int, p_status text, p_msg text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('row', p_row, 'status', p_status, 'message', p_msg) $$;

create or replace function public._imp_num(p text, p_field text, p_required boolean default true) returns numeric language plpgsql immutable as $$
declare v numeric;
begin
  if p is null or btrim(p) = '' then
    if p_required then raise exception '% is required', p_field; end if;
    return null;
  end if;
  begin v := replace(replace(btrim(p), ',', ''), ' ', '')::numeric;
  exception when others then raise exception '% must be a number', p_field; end;
  return v;
end $$;

create or replace function public._imp_date(p text, p_field text, p_required boolean default true, p_allow_future boolean default false) returns date language plpgsql stable as $$
declare v date;
begin
  if p is null or btrim(p) = '' then
    if p_required then raise exception '% is required', p_field; end if;
    return null;
  end if;
  begin v := btrim(p)::date; exception when others then raise exception '% must be a valid date (YYYY-MM-DD)', p_field; end;
  if v < date '2000-01-01' then raise exception '% looks wrong (before year 2000)', p_field; end if;
  if not p_allow_future and v > public._kampala_today() then raise exception '% cannot be in the future', p_field; end if;
  return v;
end $$;

create or replace function public._imp_summary(p_res jsonb, p_created int, p_skipped int, p_errors int) returns jsonb language sql immutable as $$
  select jsonb_build_object('created', p_created, 'skipped', p_skipped, 'errors', p_errors, 'results', p_res) $$;

-- ----- master data -------------------------------------------------
create or replace function public._import_customers(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; t text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      if btrim(coalesce(r->>'name','')) = '' then raise exception 'name is required'; end if;
      t := replace(lower(btrim(coalesce(nullif(r->>'customer_type',''), 'individual'))), ' ', '_');
      if t not in ('individual','contractor','construction_company','dealer','other') then raise exception 'unknown customer type "%"', r->>'customer_type'; end if;
      if exists (select 1 from customers where lower(name) = lower(btrim(r->>'name')) and coalesce(phone,'') = coalesce(nullif(btrim(r->>'phone'),''),'')) then
        s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','customer already exists')); continue;
      end if;
      insert into customers(name, phone, email, location, customer_type, notes) values (btrim(r->>'name'), nullif(btrim(r->>'phone'),''), nullif(btrim(r->>'email'),''), nullif(btrim(r->>'location'),''), t, nullif(btrim(r->>'notes'),''));
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_suppliers(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      if btrim(coalesce(r->>'name','')) = '' then raise exception 'name is required'; end if;
      if exists (select 1 from suppliers where lower(name) = lower(btrim(r->>'name'))) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','supplier already exists')); continue; end if;
      insert into suppliers(name, phone, location, contact_person, supplied_materials, notes) values (btrim(r->>'name'), nullif(btrim(r->>'phone'),''), nullif(btrim(r->>'location'),''), nullif(btrim(r->>'contact_person'),''), nullif(btrim(r->>'supplied_materials'),''), nullif(btrim(r->>'notes'),''));
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_accounts(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; t text; v numeric;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      if btrim(coalesce(r->>'name','')) = '' then raise exception 'name is required'; end if;
      t := replace(lower(btrim(coalesce(r->>'type',''))), ' ', '_');
      if t not in ('cash','bank','mobile_money','other') then raise exception 'type must be cash, bank, mobile money or other'; end if;
      v := coalesce(public._imp_num(r->>'opening_balance','opening balance',false), 0);
      if v < 0 then raise exception 'opening balance cannot be negative'; end if;
      if exists (select 1 from accounts where lower(name) = lower(btrim(r->>'name'))) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','account already exists (opening balance not changed)')); continue; end if;
      insert into accounts(name, type, opening_balance, account_ref, description, created_by) values (btrim(r->>'name'), t::account_type, v, nullif(btrim(r->>'account_ref'),''), nullif(btrim(r->>'description'),''), auth.uid());
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_products(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; v_cat uuid; v_name text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      if btrim(coalesce(r->>'sku','')) = '' or btrim(coalesce(r->>'name','')) = '' then raise exception 'sku and name are required'; end if;
      if exists (select 1 from products where lower(sku) = lower(btrim(r->>'sku'))) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','SKU already exists')); continue; end if;
      v_cat := null; v_name := nullif(btrim(r->>'category'),'');
      if v_name is not null then
        select id into v_cat from product_categories where lower(name) = lower(v_name);
        if v_cat is null then insert into product_categories(name, sort_order) values (v_name, 500) returning id into v_cat; end if;
      end if;
      if public._imp_num(r->>'selling_price','selling price') < 0 then raise exception 'selling price cannot be negative'; end if;
      insert into products(sku, name, category_id, dimensions, description, unit, selling_price, production_cost_estimate, min_stock)
        values (btrim(r->>'sku'), btrim(r->>'name'), v_cat, nullif(btrim(r->>'dimensions'),''), nullif(btrim(r->>'description'),''), coalesce(nullif(btrim(r->>'unit'),''),'pieces'),
                public._imp_num(r->>'selling_price','selling price'), coalesce(public._imp_num(r->>'production_cost_estimate','cost estimate',false),0), coalesce(public._imp_num(r->>'min_stock','minimum stock',false),0));
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_employees(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; t text; b text; v numeric;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      if btrim(coalesce(r->>'name','')) = '' then raise exception 'name is required'; end if;
      t := replace(lower(btrim(coalesce(nullif(r->>'employment_type',''),'casual'))), ' ', '_'); if t = 'daily_labour' then t := 'daily'; elsif t = 'production_labour' then t := 'production'; end if;
      if t not in ('permanent','casual','daily','production') then raise exception 'employment type must be permanent, casual, daily or production'; end if;
      b := lower(btrim(coalesce(nullif(r->>'pay_basis',''),'daily'))); if b not in ('daily','monthly') then raise exception 'pay basis must be daily or monthly'; end if;
      v := public._imp_num(r->>'rate','rate'); if v < 0 then raise exception 'rate cannot be negative'; end if;
      if exists (select 1 from employees where lower(name) = lower(btrim(r->>'name')) and coalesce(phone,'') = coalesce(nullif(btrim(r->>'phone'),''),'')) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','employee already exists')); continue; end if;
      insert into employees(name, role, phone, employment_type, pay_basis, rate) values (btrim(r->>'name'), nullif(btrim(r->>'role'),''), nullif(btrim(r->>'phone'),''), t, b, v);
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

-- ----- opening stock --------------------------------------------------
create or replace function public._import_opening_stock(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; p products; q numeric; cost numeric;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      select * into p from products where lower(sku) = lower(btrim(coalesce(r->>'sku','')));
      if not found then raise exception 'no product with SKU "%"', r->>'sku'; end if;
      q := public._imp_num(r->>'quantity','quantity'); if q <= 0 then raise exception 'quantity must be greater than zero'; end if;
      cost := coalesce(public._imp_num(r->>'unit_cost','unit cost',false), 0); if cost < 0 then raise exception 'unit cost cannot be negative'; end if;
      if exists (select 1 from inventory_movements where product_id = p.id and kind = 'opening') then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','opening stock already recorded for this product')); continue; end if;
      perform public._post_stock(p.id, public._kampala_today(), 'opening', q, cost, 'import', null, 'Opening stock (import)', false);
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created', case when cost = 0 then 'imported with ZERO cost — profit on these goods will be overstated until a cost is set' end));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_material_opening(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; m raw_materials; q numeric; cost numeric;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      select * into m from raw_materials where lower(name) = lower(btrim(coalesce(r->>'name','')));
      if not found then raise exception 'no raw material named "%" (add it in Inventory first)', r->>'name'; end if;
      q := public._imp_num(r->>'quantity','quantity'); if q <= 0 then raise exception 'quantity must be greater than zero'; end if;
      cost := coalesce(public._imp_num(r->>'unit_cost','unit cost',false), 0); if cost < 0 then raise exception 'unit cost cannot be negative'; end if;
      if exists (select 1 from material_movements where material_id = m.id and kind = 'opening') then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','opening stock already recorded for this material')); continue; end if;
      perform public._post_material(m.id, public._kampala_today(), 'opening', q, cost, 'import', null, null, 'Opening stock (import)', false);
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created', case when cost = 0 then 'imported with ZERO cost' end));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

-- ----- opening debts --------------------------------------------------
create or replace function public._import_opening_receivables(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; v_cust uuid; v_cnt int; amt numeric; d date; due date; ref text; v_note text; v_days int;
begin
  select coalesce((value->>'customer_days')::int, 30) into v_days from settings where key = 'credit_terms';
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      select count(*), min(id::text)::uuid into v_cnt, v_cust from customers where lower(name) = lower(btrim(coalesce(r->>'customer','')));
      if v_cnt = 0 then raise exception 'customer "%" not found (import customers first)', r->>'customer'; end if;
      if v_cnt > 1 then raise exception 'several customers are named "%" — rename one before importing', r->>'customer'; end if;
      amt := public._imp_num(r->>'amount','amount'); if amt <= 0 then raise exception 'amount must be greater than zero'; end if;
      d := public._imp_date(r->>'invoice_date','invoice date'); due := coalesce(public._imp_date(r->>'due_date','due date',false,true), d + coalesce(v_days,30));
      ref := nullif(btrim(r->>'reference'),''); v_note := 'Opening balance brought forward' || coalesce(' — ref: ' || ref, '');
      if ref is not null and exists (select 1 from sales where customer_id = v_cust and is_opening and notes = v_note) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','this opening invoice was already imported')); continue; end if;
      insert into sales(sale_no, sale_date, customer_id, status, payment_status, delivery_status, subtotal, total, due_date, salesperson_id, notes, is_opening, stock_deducted_at, created_by)
        values ('OB-' || lpad(nextval('public.opening_seq')::text, 6, '0'), d, v_cust, 'confirmed', 'unpaid', 'delivered', amt, amt, due, auth.uid(), v_note, true, now(), auth.uid());
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_opening_payables(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; v_sup uuid; v_cnt int; amt numeric; d date; due date; ref text; v_days int;
begin
  select coalesce((value->>'supplier_days')::int, 30) into v_days from settings where key = 'credit_terms';
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      select count(*), min(id::text)::uuid into v_cnt, v_sup from suppliers where lower(name) = lower(btrim(coalesce(r->>'supplier','')));
      if v_cnt = 0 then raise exception 'supplier "%" not found (import suppliers first)', r->>'supplier'; end if;
      if v_cnt > 1 then raise exception 'several suppliers are named "%"', r->>'supplier'; end if;
      amt := public._imp_num(r->>'amount','amount'); if amt <= 0 then raise exception 'amount must be greater than zero'; end if;
      d := public._imp_date(r->>'invoice_date','invoice date'); due := coalesce(public._imp_date(r->>'due_date','due date',false,true), d + coalesce(v_days,30)); ref := nullif(btrim(r->>'reference'),'');
      if ref is not null and exists (select 1 from supplier_invoices where supplier_id = v_sup and kind = 'opening' and supplier_invoice_no = ref) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','this opening invoice was already imported')); continue; end if;
      insert into supplier_invoices(supplier_id, supplier_invoice_no, invoice_date, due_date, kind, description, amount, notes, created_by)
        values (v_sup, ref, d, due, 'opening', coalesce(nullif(btrim(r->>'description'),''), 'Opening balance brought forward'), amt, 'Imported opening balance', auth.uid());
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

-- ----- historical records --------------------------------------------
create or replace function public._import_historical_sales(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g record; ln jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; v_cust uuid; v_cnt int; d date; ref text; v_sale uuid; v_no int; prod products;
  qty numeric; price numeric; disc numeric; sub numeric; paid numeric; paid_i numeric; due date; v_note text; v_first jsonb; v_days int;
begin
  select coalesce((value->>'customer_days')::int, 30) into v_days from settings where key = 'credit_terms';
  for g in select k, jsonb_agg(r order by ord) as lines, min(ord) as first_ord
             from (select coalesce(nullif(btrim(r->>'invoice_ref'),''), 'row-' || ord) k, r, ord from jsonb_array_elements(p_rows) with ordinality t(r, ord)) x group by k order by min(ord) loop
    v_first := g.lines->0; n := coalesce((v_first->>'_row')::int, g.first_ord + 1);
    begin
      select count(*), min(id::text)::uuid into v_cnt, v_cust from customers where lower(name) = lower(btrim(coalesce(v_first->>'customer','')));
      if v_cnt = 0 then raise exception 'customer "%" not found (import customers first)', v_first->>'customer'; end if;
      if v_cnt > 1 then raise exception 'several customers are named "%"', v_first->>'customer'; end if;
      d := public._imp_date(v_first->>'date','date');
      ref := nullif(btrim(v_first->>'invoice_ref'),''); v_note := 'Historical import' || coalesce(' — ref: ' || ref, '');
      if ref is not null and exists (select 1 from sales where customer_id = v_cust and is_historical and notes = v_note) then s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','this invoice was already imported')); continue; end if;
      sub := 0; paid := null;
      v_no := 0;
      for ln in select * from jsonb_array_elements(g.lines) loop
        qty := public._imp_num(ln->>'quantity','quantity'); price := public._imp_num(ln->>'unit_price','unit price'); disc := coalesce(public._imp_num(ln->>'discount','discount',false),0);
        if qty <= 0 then raise exception 'quantity must be greater than zero'; end if; if price < 0 or disc < 0 then raise exception 'price and discount cannot be negative'; end if;
        if qty * price - disc < 0 then raise exception 'discount exceeds the line value'; end if;
        if nullif(btrim(ln->>'sku'),'') is null and nullif(btrim(ln->>'description'),'') is null then raise exception 'each line needs a SKU or a description'; end if;
        sub := sub + round(qty * price - disc, 2);
        paid_i := public._imp_num(ln->>'paid_amount','paid amount',false);
        if paid_i is not null then if paid is not null and paid <> paid_i then raise exception 'paid amount differs between lines of the same invoice'; end if; paid := paid_i; end if;
      end loop;
      paid := coalesce(paid, 0); if paid < 0 or paid > sub then raise exception 'paid amount must be between 0 and the invoice total (%)', sub; end if;
      due := coalesce(public._imp_date(v_first->>'due_date','due date',false,true), d + coalesce(v_days,30));
      insert into sales(sale_no, sale_date, customer_id, status, payment_status, delivery_status, subtotal, total, amount_paid, opening_paid, due_date, salesperson_id, notes, is_historical, stock_deducted_at, created_by)
        values ('HIS-' || lpad(nextval('public.hist_seq')::text, 6, '0'), d, v_cust, 'confirmed', case when paid >= sub then 'paid' when paid > 0 then 'partially_paid' else 'unpaid' end, 'delivered', sub, sub, paid, paid, due, auth.uid(), v_note, true, now(), auth.uid())
        returning id into v_sale;
      for ln in select * from jsonb_array_elements(g.lines) loop
        prod := null;
        if nullif(btrim(ln->>'sku'),'') is not null then
          select * into prod from products where lower(sku) = lower(btrim(ln->>'sku'));
          if not found then raise exception 'no product with SKU "%"', ln->>'sku'; end if;
        end if;
        v_no := v_no + 1; qty := public._imp_num(ln->>'quantity','quantity'); price := public._imp_num(ln->>'unit_price','unit price'); disc := coalesce(public._imp_num(ln->>'discount','discount',false),0);
        insert into sale_items(sale_id, line_no, product_id, description, unit, quantity, unit_price, discount, line_total)
          values (v_sale, v_no, prod.id, coalesce(nullif(btrim(ln->>'description'),''), prod.name || coalesce(' ' || prod.dimensions,'')), coalesce(prod.unit,'pieces'), qty, round(price,2), round(disc,2), round(qty * price - disc, 2));
      end loop;
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created', format('%s line(s), total %s', v_no, sub)));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

create or replace function public._import_historical_expenses(p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; res jsonb := '[]'; c int := 0; s int := 0; e int := 0; n int; i int := 0; v_cat uuid; d date; amt numeric; paid numeric;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; n := coalesce((r->>'_row')::int, i + 1);
    begin
      select id into v_cat from transaction_categories where kind = 'expense' and lower(name) = lower(btrim(coalesce(r->>'category','')));
      if v_cat is null then raise exception 'no expense category named "%"', r->>'category'; end if;
      if btrim(coalesce(r->>'description','')) = '' then raise exception 'description is required'; end if;
      d := public._imp_date(r->>'date','date'); amt := public._imp_num(r->>'amount','amount'); if amt <= 0 then raise exception 'amount must be greater than zero'; end if;
      paid := coalesce(public._imp_num(r->>'paid_amount','paid amount',false), amt); if paid < 0 or paid > amt then raise exception 'paid amount must be between 0 and the expense amount'; end if;
      if exists (select 1 from expenses where expense_date = d and category_id = v_cat and amount = round(amt,2) and lower(btrim(description)) = lower(btrim(r->>'description')) and notes like 'Historical import%') then
        s := s + 1; res := res || jsonb_build_array(public._imp_res(n,'skipped','this expense was already imported')); continue; end if;
      insert into expenses(expense_date, category_id, description, amount, payee, amount_paid, opening_paid, payment_status, approval_status, approved_by, approved_at, notes, created_by)
        values (d, v_cat, btrim(r->>'description'), round(amt,2), nullif(btrim(r->>'payee'),''), round(paid,2), round(paid,2), case when paid >= amt then 'paid' when paid > 0 then 'partially_paid' else 'unpaid' end, 'approved', auth.uid(), now(),
                'Historical import' || coalesce(' — ' || nullif(btrim(r->>'reference'),''), ''), auth.uid());
      c := c + 1; res := res || jsonb_build_array(public._imp_res(n,'created'));
    exception when others then e := e + 1; res := res || jsonb_build_array(public._imp_res(n,'error',sqlerrm));
    end;
  end loop;
  return public._imp_summary(res, c, s, e);
end $$;

-- ----- the one public entry point -------------------------------------
create or replace function public.import_data(p_kind text, p_rows jsonb, p_dry_run boolean default true, p_filename text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_hash text; v_batch uuid; v_errors int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: only the Owner can import data'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'INVALID: the file has no data rows'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'INVALID: import at most 2,000 rows at a time'; end if;
  v_hash := md5(p_kind || p_rows::text);
  if not p_dry_run and exists (select 1 from import_batches where payload_hash = v_hash) then raise exception 'INVALID: this exact file has already been imported'; end if;
  begin
    v := case p_kind
      when 'accounts' then public._import_accounts(p_rows) when 'products' then public._import_products(p_rows) when 'customers' then public._import_customers(p_rows)
      when 'suppliers' then public._import_suppliers(p_rows) when 'employees' then public._import_employees(p_rows) when 'opening_stock' then public._import_opening_stock(p_rows)
      when 'material_opening' then public._import_material_opening(p_rows) when 'opening_receivables' then public._import_opening_receivables(p_rows)
      when 'opening_payables' then public._import_opening_payables(p_rows) when 'historical_sales' then public._import_historical_sales(p_rows)
      when 'historical_expenses' then public._import_historical_expenses(p_rows) end;
    if v is null then raise exception 'INVALID: unknown import type'; end if;
    v_errors := (v->>'errors')::int;
    if p_dry_run or v_errors > 0 then raise exception 'IMPORT_ROLLBACK'; end if;
    insert into import_batches(kind, filename, row_count, created_count, skipped_count, payload_hash, created_by)
      values (p_kind, p_filename, jsonb_array_length(p_rows), (v->>'created')::int, (v->>'skipped')::int, v_hash, auth.uid()) returning id into v_batch;
    perform public._audit('import', 'import_batches', v_batch::text, null, jsonb_build_object('kind', p_kind, 'file', p_filename, 'rows', jsonb_array_length(p_rows), 'created', v->'created', 'skipped', v->'skipped'), null);
    return v || jsonb_build_object('committed', true, 'dry_run', false, 'batch_id', v_batch);
  exception when others then
    if sqlerrm = 'IMPORT_ROLLBACK' then return v || jsonb_build_object('committed', false, 'dry_run', p_dry_run); end if;
    raise;
  end;
end $$;

-- ---------- company logo (public read, owner write) -----------------
insert into storage.buckets (id, name, public) values ('branding', 'branding', true) on conflict (id) do nothing;
drop policy if exists branding_read on storage.objects; drop policy if exists branding_insert on storage.objects; drop policy if exists branding_update on storage.objects; drop policy if exists branding_delete on storage.objects;
create policy branding_read on storage.objects for select using (bucket_id = 'branding');
create policy branding_insert on storage.objects for insert to authenticated with check (bucket_id = 'branding' and public.is_owner());
create policy branding_update on storage.objects for update to authenticated using (bucket_id = 'branding' and public.is_owner());
create policy branding_delete on storage.objects for delete to authenticated using (bucket_id = 'branding' and public.is_owner());

-- ---------- read policies: permission checks evaluated once per query (not per row) ----------
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid() or (select public.has_perm('users','view')));
drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select using (user_id = auth.uid() or (select public.has_perm('users','view')));
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select using ((select public.has_perm('audit','view')));
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select using ((select public.has_perm('accounts','view')) or (select public.has_perm('transactions','create')) or (select public.has_perm('cashbook','view')));
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select using ((select public.has_perm('customers','view')) or (select public.has_perm('transactions','create')));
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers for select using ((select public.has_perm('suppliers','view')) or (select public.has_perm('transactions','create')) or (select public.has_perm('inventory','create')));
drop policy if exists txn_read on public.transactions;
create policy txn_read on public.transactions for select using ((select public.has_perm('transactions','view')) or (select public.has_perm('cashbook','view')));
drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales for select using ((select public.has_perm('sales','view')) or (select public.has_perm('customers','view')) or (select public.has_perm('debts','view')));
drop policy if exists sale_items_read on public.sale_items;
create policy sale_items_read on public.sale_items for select using ((select public.has_perm('sales','view')) or (select public.has_perm('customers','view')) or (select public.has_perm('debts','view')));
drop policy if exists pa_read on public.payment_allocations;
create policy pa_read on public.payment_allocations for select using ((select public.has_perm('sales','view')) or (select public.has_perm('customers','view')) or (select public.has_perm('debts','view')));
drop policy if exists si_read on public.supplier_invoices;
create policy si_read on public.supplier_invoices for select using ((select public.has_perm('suppliers','view')));
drop policy if exists spa_read on public.supplier_payment_allocations;
create policy spa_read on public.supplier_payment_allocations for select using ((select public.has_perm('suppliers','view')));
drop policy if exists invmov_read on public.inventory_movements;
create policy invmov_read on public.inventory_movements for select using ((select public.has_perm('inventory','view')) or (select public.has_perm('production','view')));
drop policy if exists matmov_read on public.material_movements;
create policy matmov_read on public.material_movements for select using ((select public.has_perm('inventory','view')) or (select public.has_perm('production','view')));
drop policy if exists materials_read on public.raw_materials;
create policy materials_read on public.raw_materials for select using ((select public.has_perm('inventory','view')) or (select public.has_perm('production','view')));
drop policy if exists batches_read on public.production_batches;
create policy batches_read on public.production_batches for select using ((select public.has_perm('production','view')));
drop policy if exists pm_read on public.production_materials;
create policy pm_read on public.production_materials for select using ((select public.has_perm('production','view')));
drop policy if exists pc_read on public.production_costs;
create policy pc_read on public.production_costs for select using ((select public.has_perm('production','view')));
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select using ((select public.has_perm('expenses','view')));
drop policy if exists ep_read on public.expense_payments;
create policy ep_read on public.expense_payments for select using ((select public.has_perm('expenses','view')));
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select using ((select public.has_perm('payroll','view')));
drop policy if exists payroll_read on public.payroll_records;
create policy payroll_read on public.payroll_records for select using ((select public.has_perm('payroll','view')));
drop policy if exists budgets_read on public.budgets;
create policy budgets_read on public.budgets for select using ((select public.has_perm('budgets','view')));
drop policy if exists closings_read on public.daily_closings;
create policy closings_read on public.daily_closings for select using ((select public.has_perm('daily_closing','view')));
drop policy if exists recon_read on public.reconciliations;
create policy recon_read on public.reconciliations for select using ((select public.has_perm('daily_closing','view')) or (select public.has_perm('accounts','view')));
drop policy if exists forecast_items_read on public.forecast_items;
create policy forecast_items_read on public.forecast_items for select using ((select public.has_perm('reports','view')) and (select public.has_perm('dashboard','view')));

-- ---------- function privileges: explicit allow-list ----------------
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
  public.reconcile_account(uuid,date,numeric,text,boolean),
  -- phase 5
  public.profit_and_loss(date,date), public.product_profitability(date,date), public.cash_flow_statement(date,date), public.balance_sheet(), public.period_summary(text,date,date),
  public.sales_report(text,date,date,uuid,uuid), public.cash_forecast(jsonb), public.save_forecast_item(uuid,date,text,numeric,text,text,boolean), public.integrity_check(),
  -- phase 6
  public.import_data(text,jsonb,boolean,text)
  to authenticated;
