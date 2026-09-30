begin;
create table if not exists private.medication_favorites (
 staff_user uuid not null references auth.users(id) on delete cascade,
 medication_id uuid not null references public.medications(id) on delete cascade,
 primary key(staff_user,medication_id)
);
alter table private.medication_favorites enable row level security;
revoke all on private.medication_favorites from public,anon,authenticated;
alter table public.procedures add column if not exists service_id uuid references public.procedure_services(id);
-- Nurses use the limited work catalog; the medication table contains purchase details.
drop policy if exists nurse_medications_read on public.medications;

create or replace function private.work_catalog_v2() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(private.current_staff_role(),'') not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'name',m.name,'manufacturer_country',m.manufacturer_country,'consumption_unit',m.consumption_unit,
  'sale_price',m.sale_price,'search_name',m.search_name,'generic_name',m.generic_name,'category',m.category,
  'dosage',m.dosage,'photo_path',m.photo_path,'work_qty',coalesce(b.qty,0),'nearest_expiry',b.expiry
 ) order by m.name),'[]') from public.medications m left join lateral(
  select sum(work_quantity) qty,min(expiry_date) expiry from public.medication_batches
  where medication_id=m.id and work_quantity>0 and expiry_date>=(now() at time zone 'Europe/Moscow')::date
 ) b on true where m.active);
end $$;

create or replace function private.quick_ui_v4(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; role_name text; med uuid; sh uuid; pr public.procedures%rowtype; result jsonb;
begin
 select id,role into actor,role_name from public.staff where auth_user_id=auth.uid() and active;
 if auth.uid() is null or actor is null or role_name not in ('admin','owner','nurse') then raise exception 'Нет доступа';end if;
 if p_action='favorite' then
  med:=(p_payload->>'id')::uuid;
  if not exists(select 1 from public.medications where id=med and active) then raise exception 'Препарат не найден';end if;
  if coalesce((p_payload->>'selected')::boolean,false) then
   insert into private.medication_favorites values(auth.uid(),med) on conflict do nothing;
  else delete from private.medication_favorites where staff_user=auth.uid() and medication_id=med;end if;
  return jsonb_build_object('id',med,'selected',coalesce((p_payload->>'selected')::boolean,false));
 elsif p_action='context' then
  return jsonb_build_object(
   'favorites',coalesce((select jsonb_agg(medication_id) from private.medication_favorites where staff_user=auth.uid()),'[]'),
   'recent',coalesce((select jsonb_agg(jsonb_build_object('id',medication_id,'count',uses,'at',last_at) order by uses desc,last_at desc)
    from (select medication_id,count(*) uses,max(at) last_at from(
     select pm.medication_id,p.visit_at at from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id
      where p.visit_at>now()-interval '30 days'
     union all select si.medication_id,s.sold_at from public.sale_items si join public.sales s on s.id=si.sale_id
      where s.sold_at>now()-interval '30 days'
    ) e group by medication_id order by uses desc,last_at desc limit 30) ranked),'[]'),
   'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'started_at',s.started_at,'planned_end_at',s.planned_end_at,
    'staff',(select jsonb_agg(jsonb_build_object('id',st.id,'full_name',st.full_name)) from public.shift_staff ss join public.staff st on st.id=ss.staff_id where ss.shift_id=s.id)) order by s.started_at desc)
    from public.shifts s where s.status='open' and (role_name in ('admin','owner') or exists(select 1 from public.shift_staff ss where ss.shift_id=s.id and ss.staff_id=actor))),'[]'));
 elsif p_action='last_procedure' then
  select * into pr from public.procedures where patient_id=(p_payload->>'patient_id')::uuid order by visit_at desc,id desc limit 1;
  if not found then return null;end if;
  return jsonb_build_object('id',pr.id,'patient_id',pr.patient_id,'at',pr.visit_at,'service_name',pr.procedure_type,
   'service_id',coalesce(pr.service_id,(select (array_agg(id))[1] from public.procedure_services where name=pr.procedure_type and active having count(*)=1)),
   'items',coalesce((select jsonb_agg(jsonb_build_object('medication_id',m.id,'name',m.name,'quantity',pm.quantity,'unit',m.consumption_unit,'active',m.active) order by m.name)
    from public.procedure_medications pm join public.medications m on m.id=pm.medication_id where pm.procedure_id=pr.id),'[]'));
 elsif p_action in ('report','close') then
  sh:=(p_payload->>'shift_id')::uuid;
  if sh is null or not exists(select 1 from public.shifts where id=sh) then raise exception 'Смена не найдена';end if;
  if role_name not in ('admin','owner') and not exists(select 1 from public.shift_staff where shift_id=sh and staff_id=actor) then raise exception 'Нет доступа к смене';end if;
  if p_action='close' then perform public.close_shift_v8(sh);end if;
  result:=public.shift_report_detailed_test(sh);
  return result||jsonb_build_object('patients_count',(select count(distinct patient_id) from(
    select patient_id from public.procedures where shift_id=sh union select patient_id from public.sales where shift_id=sh) ps),
   'used',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.consumption_unit,'procedure_qty',u.proc,'sale_qty',u.sale,'quantity',u.proc+u.sale) order by m.name)
    from (select medication_id,sum(proc) proc,sum(sale) sale from(
     select pm.medication_id,pm.quantity proc,0::numeric sale from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=sh
     union all select si.medication_id,0,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=sh
    ) q group by medication_id) u join public.medications m on m.id=u.medication_id),'[]'));
 else raise exception 'Неизвестная операция';end if;
end $$;
revoke all on function private.quick_ui_v4(text,jsonb) from public,anon;
grant execute on function private.quick_ui_v4(text,jsonb) to authenticated;
create or replace function public.quick_ui_v4(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.quick_ui_v4(p_action,p_payload); $$;
revoke all on function public.quick_ui_v4(text,jsonb) from public,anon;
grant execute on function public.quick_ui_v4(text,jsonb) to authenticated;
-- Record the exact service ID alongside the historical price/name snapshot.
create or replace function private.capture_service_v4() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.service_id is null then
  select (array_agg(id))[1] into new.service_id from public.procedure_services where name=new.procedure_type and active having count(*)=1;
 end if;return new;
end $$;
revoke all on function private.capture_service_v4() from public,anon,authenticated;
create trigger procedure_service_v4 before insert on public.procedures for each row execute function private.capture_service_v4();
commit;
