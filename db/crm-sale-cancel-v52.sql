-- v52: cancel an unpaid duplicate sale, including a sale without a patient.
-- Original bill, sale items and stock movements remain immutable evidence. Actual
-- received money is never voided or treated as a refund by this endpoint.
begin;
set local lock_timeout='10s';

create table private.crm_cancelled_sales_v52 (
 sale_id uuid primary key references public.sales(id),
 request_id uuid not null unique references private.warehouse_requests(id),
 actor_user uuid,actor_staff uuid references public.staff(id),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 cancelled_at timestamptz not null default clock_timestamp(),
 original_version integer not null,original_snapshot jsonb not null,
 returned_stock jsonb not null default '[]',partial_stock_before jsonb not null default '[]'
);
alter table private.crm_cancelled_sales_v52 enable row level security;
revoke all on private.crm_cancelled_sales_v52 from public,anon,authenticated;

-- Read-only, internal projection. Function owners can read it through their
-- existing authorized APIs; no client receives a new table/view permission.
create view private.crm_active_sales_v52 with(security_invoker=true) as
 select p.* from public.sales p
 where not exists(select 1 from private.crm_cancelled_sales_v52 c where c.sale_id=p.id);
revoke all on private.crm_active_sales_v52 from public,anon,authenticated;

create function private.crm_cancelled_sale_guard_v52() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.crm_cancelled_sales_v52 where sale_id=old.id) then
  raise exception 'Продажа удалена как ошибочная запись. Откройте журнал заново' using errcode='55000';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
revoke all on function private.crm_cancelled_sale_guard_v52() from public,anon,authenticated;
create trigger crm_cancelled_sale_guard_v52 before update or delete on public.sales
 for each row execute function private.crm_cancelled_sale_guard_v52();

-- Reviewed readers use an internal active projection. Raw public.sales is
-- deliberately retained for immutable audit/backup and write-lock targets.
-- Existing grants, function OIDs and cancellation-of-procedures logic survive.
do $readers_v52$
declare patch_n record;source_n text;changed_n text;oid_n oid;acl_n aclitem[];owner_n oid;security_n boolean;config_n text[];
begin
 for patch_n in select * from(values
  ('private.crm_build_shift_report_legacy_v9(uuid)','731a58c69f6dd121cd56a9ff5ea8759e','e5181e1522468304bf76dab5e82081ca',8,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_build_shift_report_v5_before_v28(uuid)','284454f7944d3569c829bbe2c76a88cf','2ba5a70f441401112536f43462b7a678',5,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_build_shift_report_v5_before_v29(uuid)','a15337a11457af34404a2791c1837970','ead722ac66e3814765d8d987fcec2f5b',6,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_build_shift_report_v5_before_v30(uuid)','a2cfc64b92753f8454112a58b5803a72','9f03493230ec28c24506cc02803f889c',2,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_cash_drawer_facts_v30_before_v37(uuid, numeric)','1390d7c82ed1b39eeade39c8f9d71b7b','35aefe15a632cd1c30a81685d0da5b12',1,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_cash_financial_snapshot_v37(uuid)','75d32c637b969ab4c7269d2bafca8211','2588106315c3c26c6a296418576464e5',2,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_dashboard_day_v25_before_v30(date)','8257a380a553cb708c873bcbe32fe959','cfebd5d40965ab6284f89db7e70abb51',2,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_finance_summary_v5_before_v28(jsonb)','bedfe37de747ba371b701926ecf32604','e16a963502a58b8f1cc0f57ba3fdb267',1,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_finance_summary_v5_before_v30(jsonb)','5f25243d859fcf47431210f82b74a7f6','17a0003ff1c28b58a875ce4fb2e54a67',1,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_patient_history_v5(uuid)','de7079cea0afb7d338e70ba3b9190f0a','31b7599bd6cceb82c6117d76bdb4e90e',1,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_refresh_closed_report_v10_before_v29(uuid)','3ca5ceb547aa778d93ec12b95d3c207f','15473688eda859e18eba85c668da7df8',1,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.quick_ui_v4(text, jsonb)','4566954afee1aa83a562380b153ea72e','ef62d488aea009ca2a7c1976a72b363d',3,$old_v52$public.sales$old_v52$,$new_v52$private.crm_active_sales_v52$new_v52$),
  ('private.crm_clinical_v10_before_v28(text, jsonb, uuid)','ab5786180b43a12a5587d8df679b771d','df54a0c20e6fb769ab9385489f535269',2,$old_v52$from public.sales s where$old_v52$,$new_v52$from private.crm_active_sales_v52 s where$new_v52$),
  ('private.crm_treatment_snapshot_v10(text, uuid)','270ae10fcad3b8083a5ee5e2f1a4188e','2899f60bcc4481b7541a43f48ff8df29',1,$old_v52$begin
$old_v52$,$new_v52$begin
 if p_kind='sale' and exists(select 1 from private.crm_cancelled_sales_v52 where sale_id=p_id) then
  raise exception 'Продажа удалена как ошибочная запись. Откройте журнал заново' using errcode='55000';
 end if;
$new_v52$),
  ('private.crm_backup_data_v5()','578c5ebd681e0038f1d0b95ba205c09e','8a9aced2c4a9c8ad292546a35cd81bf9',1,$old_v52$'crm_partial_stock_requests_v28'$old_v52$,$new_v52$'crm_partial_stock_requests_v28','crm_cancelled_procedures_v51','crm_cancelled_sales_v52'$new_v52$)
 ) p(signature,before_hash,after_hash,occurrences,old_fragment,new_fragment) loop
  oid_n:=to_regprocedure(patch_n.signature);
  if oid_n is null then raise exception 'v52: missing reviewed reader %',patch_n.signature;end if;
  source_n:=pg_get_functiondef(oid_n);
  if md5(source_n)=patch_n.after_hash then continue;end if;
  if md5(source_n)<>patch_n.before_hash then raise exception 'v52: reviewed reader changed: %',patch_n.signature;end if;
  if (length(source_n)-length(replace(source_n,patch_n.old_fragment,'')))/length(patch_n.old_fragment)<>patch_n.occurrences then
   raise exception 'v52: unexpected reader anchors: %',patch_n.signature;
  end if;
  select proacl,proowner,prosecdef,proconfig into acl_n,owner_n,security_n,config_n from pg_proc where oid=oid_n;
  changed_n:=replace(source_n,patch_n.old_fragment,patch_n.new_fragment);
  if md5(changed_n)<>patch_n.after_hash then raise exception 'v52: unexpected transformed reader: %',patch_n.signature;end if;
  execute changed_n;
  if to_regprocedure(patch_n.signature)::oid is distinct from oid_n
   or (select proacl from pg_proc where oid=oid_n) is distinct from acl_n
   or (select proowner from pg_proc where oid=oid_n) is distinct from owner_n
   or (select prosecdef from pg_proc where oid=oid_n) is distinct from security_n
   or (select proconfig from pg_proc where oid=oid_n) is distinct from config_n then
   raise exception 'v52: reader identity or privilege changed: %',patch_n.signature;
  end if;
 end loop;
end $readers_v52$;

create function private.crm_sale_cancel_v52(p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_n uuid;role_n text;id_n uuid;shift_n uuid;reason_n text;version_n integer;expected_n numeric;
 req_n private.warehouse_requests%rowtype;original_n jsonb;answer_n jsonb;partial_n jsonb;
 returned_n jsonb:='[]';row_n record;actual_n numeric;source_shift_n uuid;
begin
 select id,role into actor_n,role_n from public.staff where active and auth_user_id=auth.uid() limit 1 for share;
 if auth.uid() is null or actor_n is null or role_n not in('owner','admin') then
  raise exception 'Удалять продажи может только администратор или владелец' using errcode='42501';
 end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Укажите продажу и номер операции' using errcode='22023';
 end if;
 if p_payload->'confirmed_duplicate' is distinct from 'true'::jsonb then
  raise exception 'Подтвердите, что удаляется ошибочно созданная или повторная продажа' using errcode='22023';
 end if;
 id_n:=nullif(p_payload->>'id','')::uuid;reason_n:=nullif(trim(p_payload->>'reason'),'');
 if id_n is null or reason_n is null or length(reason_n)>2000
  or coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$'
  or coalesce(p_payload->>'expected_received_total','')!~'^[0-9]+([.][0-9]{1,2})?$' then
  raise exception 'Обновите продажу и укажите причину удаления' using errcode='22023';
 end if;
 version_n:=(p_payload->>'expected_version')::integer;
 expected_n:=(p_payload->>'expected_received_total')::numeric;
 if expected_n>999999999999.99 then raise exception 'Проверьте ранее полученную оплату' using errcode='22023';end if;
 insert into private.warehouse_requests(id,staff_user,action,payload)
  values(p_request_id,auth.uid(),'sale_cancel_v52',p_payload) on conflict do nothing;
 select * into req_n from private.warehouse_requests where id=p_request_id for update;
 if req_n.staff_user is distinct from auth.uid() or req_n.action<>'sale_cancel_v52' or req_n.payload is distinct from p_payload then
  raise exception 'Номер операции уже использован' using errcode='22023';
 end if;
 -- A completed retry must not call the now-inaccessible original snapshot.
 if req_n.result is not null then return req_n.result;end if;
 select shift_id into source_shift_n from public.sales where id=id_n;
 if not found then raise exception 'Продажа не найдена' using errcode='22023';end if;
 -- Same source-shift -> bill lock order as receipts/edits. Payment arrivals
 -- that win this race change version/received total and make this CAS fail.
 perform 1 from public.shifts where id=source_shift_n for update;
 perform 1 from public.sales where id=id_n for update;
 if exists(select 1 from private.crm_cancelled_sales_v52 where sale_id=id_n) then
  raise exception 'Продажа уже удалена. Откройте журнал заново' using errcode='55000';
 end if;
 original_n:=private.crm_treatment_snapshot_v10('sale',id_n);
 if (original_n->>'shift_id')::uuid is distinct from source_shift_n then
  raise exception 'Смена продажи изменилась. Откройте запись заново' using errcode='40001';
 end if;
 actual_n:=(original_n->>'received_total')::numeric;
 if (original_n->>'version')::integer<>version_n or actual_n<>expected_n then
  raise exception 'Продажа или оплата уже изменена. Откройте её заново' using errcode='40001';
 end if;
 if actual_n<>0 then
  raise exception 'У продажи есть полученная оплата. Сначала исправьте ошибочную оплату; удаление не выполняет возврат денег' using errcode='22023';
 end if;
 -- Zero initial allocations remain as historical rows. An active receipt
 -- would mean a corrupted zero snapshot, so refuse rather than void anything.
 if exists(select 1 from private.crm_receipts_v10 where sale_id=id_n and voided_at is null)
  or exists(select 1 from private.crm_payment_allocations where sale_id=id_n and voided_at is null
   and cash+terminal+owner_card+other_card<>0) then
  raise exception 'У продажи обнаружена оплата. Обновите запись и исправьте оплату перед удалением' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.medication_id),'[]') into partial_n
  from private.crm_partial_stock_lines_v28 l where kind='sale' and record_id=id_n;
 -- Lock all medication rows in deterministic order before returning batches.
 perform m.id from public.medications m where m.id in(
  select medication_id from public.stock_movements where sale_id=id_n and movement_type='sale'
 ) order by m.id for update;
 for row_n in
  select m.medication_id,sum(m.quantity-coalesce(r.returned,0)) quantity
  from public.stock_movements m left join lateral(
   select sum(s.quantity) returned from private.crm_stock_returns_v10 s where s.movement_id=m.id
  ) r on true where m.sale_id=id_n and m.movement_type='sale'
  group by m.medication_id having sum(m.quantity-coalesce(r.returned,0))>0 order by m.medication_id
 loop
  perform private.crm_return_consumed_v10('sale',id_n,row_n.medication_id,row_n.quantity,p_request_id);
  returned_n:=returned_n||jsonb_build_array(jsonb_build_object('medication_id',row_n.medication_id,'quantity',row_n.quantity));
 end loop;
 -- Remove only this duplicate's unresolved stock demand; never manufacture
 -- stock for units that the gradual inventory system did not actually take.
 delete from private.crm_partial_stock_lines_v28 where kind='sale' and record_id=id_n;
 insert into private.crm_cancelled_sales_v52(sale_id,request_id,actor_user,actor_staff,reason,original_version,original_snapshot,returned_stock,partial_stock_before)
  values(id_n,p_request_id,auth.uid(),actor_n,reason_n,version_n,original_n,returned_n,partial_n);
 answer_n:=jsonb_build_object('id',id_n,'kind','sale','cancelled',true,'shift_id',source_shift_n,
  'patient_id',original_n->'patient_id','request_id',p_request_id,'returned_stock',returned_n,'reason',reason_n);
 perform private.crm_audit_v5('sale_cancelled_v52','sale',id_n::text,
  jsonb_build_object('treatment',original_n,'partial_stock',partial_n),answer_n,reason_n);
 -- Financial-count snapshots are append-only. Excluding the canceled bill
 -- from the normal fingerprint makes an old count stale without rewriting it.
 perform private.crm_refresh_closed_report_v10(source_shift_n);
 update private.warehouse_requests set result=answer_n where id=p_request_id;
 return answer_n;
end $$;
revoke all on function private.crm_sale_cancel_v52(jsonb,uuid) from public,anon,authenticated;
create function public.crm_sale_cancel_v52(p_payload jsonb,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.crm_sale_cancel_v52(p_payload,p_request_id);
$$;
revoke all on function public.crm_sale_cancel_v52(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_sale_cancel_v52(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
