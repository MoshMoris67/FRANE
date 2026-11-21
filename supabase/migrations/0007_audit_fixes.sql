-- =====================================================================
-- FRANE CONCRETE FACTORY — Phase 7: audit fixes
-- Found by supabase/tests/audit_identity.sql (net assets must equal contributions − drawings + cumulative profit).
--  1. balance_sheet() omitted unpaid production costs, so finished goods (which include them) overstated net assets.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.balance_sheet()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cash jsonb; v_cash_t numeric; v_rec numeric; v_inv_fg numeric; v_inv_rm numeric; v_pay numeric; v_unpaid_exp numeric; v_payroll numeric; v_cust_credit numeric; v_loans numeric;
        v_contrib numeric; v_draw numeric; v_assets numeric; v_liab numeric; v_equity numeric; v_supp_adv numeric; v_cum_profit jsonb; v_prod_unpaid numeric;
begin
  perform public._fin_access();
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'type', type, 'balance', bal) order by name),'[]'::jsonb), coalesce(sum(bal),0) into v_cash, v_cash_t from (
    select a.name, a.type, a.opening_balance + coalesce((select sum(case direction when 'in' then amount else -amount end) from transactions where account_id = a.id),0) bal from accounts a where a.status = 'active') x;
  select coalesce(sum(balance),0) into v_rec from sales where status = 'confirmed';
  select coalesce(sum(greatest(current_stock,0) * avg_cost),0) into v_inv_fg from products;
  select coalesce(sum(greatest(current_stock,0) * unit_cost),0) into v_inv_rm from raw_materials;
  select coalesce(sum(balance),0) into v_pay from supplier_invoices where status = 'open';
  select coalesce(sum(balance),0) into v_unpaid_exp from expenses where status = 'open' and approval_status = 'approved';
  -- Costs capitalised into a batch (labour, other) that are not yet paid are a liability the moment they are in stock value.
  -- Payroll that is linked to a batch lives in production_costs, so payroll_owed below counts only payroll with no batch.
  select coalesce(sum(amount),0) into v_prod_unpaid from production_costs where not paid and not voided;
  select coalesce(sum(total_pay),0) into v_payroll from payroll_records where status = 'approved' and batch_id is null;
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
  v_liab := v_pay + v_unpaid_exp + v_payroll + v_prod_unpaid + v_cust_credit + greatest(v_loans, 0);
  v_equity := v_assets - v_liab;
  select public.profit_and_loss('2000-01-01', public._kampala_today()) into v_cum_profit;
  return jsonb_build_object('as_at', public._kampala_today(),
    'assets', jsonb_build_object('cash_and_bank', v_cash, 'cash_and_bank_total', v_cash_t, 'receivables', v_rec, 'finished_goods', v_inv_fg, 'raw_materials', v_inv_rm, 'supplier_advances', v_supp_adv, 'total', v_assets),
    'liabilities', jsonb_build_object('supplier_payables', v_pay, 'unpaid_expenses', v_unpaid_exp, 'payroll_owed', v_payroll, 'unpaid_production_costs', v_prod_unpaid, 'customer_credit', v_cust_credit, 'loans', greatest(v_loans, 0), 'total', v_liab),
    'equity', jsonb_build_object('owner_contributions', v_contrib, 'owner_withdrawals', v_draw, 'net_assets', v_equity, 'retained_and_opening_balance', v_equity - v_contrib + v_draw, 'profit_to_date_per_pl', v_cum_profit->'net_profit'),
    'notes', jsonb_build_array('Provisional: built from live balances. Equity is the balancing figure (assets − liabilities).',
                               'Fixed assets, depreciation, tax and accruals outside the system are not tracked.',
                               'Retained earnings & opening capital = net assets − contributions + drawings; compare with profit to date to spot unrecorded items.'));
end $function$;

-- ---------------------------------------------------------------------
--  2. Opening balance is a historical fact. Once an account has any movement, reconciliation or closing it is
--     LOCKED for everyone (owner included): changing it silently rewrites every past balance with no ledger entry.
--     Corrections go through reconcile_account (a visible, audited adjustment).
-- ---------------------------------------------------------------------
create or replace function public.guard_account() returns trigger language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  new.updated_at := now();
  if new.opening_balance is distinct from old.opening_balance
     and (exists (select 1 from transactions where account_id = old.id)
          or exists (select 1 from reconciliations where account_id = old.id)
          or exists (select 1 from daily_closings where account_id = old.id)) then
    raise exception 'LOCKED: this account already has activity, so its opening balance can no longer be changed. Use Reconcile to record a correction.';
  end if;
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

-- ---------------------------------------------------------------------
--  3. NaN / Infinity guard. In PostgreSQL 'NaN' > 0 is TRUE, so every "amount > 0" check let it through, and a single NaN
--     row turns every sum (balances, P&L, dashboard) into NaN. Every numeric column of every table now refuses it.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.table_name, c.column_name from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
            where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'numeric' loop
    begin
      execute format('alter table public.%I add constraint %I check (%I is null or (%I > ''-Infinity''::numeric and %I < ''Infinity''::numeric))',
                     r.table_name, left(r.table_name || '_' || r.column_name || '_finite', 63), r.column_name, r.column_name, r.column_name);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- friendly message at the single entry point for every ledger posting (the constraint above is the backstop)
CREATE OR REPLACE FUNCTION public._post_txn(p_type txn_type, p_date date, p_account uuid, p_amount numeric, p_desc text, p_customer uuid, p_supplier uuid, p_sale uuid, p_method text, p_ref text, p_notes text, p_attach jsonb, p_idem uuid, p_receipt text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dir public.txn_direction; v_acc accounts; v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount = 'NaN'::numeric or p_amount = 'Infinity'::numeric then raise exception 'INVALID: amount must be greater than zero'; end if;
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
end $function$;

-- ---------------------------------------------------------------------
--  4. File uploads: size and type limits enforced by Storage itself (not just the browser).
--     Receipts: images and PDF, 5 MB. Logo: PNG/JPEG/WebP only (SVG can carry scripts), 2 MB, replaced only by the Owner.
--     Guarded so the file still runs on a database whose storage schema has no limit columns.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit')
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','application/pdf'] where id = 'attachments';
    update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'branding';
  end if;
end $$;
