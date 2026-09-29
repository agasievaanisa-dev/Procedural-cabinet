-- Additive opening balances, same guarded and idempotent transaction.
begin;
create or replace function private.warehouse_v2(p_action text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_med public.medications%rowtype; v_request private.warehouse_requests%rowtype;
  v_qty numeric; v_packs numeric; v_price numeric; v_reserve numeric;
  v_location text; v_expiry date; v_result jsonb; v_batch uuid; v_saved uuid;
begin
  if auth.uid() is null or not private.is_manager() then raise exception 'Нет доступа к складу'; end if;
  if p_action not in ('list','save','receive','opening','transfer','archive','restore','batches','history') then
    raise exception 'Неизвестная операция';
  end if;
  if p_action in ('save','receive','opening','transfer','archive','restore') then
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
  end if;
  case p_action
  when 'list' then
    select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('generic_name',m.generic_name,'category',m.category) order by i.name),'[]')
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
    if v_id is not null and v_packs<>v_med.units_per_package and exists(
      select 1 from public.stock where medication_id=v_id and quantity>0) then
      raise exception 'Нельзя менять размер упаковки при наличии остатков. Создайте отдельную карточку'; end if;
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
    if v_expiry is null or v_expiry<current_date then raise exception 'Укажите действующий срок годности'; end if;
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
    if v_expiry is null or v_expiry<current_date then raise exception 'Укажите действующий срок годности'; end if;
    if v_med.units_per_package is null or v_med.units_per_package<1 then raise exception 'Проверьте размер упаковки'; end if;
    insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,purchase_price_per_unit,expiry_date)
      values(v_id,v_qty,v_qty,v_price/v_med.units_per_package,v_expiry) returning id into v_batch;
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
    select quantity into v_reserve from public.stock where medication_id=v_id and location='reserve' for update;
    if coalesce(v_reserve,0)<v_qty then raise exception 'Недостаточно препарата в запасе'; end if;
    update public.stock set quantity=quantity-v_qty,updated_at=now() where medication_id=v_id and location='reserve';
    insert into public.stock(medication_id,location,quantity) values(v_id,'work',v_qty)
      on conflict(medication_id,location) do update set quantity=public.stock.quantity+excluded.quantity,updated_at=now();
    insert into public.stock_movements(medication_id,movement_type,quantity,from_location,to_location,comment)
      values(v_id,'reserve_to_work',v_qty,'reserve','work',coalesce(nullif(trim(p_payload->>'comment'),''),'Перевод в работу'));
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
  if p_request_id is not null and p_action in ('save','receive','opening','transfer','archive','restore') then
    update private.warehouse_requests set result=v_result where id=p_request_id;
  end if;
  return v_result;
end; $$;

notify pgrst, 'reload schema';
commit;
