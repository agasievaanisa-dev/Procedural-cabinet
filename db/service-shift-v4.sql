begin;
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
  insert into public.procedures(patient_id,shift_id,nurse_id,service_id,procedure_type,work_price,consumables_price,list_total,discount_amount,discount_percent,discount_reason,discount_comment,paid_total,notes)
   values(patient,sh,nurse,service,service_name,work_n,consumables_n,total_n,discount_n,percent_n,reason,note,paid_n,p_payload->>'notes') returning id into result_id;
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

drop trigger procedure_service_v4 on public.procedures;
drop function private.capture_service_v4();
create or replace function private.start_shift_v4(p_shift_date date,p_started_at timestamptz,p_planned_end_at timestamptz,p_nurse1 uuid,p_nurse2 uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; existing uuid; result_id uuid;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_shift_date is null or p_started_at is null or p_planned_end_at is null or p_planned_end_at<=p_started_at or p_planned_end_at-p_started_at>interval '24 hours' then raise exception 'Проверьте время смены';end if;
 if p_nurse1 is null or p_nurse2 is null or p_nurse1=p_nurse2 then raise exception 'Выберите двух разных сотрудников';end if;
 if role_name='nurse' and actor not in (p_nurse1,p_nurse2) then raise exception 'Вы должны входить в выбранную смену';end if;
 -- Stable lock order serializes concurrent opening for either member.
 perform id from public.staff where id in (p_nurse1,p_nurse2) order by id for update;
 if (select count(*) from public.staff where id in (p_nurse1,p_nurse2) and active and role='nurse')<>2 then raise exception 'Одна из медсестёр недоступна';end if;
 select s.id into existing from public.shifts s where s.status='open' and
  exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=p_nurse1) and
  exists(select 1 from public.shift_staff where shift_id=s.id and staff_id=p_nurse2) order by s.started_at desc limit 1;
 if existing is not null then return existing;end if;
 if exists(select 1 from public.shift_staff ss join public.shifts s on s.id=ss.shift_id where s.status='open' and ss.staff_id in (p_nurse1,p_nurse2)) then raise exception 'У выбранной медсестры уже открыта другая смена. Сначала завершите её.';end if;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(p_shift_date,p_started_at,p_planned_end_at,'open') returning id into result_id;
 insert into public.shift_staff(shift_id,staff_id) values(result_id,p_nurse1),(result_id,p_nurse2);
 return result_id;
end $$;
revoke all on function private.start_shift_v4(date,timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function private.start_shift_v4(date,timestamptz,timestamptz,uuid,uuid) to authenticated;
create or replace function public.start_shift_v82(p_shift_date date,p_started_at timestamptz,p_planned_end_at timestamptz,p_nurse1 uuid,p_nurse2 uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.start_shift_v4(p_shift_date,p_started_at,p_planned_end_at,p_nurse1,p_nurse2); $$;
commit;
