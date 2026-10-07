-- Read-only warehouse report. Apply after crm-management-v5.sql / crm-warehouse-v5.sql.
create index if not exists crm_stock_report_date_v5_idx on public.stock_movements(created_at);
create index if not exists crm_stock_report_med_date_v5_idx on public.stock_movements(medication_id,created_at);

create or replace function private.crm_warehouse_report_v5(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 date_from date; date_to date; medication_filter uuid; result jsonb;
 period_start timestamptz; period_end timestamptz;
begin
 if auth.uid() is null or not exists(
  select 1 from public.staff where auth_user_id=auth.uid() and active and role in ('owner','admin')
 ) then raise exception 'Складской отчёт доступен только активному владельцу';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Неверные параметры отчёта';end if;
 if (p_payload ? 'from' and coalesce(p_payload->>'from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  or (p_payload ? 'to' and coalesce(p_payload->>'to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
  raise exception 'Укажите даты в формате ГГГГ-ММ-ДД';
 end if;
 date_from:=coalesce((p_payload->>'from')::date,(now() at time zone 'Europe/Moscow')::date);
 date_to:=coalesce((p_payload->>'to')::date,(now() at time zone 'Europe/Moscow')::date);
 if date_from>date_to then raise exception 'Начало периода позже окончания';end if;
 medication_filter:=nullif(p_payload->>'medication_id','')::uuid;
 if medication_filter is not null and not exists(select 1 from public.medications where id=medication_filter) then
  raise exception 'Препарат не найден';
 end if;
 period_start:=date_from::timestamp at time zone 'Europe/Moscow';
 period_end:=(date_to+1)::timestamp at time zone 'Europe/Moscow';
 -- Both movements and current stock come from the same statement snapshot.
 with selected_medications as (
  select m.id,coalesce(nullif(trim(m.name),''),'Без названия') name,
   coalesce(nullif(trim(m.consumption_unit),''),'ед.') unit,coalesce(m.active,false) active
  from public.medications m where medication_filter is null or m.id=medication_filter
 ), movements as (
  select sm.id,sm.created_at at,sm.medication_id,m.name,m.unit,sm.movement_type type,
   sm.quantity,sm.from_location,sm.to_location,
   coalesce(b.batch_number,'') batch_number,
   coalesce(nullif(trim(s.full_name),''),'Не указан') actor_name,coalesce(sm.comment,'') comment
  from public.stock_movements sm join selected_medications m on m.id=sm.medication_id
  left join public.medication_batches b on b.id=sm.batch_id and b.medication_id=sm.medication_id
  left join public.staff s on s.id=sm.actor_staff
  where sm.created_at>=period_start and sm.created_at<period_end
 ), current_stock as (
  select st.medication_id,
   coalesce(sum(st.quantity) filter(where st.location='reserve'),0) reserve_current,
   coalesce(sum(st.quantity) filter(where st.location='work'),0) work_current
  from public.stock st join selected_medications m on m.id=st.medication_id group by st.medication_id
 ), period_totals as (
  select medication_id,count(*) movement_count,
   sum(case when to_location='reserve' then quantity else 0 end-case when from_location='reserve' then quantity else 0 end) reserve_delta,
   sum(case when to_location='work' then quantity else 0 end-case when from_location='work' then quantity else 0 end) work_delta
  from movements group by medication_id
 ), medication_rows as (
  select m.*,coalesce(c.reserve_current,0) reserve_current,coalesce(c.work_current,0) work_current,
   coalesce(c.reserve_current,0)+coalesce(c.work_current,0) total_current,
   coalesce(p.reserve_delta,0) reserve_delta,coalesce(p.work_delta,0) work_delta,
   coalesce(p.movement_count,0) movement_count
  from selected_medications m left join current_stock c on c.medication_id=m.id
  left join period_totals p on p.medication_id=m.id
 )
 select jsonb_build_object(
  'from',date_from,'to',date_to,'time_zone','Europe/Moscow','generated_at',statement_timestamp(),
  'movements_count',(select count(*) from movements),'medications_count',(select count(*) from medication_rows),
  'catalog',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(trim(name),''),'Без названия'),
   'unit',coalesce(nullif(trim(consumption_unit),''),'ед.'),'active',coalesce(active,false)) order by name,id),'[]'::jsonb) from public.medications),
  'medications',(select coalesce(jsonb_agg(to_jsonb(r) order by r.name,r.id),'[]'::jsonb) from medication_rows r),
  'movements',(select coalesce(jsonb_agg(to_jsonb(r) order by r.at,r.id),'[]'::jsonb) from movements r)
 ) into result;
 return result;
end $$;
revoke all on function private.crm_warehouse_report_v5(jsonb) from public,anon;
grant execute on function private.crm_warehouse_report_v5(jsonb) to authenticated;
create or replace function public.crm_warehouse_report_v5(p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.crm_warehouse_report_v5(p_payload);
$$;
revoke all on function public.crm_warehouse_report_v5(jsonb) from public,anon;
grant execute on function public.crm_warehouse_report_v5(jsonb) to authenticated;
