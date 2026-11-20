-- Phase 3 tests: stock, costing, production, fulfilment, COGS, privileges
\set ON_ERROR_STOP off
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$ begin raise notice '% : %', case when coalesce(ok,false) then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails(name text, sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise notice 'FAIL : % (no error)', name;
exception when others then raise notice '% : % [%]', case when sqlerrm like '%'||expect||'%' then 'PASS' else 'FAIL' end, name, left(sqlerrm,100); end $$;

reset role;
create temp table ids as select (select id from accounts where name='Cash') cash, (select id from transaction_categories where name='Casual labour' and kind='expense') lab, (select id from suppliers where name='Hima Cement') sup;
grant select on ids to authenticated;
insert into auth.users(id,email) values ('55555555-5555-5555-5555-555555555555','sup@x');
set role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select set_user_access('55555555-5555-5555-5555-555555555555','supervisor',true);

do $$ declare
  cash uuid; bank uuid; sup uuid; cem uuid; snd uuid; p1 uuid; cu uuid; s1 uuid; b1 uuid; b2 uuid; pm uuid; c1 uuid; c2 uuid; c3 uuid; t uuid; r jsonb; v numeric; exp0 numeric; cogs0 numeric; cash0 numeric; stock numeric; cpu numeric; lab uuid; fuel uuid; mv uuid; mv2 uuid; inv uuid;
begin
  perform pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  select id into cash from accounts where name='Cash'; select id into bank from accounts where name='Bank';
  select id into sup from suppliers where name='Hima Cement'; select id into cem from raw_materials where name='Cement'; select id into snd from raw_materials where name='Sand';
  select id into p1 from products where sku='HB-6'; select id into cu from customers where name='Mukasa Builders';
  select id into lab from transaction_categories where name='Casual labour' and kind='expense';
  -- phase2 left 100 bags (cancelled → 0) and 40t sand
  select current_stock into v from raw_materials where id=cem;
  perform pg_temp.check('cancelling a materials invoice took its stock back out', v=0);
  perform pg_temp.check('phase2 sand purchase stocked 40t at 5000', (select current_stock from raw_materials where id=snd)=40 and (select unit_cost from raw_materials where id=snd)=5000);

  -- weighted average costing on purchases
  perform record_material_opening(cem, 50, 30000);
  inv := record_material_purchase(sup, current_date, 'HC-200', null, jsonb_build_array(jsonb_build_object('material_id',cem,'quantity',100,'unit_cost',32000)));
  perform pg_temp.check('weighted average: (50×30000 + 100×32000)/150 = 31333.3333', (select unit_cost from raw_materials where id=cem)=31333.3333 and (select current_stock from raw_materials where id=cem)=150);
  perform pg_temp.check('purchase created an unpaid payable of 3,200,000 and is not an expense', (select balance from supplier_invoices where id=inv)=3200000 and (select kind from supplier_invoices where id=inv)='materials');
  perform pg_temp.fails('direct expense on inventory-tracked category blocked', format('select record_transaction(%L,current_date,%L,1000,%L,%L)','expense',cash,'cement cash',(select id from transaction_categories where name='Cement' and kind='expense')), 'inventory-tracked');
  perform pg_temp.fails('materials kind via generic supplier invoice blocked', format('select record_supplier_invoice(%L,%L,current_date,null,%L,null,%L,1000)',sup,'x','materials','cement'), 'Receive materials');
  perform pg_temp.fails('material purchase needs positive qty', format('select record_material_purchase(%L,current_date,null,null,%L)',sup,jsonb_build_array(jsonb_build_object('material_id',cem,'quantity',0,'unit_cost',1))::text), 'greater than zero');

  -- production batch workflow
  select (dashboard_summary(current_date,current_date)->>'expenses')::numeric into exp0;
  select current_balance into cash0 from account_balances where name='Cash';
  b1 := create_batch(p1, current_date, 1000, 'Supervisor Sam', 'first run');
  perform pg_temp.fails('materials need an in-progress batch', format('select add_batch_material(%L,%L,10)',b1,cem), 'in progress');
  perform start_batch(b1);
  pm := add_batch_material(b1, cem, 30);
  perform pg_temp.check('consumption posts at weighted average: 30 × 31333.3333 = 940,000', (select total_cost from production_materials where id=pm)=940000 and (select current_stock from raw_materials where id=cem)=120);
  perform add_batch_material(b1, snd, 10);
  perform pg_temp.check('batch material cost = 940000 + 50000', (select material_cost from production_batches where id=b1)=990000);
  perform pg_temp.fails('cannot consume more than on hand', format('select add_batch_material(%L,%L,9999)',b1,cem), 'INSUFFICIENT_STOCK');
  c1 := add_batch_cost(b1,'labour','Block makers',100000,'Team A');                       -- incurred, unpaid
  c2 := add_batch_cost(b1,'other','Loading',50000,null,jsonb_build_object('account_id',cash,'category_id',lab));   -- incurred and paid now
  perform pg_temp.check('paid cost reduced cash', (select current_balance from account_balances where name='Cash')=cash0-50000);
  perform pg_temp.check('incurred 150000 but only 50000 paid', (select other_cost from production_batches where id=b1)=150000 and (select paid from production_costs where id=c2) and not (select paid from production_costs where id=c1));
  perform pg_temp.check('batch-tagged payment is NOT period operating expense', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0);
  perform pg_temp.fails('cannot complete with rejects > produced', format('select complete_batch(%L,100,200)',b1), 'rejected');
  r := complete_batch(b1, 1000, 50);
  cpu := round((990000+150000)/950.0, 4);
  perform pg_temp.check('accepted = 950, total cost 1,140,000', (r->>'accepted')::numeric=950 and (r->>'total_cost')::numeric=1140000);
  perform pg_temp.check('cost per unit = total / accepted', (select cost_per_unit from production_batches where id=b1)=cpu);
  perform pg_temp.check('finished goods stock +950 at batch cost', (select current_stock from products where id=p1)=950 and (select avg_cost from products where id=p1)=cpu);
  perform pg_temp.check('product cost estimate updated', (select production_cost_estimate from products where id=p1)=round(cpu,2));
  perform pg_temp.fails('closed batch rejects new costs', format('select add_batch_cost(%L,%L,%L,10)',b1,'other','late'), 'before the batch is completed');
  perform pg_temp.fails('batch cannot be completed twice', format('select complete_batch(%L,10,0)',b1), 'in progress');

  -- fulfilment deducts exactly once, at the cost of the moment
  select (dashboard_summary(current_date,current_date)->>'cogs')::numeric into cogs0;
  s1 := save_sale(null, cu, current_date, jsonb_build_array(jsonb_build_object('product_id',p1,'quantity',200,'unit_price',2500)), 0,0,null,null,null,true);
  perform pg_temp.check('confirming a sale does not move stock', (select current_stock from products where id=p1)=950);
  perform set_delivery_status(s1,'loading');
  perform pg_temp.check('loading does not move stock', (select current_stock from products where id=p1)=950);
  perform set_delivery_status(s1,'dispatched');
  perform pg_temp.check('dispatch deducts 200', (select current_stock from products where id=p1)=750);
  perform set_delivery_status(s1,'delivered');
  perform pg_temp.check('delivered after dispatched does not deduct again', (select current_stock from products where id=p1)=750 and (select count(*) from inventory_movements where source_type='sale' and source_id=s1 and kind='sale')=1);
  perform pg_temp.fails('cannot move a dispatched order back', format('select set_delivery_status(%L,%L)',s1,'pending'), 'return');
  perform pg_temp.check('dispatch movement carries cost per unit', (select unit_cost from inventory_movements where source_id=s1 and kind='sale')=cpu);
  r := dashboard_summary(current_date,current_date);
  perform pg_temp.check('COGS = 200 × cost per unit', abs((r->>'cogs')::numeric - cogs0 - 200*cpu) < 0.01);
  perform pg_temp.check('costing is complete (no zero-cost dispatches)', (r->>'cogs_incomplete')::numeric=0);

  -- returns, damage, adjustments
  mv := record_return(p1, 50, s1, 'Customer returned broken pallet');
  perform pg_temp.check('return restores stock at original cost', (select current_stock from products where id=p1)=800 and (select unit_cost from inventory_movements where id=mv)=cpu);
  perform pg_temp.fails('cannot return more than was dispatched', format('select record_return(%L,200,%L,%L)',p1,s1,'too many'), 'can still be returned');
  perform record_damage(p1, 10, 'Dropped in yard');
  perform pg_temp.check('damage reduces stock', (select current_stock from products where id=p1)=790);
  r := dashboard_summary(current_date,current_date);
  perform pg_temp.check('COGS now 150×cpu + 10×cpu losses', abs((r->>'cogs')::numeric - cogs0 - 160*cpu) < 0.01);
  perform pg_temp.fails('adjustment needs a reason', format('select adjust_stock(%L,5,%L)',p1,''), 'reason');
  mv2 := adjust_stock(p1, -800, 'Stock-take: write down', current_date, true);
  perform pg_temp.check('negative stock only via override and is flagged', (select current_stock from products where id=p1)=-10 and (select flagged_negative from inventory_movements where id=mv2));
  perform adjust_stock(p1, 10, 'Recount corrected', current_date);
  perform pg_temp.fails('stock cannot silently go negative', format('select record_damage(%L,5,%L)',p1,'x y z'), 'INSUFFICIENT_STOCK');
  perform adjust_stock(p1, 790, 'Restore after test', current_date);

  -- cancel a batch: materials return, paid costs fall into operating expenses
  b2 := create_batch(p1, current_date, 100, null, null, true);
  perform add_batch_material(b2, cem, 10);
  c3 := add_batch_cost(b2,'labour','Casual',20000,null,jsonb_build_object('account_id',cash,'category_id',lab));
  select current_stock into stock from raw_materials where id=cem;
  select (dashboard_summary(current_date,current_date)->>'expenses')::numeric into exp0;
  perform cancel_batch(b2, 'Mould broke');
  perform pg_temp.check('cancelled batch returned materials', (select current_stock from raw_materials where id=cem)=stock+10);
  perform pg_temp.check('cash already paid becomes a normal expense (20,000)', (dashboard_summary(current_date,current_date)->>'expenses')::numeric=exp0+20000);
  perform pg_temp.check('unpaid costs on cancelled batch are voided, none left', not exists (select 1 from production_costs where batch_id=b2 and not voided and not paid));

  -- unpaid cost: pay later, reversal re-opens it
  b2 := create_batch(p1, current_date, 50, null, null, true);
  c1 := add_batch_cost(b2,'labour','Loaders',30000);
  t := pay_batch_cost(c1, cash, lab);
  perform pg_temp.check('pay later links ledger expense to the batch', (select batch_id from transactions where id=t)=b2 and (select paid from production_costs where id=c1));
  perform reverse_transaction(t, 'Paid wrong team');
  perform pg_temp.check('reversing the payment marks the cost unpaid again', not (select paid from production_costs where id=c1));
  perform void_batch_cost(c1, 'Not needed');
  perform pg_temp.check('voided cost leaves the batch total', (select other_cost from production_batches where id=b2)=0);

  -- ledger identities
  perform pg_temp.check('cached product stock = Σ movements', (select current_stock from products where id=p1)=(select sum(quantity) from inventory_movements where product_id=p1));
  perform pg_temp.check('cached material stock = Σ movements (all materials)', not exists (select 1 from raw_materials m where m.current_stock <> coalesce((select sum(quantity) from material_movements x where x.material_id=m.id),0)));
  perform pg_temp.check('cached product stock = Σ movements (all products)', not exists (select 1 from products p where p.current_stock <> coalesce((select sum(quantity) from inventory_movements x where x.product_id=p.id),0)));
  r := production_report(current_date-1, current_date);
  perform pg_temp.check('production report lists batch output and costs', (r->'by_product'->0->>'accepted')::numeric=950 and (r->'by_product'->0->>'cost_per_unit')::numeric=1200 and jsonb_array_length(r->'materials')>=1);
  perform pg_temp.check('dashboard exposes operations', (dashboard_summary(current_date,current_date)->>'stock_value') is not null and jsonb_array_length(dashboard_summary(current_date,current_date)->'sales_by_product')>=1);
end $$;

-- direct writes are impossible
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.fails('cannot set product stock directly', $q$update products set current_stock = 9999$q$, '');
select pg_temp.fails('cannot insert stock movement directly', $q$insert into inventory_movements(product_id,movement_date,kind,quantity,balance_after) select id,current_date,'adjustment',1,1 from products limit 1$q$, '');
select pg_temp.fails('cannot edit material cost directly', $q$update raw_materials set unit_cost = 1$q$, '');
select pg_temp.fails('internal helpers are not callable', $q$select _post_stock((select id from products limit 1), current_date, 'adjustment', 1, 1, 'x', null, 'x', true)$q$, 'permission denied');
select pg_temp.fails('internal ledger poster is not callable', $q$select _post_txn('customer_payment', current_date, (select id from accounts limit 1), 1, 'x', null, null, null, null, null, null, '[]', null, null)$q$, 'permission denied');
select pg_temp.check('public API stays callable', has_function_privilege('authenticated','public.record_transaction(txn_type,date,uuid,numeric,text,uuid,text,text,uuid,uuid,text,jsonb,uuid,txn_direction,boolean)','execute'));

-- roles
select pg_temp.as_user('55555555-5555-5555-5555-555555555555'); -- supervisor
select pg_temp.check('supervisor sees batches and materials', (select count(*) from production_batches)>0 and (select count(*) from raw_materials)>0);
select pg_temp.check('supervisor sees no money', (select count(*) from transactions)=0 and (select count(*) from customer_balances)=0);
select pg_temp.fails('supervisor cannot adjust stock', $q$select adjust_stock((select id from products limit 1), 5, 'because')$q$, 'FORBIDDEN');
select pg_temp.fails('supervisor cannot pay costs from cash', $q$select add_batch_cost((select id from production_batches where status='in_progress' limit 1),'labour','x',1000,null,jsonb_build_object('account_id',(select cash from ids),'category_id',(select lab from ids)))$q$, 'FORBIDDEN');
select pg_temp.check('supervisor can run a batch', create_batch((select id from products limit 1), current_date, 10, 'Sam') is not null);
select pg_temp.fails('supervisor cannot dispatch sales', $q$select set_delivery_status((select id from sales where status='confirmed' limit 1),'loading')$q$, 'FORBIDDEN');
select pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- storekeeper
select pg_temp.check('storekeeper can receive materials', record_material_purchase((select sup from ids), current_date, 'SK-1', null, jsonb_build_array(jsonb_build_object('material_id',(select id from raw_materials where name='Aggregate'),'quantity',5,'unit_cost',20000))) is not null);
select pg_temp.fails('storekeeper cannot pay suppliers on receipt', $q$select record_material_purchase((select sup from ids), current_date, 'SK-2', null, jsonb_build_array(jsonb_build_object('material_id',(select id from raw_materials where name='Aggregate'),'quantity',1,'unit_cost',1000)), null, jsonb_build_object('account_id',(select cash from ids),'amount',1000))$q$, 'FORBIDDEN');
select pg_temp.fails('storekeeper cannot create batches', $q$select create_batch((select id from products limit 1), current_date, 5)$q$, 'FORBIDDEN');
select pg_temp.check('storekeeper can record damage', record_damage((select id from products where current_stock>10 limit 1), 1, 'Cracked') is not null);
select pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- cashier
select pg_temp.check('cashier sees no stock ledger or batches', (select count(*) from inventory_movements)=0 and (select count(*) from production_batches)=0);
select pg_temp.fails('cashier cannot record stock', $q$select record_damage((select id from products limit 1), 1, 'nope nope')$q$, 'FORBIDDEN');
