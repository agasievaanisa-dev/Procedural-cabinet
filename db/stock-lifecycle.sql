begin;
-- Never invent the location of existing batches. This rollout requires the
-- audited empty opening stock; abort if someone populated it meanwhile.
lock table public.stock, public.medication_batches in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.stock where quantity<>0) or exists(select 1 from public.medication_batches where quantity_remaining<>0) then
   raise exception 'Перед обновлением требуется сверка уже введённых партий';
 end if;
end $$;
alter table public.medication_batches add column work_quantity numeric not null default 0
 check(work_quantity>=0 and work_quantity<=quantity_remaining);

create or replace function private.assert_stock_v3(p_med uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce((select quantity from public.stock where medication_id=p_med and location='work'),0)
    <>coalesce((select sum(work_quantity) from public.medication_batches where medication_id=p_med),0)
 or coalesce((select quantity from public.stock where medication_id=p_med and location='reserve'),0)
    <>coalesce((select sum(quantity_remaining-work_quantity) from public.medication_batches where medication_id=p_med),0) then
   raise exception 'Остатки и партии не совпадают. Требуется сверка склада';
 end if;
end $$;
revoke all on function private.assert_stock_v3(uuid) from public,anon,authenticated;

create or replace function private.move_stock_v3(p_med uuid,p_qty numeric,p_from text,p_to text,p_kind text,p_comment text,p_procedure uuid default null,p_sale uuid default null,p_batch uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare b record; take_n numeric; left_n numeric:=p_qty; available numeric; today date:=(now() at time zone 'Europe/Moscow')::date;
begin
 if p_qty is null or p_qty<=0 or p_qty<>trunc(p_qty) or p_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите целое количество единиц больше нуля';end if;
 if p_from is null or p_from not in ('work','reserve') or (p_to is not null and p_to not in ('work','reserve')) or p_from=p_to then raise exception 'Неверное место хранения';end if;
 perform 1 from public.medications where id=p_med for update;
 if not found then raise exception 'Препарат не найден';end if;
 perform private.assert_stock_v3(p_med);
 for b in select * from public.medication_batches
   where medication_id=p_med and (p_batch is null or id=p_batch)
   and case when p_from='work' then work_quantity else quantity_remaining-work_quantity end>0
   and (p_kind in ('write_off','work_to_reserve') or expiry_date>=today)
   order by expiry_date nulls last,received_date,id for update
 loop
   exit when left_n=0;
   available:=case when p_from='work' then b.work_quantity else b.quantity_remaining-b.work_quantity end;
   take_n:=least(left_n,available);
   update public.medication_batches set
    quantity_remaining=quantity_remaining-case when p_to is null then take_n else 0 end,
    work_quantity=work_quantity+case when p_to='work' then take_n when p_from='work' then -take_n else 0 end
    where id=b.id;
   insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,from_location,to_location,comment,procedure_id,sale_id)
    values(p_med,b.id,p_kind,take_n,p_from,p_to,p_comment,p_procedure,p_sale);
   left_n:=left_n-take_n;
 end loop;
 if left_n>0 then raise exception 'Недостаточно доступных единиц в выбранном месте. Проверьте остаток и сроки годности';end if;
 update public.stock set quantity=quantity-p_qty,updated_at=now() where medication_id=p_med and location=p_from;
 if p_to is not null then
  insert into public.stock(medication_id,location,quantity) values(p_med,p_to,p_qty)
   on conflict(medication_id,location) do update set quantity=public.stock.quantity+excluded.quantity,updated_at=now();
 end if;
 perform private.assert_stock_v3(p_med);
end $$;
revoke all on function private.move_stock_v3(uuid,numeric,text,text,text,text,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function private.record_treatment_v3(p_kind text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid; sh uuid:=(p_payload->>'shift_id')::uuid; nurse uuid:=(p_payload->>'nurse_id')::uuid;
 patient uuid:=nullif(p_payload->>'patient_id','')::uuid; service uuid:=nullif(p_payload->>'service_id','')::uuid;
 req private.warehouse_requests%rowtype; item jsonb; items jsonb; med public.medications%rowtype;
 result_id uuid; quantity_n numeric; total_n numeric:=0; work_n numeric:=0; consumables_n numeric:=0;
 service_name text; paid_n numeric; discount_n numeric; percent_n numeric:=0;
 reason text:=nullif(trim(p_payload->>'discount_reason'),''); note text:=nullif(trim(p_payload->>'discount_comment'),'');
begin
 select id into actor from public.staff where active and auth_user_id=auth.uid() and role in ('admin','owner','nurse') limit 1;
 if auth.uid() is null or actor is null then raise exception 'Нет доступа';end if;
 if p_kind is null or p_kind not in ('procedure','sale') or p_request_id is null then raise exception 'Неверная операция';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload) values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select * into req from private.warehouse_requests where id=p_request_id for update;
 if req.staff_user<>auth.uid() or req.action<>'clinical_'||p_kind or req.payload<>p_payload then raise exception 'Номер операции уже использован';end if;
 if req.result is not null then return req.result;end if;
 perform 1 from public.shifts where id=sh and status='open' for update;
 if not found then raise exception 'Смена закрыта или не выбрана';end if;
 if not private.is_manager() and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к этой смене';end if;
 if not exists(select 1 from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=sh and ss.staff_id=nurse and st.active and st.role='nurse') then raise exception 'Выберите медсестру этой смены';end if;
 if (p_kind='procedure' and patient is null) or (patient is not null and not exists(select 1 from public.patients where id=patient)) then raise exception 'Выберите пациента';end if;
 if p_kind='procedure' then
  select name,work_price,consumables_price into service_name,work_n,consumables_n from public.procedure_services where id=service and active for share;
  if not found then raise exception 'Выберите действующую услугу';end if;
  if work_n<0 or consumables_n<0 or work_n::text in ('NaN','Infinity','-Infinity') or consumables_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цены услуги';end if;
 end if;
 items:=coalesce(p_payload->'items','[]'::jsonb);
 if jsonb_typeof(items)<>'array' then raise exception 'Проверьте список препаратов';end if;
 for item in select * from jsonb_array_elements(items) loop
  quantity_n:=(item->>'quantity')::numeric;
  if nullif(item->>'medication_id','') is null or quantity_n is null or quantity_n<=0 or quantity_n<>trunc(quantity_n) or quantity_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Количество препарата должно быть целым числом больше нуля';end if;
 end loop;
 -- Merge repeated rows and lock medications in a stable order.
 select coalesce(jsonb_agg(jsonb_build_object('medication_id',id,'quantity',q) order by id),'[]') into items
 from (select (x->>'medication_id')::uuid id,sum((x->>'quantity')::numeric) q from jsonb_array_elements(items) x group by 1) grouped;
 if p_kind='sale' and jsonb_array_length(items)=0 then raise exception 'Добавьте препарат';end if;
 for item in select * from jsonb_array_elements(items) loop
  select * into med from public.medications where id=(item->>'medication_id')::uuid and active for update;
  if not found then raise exception 'Препарат недоступен';end if;
  if med.sale_price is null or med.sale_price<0 or med.sale_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цену препарата';end if;
  total_n:=total_n+round(med.sale_price*(item->>'quantity')::numeric,2);
 end loop;
 total_n:=round(total_n+work_n+consumables_n,2);
 paid_n:=round(coalesce((p_payload->>'paid_total')::numeric,total_n),2);
 if paid_n<0 or paid_n>total_n or paid_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Оплата должна быть от нуля до суммы по прайсу';end if;
 discount_n:=total_n-paid_n;
 if discount_n>0 then
  if reason is null or reason not in ('Скидка от владельца','Постоянный пациент','Акция','Другое') then raise exception 'Укажите причину скидки';end if;
  if reason='Другое' and note is null then raise exception 'Добавьте комментарий к скидке';end if;
  percent_n:=round(discount_n*100/total_n,2);
 else reason:=null;note:=null;
 end if;
 if p_kind='procedure' then
  insert into public.procedures(patient_id,shift_id,nurse_id,procedure_type,work_price,consumables_price,list_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes)
   values(patient,sh,nurse,service_name,work_n,consumables_n,total_n,discount_n,percent_n,reason,note,paid_n,p_payload->>'notes') returning id into result_id;
 else
  insert into public.sales(shift_id,nurse_id,patient_id,list_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes)
   values(sh,nurse,patient,total_n,discount_n,percent_n,reason,note,paid_n,p_payload->>'notes') returning id into result_id;
 end if;
 for item in select * from jsonb_array_elements(items) loop
  select * into med from public.medications where id=(item->>'medication_id')::uuid;
  quantity_n:=(item->>'quantity')::numeric;
  if p_kind='procedure' then
   insert into public.procedure_medications(procedure_id,medication_id,quantity,unit_price,line_total) values(result_id,med.id,quantity_n,med.sale_price,round(quantity_n*med.sale_price,2));
   perform private.move_stock_v3(med.id,quantity_n,'work',null,'procedure_use','Расход на процедуру',result_id,null);
  else
   insert into public.sale_items(sale_id,medication_id,quantity,unit_price,line_total) values(result_id,med.id,quantity_n,med.sale_price,round(quantity_n*med.sale_price,2));
   perform private.move_stock_v3(med.id,quantity_n,'work',null,'sale','Продажа',null,result_id);
  end if;
 end loop;
 update private.warehouse_requests set result=jsonb_build_object('id',result_id) where id=p_request_id;
 return jsonb_build_object('id',result_id);
end $$;
revoke all on function private.record_treatment_v3(text,jsonb,uuid) from public,anon;
grant execute on function private.record_treatment_v3(text,jsonb,uuid) to authenticated;
create or replace function public.record_treatment_v3(p_kind text,p_payload jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.record_treatment_v3(p_kind,p_payload,p_request_id); $$;
revoke all on function public.record_treatment_v3(text,jsonb,uuid) from public,anon;
grant execute on function public.record_treatment_v3(text,jsonb,uuid) to authenticated;

-- Direct writes can bypass the transaction and silently desynchronise stock.
revoke insert,update,delete on public.medications,public.stock,public.stock_movements,public.medication_batches,public.procedures,public.procedure_medications,public.sales,public.sale_items,public.shifts,public.shift_staff from anon,authenticated;

CREATE OR REPLACE FUNCTION private.warehouse_v2(p_action text, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; v_med public.medications%rowtype; v_request private.warehouse_requests%rowtype;
  v_qty numeric; v_packs numeric; v_price numeric; v_reserve numeric;
  v_location text; v_expiry date; v_result jsonb; v_batch uuid; v_saved uuid;
begin
  if auth.uid() is null or not private.is_manager() then raise exception 'Нет доступа к складу'; end if;
  if p_action not in ('list','save','receive','opening','transfer','return','writeoff','archive','restore','batches','history') then
    raise exception 'Неизвестная операция';
  end if;
  if p_action in ('save','receive','opening','transfer','return','writeoff','archive','restore') then
    if p_request_id is null then raise exception 'Не указан номер операции'; end if;
    insert into private.warehouse_requests(id,staff_user,action,payload)
      values(p_request_id,auth.uid(),p_action,p_payload) on conflict do nothing;
    select * into v_request from private.warehouse_requests where id=p_request_id for update;
    if v_request.staff_user<>auth.uid() or v_request.action<>p_action or v_request.payload<>p_payload then
      raise exception 'Номер операции уже использован';
    end if;
    if v_request.result is not null then return v_request.result; end if;
  end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if p_action not in ('list','save') and v_id is null then raise exception 'Выберите препарат'; end if;
  if v_id is not null then
    select * into v_med from public.medications where id=v_id for update;
    if not found then raise exception 'Препарат не найден'; end if;
    perform private.assert_stock_v3(v_id);
  end if;
  case p_action
  when 'list' then
    select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('generic_name',m.generic_name,'category',m.category,'work_available',coalesce((select sum(b.work_quantity) from public.medication_batches b where b.medication_id=m.id and b.expiry_date>=(now() at time zone 'Europe/Moscow')::date),0),'reserve_available',coalesce((select sum(b.quantity_remaining-b.work_quantity) from public.medication_batches b where b.medication_id=m.id and b.expiry_date>=(now() at time zone 'Europe/Moscow')::date),0)) order by i.name),'[]')
      into v_result from public.manager_inventory_photo_v1() i join public.medications m on m.id=i.id;
  when 'save' then
    if nullif(trim(p_payload->>'name'),'') is null then raise exception 'Введите название'; end if;
    v_packs:=(p_payload->>'units_per_package')::numeric;
    if v_packs is null or v_packs<1 or v_packs<>trunc(v_packs) or v_packs::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Единиц в упаковке: целое число от 1'; end if;
    if exists(select 1 from jsonb_each_text(p_payload) j where j.key in
      ('purchase_price','sale_price','min_total_stock','work_threshold','lead_time_days')
      and (j.value is null or j.value::numeric<0 or j.value::numeric::text in ('NaN','Infinity','-Infinity'))) then
      raise exception 'Цены, пороги и срок поставки должны быть неотрицательными числами'; end if;
    if v_id is not null and (v_packs<>v_med.units_per_package or p_payload->>'unit' is distinct from v_med.consumption_unit) and exists(
      select 1 from public.stock where medication_id=v_id and quantity>0) then
      raise exception 'Нельзя менять единицу расхода и размер упаковки при наличии остатков'; end if;
    v_saved:=public.manager_set_medication_test(v_id,trim(p_payload->>'name'),nullif(trim(p_payload->>'country'),''),
      coalesce(nullif(trim(p_payload->>'unit'),''),'ед.'),'упаковка',v_packs,
      (p_payload->>'purchase_price')::numeric,(p_payload->>'sale_price')::numeric,
      (p_payload->>'min_total_stock')::numeric,(p_payload->>'work_threshold')::numeric,(p_payload->>'lead_time_days')::integer);
    update public.medications set search_name=nullif(trim(p_payload->>'search_name'),''),
      dosage=nullif(trim(p_payload->>'dosage'),''),generic_name=nullif(trim(p_payload->>'generic_name'),''),
      category=nullif(trim(p_payload->>'category'),'') where id=v_saved;
    v_result:=jsonb_build_object('id',v_saved);
  when 'receive' then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива'; end if;
    v_packs:=(p_payload->>'packages')::numeric; v_price:=(p_payload->>'price')::numeric;
    v_expiry:=nullif(p_payload->>'expiry','')::date;
    if v_packs is null or v_packs<=0 or v_packs<>trunc(v_packs) or v_packs::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Введите целое положительное число упаковок'; end if;
    if v_price is null or v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте закупочную цену'; end if;
    if v_med.units_per_package is null or v_med.units_per_package<1 then raise exception 'Проверьте размер упаковки'; end if;
    if v_expiry is null or v_expiry<(now() at time zone 'Europe/Moscow')::date then raise exception 'Укажите действующий срок годности'; end if;
    v_qty:=v_packs*v_med.units_per_package;
    insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,purchase_price_per_unit,expiry_date)
      values(v_id,v_qty,v_qty,v_price/v_med.units_per_package,v_expiry) returning id into v_batch;
    insert into public.stock(medication_id,location,quantity) values(v_id,'reserve',v_qty)
      on conflict(medication_id,location) do update set quantity=public.stock.quantity+excluded.quantity,updated_at=now();
    update public.medications set purchase_price=v_price where id=v_id;
    insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,to_location,comment)
      values(v_id,v_batch,'purchase',v_qty,'reserve',coalesce(nullif(trim(p_payload->>'comment'),''),'Приход новой партии'));
    v_result:=jsonb_build_object('quantity',v_qty);
  when 'opening' then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива'; end if;
    v_qty:=(p_payload->>'quantity')::numeric;
    v_price:=(p_payload->>'price')::numeric;
    v_location:=p_payload->>'location';
    v_expiry:=nullif(p_payload->>'expiry','')::date;
    if v_location is null or v_location not in ('reserve','work') then raise exception 'Выберите место хранения'; end if;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Введите целое положительное число единиц'; end if;
    if v_price is null or v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте закупочную цену'; end if;
    if v_expiry is null or v_expiry<(now() at time zone 'Europe/Moscow')::date then raise exception 'Укажите действующий срок годности'; end if;
    if v_med.units_per_package is null or v_med.units_per_package<1 then raise exception 'Проверьте размер упаковки'; end if;
    insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,purchase_price_per_unit,expiry_date)
      values(v_id,v_qty,v_qty,v_price/v_med.units_per_package,v_expiry) returning id into v_batch;
    if v_location='work' then update public.medication_batches set work_quantity=v_qty where id=v_batch;end if;
    insert into public.stock(medication_id,location,quantity) values(v_id,v_location,v_qty)
      on conflict(medication_id,location) do update set quantity=public.stock.quantity+excluded.quantity,updated_at=now();
    insert into public.stock_movements(medication_id,batch_id,movement_type,quantity,to_location,comment)
      values(v_id,v_batch,'correction',v_qty,v_location,'Начальный остаток: '||coalesce(nullif(trim(p_payload->>'comment'),''),'ввод по фактическому наличию'));
    v_result:=jsonb_build_object('quantity',v_qty,'location',v_location);
  when 'transfer' then
    if not v_med.active then raise exception 'Сначала восстановите препарат из архива'; end if;
    v_qty:=(p_payload->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Введите целое положительное число единиц'; end if;
    perform private.move_stock_v3(v_id,v_qty,'reserve','work','reserve_to_work',coalesce(nullif(trim(p_payload->>'comment'),''),'Перевод в рабочий шкаф'));
    v_result:=jsonb_build_object('quantity',v_qty);
  when 'return' then
    v_qty:=(p_payload->>'quantity')::numeric;
    perform private.move_stock_v3(v_id,v_qty,'work','reserve','work_to_reserve','Возврат в запас');
    v_result:=jsonb_build_object('quantity',v_qty);
  when 'writeoff' then
    v_qty:=(p_payload->>'quantity')::numeric;
    if nullif(trim(p_payload->>'comment'),'') is null or nullif(p_payload->>'batch_id','') is null then raise exception 'Выберите партию и укажите причину списания';end if;
    perform private.move_stock_v3(v_id,v_qty,p_payload->>'location',null,'write_off',trim(p_payload->>'comment'),null,null,(p_payload->>'batch_id')::uuid);
    v_result:=jsonb_build_object('quantity',v_qty);
  when 'archive' then
    if exists(select 1 from public.stock where medication_id=v_id and quantity<>0) then
      raise exception 'Архивирование доступно только при нулевых остатках'; end if;
    update public.medications set active=false where id=v_id;
    v_result:='{"active":false}'::jsonb;
  when 'restore' then
    update public.medications set active=true where id=v_id;
    v_result:='{"active":true}'::jsonb;
  when 'batches' then
    select coalesce(jsonb_agg(to_jsonb(b) order by b.expiry_date nulls last,b.received_date),'[]') into v_result
      from public.medication_batches b where medication_id=v_id;
  when 'history' then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id),'[]') into v_result from (
      select id,movement_type,quantity,from_location,to_location,comment,created_at from public.stock_movements
      where medication_id=v_id order by created_at desc,id limit 100) s;
  end case;
  if p_request_id is not null and p_action in ('save','receive','opening','transfer','return','writeoff','archive','restore') then
    update private.warehouse_requests set result=v_result where id=p_request_id;
  end if;
  if v_id is not null then perform private.assert_stock_v3(v_id);end if;
  return v_result;
end; $function$
;

create or replace function private.work_catalog_v2()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(private.current_staff_role(),'') not in ('admin','owner','nurse') then
    raise exception 'Нет доступа'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'manufacturer_country',m.manufacturer_country,
    'consumption_unit',m.consumption_unit,'sale_price',m.sale_price,'search_name',m.search_name,'dosage',m.dosage,
    'photo_path',m.photo_path,'work_qty',s.quantity) order by m.name),'[]')
    from public.medications m join (select medication_id,sum(work_quantity) quantity from public.medication_batches where expiry_date>=(now() at time zone 'Europe/Moscow')::date group by medication_id) s on s.medication_id=m.id and s.quantity>0 where m.active);
end; $$;
revoke all on function private.work_catalog_v2() from public,anon;
grant execute on function private.work_catalog_v2() to authenticated;
create or replace function public.work_catalog_v2() returns jsonb language sql security invoker set search_path='' as $$
  select private.work_catalog_v2();
$$;
revoke all on function public.work_catalog_v2() from public,anon;
grant execute on function public.work_catalog_v2() to authenticated;

CREATE OR REPLACE FUNCTION public.save_procedure_test(p_patient_id uuid, p_shift_id uuid, p_nurse_id uuid, p_service_id uuid, p_paid_total numeric, p_discount_reason text, p_discount_comment text, p_notes text, p_items jsonb DEFAULT '[]'::jsonb) returns uuid language sql security invoker set search_path='' as $$ select (private.record_treatment_v3('procedure',jsonb_build_object('patient_id',p_patient_id,'shift_id',p_shift_id,'nurse_id',p_nurse_id,'service_id',p_service_id,'paid_total',p_paid_total,'discount_reason',p_discount_reason,'discount_comment',p_discount_comment,'notes',p_notes,'items',p_items),gen_random_uuid())->>'id')::uuid; $$;
revoke all on function public.save_procedure_test(uuid,uuid,uuid,uuid,numeric,text,text,text,jsonb) from public,anon;
grant execute on function public.save_procedure_test(uuid,uuid,uuid,uuid,numeric,text,text,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.save_sale_test(p_shift_id uuid, p_nurse_id uuid, p_patient_id uuid, p_paid_total numeric, p_discount_reason text, p_discount_comment text, p_notes text, p_items jsonb DEFAULT '[]'::jsonb) returns uuid language sql security invoker set search_path='' as $$ select (private.record_treatment_v3('sale',jsonb_build_object('shift_id',p_shift_id,'nurse_id',p_nurse_id,'patient_id',p_patient_id,'paid_total',p_paid_total,'discount_reason',p_discount_reason,'discount_comment',p_discount_comment,'notes',p_notes,'items',p_items),gen_random_uuid())->>'id')::uuid; $$;
revoke all on function public.save_sale_test(uuid,uuid,uuid,numeric,text,text,text,jsonb) from public,anon;
grant execute on function public.save_sale_test(uuid,uuid,uuid,numeric,text,text,text,jsonb) to authenticated;
revoke all on function public.save_sale_v8(uuid,uuid,uuid,numeric,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_procedure_v8(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.manager_upsert_medication_v8(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,date) from public,anon,authenticated;
revoke all on function private.consume_medication_batches(uuid,numeric) from public,anon,authenticated;
revoke all on function public.manager_receive_stock_test(uuid,numeric,numeric,date,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.start_shift_v82(p_shift_date date, p_started_at timestamp with time zone, p_planned_end_at timestamp with time zone, p_nurse1 uuid, p_nurse2 uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$

declare

  v_staff_id uuid;

  v_shift_id uuid;

  v_existing uuid;

begin

  select s.id into v_staff_id

  from public.staff s

  where s.auth_user_id=auth.uid()

    and s.active=true

    and s.role in ('nurse','admin','owner')

  limit 1;

  if v_staff_id is null then raise exception 'Нет доступа к созданию смены'; end if;

  if p_nurse1 = p_nurse2 then raise exception 'Нужны две разные медсестры'; end if;

  if p_planned_end_at <= p_started_at then raise exception 'Окончание смены должно быть позже начала'; end if;

  if p_planned_end_at - p_started_at > interval '24 hours' then raise exception 'Смена не может быть длиннее 24 часов'; end if;

  if v_staff_id not in (p_nurse1,p_nurse2) and not private.is_manager() then

    raise exception 'Вы должны входить в выбранную смену';

  end if;

  if (select count(*) from public.staff where id in (p_nurse1,p_nurse2) and active=true and role='nurse') <> 2 then

    raise exception 'Одна из выбранных медсестёр недоступна';

  end if;



  select sh.id into v_existing

  from public.shifts sh

  join public.shift_staff ss on ss.shift_id=sh.id

  where ss.staff_id=v_staff_id and sh.status='open'

  order by sh.started_at desc limit 1;

  if v_existing is not null then return v_existing; end if;



  insert into public.shifts(shift_date,started_at,planned_end_at,status)

  values(p_shift_date,p_started_at,p_planned_end_at,'open')

  returning id into v_shift_id;



  insert into public.shift_staff(shift_id,staff_id)

  values(v_shift_id,p_nurse1),(v_shift_id,p_nurse2);

  return v_shift_id;

end;

$function$
;

CREATE OR REPLACE FUNCTION public.close_shift_v8(p_shift_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$

declare

  v_staff_id uuid;

begin

  select id into v_staff_id

  from public.staff

  where auth_user_id = auth.uid() and active = true

  limit 1;



  if v_staff_id is null then

    raise exception 'Сотрудник не найден';

  end if;



  if not exists (

    select 1 from public.shift_staff

    where shift_id = p_shift_id and staff_id = v_staff_id

  ) and not private.is_manager() then

    raise exception 'Нет доступа к смене';

  end if;



  -- Close the selected shift and any stale duplicate open shifts for this employee.

  update public.shifts sh

     set ended_at = coalesce(sh.ended_at, now()),

         status = 'closed'

   where sh.status = 'open'

     and (

       sh.id = p_shift_id

       or exists (

         select 1

         from public.shift_staff ss

         where ss.shift_id = sh.id

           and ss.staff_id = v_staff_id

       )

     );

end;

$function$
;

CREATE OR REPLACE FUNCTION public.shift_report_detailed_test(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$

declare v_staff uuid; v jsonb;

begin

 select id into v_staff from public.staff where auth_user_id=auth.uid() and active=true limit 1;

 if v_staff is null then raise exception 'Нет доступа'; end if;

 if not exists(select 1 from public.shift_staff where shift_id=p_shift_id and staff_id=v_staff) and not private.is_manager() then raise exception 'Нет доступа к смене'; end if;

 select jsonb_build_object(

   'shift',(select jsonb_build_object('date',shift_date,'started_at',started_at,'planned_end_at',planned_end_at,'ended_at',ended_at,'status',status) from public.shifts where id=p_shift_id),

   'patients_count',(select count(distinct patient_id) from public.procedures where shift_id=p_shift_id),

   'procedures_count',(select count(*) from public.procedures where shift_id=p_shift_id),

   'procedures_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift_id),0),

   'sales_total',coalesce((select sum(paid_total) from public.sales where shift_id=p_shift_id),0),

   'cash_total',coalesce((select sum(paid_total) from public.procedures where shift_id=p_shift_id),0)+coalesce((select sum(paid_total) from public.sales where shift_id=p_shift_id),0),

   'by_nurse',coalesce((select jsonb_agg(jsonb_build_object('nurse',st.full_name,'nurse_id',st.id,

      'procedures_count',(select count(*) from public.procedures p where p.shift_id=p_shift_id and p.nurse_id=st.id),

      'procedures_total',coalesce((select sum(paid_total) from public.procedures p where p.shift_id=p_shift_id and p.nurse_id=st.id),0),

      'sales_total',coalesce((select sum(paid_total) from public.sales s where s.shift_id=p_shift_id and s.nurse_id=st.id),0),

      'total',coalesce((select sum(paid_total) from public.procedures p where p.shift_id=p_shift_id and p.nurse_id=st.id),0)+coalesce((select sum(paid_total) from public.sales s where s.shift_id=p_shift_id and s.nurse_id=st.id),0)

   ) order by st.full_name) from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=p_shift_id),'[]'::jsonb),

   'procedures',coalesce((select jsonb_agg(jsonb_build_object('at',p.visit_at,'patient',pt.full_name,'nurse',st.full_name,'type',p.procedure_type,'list_total',p.list_total,'discount',p.discount_amount,'discount_reason',p.discount_reason,'paid',p.paid_total,'notes',p.notes,

     'items',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'line_total',pm.line_total) order by m.name) from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=p.id),'[]'::jsonb)

   ) order by p.visit_at) from public.procedures p join public.patients pt on pt.id=p.patient_id join public.staff st on st.id=p.nurse_id where p.shift_id=p_shift_id),'[]'::jsonb),

   'sales',coalesce((select jsonb_agg(jsonb_build_object('at',s.sold_at,'patient',coalesce(pt.full_name,'Без пациента'),'nurse',st.full_name,'list_total',s.list_total,'discount',s.discount_amount,'discount_reason',s.discount_reason,'paid',s.paid_total,'notes',s.notes,

     'items',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'quantity',si.quantity,'unit',m.consumption_unit,'line_total',si.line_total) order by m.name) from public.sale_items si join public.medications m on m.id=si.medication_id where si.sale_id=s.id),'[]'::jsonb)

   ) order by s.sold_at) from public.sales s left join public.patients pt on pt.id=s.patient_id join public.staff st on st.id=s.nurse_id where s.shift_id=p_shift_id),'[]'::jsonb)

 ) into v;

 return v;

end;$function$
;

notify pgrst, 'reload schema';
commit;
