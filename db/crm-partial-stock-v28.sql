-- Gradual inventory: finance remains independent; only known, dated units move.
-- No existing treatment, financial amount, stock quantity or movement is rewritten.
begin;
set local lock_timeout='10s';

alter table private.crm_finance_settings add column if not exists partial_stock boolean not null default false;
alter table private.crm_finance_settings add constraint crm_partial_stock_requires_payment_only_v28 check(not partial_stock or payment_only);

create table private.crm_partial_stock_tracking_v28 (
 medication_id uuid primary key references public.medications(id),enabled boolean not null,
 source text not null check(source in ('auto','manual')),updated_at timestamptz not null default now(),updated_by uuid
);
create table private.crm_partial_stock_records_v28 (
 kind text not null check(kind in ('procedure','sale')),record_id uuid not null,
 created_at timestamptz not null default now(),primary key(kind,record_id)
);
create table private.crm_partial_stock_lines_v28 (
 kind text not null,record_id uuid not null,medication_id uuid not null references public.medications(id),
 requested_qty numeric not null check(requested_qty>=0 and requested_qty=trunc(requested_qty)),
 deducted_qty numeric not null check(deducted_qty>=0 and deducted_qty=trunc(deducted_qty)),
 pending_qty numeric not null check(pending_qty>=0 and pending_qty=trunc(pending_qty)),pending_reason text,
 updated_at timestamptz not null default now(),primary key(kind,record_id,medication_id),
 foreign key(kind,record_id) references private.crm_partial_stock_records_v28(kind,record_id),
 check(requested_qty=deducted_qty+pending_qty),check((pending_qty=0 and pending_reason is null) or(pending_qty>0 and pending_reason in ('untracked','shortage','unknown_expiry','expired','multiple')))
);
create index crm_partial_stock_pending_v28 on private.crm_partial_stock_lines_v28(medication_id) where pending_qty>0;
create table private.crm_partial_stock_requests_v28 (
 request_id uuid primary key,actor_user uuid not null,action text not null,payload jsonb not null,
 result jsonb,created_at timestamptz not null default now()
);
alter table private.crm_partial_stock_tracking_v28 enable row level security;
alter table private.crm_partial_stock_records_v28 enable row level security;
alter table private.crm_partial_stock_lines_v28 enable row level security;
alter table private.crm_partial_stock_requests_v28 enable row level security;
revoke all on private.crm_partial_stock_tracking_v28,private.crm_partial_stock_records_v28,private.crm_partial_stock_lines_v28,private.crm_partial_stock_requests_v28 from public,anon,authenticated;

-- A medicine remains tracked after its last unit is consumed. Manual pauses win.
-- Close the seed/trigger gap while the operating cabinet may still receive stock.
lock table public.medications,public.medication_batches,public.stock in share row exclusive mode;
insert into private.crm_partial_stock_tracking_v28(medication_id,enabled,source)
 select distinct medication_id,true,'auto' from public.stock where quantity>0;
create function private.crm_partial_stock_auto_v28() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.quantity>0 then
  insert into private.crm_partial_stock_tracking_v28(medication_id,enabled,source)
   values(new.medication_id,true,'auto') on conflict(medication_id) do update
   set enabled=true,updated_at=now() where private.crm_partial_stock_tracking_v28.source='auto';
 end if;
 return new;
end $$;
revoke all on function private.crm_partial_stock_auto_v28() from public,anon,authenticated;
create trigger crm_partial_stock_auto_v28 after insert or update of quantity on public.stock
 for each row execute function private.crm_partial_stock_auto_v28();

-- Copy, do not rename: existing function OIDs and all grants stay intact.
do $copy$
declare n text;signature_n text;source_n text;
begin
 for n,signature_n in select * from(values
  ('crm_record_treatment_v10','text,jsonb,uuid,boolean'),
  ('crm_clinical_v10','text,jsonb,uuid'),('crm_finance_v5','text,jsonb'),
  ('crm_treatment_snapshot_v10','text,uuid'),('work_catalog_v2',''),
  ('warehouse_v5','text,jsonb,uuid'),('crm_build_shift_report_v5','uuid'),('crm_finance_summary_v5','jsonb'),('crm_refresh_closed_report_v10','uuid')
 ) x(n,sig) loop
  source_n:=pg_get_functiondef(to_regprocedure('private.'||n||'('||signature_n||')'));
  if source_n is null then raise exception 'Missing released function: %',n;end if;
  execute replace(source_n,'FUNCTION private.'||n||'(','FUNCTION private.'||n||'_before_v28(');
  execute 'revoke all on function private.'||n||'_before_v28('||signature_n||') from public,anon,authenticated';
 end loop;
end $copy$;

-- In the finance summary stock_deducted is a read-only CTE field used solely
-- for payment-only counters. Exclude hybrid records from those legacy counts;
-- retain the rest of the released financial SQL byte for byte.
do $summary$
declare source_n text;old_n text;new_n text;
begin
 source_n:=pg_get_functiondef('private.crm_finance_summary_v5(jsonb)'::regprocedure);
 old_n:='p.stock_deducted';
 if (length(source_n)-length(replace(source_n,old_n,'')))/length(old_n)<>1 then raise exception 'Unexpected procedure stock summary source';end if;
 new_n:='(p.stock_deducted or exists(select 1 from private.crm_partial_stock_records_v28 pr where pr.kind=''procedure'' and pr.record_id=p.id)) stock_deducted';
 source_n:=replace(source_n,old_n,new_n);
 old_n:='s.stock_deducted';
 if (length(source_n)-length(replace(source_n,old_n,'')))/length(old_n)<>1 then raise exception 'Unexpected sale stock summary source';end if;
 new_n:='(s.stock_deducted or exists(select 1 from private.crm_partial_stock_records_v28 sr where sr.kind=''sale'' and sr.record_id=s.id))';
 execute replace(source_n,old_n,new_n);
end $summary$;

create function private.crm_partial_stock_facts_v28(p_med uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('stock_tracking_enabled',coalesce((select enabled from private.crm_partial_stock_tracking_v28 where medication_id=p_med),false),
  'physical_work_qty',coalesce(sum(work_quantity),0),
  'reserve_available',coalesce(sum(quantity_remaining-work_quantity) filter(where expiry_date>=(now() at time zone 'Europe/Moscow')::date),0),
  'total_available',coalesce(sum(quantity_remaining) filter(where expiry_date>=(now() at time zone 'Europe/Moscow')::date),0),
  'unknown_expiry_qty',coalesce(sum(quantity_remaining) filter(where expiry_date is null),0),
  'expired_qty',coalesce(sum(quantity_remaining) filter(where expiry_date<(now() at time zone 'Europe/Moscow')::date),0))
 from public.medication_batches where medication_id=p_med;
$$;
revoke all on function private.crm_partial_stock_facts_v28(uuid) from public,anon,authenticated;

create or replace function private.work_catalog_v2() returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows_n jsonb;manager_n boolean;
begin
 rows_n:=private.work_catalog_v2_before_v28();
 manager_n:=private.is_manager();
 if manager_n is not true then
  -- Nurses retain the established working-cabinet view. The private spending
  -- helper may use reserve stock, but the catalogue never reveals its balance.
  return coalesce((select jsonb_agg(x.value||jsonb_build_object(
   'stock_tracking_enabled',coalesce(t.enabled,false),
   'physical_work_qty',coalesce(b.physical_work_qty,0),
   'unknown_expiry_qty',coalesce(b.unknown_work_qty,0),
   'expired_qty',coalesce(b.expired_work_qty,0)) order by x.ordinality)
   from jsonb_array_elements(rows_n) with ordinality x(value,ordinality)
   left join private.crm_partial_stock_tracking_v28 t on t.medication_id=(x.value->>'id')::uuid
   left join lateral(select sum(mb.work_quantity) physical_work_qty,
    sum(mb.work_quantity) filter(where mb.expiry_date is null) unknown_work_qty,
    sum(mb.work_quantity) filter(where mb.expiry_date<(now() at time zone 'Europe/Moscow')::date) expired_work_qty
    from public.medication_batches mb where mb.medication_id=(x.value->>'id')::uuid) b on true),'[]'::jsonb);
 end if;
 return coalesce((select jsonb_agg(x.value||private.crm_partial_stock_facts_v28((x.value->>'id')::uuid) order by x.ordinality)
  from jsonb_array_elements(rows_n) with ordinality x(value,ordinality)),'[]'::jsonb);
end $$;
create or replace function private.warehouse_v5(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;
begin
 answer_n:=private.warehouse_v5_before_v28(p_action,p_payload,p_request_id);
 if p_action='list' then
  return coalesce((select jsonb_agg(x.value||private.crm_partial_stock_facts_v28((x.value->>'id')::uuid) order by x.ordinality)
   from jsonb_array_elements(answer_n) with ordinality x(value,ordinality)),'[]'::jsonb);
 end if;
 return answer_n;
end $$;

create or replace function private.crm_treatment_snapshot_v10(p_kind text,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;items_n jsonb;summary_n jsonb;
begin
 answer_n:=private.crm_treatment_snapshot_v10_before_v28(p_kind,p_id);
 if not exists(select 1 from private.crm_partial_stock_records_v28 where kind=p_kind and record_id=p_id) then
  return answer_n||jsonb_build_object('stock_mode',case when(answer_n->>'stock_deducted')::boolean then 'full' else 'payment_only' end);
 end if;
 select coalesce(jsonb_agg(x.value||jsonb_build_object('stock_requested',coalesce(l.requested_qty,0),
  'stock_deducted_quantity',coalesce(l.deducted_qty,0),'stock_pending_quantity',coalesce(l.pending_qty,0),'pending_reason',l.pending_reason) order by x.ordinality),'[]')
 into items_n from jsonb_array_elements(answer_n->'items') with ordinality x(value,ordinality)
 left join private.crm_partial_stock_lines_v28 l on l.kind=p_kind and l.record_id=p_id and l.medication_id=(x.value->>'medication_id')::uuid;
 select jsonb_build_object('requested_quantity',coalesce(sum(requested_qty),0),'deducted_quantity',coalesce(sum(deducted_qty),0),'pending_quantity',coalesce(sum(pending_qty),0))
 into summary_n from private.crm_partial_stock_lines_v28 where kind=p_kind and record_id=p_id;
 return answer_n||jsonb_build_object('stock_mode','partial','partial_stock',true,'stock_summary',summary_n,'items',items_n,'medications',items_n);
end $$;

-- Increase only the newly requested quantity. Old pending units never silently
-- consume a later delivery; reductions cancel pending units before exact returns.
create function private.crm_partial_stock_apply_v28(p_kind text,p_id uuid,p_request uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare row_n record;old_n private.crm_partial_stock_lines_v28%rowtype;new_q numeric;delta_n numeric;
 take_n numeric;transfer_n numeric;work_n numeric;reserve_n numeric;pending_n numeric;deducted_n numeric;reason_n text;facts_n jsonb;items_n jsonb;
begin
 if p_kind='procedure' then
  select coalesce(jsonb_agg(jsonb_build_object('medication_id',medication_id,'quantity',quantity)),'[]') into items_n from public.procedure_medications where procedure_id=p_id;
 else
  select coalesce(jsonb_agg(jsonb_build_object('medication_id',medication_id,'quantity',quantity)),'[]') into items_n from public.sale_items where sale_id=p_id;
 end if;
 perform m.id from public.medications m where m.id in(
  select (x->>'medication_id')::uuid from jsonb_array_elements(items_n) x
  union select medication_id from private.crm_partial_stock_lines_v28 where kind=p_kind and record_id=p_id
 ) order by m.id for update;
 for row_n in select id from(
  select(x->>'medication_id')::uuid id from jsonb_array_elements(items_n) x
  union select medication_id from private.crm_partial_stock_lines_v28 where kind=p_kind and record_id=p_id
 ) z order by id loop
  select * into old_n from private.crm_partial_stock_lines_v28 where kind=p_kind and record_id=p_id and medication_id=row_n.id for update;
  select coalesce(sum((x->>'quantity')::numeric),0) into new_q from jsonb_array_elements(items_n) x where(x->>'medication_id')::uuid=row_n.id;
  pending_n:=coalesce(old_n.pending_qty,0);deducted_n:=coalesce(old_n.deducted_qty,0);reason_n:=old_n.pending_reason;
  delta_n:=new_q-coalesce(old_n.requested_qty,0);
  if delta_n>0 then
   facts_n:=private.crm_partial_stock_facts_v28(row_n.id);take_n:=0;
   if(facts_n->>'stock_tracking_enabled')::boolean then
    perform private.assert_stock_v3(row_n.id);
    perform b.id from public.medication_batches b where b.medication_id=row_n.id order by b.expiry_date nulls last,b.received_date,b.id for update;
    select coalesce(sum(work_quantity),0),coalesce(sum(quantity_remaining-work_quantity),0) into work_n,reserve_n
     from public.medication_batches where medication_id=row_n.id and expiry_date>=(now() at time zone 'Europe/Moscow')::date;
    take_n:=least(delta_n,work_n+reserve_n);transfer_n:=greatest(take_n-work_n,0);
    if transfer_n>0 then
     perform private.move_stock_v3(row_n.id,transfer_n,'reserve','work','reserve_to_work','Автоматическое пополнение рабочего шкафа для процедуры или продажи');
    end if;
    if take_n>0 then
     perform private.move_stock_v3(row_n.id,take_n,'work',null,case when p_kind='procedure' then 'procedure_use' else 'sale' end,
      'Списание при постепенном подключении склада',case when p_kind='procedure' then p_id end,case when p_kind='sale' then p_id end);
    end if;
   end if;
   deducted_n:=deducted_n+take_n;
   if delta_n>take_n then
    facts_n:=private.crm_partial_stock_facts_v28(row_n.id);
    reason_n:=case when not(facts_n->>'stock_tracking_enabled')::boolean then 'untracked'
     when(facts_n->>'unknown_expiry_qty')::numeric>0 then 'unknown_expiry'
     when(facts_n->>'expired_qty')::numeric>0 then 'expired' else 'shortage' end;
    if pending_n>0 and old_n.pending_reason is distinct from reason_n then reason_n:='multiple';end if;
    pending_n:=pending_n+delta_n-take_n;
   end if;
  elsif delta_n<0 then
   take_n:=least(pending_n,-delta_n);pending_n:=pending_n-take_n;delta_n:=-delta_n-take_n;
   if delta_n>0 then
    perform private.crm_return_consumed_v10(p_kind,p_id,row_n.id,delta_n,p_request);deducted_n:=deducted_n-delta_n;
   end if;
  end if;
  if pending_n=0 then reason_n:=null;end if;
  if new_q=0 then
   delete from private.crm_partial_stock_lines_v28 where kind=p_kind and record_id=p_id and medication_id=row_n.id;
  else
   insert into private.crm_partial_stock_lines_v28(kind,record_id,medication_id,requested_qty,deducted_qty,pending_qty,pending_reason)
    values(p_kind,p_id,row_n.id,new_q,deducted_n,pending_n,reason_n)
    on conflict(kind,record_id,medication_id) do update set requested_qty=excluded.requested_qty,deducted_qty=excluded.deducted_qty,pending_qty=excluded.pending_qty,pending_reason=excluded.pending_reason,updated_at=now();
  end if;
 end loop;
end $$;
revoke all on function private.crm_partial_stock_apply_v28(text,uuid,uuid) from public,anon,authenticated;

create or replace function private.crm_record_treatment_v10(p_kind text,p_payload jsonb,p_request_id uuid,p_allocated boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request_n private.crm_partial_stock_requests_v28%rowtype;answer_n jsonb;partial_n boolean;prior_n boolean;id_n uuid;actor_n uuid;action_n text;
begin
 select id into actor_n from public.staff where auth_user_id=auth.uid() and active and role in('owner','admin','nurse') limit 1;
 if auth.uid() is null or actor_n is null then raise exception 'Нет доступа' using errcode='42501';end if;
 if p_request_id is null or p_kind not in('procedure','sale') or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте операцию';end if;
 action_n:='create_'||p_kind||'_'||coalesce(p_allocated,false)::text;
 insert into private.crm_partial_stock_requests_v28(request_id,actor_user,action,payload) values(p_request_id,auth.uid(),action_n,p_payload) on conflict do nothing;
 select * into request_n from private.crm_partial_stock_requests_v28 where request_id=p_request_id for update;
 if request_n.actor_user is distinct from auth.uid() or request_n.action is distinct from action_n or request_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
 if request_n.result is not null then return request_n.result;end if;
 select partial_stock into partial_n from private.crm_finance_settings where id for share;
 if p_payload?'expected_partial_stock' and(jsonb_typeof(p_payload->'expected_partial_stock') is distinct from 'boolean'
  or(p_payload->>'expected_partial_stock')::boolean is distinct from partial_n) then
  raise exception 'Режим учёта изменён. Обновите форму';
 end if;
 -- Claim the established core receipt before inspecting it. A concurrently
 -- finishing pre-v28 request must be treated as legacy, never retro-deducted.
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,auth.uid(),'clinical_'||p_kind,p_payload) on conflict do nothing;
 select result is not null into prior_n from private.warehouse_requests where id=p_request_id for update;
 answer_n:=private.crm_record_treatment_v10_before_v28(p_kind,p_payload,p_request_id,p_allocated);
 id_n:=(answer_n->>'id')::uuid;
 if partial_n and not prior_n then
  if(answer_n->>'stock_deducted')::boolean then raise exception 'Обновите режим учёта';end if;
  insert into private.crm_partial_stock_records_v28(kind,record_id) values(p_kind,id_n);
  perform private.crm_partial_stock_apply_v28(p_kind,id_n,p_request_id);
  answer_n:=private.crm_treatment_snapshot_v10(p_kind,id_n)||jsonb_build_object('payments',answer_n->'payments');
  perform private.crm_audit_v5('partial_stock_recorded_v28',p_kind,id_n::text,null,answer_n,null);
  update private.warehouse_requests set result=answer_n where id=p_request_id;
 end if;
 update private.crm_partial_stock_requests_v28 set result=answer_n where request_id=p_request_id;
 return answer_n;
end $$;

create or replace function private.crm_clinical_v10(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request_n private.crm_partial_stock_requests_v28%rowtype;answer_n jsonb;prior_n boolean;kind_n text;id_n uuid;actor_n uuid;before_n jsonb;
begin
 if p_action is distinct from 'treatment_edit' then return private.crm_clinical_v10_before_v28(p_action,p_payload,p_request_id);end if;
 select id into actor_n from public.staff where auth_user_id=auth.uid() and active and role in('owner','admin','nurse') limit 1;
 if auth.uid() is null or actor_n is null then raise exception 'Нет доступа' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте операцию';end if;
 insert into private.crm_partial_stock_requests_v28(request_id,actor_user,action,payload) values(p_request_id,auth.uid(),'treatment_edit',p_payload) on conflict do nothing;
 select * into request_n from private.crm_partial_stock_requests_v28 where request_id=p_request_id for update;
 if request_n.actor_user is distinct from auth.uid() or request_n.action<>'treatment_edit' or request_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
 if request_n.result is not null then
  -- Preserve the released nurse/deleted-patient access check even on a retry.
  -- The core receipt is already complete, so this cannot replay a stock edit.
  perform private.crm_clinical_v10_before_v28(p_action,p_payload,p_request_id);
  return request_n.result;
 end if;
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,auth.uid(),'clinical_v10_treatment_edit',p_payload) on conflict do nothing;
 select result is not null into prior_n from private.warehouse_requests where id=p_request_id for update;
 answer_n:=private.crm_clinical_v10_before_v28(p_action,p_payload,p_request_id);
 kind_n:=coalesce(p_payload->>'kind','procedure');id_n:=(answer_n->>'id')::uuid;
 if not prior_n and exists(select 1 from private.crm_partial_stock_records_v28 where kind=kind_n and record_id=id_n) then
  before_n:=answer_n->'stock_summary';
  perform private.crm_partial_stock_apply_v28(kind_n,id_n,p_request_id);
  answer_n:=private.crm_treatment_snapshot_v10(kind_n,id_n)||jsonb_build_object('payments',answer_n->'payments');
  perform private.crm_audit_v5('partial_stock_edited_v28',kind_n,id_n::text,before_n,answer_n->'stock_summary',p_payload->>'edit_reason');
  update private.warehouse_requests set result=answer_n where id=p_request_id;
  perform private.crm_refresh_closed_report_v10((answer_n->>'shift_id')::uuid);
 end if;
 update private.crm_partial_stock_requests_v28 set result=answer_n where request_id=p_request_id;
 return answer_n;
end $$;

create or replace function private.crm_finance_v5(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer_n jsonb;partial_n boolean;before_n boolean;
begin
 if p_action='settings_save' then
  if auth.uid() is null or not private.is_manager() then raise exception 'Нет доступа' using errcode='42501';end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Проверьте параметры';end if;
  if p_payload?'partial_stock' and jsonb_typeof(p_payload->'partial_stock') is distinct from 'boolean' then raise exception 'Проверьте режим постепенного учёта';end if;
  select partial_stock into before_n from private.crm_finance_settings where id for update;
  partial_n:=coalesce((p_payload->>'partial_stock')::boolean,before_n);
  if partial_n then
   if p_payload?'payment_only' and p_payload->'payment_only' is distinct from 'true'::jsonb then raise exception 'Обновите настройки и выберите режим учёта';end if;
   p_payload:=p_payload||jsonb_build_object('payment_only',true);
  end if;
  -- Disable the partial guard first when moving to full stock mode; all changes
  -- roll back if the established financial validation rejects this save.
  if not partial_n then update private.crm_finance_settings set partial_stock=false where id;end if;
  answer_n:=private.crm_finance_v5_before_v28(p_action,p_payload);
  update private.crm_finance_settings set partial_stock=partial_n where id;
  if before_n is distinct from partial_n then perform private.crm_audit_v5('partial_stock_mode_changed_v28','settings','finance',jsonb_build_object('partial_stock',before_n),jsonb_build_object('partial_stock',partial_n),null);end if;
 else answer_n:=private.crm_finance_v5_before_v28(p_action,p_payload);end if;
 if p_action in('accounting_mode','settings_get','settings_save') then
  select partial_stock into partial_n from private.crm_finance_settings where id;
  return answer_n||jsonb_build_object('partial_stock',partial_n,'stock_mode',case when partial_n then 'partial' when(answer_n->>'payment_only')::boolean then 'payment_only' else 'full' end);
 end if;
 return answer_n;
end $$;

create function private.crm_partial_stock_v28(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor_n uuid;role_n text;request_n private.crm_partial_stock_requests_v28%rowtype;answer_n jsonb;med_n uuid;enabled_n boolean;before_n jsonb;
begin
 select id,role into actor_n,role_n from public.staff where auth_user_id=auth.uid() and active limit 1;
 if auth.uid() is null or actor_n is null or role_n not in('owner','admin','nurse') then raise exception 'Нет доступа' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null then raise exception 'Проверьте параметры';end if;
 if p_action='status' then
  return (select jsonb_build_object('partial_stock',partial_stock,'payment_only',payment_only,'stock_mode',case when partial_stock then 'partial' when payment_only then 'payment_only' else 'full' end,
   'tracked_count',(select count(*) from private.crm_partial_stock_tracking_v28 t join public.medications m on m.id=t.medication_id where t.enabled and m.active)) from private.crm_finance_settings where id);
 end if;
 if p_action='medications' then return private.work_catalog_v2();end if;
 if role_n='nurse' then raise exception 'Доступно только администратору' using errcode='42501';end if;
 if p_action='review_summary' then
  return jsonb_build_object('pending_count',(select count(*) from private.crm_partial_stock_lines_v28 where pending_qty>0),
   'pending_quantity',(select coalesce(sum(pending_qty),0) from private.crm_partial_stock_lines_v28),
   'medications',coalesce((select jsonb_agg(to_jsonb(z) order by z.name,z.medication_id) from(
    select l.medication_id,m.name,m.consumption_unit unit,sum(l.pending_qty) pending_quantity,count(*) records_count,
     jsonb_agg(distinct l.pending_reason) reasons from private.crm_partial_stock_lines_v28 l join public.medications m on m.id=l.medication_id
    where l.pending_qty>0 group by l.medication_id,m.name,m.consumption_unit) z),'[]'::jsonb));
 end if;
 if p_action='review_detail' then
  med_n:=nullif(p_payload->>'id','')::uuid;
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(z) order by z.updated_at,z.kind,z.record_id,z.medication_id) from(
   select l.*,m.name,m.consumption_unit unit from private.crm_partial_stock_lines_v28 l join public.medications m on m.id=l.medication_id
   where l.pending_qty>0 and(med_n is null or l.medication_id=med_n)) z),'[]'::jsonb));
 end if;
 if p_action not in('mode_set','tracking_set') or p_request_id is null then raise exception 'Неизвестная операция';end if;
 if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'Укажите включение или выключение учёта';end if;
 enabled_n:=(p_payload->>'enabled')::boolean;
 insert into private.crm_partial_stock_requests_v28(request_id,actor_user,action,payload) values(p_request_id,auth.uid(),p_action,p_payload) on conflict do nothing;
 select * into request_n from private.crm_partial_stock_requests_v28 where request_id=p_request_id for update;
 if request_n.actor_user is distinct from auth.uid() or request_n.action is distinct from p_action or request_n.payload is distinct from p_payload then raise exception 'Номер операции уже использован';end if;
 if request_n.result is not null then return request_n.result;end if;
 if p_action='mode_set' then
  select to_jsonb(f) into before_n from private.crm_finance_settings f where id for update;
  update private.crm_finance_settings set partial_stock=enabled_n,payment_only=true,updated_at=now(),updated_by=auth.uid() where id;
  answer_n:=private.crm_partial_stock_v28('status','{}',null);
  perform private.crm_audit_v5('partial_stock_mode_changed_v28','settings','finance',before_n,answer_n,p_payload->>'reason');
 else
  med_n:=nullif(p_payload->>'id','')::uuid;
  perform 1 from public.medications where id=med_n and active for update;
  if not found then raise exception 'Препарат недоступен';end if;
  select to_jsonb(t) into before_n from private.crm_partial_stock_tracking_v28 t where medication_id=med_n for update;
  insert into private.crm_partial_stock_tracking_v28(medication_id,enabled,source,updated_by) values(med_n,enabled_n,'manual',auth.uid())
   on conflict(medication_id) do update set enabled=excluded.enabled,source='manual',updated_at=now(),updated_by=auth.uid();
  answer_n:=jsonb_build_object('id',med_n,'stock_tracking_enabled',enabled_n)||private.crm_partial_stock_facts_v28(med_n);
  perform private.crm_audit_v5('partial_stock_tracking_changed_v28','medications',med_n::text,before_n,answer_n,p_payload->>'reason');
 end if;
 update private.crm_partial_stock_requests_v28 set result=answer_n where request_id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_partial_stock_v28(text,jsonb,uuid) from public,anon;
grant execute on function private.crm_partial_stock_v28(text,jsonb,uuid) to authenticated;
create function public.crm_partial_stock_v28(p_action text,p_payload jsonb default '{}',p_request_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select private.crm_partial_stock_v28(p_action,p_payload,p_request_id);$$;
revoke all on function public.crm_partial_stock_v28(text,jsonb,uuid) from public,anon;
grant execute on function public.crm_partial_stock_v28(text,jsonb,uuid) to authenticated;

-- Stock-only overlay: retain all established cash, debt and payroll arithmetic.
create or replace function private.crm_build_shift_report_v5(p_shift uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer_n jsonb;pc_n bigint;sc_n bigint;legacy_pc bigint;legacy_sc bigint;warnings_n jsonb;pending_n numeric;untracked_n jsonb;used_n jsonb;
begin
 answer_n:=private.crm_build_shift_report_v5_before_v28(p_shift);
 select count(*) into pc_n from private.crm_partial_stock_records_v28 r join public.procedures p on r.kind='procedure' and p.id=r.record_id where p.shift_id=p_shift;
 select count(*) into sc_n from private.crm_partial_stock_records_v28 r join public.sales s on r.kind='sale' and s.id=r.record_id where s.shift_id=p_shift;
 legacy_pc:=greatest(coalesce((answer_n->>'payment_only_procedures_count')::bigint,0)-pc_n,0);
 legacy_sc:=greatest(coalesce((answer_n->>'payment_only_sales_count')::bigint,0)-sc_n,0);
 select coalesce(sum(l.pending_qty),0) into pending_n from private.crm_partial_stock_lines_v28 l
  left join public.procedures p on l.kind='procedure' and p.id=l.record_id left join public.sales s on l.kind='sale' and s.id=l.record_id where coalesce(p.shift_id,s.shift_id)=p_shift;
 select coalesce(jsonb_agg(w),'[]') into warnings_n from jsonb_array_elements(coalesce(answer_n->'warnings','[]')) w where w->>'type' is distinct from 'payment_only';
 if legacy_pc+legacy_sc>0 then warnings_n:=warnings_n||jsonb_build_array(jsonb_build_object('type','payment_only','scope','work','name','Без складского списания','count',legacy_pc+legacy_sc,'procedures_count',legacy_pc,'sales_count',legacy_sc,'message','В смене есть прежние операции без складского списания. Их количества показаны отдельно.'));end if;
 if pending_n>0 then warnings_n:=warnings_n||jsonb_build_array(jsonb_build_object('type','partial_stock','scope','work','name','Требуется сверка склада','count',pending_n,'message','Финансы сохранены. Часть препаратов ожидает сверки количества или срока годности.'));end if;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.name,z.medication_id),'[]') into untracked_n from(
  select q.medication_id id,q.medication_id,m.name,m.consumption_unit unit,sum(q.quantity) quantity,
   coalesce(sum(q.quantity) filter(where q.kind='procedure'),0) procedure_qty,coalesce(sum(q.quantity) filter(where q.kind='sale'),0) sale_qty from(
   select 'procedure'::text kind,pm.medication_id,pm.quantity from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and not p.stock_deducted and not exists(select 1 from private.crm_partial_stock_records_v28 r where r.kind='procedure' and r.record_id=p.id)
   union all select 'sale',si.medication_id,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and not s.stock_deducted and not exists(select 1 from private.crm_partial_stock_records_v28 r where r.kind='sale' and r.record_id=s.id)
   union all select l.kind,l.medication_id,l.pending_qty from private.crm_partial_stock_lines_v28 l left join public.procedures p on l.kind='procedure' and p.id=l.record_id left join public.sales s on l.kind='sale' and s.id=l.record_id where coalesce(p.shift_id,s.shift_id)=p_shift and l.pending_qty>0
  ) q join public.medications m on m.id=q.medication_id group by q.medication_id,m.name,m.consumption_unit
 ) z;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.name,z.medication_id),'[]') into used_n from(
  select q.medication_id id,q.medication_id,m.name,m.consumption_unit unit,sum(q.quantity) quantity,
   coalesce(sum(q.quantity) filter(where q.kind='procedure'),0) procedure_qty,coalesce(sum(q.quantity) filter(where q.kind='sale'),0) sale_qty from(
   select 'procedure'::text kind,pm.medication_id,pm.quantity from public.procedure_medications pm join public.procedures p on p.id=pm.procedure_id where p.shift_id=p_shift and p.stock_deducted
   union all select 'sale',si.medication_id,si.quantity from public.sale_items si join public.sales s on s.id=si.sale_id where s.shift_id=p_shift and s.stock_deducted
   union all select l.kind,l.medication_id,l.deducted_qty from private.crm_partial_stock_lines_v28 l left join public.procedures p on l.kind='procedure' and p.id=l.record_id left join public.sales s on l.kind='sale' and s.id=l.record_id where coalesce(p.shift_id,s.shift_id)=p_shift and l.deducted_qty>0
  ) q join public.medications m on m.id=q.medication_id group by q.medication_id,m.name,m.consumption_unit
 ) z;
 return answer_n||jsonb_build_object('payment_only_procedures_count',legacy_pc,'payment_only_sales_count',legacy_sc,
  'partial_stock_procedures_count',pc_n,'partial_stock_sales_count',sc_n,'partial_stock_pending_quantity',pending_n,'warnings',warnings_n,'untracked',untracked_n,'used',used_n);
end $$;

-- Keep the close-time physical stock and payroll snapshot. Only the treatment
-- ledger totals follow later, audited edits to partial-stock records.
create or replace function private.crm_refresh_closed_report_v10(p_shift uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare fresh_n jsonb;
begin
 perform private.crm_refresh_closed_report_v10_before_v28(p_shift);
 if not exists(select 1 from private.crm_shift_reports where shift_id=p_shift) or not exists(
  select 1 from private.crm_partial_stock_records_v28 r left join public.procedures p on r.kind='procedure' and p.id=r.record_id
   left join public.sales s on r.kind='sale' and s.id=r.record_id where coalesce(p.shift_id,s.shift_id)=p_shift
 ) then return;end if;
 fresh_n:=private.crm_build_shift_report_v5(p_shift);
 update private.crm_shift_reports r set report=r.report||jsonb_build_object(
  'used',fresh_n->'used','untracked',fresh_n->'untracked',
  'payment_only_procedures_count',fresh_n->'payment_only_procedures_count','payment_only_sales_count',fresh_n->'payment_only_sales_count',
  'partial_stock_procedures_count',fresh_n->'partial_stock_procedures_count','partial_stock_sales_count',fresh_n->'partial_stock_sales_count',
  'partial_stock_pending_quantity',fresh_n->'partial_stock_pending_quantity',
  'warnings',coalesce((select jsonb_agg(w) from jsonb_array_elements(coalesce(r.report->'warnings','[]')) w where coalesce(w->>'type','') not in('partial_stock','payment_only')),'[]'::jsonb)
   ||coalesce((select jsonb_agg(w) from jsonb_array_elements(coalesce(fresh_n->'warnings','[]')) w where w->>'type' in('partial_stock','payment_only')),'[]'::jsonb)
 ) where r.shift_id=p_shift;
end $$;

notify pgrst,'reload schema';
commit;
