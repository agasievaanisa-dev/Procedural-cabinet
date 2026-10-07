-- Reversible removal of a medication card from the working catalogue.
-- Clinical history and batch costs stay intact. Current balances are written
-- off through the existing stock ledger; restoring the card restores no stock.
begin;

create table if not exists private.crm_deleted_medications_v7 (
 medication_id uuid primary key references public.medications(id),
 previous_active boolean not null,
 medication_snapshot jsonb not null,
 reserve_removed numeric not null check (reserve_removed>=0 and reserve_removed=trunc(reserve_removed)),
 work_removed numeric not null check (work_removed>=0 and work_removed=trunc(work_removed)),
 reason text not null check (length(trim(reason)) between 1 and 1000),
 deleted_by uuid not null,
 deleted_staff uuid,
 deleted_at timestamptz not null default now()
);
alter table private.crm_deleted_medications_v7 enable row level security;
revoke all on private.crm_deleted_medications_v7 from public,anon,authenticated;

-- An older browser or API must not resurrect a deleted card with warehouse
-- save/restore, or alter its metadata while it is in the deleted-card list.
-- The v7 restore removes the tombstone under the medication lock first.
create or replace function private.crm_deleted_medication_guard_v7()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.crm_deleted_medications_v7 where medication_id=old.id) then
  raise exception 'Препарат удалён. Сначала восстановите карточку в разделе «Удалённые препараты»';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.crm_deleted_medication_guard_v7() from public,anon,authenticated;
drop trigger if exists crm_deleted_medication_guard_v7 on public.medications;
create trigger crm_deleted_medication_guard_v7 before update or delete on public.medications
 for each row execute function private.crm_deleted_medication_guard_v7();

create or replace function private.crm_medication_delete_v7(
 p_action text,p_payload jsonb default '{}'::jsonb,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_request private.warehouse_requests%rowtype;
 v_med public.medications%rowtype;
 v_deleted private.crm_deleted_medications_v7%rowtype;
 v_id uuid;
 v_reason text;
 v_reserve numeric;
 v_work numeric;
 v_expected_reserve numeric;
 v_expected_work numeric;
 v_result jsonb;
begin
 if auth.uid() is null or not private.is_manager() then
  raise exception 'Удаление и восстановление доступны только владельцу';
 end if;
 if p_action is null or p_action not in ('preview','delete','list_deleted','restore') then
  raise exception 'Неизвестная операция с препаратом';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then
  raise exception 'Проверьте данные препарата';
 end if;

 if p_action='list_deleted' then
  return coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.medication_id,'name',m.name,'unit',m.consumption_unit,
   'deleted_at',d.deleted_at,'deleted_by',d.deleted_by,'reason',d.reason,
   'reserve_removed',d.reserve_removed,'work_removed',d.work_removed,
   'total_removed',d.reserve_removed+d.work_removed,'restore_stock',0
  ) order by d.deleted_at desc,d.medication_id)
  from private.crm_deleted_medications_v7 d join public.medications m on m.id=d.medication_id),'[]'::jsonb);
 end if;

 if p_action in ('delete','restore') then
  if p_request_id is null then raise exception 'Нужен номер операции';end if;
  -- Claim before locking the medication. A concurrent transport retry waits,
  -- then returns the committed response before checking stale expectations.
  insert into private.warehouse_requests(id,staff_user,action,payload)
   values(p_request_id,auth.uid(),'v7_medication_'||p_action,p_payload) on conflict do nothing;
  select * into v_request from private.warehouse_requests where id=p_request_id for update;
  if v_request.staff_user is distinct from auth.uid()
     or v_request.action is distinct from 'v7_medication_'||p_action
     or v_request.payload is distinct from p_payload then
   raise exception 'Номер операции уже используется';
  end if;
  if v_request.result is not null then return v_request.result;end if;
  v_reason:=nullif(trim(p_payload->>'reason'),'');
  if v_reason is null then raise exception 'Укажите причину';end if;
  if length(v_reason)>1000 then raise exception 'Причина: не более 1000 символов';end if;
 end if;

 v_id:=nullif(p_payload->>'id','')::uuid;
 if v_id is null then raise exception 'Выберите препарат';end if;
 -- Existing receiving, inventory, and clinical operations use this same row
 -- lock, so balances below form one consistent snapshot of the medication.
 if p_action='preview' then
  select * into v_med from public.medications where id=v_id for share;
 else
  select * into v_med from public.medications where id=v_id for update;
 end if;
 if not found then raise exception 'Препарат не найден';end if;
 select * into v_deleted from private.crm_deleted_medications_v7 where medication_id=v_id;
 if p_action='restore' then
  if not found then raise exception 'Карточка уже восстановлена или не была удалена';end if;
 elsif found then
  raise exception 'Препарат уже удалён. Обновите список';
 end if;
 perform private.assert_stock_v3(v_id);
 select coalesce(max(quantity) filter(where location='reserve'),0),
  coalesce(max(quantity) filter(where location='work'),0)
 into v_reserve,v_work from public.stock where medication_id=v_id;

 if p_action='preview' then
  return jsonb_build_object('id',v_id,'name',v_med.name,'unit',v_med.consumption_unit,'active',v_med.active,
   'reserve',v_reserve,'work',v_work,'total',v_reserve+v_work,
   'expected_reserve',v_reserve,'expected_work',v_work,'history_preserved',true,'restore_stock',0);
 elsif p_action='delete' then
  v_expected_reserve:=(p_payload->>'expected_reserve')::numeric;
  v_expected_work:=(p_payload->>'expected_work')::numeric;
  if v_expected_reserve is null or v_expected_reserve<0 or v_expected_reserve<>trunc(v_expected_reserve)
     or v_expected_reserve::text in ('NaN','Infinity','-Infinity')
     or v_expected_work is null or v_expected_work<0 or v_expected_work<>trunc(v_expected_work)
     or v_expected_work::text in ('NaN','Infinity','-Infinity') then
   raise exception 'Обновите остатки перед удалением';
  end if;
  if v_reserve is distinct from v_expected_reserve or v_work is distinct from v_expected_work then
   raise exception 'Остаток уже изменился. Обновите данные и проверьте количество перед удалением';
  end if;
  if v_reserve>0 then
   perform private.move_stock_v3(v_id,v_reserve,'reserve',null,'write_off','Удаление карточки препарата. Причина: '||v_reason);
  end if;
  if v_work>0 then
   perform private.move_stock_v3(v_id,v_work,'work',null,'write_off','Удаление карточки препарата. Причина: '||v_reason);
  end if;
  -- Updating active before inserting the tombstone keeps the shared guard
  -- strict: it has no session flag or user-controlled bypass.
  update public.medications set active=false where id=v_id;
  insert into private.crm_deleted_medications_v7(medication_id,previous_active,medication_snapshot,
   reserve_removed,work_removed,reason,deleted_by,deleted_staff)
  values(v_id,v_med.active,to_jsonb(v_med),v_reserve,v_work,v_reason,auth.uid(),
   (select id from public.staff where auth_user_id=auth.uid() and active limit 1));
  v_result:=jsonb_build_object('id',v_id,'name',v_med.name,'unit',v_med.consumption_unit,'deleted',true,'active',false,
   'reserve_removed',v_reserve,'work_removed',v_work,'total_removed',v_reserve+v_work,
   'reserve',0,'work',0,'total',0,'history_preserved',true,'restore_stock',0);
  perform private.crm_audit_v5('medication_deleted','medications',v_id::text,
   jsonb_build_object('medication',to_jsonb(v_med),'reserve',v_reserve,'work',v_work),v_result,v_reason);
 else
  if v_reserve<>0 or v_work<>0 then
   raise exception 'У удалённой карточки обнаружен остаток. Требуется сверка склада';
  end if;
  delete from private.crm_deleted_medications_v7 where medication_id=v_id;
  update public.medications set active=v_deleted.previous_active where id=v_id;
  v_result:=jsonb_build_object('id',v_id,'name',v_med.name,'unit',v_med.consumption_unit,'restored',true,
   'active',v_deleted.previous_active,'reserve',0,'work',0,'total',0,'history_preserved',true,'restore_stock',0);
  perform private.crm_audit_v5('medication_restored','medications',v_id::text,
   jsonb_build_object('deleted_at',v_deleted.deleted_at,'active',false,'reserve',0,'work',0),v_result,v_reason);
 end if;
 perform private.assert_stock_v3(v_id);
 update private.warehouse_requests set result=v_result where id=p_request_id;
 return v_result;
end $$;
revoke all on function private.crm_medication_delete_v7(text,jsonb,uuid) from public,anon;
grant execute on function private.crm_medication_delete_v7(text,jsonb,uuid) to authenticated;

create or replace function public.crm_medication_delete_v7(
 p_action text,p_payload jsonb default '{}'::jsonb,p_request_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.crm_medication_delete_v7(p_action,p_payload,p_request_id);
$$;
revoke all on function public.crm_medication_delete_v7(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_medication_delete_v7(text,jsonb,uuid) to authenticated;

-- Deleted cards are hidden in owner lists too. Existing ordinary archive
-- cards remain listed, and history/report queries retain medication rows.
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
   into v_result from jsonb_array_elements(v_result) x join public.medications m on m.id=(x.value->>'id')::uuid
   where not exists(select 1 from private.crm_deleted_medications_v7 d where d.medication_id=m.id);
 end if;
 return v_result;
end $$;

-- Include removal state in both scheduled backups and the owner's export;
-- otherwise a restored database could expose deleted cards as ordinary archive.
create or replace function private.crm_backup_data_v5() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t record; parts text[]:=array[]::text[]; result jsonb;
begin
  -- One SELECT gives a consistent snapshot across related clinical tables.
  for t in select table_schema,table_name from information_schema.tables
    where table_type='BASE TABLE' and (table_schema='public' or
      (table_schema='private' and table_name in ('medication_favorites','warehouse_requests','crm_audit_log','crm_templates','crm_procedure_templates','crm_finance_settings','crm_payment_allocations','crm_shift_payroll','crm_shift_reports','crm_deleted_medications_v7')))
    order by table_schema,table_name loop
    parts:=array_append(parts,format('select %L::text as name, coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) as rows from %I.%I t',t.table_schema||'.'||t.table_name,t.table_schema,t.table_name));
  end loop;
  execute 'select jsonb_object_agg(name,rows) from ('||array_to_string(parts,' union all ')||') all_tables' into result;
  return jsonb_build_object('format','procedural-cabinet-backup-v5','created_at',now(),'tables',result);
end $$;

notify pgrst,'reload schema';
commit;
