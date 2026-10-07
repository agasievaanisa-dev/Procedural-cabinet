begin;
create or replace function private.warehouse_v5(p_action text,p_payload jsonb default '{}',p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; req private.warehouse_requests; med_id uuid:=nullif(p_payload->>'id','')::uuid;
 batch public.medication_batches; batch_id uuid; location_name text; actual numeric; delta numeric;
 old_n numeric; note text; before_ids uuid[]; received date;
begin
 if auth.uid() is null or not private.is_manager() then raise exception 'Доступно только владельцу';end if;
 if p_action='inventory' then
  if p_request_id is null then raise exception 'Нужен номер операции';end if;
  insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'v5_inventory',p_payload) on conflict do nothing;
  select * into req from private.warehouse_requests where id=p_request_id for update;
  if req.staff_user<>auth.uid() or req.action<>'v5_inventory' or req.payload<>p_payload then raise exception 'Номер операции уже используется';end if;
  if req.result is not null then return req.result;end if;
  perform 1 from public.medications where id=med_id and active for update;
  if not found then raise exception 'Препарат недоступен';end if;
  batch_id:=nullif(p_payload->>'batch_id','')::uuid; location_name:=p_payload->>'location';
  actual:=(p_payload->>'actual_quantity')::numeric; note:=nullif(trim(p_payload->>'reason'),'');
  if location_name is null or location_name not in ('reserve','work') or note is null then raise exception 'Укажите место хранения и причину инвентаризации';end if;
  if actual is null or actual<0 or actual<>trunc(actual) or actual::text in ('NaN','Infinity','-Infinity') then raise exception 'Фактический остаток: целое число от нуля';end if;
  select * into batch from public.medication_batches where id=batch_id and medication_id=med_id for update;
  if not found then raise exception 'Партия не найдена';end if;
  old_n:=case when location_name='work' then batch.work_quantity else batch.quantity_remaining-batch.work_quantity end;
  delta:=actual-old_n;
  if delta>0 and (batch.expiry_date is null or batch.expiry_date<(now() at time zone 'Europe/Moscow')::date) then raise exception 'Нельзя увеличивать годный остаток партии с истёкшим или неизвестным сроком';end if;
  if delta<>0 then
   update public.medication_batches set quantity_remaining=quantity_remaining+delta,
     quantity_received=quantity_received+greatest(delta,0),work_quantity=work_quantity+case when location_name='work' then delta else 0 end where id=batch_id;
   insert into public.stock(medication_id,location,quantity) values(med_id,location_name,greatest(delta,0))
     on conflict(medication_id,location) do update set quantity=public.stock.quantity+delta,updated_at=now();
   insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,from_location,to_location,comment)
     values(med_id,batch_id,'correction',abs(delta),case when delta<0 then location_name end,case when delta>0 then location_name end,
      'Инвентаризация: '||old_n||' → '||actual||'. Причина: '||note);
  end if;
  v_result:=jsonb_build_object('id',med_id,'batch_id',batch_id,'before',old_n,'quantity',actual,'difference',delta);
  update private.warehouse_requests w set result=v_result where w.id=p_request_id;
  -- Qualify variable below to avoid ambiguity with the result column.
  return v_result;
 end if;
 if p_action in ('save','receive','opening') then
  if p_request_id is null then raise exception 'Нужен номер операции';end if;
  insert into private.warehouse_requests(id,staff_user,action,payload)
    values(p_request_id,auth.uid(),p_action,p_payload) on conflict do nothing;
  select * into req from private.warehouse_requests where id=p_request_id for update;
  if found then
   if req.staff_user<>auth.uid() or req.action<>p_action or req.payload<>p_payload then raise exception 'Номер операции уже используется';end if;
   if req.result is not null then return req.result;end if;
  end if;
 end if;
 if p_action in ('receive','opening') then
  perform 1 from public.medications where id=med_id for update;
  select coalesce(array_agg(id),array[]::uuid[]) into before_ids from public.medication_batches where medication_id=med_id;
  received:=coalesce(nullif(p_payload->>'received_date','')::date,(now() at time zone 'Europe/Moscow')::date);
  if received> (now() at time zone 'Europe/Moscow')::date or received<date '1900-01-01' then raise exception 'Проверьте дату поступления';end if;
 end if;
 v_result:=private.warehouse_v2(p_action,p_payload,p_request_id);
 if p_action='save' then
  update public.medications set manufacturer=nullif(trim(p_payload->>'manufacturer'),''),release_form=nullif(trim(p_payload->>'release_form'),''),comment=nullif(trim(p_payload->>'comment'),'')
   where id=(v_result->>'id')::uuid;
 elsif p_action in ('receive','opening') then
  update public.medication_batches set batch_number=nullif(trim(p_payload->>'batch_number'),''),supplier=nullif(trim(p_payload->>'supplier'),''),received_date=received
   where medication_id=med_id and not(id=any(before_ids)) returning id into batch_id;
  v_result:=v_result||jsonb_build_object('batch_id',batch_id);
  update private.warehouse_requests w set result=v_result where w.id=p_request_id;
 elsif p_action='list' then
  select coalesce(jsonb_agg(x.value||jsonb_build_object('manufacturer',m.manufacturer,'release_form',m.release_form,'comment',m.comment) order by m.name),'[]')
   into v_result from jsonb_array_elements(v_result) x join public.medications m on m.id=(x.value->>'id')::uuid;
 end if;
 return v_result;
end $$;
revoke all on function private.warehouse_v5(text,jsonb,uuid) from public,anon;
grant execute on function private.warehouse_v5(text,jsonb,uuid) to authenticated;
create or replace function public.warehouse_v5(p_action text,p_payload jsonb default '{}',p_request_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$select private.warehouse_v5(p_action,p_payload,p_request_id);$$;
revoke all on function public.warehouse_v5(text,jsonb,uuid) from public,anon;
grant execute on function public.warehouse_v5(text,jsonb,uuid) to authenticated;
CREATE OR REPLACE FUNCTION private.work_catalog_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or coalesce(private.current_staff_role(),'') not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'name',m.name,'manufacturer_country',m.manufacturer_country,'consumption_unit',m.consumption_unit,
  'manufacturer',m.manufacturer,'release_form',m.release_form,'sale_price',m.sale_price,'search_name',m.search_name,'generic_name',m.generic_name,'category',m.category,
  'dosage',m.dosage,'photo_path',m.photo_path,'work_qty',coalesce(b.qty,0),'nearest_expiry',b.expiry
 ) order by m.name),'[]') from public.medications m left join lateral(
  select sum(work_quantity) qty,min(expiry_date) expiry from public.medication_batches
  where medication_id=m.id and work_quantity>0 and expiry_date>=(now() at time zone 'Europe/Moscow')::date
 ) b on true where m.active);
end $function$
;
commit;
