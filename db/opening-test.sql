begin;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from public.staff where active and role in ('admin','owner') limit 1),true);
set local role authenticated;
do $$
declare med uuid; req uuid:=gen_random_uuid(); p jsonb; r jsonb; failed boolean;
begin
 med:=(public.warehouse_v2('save','{"name":"Opening regression fixture","units_per_package":100,"purchase_price":1000,"sale_price":20,"min_total_stock":0,"work_threshold":0,"lead_time_days":3}',gen_random_uuid())->>'id')::uuid;
 p:=jsonb_build_object('id',med,'quantity',75,'price',1000,'location','reserve','expiry',current_date+365);
 perform public.warehouse_v2('opening',p,req);
 perform public.warehouse_v2('opening',p,req);
 perform public.warehouse_v2('opening',p||'{"location":"work","quantity":13}',gen_random_uuid());
 select x into r from jsonb_array_elements(public.warehouse_v2('list')) x where x->>'id'=med::text;
 if (r->>'reserve_qty')::numeric<>75 or (r->>'work_qty')::numeric<>13 then raise exception 'Opening quantities incorrect'; end if;
 if jsonb_array_length(public.warehouse_v2('history',jsonb_build_object('id',med)))<>2 then raise exception 'Duplicate opening movement'; end if;
 if jsonb_array_length(public.warehouse_v2('batches',jsonb_build_object('id',med)))<>2 then raise exception 'Missing opening batches'; end if;
 failed:=false;
 begin perform public.warehouse_v2('opening',p||'{"location":"other"}',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Invalid location allowed';end if;
 failed:=false;
 begin perform public.warehouse_v2('opening',p||'{"quantity":-5}',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Negative quantity allowed';end if;
 failed:=false;
 begin perform public.warehouse_v2('opening',p||'{"quantity":1.5}',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Fractional quantity allowed';end if;
end $$;
reset role;
rollback;
