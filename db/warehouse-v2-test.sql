-- Run after the proposal SQL in ONE transaction and ROLLBACK, never COMMIT fixtures.
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('admin','owner') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
set local role authenticated;
do $$
declare
  med uuid; req uuid:=gen_random_uuid(); response jsonb; original jsonb; payload jsonb;
  failed boolean; work_n numeric; reserve_n numeric;
begin
  payload:=jsonb_build_object('name','Warehouse regression fixture','units_per_package',10,'purchase_price',100,
    'sale_price',20,'min_total_stock',5,'work_threshold',15,'lead_time_days',3,'unit','амп.');
  response:=public.warehouse_v2('save',payload,req); med:=(response->>'id')::uuid;
  if public.warehouse_v2('save',payload,req)<>response then raise exception 'Save retry failed'; end if;
  perform set_config('test.med',med::text,true);
  req:=gen_random_uuid();payload:=jsonb_build_object('id',med,'packages',4,'price',100,'expiry',current_date+365);
  original:=public.warehouse_v2('receive',payload,req);
  response:=public.warehouse_v2('receive',payload,req);
  select (x->>'reserve_qty')::numeric into reserve_n from jsonb_array_elements(public.warehouse_v2('list')) x where x->>'id'=med::text;
  if reserve_n<>40 or response<>original then raise exception 'Receipt or idempotency failed'; end if;
  req:=gen_random_uuid();payload:=jsonb_build_object('id',med,'quantity',10);
  perform public.warehouse_v2('transfer',payload,req);
  perform public.warehouse_v2('transfer',payload,req);
  perform public.warehouse_v2('transfer',jsonb_build_object('id',med,'quantity',3),gen_random_uuid());
  select (x->>'work_qty')::numeric,(x->>'reserve_qty')::numeric into work_n,reserve_n
    from jsonb_array_elements(public.warehouse_v2('list')) x where x->>'id'=med::text;
  if work_n<>13 or reserve_n<>27 or work_n+reserve_n<>40 then raise exception 'Transfer balances failed'; end if;
  if jsonb_array_length(public.warehouse_v2('history',jsonb_build_object('id',med)))<>3 then raise exception 'Movement history failed'; end if;
  failed:=false;
  begin perform public.warehouse_v2('transfer',jsonb_build_object('id',med,'quantity',28),gen_random_uuid());
    exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Overdraw was allowed'; end if;
  failed:=false;
  begin perform public.warehouse_v2('receive',jsonb_build_object('id',med,'packages',-1,'price',0,'expiry',current_date+1),gen_random_uuid());
    exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Negative receipt was allowed'; end if;
  failed:=false;
  begin perform public.warehouse_v2('receive',jsonb_build_object('id',med,'packages',1,'price',0,'expiry',current_date-1),gen_random_uuid());
    exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Expired receipt was allowed'; end if;
  failed:=false;
  begin perform public.warehouse_v2('archive',jsonb_build_object('id',med),gen_random_uuid());
    exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Archive with stock was allowed'; end if;
  -- Existing client remains compatible with the corrected movement type.
  perform public.manager_transfer_to_work_test(med,1,'Compatibility test');
  if (select quantity from public.stock where medication_id=med and location='work')<>14 then raise exception 'Compatibility transfer failed'; end if;
  payload:=jsonb_build_object('name','Empty warehouse fixture','units_per_package',1,'purchase_price',0,'sale_price',0,
    'min_total_stock',0,'work_threshold',0,'lead_time_days',0,'unit','шт.');
  response:=public.warehouse_v2('save',payload,gen_random_uuid());
  perform public.warehouse_v2('archive',jsonb_build_object('id',response->>'id'),gen_random_uuid());
  perform public.warehouse_v2('restore',jsonb_build_object('id',response->>'id'),gen_random_uuid());
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
do $$
declare denied boolean:=false; catalog jsonb;
begin
  begin perform public.warehouse_v2('list'); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'Nurse accessed warehouse'; end if;
  catalog:=public.work_catalog_v2();
  if not exists(select 1 from jsonb_array_elements(catalog) x where x->>'id'=current_setting('test.med') and (x->>'work_qty')::numeric=14) then raise exception 'Nurse work catalog failed'; end if;
  if exists(select 1 from jsonb_array_elements(catalog) x where x ? 'purchase_price' or x ? 'reserve_qty') then raise exception 'Private prices exposed'; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean:=false;
begin
  begin perform public.warehouse_v2('list'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous access allowed'; end if;
end $$;
reset role;
