-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 5: analytics
-- Profit & Loss, product profitability, cash-flow statement, balance sheet,
-- period summaries, sales reports, cash-flow FORECAST, integrity check.
--
-- P&L METHOD (accrual, weighted-average inventory costing)
--   Revenue            = confirmed sales (invoice date) + manual income entries in 'Sales' categories
--   Cost of goods sold = stock dispatched (and returned) at the weighted-average cost of the moment
--                        + stock losses/adjustments + production write-offs
--   Gross profit       = Revenue − COGS
--   Operating expenses = approved expenses, expense invoices, legacy cash expenses, payroll (not batch-linked)
--   Other income / other expenses = categories outside 'Sales'/'Collections' (income) and group 'Other' (expense)
--   NOT in profit: customer collections, transfers, loans, owner contributions/drawings, supplier
--   payments, raw-material purchases (until consumed), batch costs (until the goods are sold).
--   Profit is flagged ESTIMATED when dispatched goods carry no cost.
-- FORECAST is a separate, clearly labelled projection; it never touches actual figures.
-- =====================================================================

insert into public.settings(key, value) values ('forecast', '{
  "collect_pct_current": 90, "collect_pct_1_30": 70, "collect_pct_31_60": 40, "collect_pct_61_90": 20, "collect_pct_90_plus": 5,
  "collect_delay_days": 7, "new_sales_enabled": true, "new_sales_cash_pct": null, "history_days": 30,
  "payables_delay_days": 3, "payroll_pay_delay_days": 3, "unpaid_expense_delay_days": 7,
  "recurring_expenses_enabled": true, "recurring_payroll_enabled": true }') on conflict (key) do nothing;

create table public.forecast_items (
  id uuid primary key default gen_random_uuid(),
  item_date date not null,
  description text not null check (length(btrim(description)) > 0),
  amount numeric(16,2) not null check (amount > 0),
  direction text not null check (direction in ('in','out')),
  kind text not null default 'planned_expense' check (kind in ('planned_expense','planned_income','loan_repayment','loan_receipt','other')),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index forecast_items_date_idx on public.forecast_items(item_date) where active;
alter table public.forecast_items enable row level security;
create policy forecast_items_read on public.forecast_items for select using (public.has_perm('reports','view') and public.has_perm('dashboard','view'));
revoke all on public.forecast_items from anon, authenticated;
grant select on public.forecast_items to authenticated;

create or replace function public.save_forecast_item(p_id uuid, p_date date, p_description text, p_amount numeric, p_direction text, p_kind text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('budgets', case when p_id is null then 'create' else 'edit' end) then raise exception 'FORBIDDEN: you may not change the forecast plan'; end if;
  if p_direction not in ('in','out') then raise exception 'INVALID: direction must be in or out'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID: amount must be greater than zero'; end if;
  if p_date is null or p_date <= public._kampala_today() then raise exception 'INVALID: planned items must be dated in the future'; end if;
  if p_description is null or btrim(p_description) = '' then raise exception 'INVALID: description is required'; end if;
  if p_id is null then
    insert into forecast_items(item_date, description, amount, direction, kind, created_by) values (p_date, btrim(p_description), round(p_amount,2), p_direction, coalesce(p_kind,'other'), auth.uid()) returning id into v_id;
  else
    update forecast_items set item_date = p_date, description = btrim(p_description), amount = round(p_amount,2), direction = p_direction, kind = coalesce(p_kind,kind), active = p_active where id = p_id returning id into v_id;
    if v_id is null then raise exception 'INVALID: planned item not found'; end if;
  end if;
  perform public._audit(case when p_id is null then 'create' else 'edit' end, 'forecast_items', v_id::text, null, jsonb_build_object('date',p_date,'amount',p_amount,'direction',p_direction,'active',p_active), null);
  return v_id;
end $$;

create or replace function public._fin_access() returns void language plpgsql stable security definer set search_path = public as $$
begin if not (public.has_perm('reports','view') and public.has_perm('dashboard','view')) then raise exception 'FORBIDDEN: financial reports are restricted'; end if; end $$;

-- ---------- Profit & Loss ------------------------------------------
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
    from sales where status = 'confirmed' and sale_date between p_from and p_to;
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

-- ---------- product profitability -----------------------------------
create or replace function public.product_profitability(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_trans numeric;
begin
  perform public._fin_access();
  with lines as (
    select si.sale_id, si.product_id, coalesce(p.name, si.description) as name, si.quantity qty,
           si.line_total - case when s.subtotal > 0 then s.discount * si.line_total / s.subtotal else 0 end as net_rev,
           coalesce(p.avg_cost, 0) avg_cost, coalesce(p.production_cost_estimate, 0) est
      from sale_items si join sales s on s.id = si.sale_id and s.status = 'confirmed' and s.sale_date between p_from and p_to left join products p on p.id = si.product_id),
  disp as (select source_id sale_id, product_id, sum(-quantity) dq, sum(-quantity * unit_cost) dc from inventory_movements where kind = 'sale' and source_type = 'sale' group by 1,2),
  costed as (
    select l.name, l.product_id, l.qty, l.net_rev,
           case when d.dq > 0 then l.qty * d.dc / d.dq else l.qty * case when l.avg_cost > 0 then l.avg_cost else l.est end end as cost,
           (d.dq is null or d.dq = 0) as estimated
      from lines l left join disp d on d.sale_id = l.sale_id and d.product_id = l.product_id)
  select coalesce(jsonb_agg(jsonb_build_object('product', name, 'quantity', q, 'revenue', round(rev,2), 'cost', round(cost,2), 'gross_profit', round(rev - cost,2),
           'margin_pct', case when rev > 0 then round((rev - cost) * 100 / rev, 1) end, 'cost_per_unit', case when q > 0 then round(cost / q, 2) end,
           'estimated_cost_share_pct', case when cost > 0 then round(coalesce(est_cost,0) * 100 / cost, 0) else 0 end) order by rev desc), '[]'::jsonb) into v_rows
    from (select name, sum(qty) q, sum(net_rev) rev, sum(cost) cost, sum(cost) filter (where estimated) est_cost from costed group by name) z;
  select coalesce(sum(transport_charge),0) into v_trans from sales where status = 'confirmed' and sale_date between p_from and p_to;
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows, 'transport_revenue', v_trans);
end $$;

-- ---------- cash-flow statement (actual account movements) ----------
create or replace function public.cash_flow_statement(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_lines jsonb; v_in numeric; v_out numeric;
begin
  perform public._fin_access();
  select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end) from transactions t join accounts a2 on a2.id = t.account_id and a2.status = 'active' where t.txn_date < p_from and t.type <> 'transfer'),0)
    into v_open from accounts a where a.status = 'active';
  with m as (
    select case when t.type = 'customer_payment' then 'Operating' when t.type = 'income' then 'Operating' when t.type = 'refund' then 'Operating' when t.type = 'supplier_payment' then 'Operating'
                when t.type = 'expense' then 'Operating' when t.type::text = 'expense_payment' then 'Operating'
                when t.type in ('loan_received','loan_repayment','owner_contribution','owner_withdrawal') then 'Financing' else 'Other' end as section,
           case when t.type = 'customer_payment' then 'Receipts from customers' when t.type = 'income' then 'Other income received' when t.type = 'refund' then 'Customer refunds'
                when t.type = 'supplier_payment' then 'Payments to suppliers'
                when t.type = 'expense' and t.batch_id is not null then 'Production labour & costs paid'
                when t.type = 'expense' then 'Expenses paid (direct)'
                when t.type::text = 'expense_payment' and exists (select 1 from payroll_records p where p.paid_txn_id = t.id) then 'Payroll paid'
                when t.type::text = 'expense_payment' then 'Expenses paid'
                when t.type = 'loan_received' then 'Loans received' when t.type = 'loan_repayment' then 'Loan repayments'
                when t.type = 'owner_contribution' then 'Owner contributions' when t.type = 'owner_withdrawal' then 'Owner withdrawals' else 'Adjustments' end as label,
           case when t.direction = 'in' then t.amount else 0 end as i, case when t.direction = 'out' then t.amount else 0 end as o
      from transactions t join accounts a on a.id = t.account_id and a.status = 'active'
     where t.txn_date between p_from and p_to and t.type <> 'transfer')
  select coalesce(jsonb_agg(jsonb_build_object('section', section, 'label', label, 'inflow', i, 'outflow', o, 'net', i - o) order by section desc, i - o desc), '[]'::jsonb), coalesce(sum(i),0), coalesce(sum(o),0)
    into v_lines, v_in, v_out from (select section, label, sum(i) i, sum(o) o from m group by 1,2) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'opening', v_open, 'lines', v_lines, 'inflows', v_in, 'outflows', v_out, 'net', v_in - v_out, 'closing', v_open + v_in - v_out,
    'note', 'Actual money movements only. Transfers between your own accounts are excluded (net zero).');
end $$;

-- ---------- balance sheet (as at today, from live balances) ---------
create or replace function public.balance_sheet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cash jsonb; v_cash_t numeric; v_rec numeric; v_inv_fg numeric; v_inv_rm numeric; v_pay numeric; v_unpaid_exp numeric; v_payroll numeric; v_cust_credit numeric; v_loans numeric;
        v_contrib numeric; v_draw numeric; v_assets numeric; v_liab numeric; v_equity numeric; v_supp_adv numeric; v_cum_profit jsonb;
begin
  perform public._fin_access();
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'type', type, 'balance', bal) order by name),'[]'::jsonb), coalesce(sum(bal),0) into v_cash, v_cash_t from (
    select a.name, a.type, a.opening_balance + coalesce((select sum(case direction when 'in' then amount else -amount end) from transactions where account_id = a.id),0) bal from accounts a where a.status = 'active') x;
  select coalesce(sum(balance),0) into v_rec from sales where status = 'confirmed';
  select coalesce(sum(greatest(current_stock,0) * avg_cost),0) into v_inv_fg from products;
  select coalesce(sum(greatest(current_stock,0) * unit_cost),0) into v_inv_rm from raw_materials;
  select coalesce(sum(balance),0) into v_pay from supplier_invoices where status = 'open';
  select coalesce(sum(balance),0) into v_unpaid_exp from expenses where status = 'open' and approval_status = 'approved';
  select coalesce(sum(total_pay),0) into v_payroll from payroll_records where status = 'approved';
  select coalesce(sum(c.credit_balance) filter (where c.credit_balance > 0),0) into v_cust_credit from (
    select coalesce((select sum(amount) from transactions where customer_id = cu.id and type = 'customer_payment' and status = 'posted' and not is_reversal),0)
         - coalesce((select sum(pa.amount) from payment_allocations pa join transactions t on t.id = pa.payment_txn_id where t.customer_id = cu.id and not pa.reversed),0)
         - coalesce((select sum(amount) from transactions where customer_id = cu.id and type = 'refund' and status = 'posted' and not is_reversal),0) credit_balance from customers cu) c;
  select coalesce(sum(c.adv) filter (where c.adv > 0),0) into v_supp_adv from (
    select coalesce((select sum(amount) from transactions where supplier_id = su.id and type = 'supplier_payment' and status = 'posted' and not is_reversal),0)
         - coalesce((select sum(pa.amount) from supplier_payment_allocations pa join transactions t on t.id = pa.payment_txn_id where t.supplier_id = su.id and not pa.reversed),0) adv from suppliers su) c;
  select coalesce(sum(case type when 'loan_received' then amount when 'loan_repayment' then -amount end),0) into v_loans from transactions where status = 'posted' and not is_reversal and type in ('loan_received','loan_repayment');
  select coalesce(sum(amount) filter (where type = 'owner_contribution'),0), coalesce(sum(amount) filter (where type = 'owner_withdrawal'),0) into v_contrib, v_draw from transactions where status = 'posted' and not is_reversal;
  v_assets := v_cash_t + v_rec + v_inv_fg + v_inv_rm + v_supp_adv;
  v_liab := v_pay + v_unpaid_exp + v_payroll + v_cust_credit + greatest(v_loans, 0);
  v_equity := v_assets - v_liab;
  select public.profit_and_loss('2000-01-01', public._kampala_today()) into v_cum_profit;
  return jsonb_build_object('as_at', public._kampala_today(),
    'assets', jsonb_build_object('cash_and_bank', v_cash, 'cash_and_bank_total', v_cash_t, 'receivables', v_rec, 'finished_goods', v_inv_fg, 'raw_materials', v_inv_rm, 'supplier_advances', v_supp_adv, 'total', v_assets),
    'liabilities', jsonb_build_object('supplier_payables', v_pay, 'unpaid_expenses', v_unpaid_exp, 'payroll_owed', v_payroll, 'customer_credit', v_cust_credit, 'loans', greatest(v_loans, 0), 'total', v_liab),
    'equity', jsonb_build_object('owner_contributions', v_contrib, 'owner_withdrawals', v_draw, 'net_assets', v_equity, 'retained_and_opening_balance', v_equity - v_contrib + v_draw, 'profit_to_date_per_pl', v_cum_profit->'net_profit'),
    'notes', jsonb_build_array('Provisional: built from live balances. Equity is the balancing figure (assets − liabilities).',
                               'Fixed assets, depreciation, tax and accruals outside the system are not tracked.',
                               'Retained earnings & opening capital = net assets − contributions + drawings; compare with profit to date to spot unrecorded items.'));
end $$;

-- ---------- period summaries (daily / monthly) ----------------------
create or replace function public.period_summary(p_group text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rows jsonb;
begin
  perform public._fin_access();
  if p_group not in ('day','month') then raise exception 'INVALID: group must be day or month'; end if;
  select coalesce(sum(a.opening_balance),0) + coalesce((select sum(case t.direction when 'in' then t.amount else -t.amount end) from transactions t join accounts a2 on a2.id = t.account_id and a2.status = 'active' where t.txn_date < p_from and t.type <> 'transfer'),0)
    into v_open from accounts a where a.status = 'active';
  with ev as (
    select d, amount rev, 0::numeric cogs, 0::numeric opex, 0::numeric mi, 0::numeric mo from _revenue_events where d between p_from and p_to
    union all select d, 0, amount, 0, 0, 0 from _cogs_events where d between p_from and p_to
    union all select d, 0, 0, amount, 0, 0 from _expense_events where d between p_from and p_to
    union all select t.txn_date, 0, 0, 0, case when t.direction = 'in' then t.amount else 0 end, case when t.direction = 'out' then t.amount else 0 end
      from transactions t join accounts a on a.id = t.account_id and a.status = 'active' where t.txn_date between p_from and p_to and t.type <> 'transfer'),
  g as (select case p_group when 'day' then d::text else to_char(d,'YYYY-MM') end k, sum(rev) rev, sum(cogs) cogs, sum(opex) opex, sum(mi) mi, sum(mo) mo from ev group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('period', k, 'revenue', rev, 'cogs', cogs, 'gross_profit', rev - cogs, 'expenses', opex, 'net_profit', rev - cogs - opex, 'money_in', mi, 'money_out', mo, 'net_cash', mi - mo,
           'closing_cash', v_open + run) order by k), '[]'::jsonb) into v_rows
    from (select g.*, sum(mi - mo) over (order by k rows between unbounded preceding and current row) run from g) x;
  return jsonb_build_object('group', p_group, 'from', p_from, 'to', p_to, 'opening_cash', v_open, 'rows', v_rows);
end $$;

-- ---------- sales report --------------------------------------------
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
       where s.status = 'confirmed' and s.sale_date between p_from and p_to and (p_customer is null or s.customer_id = p_customer)
         and (p_product is null or exists (select 1 from sale_items si where si.sale_id = s.id and si.product_id = p_product))
       group by 1) x;
  end if;
  return jsonb_build_object('group', p_group, 'from', p_from, 'to', p_to, 'rows', v_rows);
end $$;

-- ---------- cash-flow FORECAST (projection — never mixed with actuals)
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
  select coalesce(sum(total),0) / v_hist into v_avg from sales where status = 'confirmed' and sale_date > v_today - v_hist and sale_date <= v_today;
  -- share of invoiced value historically paid on the dn of sale (data-driven unless overridden)
  v_share := coalesce(nullif(v_a->>'new_sales_cash_pct','')::numeric,
     (select least(100, round(100 * coalesce(sum(pa.amount) filter (where t.txn_date = s.sale_date),0) / nullif(sum(distinct s.total),0), 0)) from sales s left join payment_allocations pa on pa.sale_id = s.id and not pa.reversed left join transactions t on t.id = pa.payment_txn_id where s.status = 'confirmed' and s.sale_date > v_today - 90),
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
  rows_ as (
    select d.dn, d.dt,
      coalesce((select sum(amt) from coll c where c.dn = d.dn),0)::numeric as in_collections,
      (case when v_newsales then v_avg * v_share / 100 + case when d.dn >= 1 + v_days + v_delay then v_avg * (1 - v_share / 100) * v_cur / 100 else 0 end else 0 end)::numeric as in_new_sales,
      coalesce((select sum(amount) from planned p where p.dn = d.dn and p.direction = 'in'),0)::numeric as in_planned,
      coalesce((select sum(amt) from sup s where s.dn = d.dn),0)::numeric as out_suppliers,
      (coalesce((select sum(amt) from unpaid_pay u where u.dn = d.dn),0) + case when v_recpay and d.dn > v_paydelay then v_rec_pay else 0 end)::numeric as out_payroll,
      (coalesce((select sum(amt) from unpaid_exp e where e.dn = d.dn),0) + case when v_recexp then v_rec_exp else 0 end)::numeric as out_expenses,
      coalesce((select sum(amount) from planned p where p.dn = d.dn and p.direction = 'out'),0)::numeric as out_planned
    from days d),
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

create or replace function public.cash_forecast(p_assumptions jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin perform public._fin_access(); return public._cash_forecast_core(p_assumptions); end $$;

-- ---------- data integrity check (owner) ----------------------------
create or replace function public.integrity_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb; n int;
begin
  if not public.is_owner() then raise exception 'FORBIDDEN: owner only'; end if;
  select count(*) into n from sales s where s.status <> 'draft' and s.amount_paid <> coalesce((select sum(amount) from payment_allocations where sale_id = s.id and not reversed),0);
  v := v || jsonb_build_object('name','Invoice paid amounts equal their live payment allocations','ok', n = 0,'detail', n || ' mismatch(es)');
  select count(*) into n from sales where amount_paid > total and status = 'confirmed';
  v := v || jsonb_build_object('name','No invoice is over-paid','ok', n = 0,'detail', n || ' invoice(s)');
  select count(*) into n from supplier_invoices i where i.amount_paid <> coalesce((select sum(amount) from supplier_payment_allocations where invoice_id = i.id and not reversed),0);
  v := v || jsonb_build_object('name','Supplier invoice paid amounts equal allocations','ok', n = 0,'detail', n || ' mismatch(es)');
  select count(*) into n from expenses e where e.amount_paid <> coalesce((select sum(amount) from expense_payments where expense_id = e.id and not reversed),0);
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
  select count(*) into n from (select s.id, si.product_id, sum(si.quantity) q from sales s join sale_items si on si.sale_id = s.id where s.stock_deducted_at is not null and si.product_id is not null group by 1,2) x
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

-- ---------- dashboard: forecast shortage signal ---------------------
alter function public.dashboard_summary(date, date) rename to _dashboard_mgmt;
create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_core jsonb := public._dashboard_mgmt(p_from, p_to); v_f jsonb;
begin
  v_f := public._cash_forecast_core(null);
  return v_core || jsonb_build_object('forecast_shortage',
    (select case when (x->'first_shortage') is not null and jsonb_typeof(x->'first_shortage') <> 'null' and (x->'first_shortage'->>'day')::int <= 30 then x->'first_shortage' end from (select v_f x) q),
    'forecast_lowest_30', (select jsonb_build_object('date', e->>'date', 'balance', (e->>'balance')::numeric) from jsonb_array_elements(v_f->'daily') e where (e->>'day')::int <= 30 order by (e->>'balance')::numeric limit 1));
end $$;

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
  public.sales_report(text,date,date,uuid,uuid), public.cash_forecast(jsonb), public.save_forecast_item(uuid,date,text,numeric,text,text,boolean), public.integrity_check()
  to authenticated;
