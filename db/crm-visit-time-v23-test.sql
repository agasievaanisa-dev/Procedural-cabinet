-- Exact visit timestamps are clinical facts, not payment booking timestamps.
-- All identities and business rows are synthetic; the entire test rolls back.
begin;

do $$declare manager_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();
 manager_staff uuid;nurse_staff uuid;peer_staff uuid;other_staff uuid;own_shift uuid;foreign_shift uuid;service uuid;med uuid;
begin
 insert into auth.users(id,email) values(manager_user,manager_user::text||'@v23.example.invalid'),
  (nurse_user,nurse_user::text||'@v23.example.invalid'),(other_user,other_user::text||'@v23.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST visit time manager v23','admin',true,manager_user) returning id into manager_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST visit time nurse v23','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active) values('TEST visit time peer v23','nurse',true) returning id into peer_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST visit time foreign nurse v23','nurse',true,other_user) returning id into other_staff;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-10-13',timestamptz '2096-10-13 08:30+03',timestamptz '2096-10-13 16:00+03','open') returning id into own_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-10-14',timestamptz '2096-10-14 08:30+03',timestamptz '2096-10-14 16:00+03','open') returning id into foreign_shift;
 insert into public.shift_staff(shift_id,staff_id) values(own_shift,nurse_staff),(own_shift,peer_staff),(foreign_shift,other_staff);
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST exact visit procedure v23',500,100,true) returning id into service;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST exact visit medicine v23','амп.',10,100,1000,0,0) returning id into med;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v23.manager',manager_user::text,true);perform set_config('test.v23.nurse',nurse_user::text,true);
 perform set_config('test.v23.nurse_staff',nurse_staff::text,true);perform set_config('test.v23.peer_staff',peer_staff::text,true);
 perform set_config('test.v23.other_staff',other_staff::text,true);perform set_config('test.v23.manager_staff',manager_staff::text,true);
 perform set_config('test.v23.shift',own_shift::text,true);perform set_config('test.v23.foreign_shift',foreign_shift::text,true);
 perform set_config('test.v23.service',service::text,true);perform set_config('test.v23.med',med::text,true);
end $$;

set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();edit_req uuid;bad text;invalid_req uuid;failed_ids jsonb:='[]';
begin
 p:=jsonb_build_object('full_name','TEST exact visit patient v23','first_visit_at','2096-10-13T09:17:42+03:00','notes','TEST clinical timestamp');
 a:=public.crm_patient_save_v11(p,req);
 if (a->>'first_visit_at')::timestamptz is distinct from timestamptz '2096-10-13 06:17:42+00' then raise exception 'Patient exact timestamp/offset lost';end if;
 if public.crm_patient_save_v11(p,req) is distinct from a then raise exception 'Patient timestamp replay differs';end if;
 perform set_config('test.v23.patient',a->>'id',true);perform set_config('test.v23.patient_create_payload',p::text,true);
 perform set_config('test.v23.patient_create_request',req::text,true);perform set_config('test.v23.patient_create_result',a::text,true);
 a:=public.crm_patient_save_v11(jsonb_build_object('id',a->>'id','notes','TEST changed unrelated field'),gen_random_uuid());
 if (a->>'first_visit_at')::timestamptz is distinct from timestamptz '2096-10-13 06:17:42+00' then raise exception 'Omitted patient timestamp did not preserve edit';end if;
 a:=public.crm_patient_save_v11(jsonb_build_object('id',a->>'id','first_visit_at',null),gen_random_uuid());
 if a->>'first_visit_at' is not null then raise exception 'Null patient timestamp did not clear';end if;
 a:=public.crm_patient_save_v11(jsonb_build_object('id',a->>'id','first_visit_at','2096-10-13T07:12:00Z'),gen_random_uuid());
 edit_req:=gen_random_uuid();p:=jsonb_build_object('id',a->>'id','first_visit_at','');
 a:=public.crm_patient_save_v11(p,edit_req);
 if a->>'first_visit_at' is not null or public.crm_patient_save_v11(p,edit_req) is distinct from a then raise exception 'Blank patient time clear/replay failed';end if;
 a:=public.crm_patient_save_v11(jsonb_build_object('id',a->>'id','first_visit_at','2096-10-13T09:17:42+03:00'),gen_random_uuid());
 -- Retrying an older successful create returns its captured time, not the newer card.
 if public.crm_patient_save_v11(current_setting('test.v23.patient_create_payload')::jsonb,current_setting('test.v23.patient_create_request')::uuid)
  is distinct from current_setting('test.v23.patient_create_result')::jsonb then raise exception 'Patient historical timestamp replay changed';end if;
 for bad in select unnest(array['2096-02-30T09:00:00+03:00','2096-10-13T24:00:00+03:00','2096-10-13T09:60:00+03:00',
  '2096-10-13T09:00:00','not-a-date','2096-10-13T09:00:00+25:00']) loop
  invalid_req:=gen_random_uuid();failed_ids:=failed_ids||to_jsonb(invalid_req::text);
  begin
   perform public.crm_patient_save_v11(jsonb_build_object('full_name','TEST invalid visit time v23','first_visit_at',bad),invalid_req);
   raise exception 'Invalid patient visit timestamp accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid patient visit timestamp accepted:%' or sqlstate<>'22023' then raise;end if;end;
 end loop;
 perform set_config('test.v23.invalid_patient_requests',failed_ids::text,true);
end $$;
reset role;
do $$begin
 if exists(select 1 from public.patients where full_name='TEST invalid visit time v23')
  or exists(select 1 from private.crm_patient_save_requests_v11 where request_id in
   (select value::uuid from jsonb_array_elements_text(current_setting('test.v23.invalid_patient_requests')::jsonb))) then raise exception 'Invalid patient timestamp left a card or receipt';end if;
end $$;

set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 p:=jsonb_build_object('patient_id',current_setting('test.v23.patient'),'shift_id',current_setting('test.v23.shift'),
  'nurse_id',current_setting('test.v23.peer_staff'),'service_id',current_setting('test.v23.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v23.med'),'quantity',1)),
  'charge_total',1600,'paid_total',0,'payment_status','pending','expected_stock_deducted',false,'payments',jsonb_build_object('cash',0),
  'arrival_at','2096-10-13T11:30:00+03:00');
 a:=public.record_treatment_v5('procedure',p,req);
 if (a->>'arrival_at')::timestamptz is distinct from timestamptz '2096-10-13 08:30+00'
  or (a->>'at')::timestamptz is distinct from timestamptz '2096-10-13 08:30+00'
  or (a->>'visit_at')::timestamptz is distinct from timestamptz '2096-10-13 08:30+00'
  or (a->>'recorded_at')::timestamptz is distinct from (a->>'created_at')::timestamptz then raise exception 'Procedure snapshot does not separate actual visit from recording';end if;
 if public.record_treatment_v5('procedure',p,req) is distinct from a then raise exception 'Creation timestamp replay changed';end if;
 perform set_config('test.v23.late',a->>'id',true);perform set_config('test.v23.create_request',req::text,true);
 perform set_config('test.v23.create_payload',p::text,true);perform set_config('test.v23.create_result',a::text,true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('arrival_at','2096-10-13T08:45:00+03:00'),gen_random_uuid());
 perform set_config('test.v23.early',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('shift_id',current_setting('test.v23.foreign_shift'),
  'nurse_id',current_setting('test.v23.other_staff')),gen_random_uuid());perform set_config('test.v23.foreign',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p-'arrival_at',gen_random_uuid());perform set_config('test.v23.fallback',a->>'id',true);
 if a->>'arrival_at' is not null or (a->>'at')::timestamptz is distinct from (a->>'visit_at')::timestamptz then raise exception 'Legacy procedure lost raw-time fallback';end if;
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('paid_total',1600,'payment_status','paid','payments',jsonb_build_object('cash',1600)),gen_random_uuid());
 perform set_config('test.v23.paid',a->>'id',true);
 a:=public.record_treatment_v5('sale',(p-'service_id')||jsonb_build_object('charge_total',1000,'arrival_at','2096-10-13T13:30:00+03:00'),gen_random_uuid());
 perform set_config('test.v23.sale_late',a->>'id',true);
 a:=public.record_treatment_v5('sale',(p-'service_id')||jsonb_build_object('charge_total',1000,'arrival_at','2096-10-13T07:35:12+03:00'),gen_random_uuid());
 if (a->>'sold_at')::timestamptz is distinct from timestamptz '2096-10-13 04:35:12+00' then raise exception 'Sale exact visit timestamp lost';end if;
 perform set_config('test.v23.sale_early',a->>'id',true);
end $$;
reset role;
set local role authenticated;
do $$declare p jsonb:=current_setting('test.v23.create_payload')::jsonb;bad text;kind_n text;req uuid;failed_ids jsonb:='[]';begin
 for bad in select unnest(array['2096-02-30T09:00:00+03:00','2096-10-13T24:00:00+03:00','2096-10-13T09:00:00','not-a-date']) loop
  foreach kind_n in array array['procedure','sale'] loop
   req:=gen_random_uuid();failed_ids:=failed_ids||to_jsonb(req::text);
   begin
    perform public.record_treatment_v5(kind_n,
     case when kind_n='sale' then (p-'service_id')||jsonb_build_object('charge_total',1000,'arrival_at',bad)
      else p||jsonb_build_object('arrival_at',bad) end,req);
    raise exception 'Invalid creation timestamp accepted: % %',kind_n,bad;
   exception when others then if sqlerrm like 'Invalid creation timestamp accepted:%' or sqlstate<>'22023' then raise;end if;end;
  end loop;
 end loop;
 perform set_config('test.v23.invalid_create_requests',failed_ids::text,true);
end $$;
reset role;
do $$begin
 if (select count(*) from public.procedures where patient_id=current_setting('test.v23.patient')::uuid)<>5
  or (select count(*) from public.sales where patient_id=current_setting('test.v23.patient')::uuid)<>2
  or exists(select 1 from private.warehouse_requests where id in
   (select value::uuid from jsonb_array_elements_text(current_setting('test.v23.invalid_create_requests')::jsonb))) then raise exception 'Invalid timestamp created a treatment or receipt';end if;
 if has_function_privilege('authenticated','private.crm_visit_timestamp_v23(text)','EXECUTE')
  or has_function_privilege('anon','private.crm_visit_timestamp_v23(text)','EXECUTE') then raise exception 'Private time validator exposed';end if;
end $$;
-- Only fictional raw accounting timestamps are fixed for reproducible period checks.
update public.procedures set visit_at=timestamptz '2096-10-14 10:00+03'
 where patient_id=current_setting('test.v23.patient')::uuid;
update public.procedures set visit_at=timestamptz '2096-10-14 12:00+03'
 where id=current_setting('test.v23.early')::uuid;
update public.sales set sold_at=timestamptz '2096-10-14 10:00+03'
 where patient_id=current_setting('test.v23.patient')::uuid;
update public.sales set sold_at=timestamptz '2096-10-14 12:00+03'
 where id=current_setting('test.v23.sale_early')::uuid;

create function pg_temp.v23_financial_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p)-array['arrival_at','version','notes','updated_at'] order by p.id) from public.procedures p where p.patient_id=current_setting('test.v23.patient')::uuid),
  'sales',(select jsonb_agg(to_jsonb(s)-array['arrival_at','version','notes','updated_at'] order by s.id) from public.sales s where s.patient_id=current_setting('test.v23.patient')::uuid),
  'items',(select jsonb_agg(jsonb_build_object('procedure_id',i.procedure_id,'medication_id',i.medication_id,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.procedure_id,i.medication_id) from public.procedure_medications i join public.procedures p on p.id=i.procedure_id where p.patient_id=current_setting('test.v23.patient')::uuid),
  'sale_items',(select jsonb_agg(jsonb_build_object('sale_id',i.sale_id,'medication_id',i.medication_id,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.sale_id,i.medication_id) from public.sale_items i join public.sales s on s.id=i.sale_id where s.patient_id=current_setting('test.v23.patient')::uuid),
  'services',(select jsonb_agg(to_jsonb(i) order by i.procedure_id,i.position) from private.crm_treatment_services i join public.procedures p on p.id=i.procedure_id where p.patient_id=current_setting('test.v23.patient')::uuid),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id in(select id from public.procedures where patient_id=current_setting('test.v23.patient')::uuid) or a.sale_id in(select id from public.sales where patient_id=current_setting('test.v23.patient')::uuid)),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.procedure_id in(select id from public.procedures where patient_id=current_setting('test.v23.patient')::uuid) or r.sale_id in(select id from public.sales where patient_id=current_setting('test.v23.patient')::uuid)),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s where s.medication_id=current_setting('test.v23.med')::uuid),
  'batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.medication_batches b where b.medication_id=current_setting('test.v23.med')::uuid),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.medication_id=current_setting('test.v23.med')::uuid));
$$;
do $$begin perform set_config('test.v23.before',pg_temp.v23_financial_state()::text,true);end $$;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-14','to','2096-10-14','patient_id',current_setting('test.v23.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 1600::numeric then raise exception 'Raw accounting period fixture wrong';end if;
 perform set_config('test.v23.summary_before',a::text,true);
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v23.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v23.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare original jsonb;p jsonb;a jsonb;req uuid:=gen_random_uuid();invalid_req uuid;bad text;failed_ids jsonb:='[]';begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v23.late')));
 p:=jsonb_build_object('kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',original->'version','expected_stock_deducted',false,'services',original->'services','items',original->'items',
  'own_medications',original->'own_medications','charge_total',1600,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0),
  'arrival_at','2096-10-13T10:05:12+03:00');
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 if (a->>'at')::timestamptz is distinct from timestamptz '2096-10-13 07:05:12+00'
  or (a->>'payment_pending')::boolean is distinct from true or (a->>'version')::integer<>2 then raise exception 'Assigned nurse could not edit exact pending visit without comment';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Time edit replay changed';end if;
 perform set_config('test.v23.edit_request',req::text,true);perform set_config('test.v23.edit_payload',p::text,true);perform set_config('test.v23.edit_result',a::text,true);
 a:=public.crm_clinical_v10('treatment_edit',(p-'arrival_at')||jsonb_build_object('expected_version',2,'notes','TEST preserve visit on unrelated edit'),gen_random_uuid());
 if (a->>'arrival_at')::timestamptz is distinct from timestamptz '2096-10-13 07:05:12+00' then raise exception 'Missing edit time overwrote exact arrival';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v23.fallback')));
 a:=public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',1,'arrival_at',null),gen_random_uuid());
 if a->>'arrival_at' is not null or (a->>'at')::timestamptz is distinct from timestamptz '2096-10-14 10:00+03' then raise exception 'Explicit null clinical time lost raw fallback';end if;
 for bad in select unnest(array['2096-02-30T09:00:00+03:00','2096-10-13T24:00:00+03:00','2096-10-13T09:00:00','bad','2096-10-13T09:00:60Z']) loop
  invalid_req:=gen_random_uuid();failed_ids:=failed_ids||to_jsonb(invalid_req::text);
  begin
   perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('expected_version',3,'arrival_at',bad),invalid_req);
   raise exception 'Invalid clinical timestamp accepted: %',bad;
  exception when others then if sqlerrm like 'Invalid clinical timestamp accepted:%' or sqlstate<>'22023' then raise;end if;end;
 end loop;
 perform set_config('test.v23.invalid_edit_requests',failed_ids::text,true);
 -- Sale time editing uses the same guard and must not fabricate a receipt.
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v23.sale_late')));
 a:=public.crm_clinical_v10('treatment_edit',jsonb_build_object('kind','sale','id',original->>'id','expected_version',original->'version',
  'expected_stock_deducted',false,'items',original->'items','charge_total',1000,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0),
  'arrival_at','2096-10-13T12:55:07+03:00'),gen_random_uuid());
 if (a->>'at')::timestamptz is distinct from timestamptz '2096-10-13 09:55:07+00'
  or (a->>'sold_at')::timestamptz is distinct from timestamptz '2096-10-13 09:55:07+00' then raise exception 'Exact sale edit lost timestamp';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v23.foreign')));
 begin
  perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',1,
   'shift_id',original->>'shift_id','nurse_id',original->>'nurse_id'),gen_random_uuid());
  raise exception 'Foreign nurse edited visit time';
 exception when others then if sqlerrm='Foreign nurse edited visit time' then raise;end if;end;
 -- Nurse patient creation supports the time; patient editing retains its role guard.
 a:=public.crm_patient_save_v11(jsonb_build_object('full_name','TEST nurse exact visit v23','first_visit_at','2096-10-13T08:35:00+03:00'),gen_random_uuid());
 if (a->>'first_visit_at')::timestamptz is distinct from timestamptz '2096-10-13 05:35+00' then raise exception 'Nurse patient creation lost timestamp';end if;
 begin
  perform public.crm_patient_save_v11(jsonb_build_object('id',current_setting('test.v23.patient'),'first_visit_at','2096-10-13T10:00:00Z'),gen_random_uuid());
  raise exception 'Nurse edited manager patient time';
 exception when others then if sqlerrm='Nurse edited manager patient time' then raise;end if;end;
end $$;
reset role;
do $$begin
 if pg_temp.v23_financial_state() is distinct from current_setting('test.v23.before')::jsonb then raise exception 'Visit-only edit changed captured prices/payments/raw dates/stock';end if;
 if exists(select 1 from private.warehouse_requests where id in
  (select value::uuid from jsonb_array_elements_text(current_setting('test.v23.invalid_edit_requests')::jsonb))) then raise exception 'Invalid visit edits left receipts';end if;
 if (select arrival_at from public.procedures where id=current_setting('test.v23.late')::uuid)
  is distinct from timestamptz '2096-10-13 10:05:12+03' then raise exception 'Rejected edit changed arrival timestamp';end if;
end $$;

set local role authenticated;
do $$declare journal jsonb;history jsonb;report_n jsonb;begin
 journal:=public.crm_shift_journal_v12(date '2096-10-13');report_n:=journal->'reports'->0;
 if jsonb_array_length(journal->'reports')<>1 or report_n->'shift'->>'id' is distinct from current_setting('test.v23.shift') then raise exception 'Exact-time journal changed assigned shift scope';end if;
 -- The legacy fallback is on the following raw day and sorts after actual visits.
 if report_n->'procedures'->0->>'id' is distinct from current_setting('test.v23.early')
  or report_n->'procedures'->1->>'id' is distinct from current_setting('test.v23.late')
  or report_n->'sales'->0->>'id' is distinct from current_setting('test.v23.sale_early') then raise exception 'Journal did not order actual arrivals';end if;
 history:=public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.v23.patient')));
 if history->'procedures'->0->>'id' is distinct from current_setting('test.v23.fallback')
  or history->'procedures'->(jsonb_array_length(history->'procedures')-1)->>'id' is distinct from current_setting('test.v23.early')
  or history->'sales'->0->>'id' is distinct from current_setting('test.v23.sale_late') then raise exception 'Patient history did not use actual arrival order';end if;
 if (report_n->'procedures'->0->>'at')::timestamptz is distinct from timestamptz '2096-10-13 08:45+03'
  or (report_n->'sales'->0->>'at')::timestamptz is distinct from timestamptz '2096-10-13 07:35:12+03' then raise exception 'Journal display timestamps lost';end if;
 history:=public.patient_history_v8(current_setting('test.v23.patient')::uuid);
 if history->'procedures'->0->>'id' is distinct from current_setting('test.v23.fallback')
  or history->'procedures'->(jsonb_array_length(history->'procedures')-1)->>'id' is distinct from current_setting('test.v23.early')
  or history->'sales'->0->>'id' is distinct from current_setting('test.v23.sale_late')
  or (history->'sales'->0->>'sold_at')::timestamptz is distinct from timestamptz '2096-10-13 12:55:07+03'
  or (history->'procedures'->(jsonb_array_length(history->'procedures')-1)->>'visit_at')::timestamptz
   is distinct from timestamptz '2096-10-13 08:45+03' then raise exception 'Compact patient history lost exact timestamps or order';end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('test.v23.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v23.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare original jsonb;p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-14','to','2096-10-14','patient_id',current_setting('test.v23.patient')));
 if a is distinct from current_setting('test.v23.summary_before')::jsonb then raise exception 'Time editing shifted revenue between accounting periods';end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-13','to','2096-10-13','patient_id',current_setting('test.v23.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 0::numeric then raise exception 'Actual arrival incorrectly moved money to its date';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v23.paid')));
 p:=jsonb_build_object('kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',original->'version','expected_stock_deducted',false,'expected_received_total',1600,'confirm_no_money_received',true,
  'correction_reason','TEST incorrectly selected paid, no money received','services',original->'services','items',original->'items','own_medications',original->'own_medications',
  'charge_total',1200,'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0),
  'discount_reason','Постоянный пациент','discount_comment','TEST approved correction discount','edit_reason','TEST restore discounted debt',
  'arrival_at','2096-10-12T20:15:35+03:00');
 a:=public.crm_payment_correction_v22(p,req);
 if (a->>'at')::timestamptz is distinct from timestamptz '2096-10-12 17:15:35+00'
  or (a->>'charge_total')::numeric is distinct from 1200::numeric or (a->>'received_total')::numeric is distinct from 0::numeric
  or (a->>'debt_total')::numeric is distinct from 1200::numeric or (a->>'list_total')::numeric is distinct from 1600::numeric then raise exception 'Payment correction lost arrival or discounted debt';end if;
 if public.crm_payment_correction_v22(p,req) is distinct from a then raise exception 'Combined correction/time replay changed';end if;
 perform set_config('test.v23.correction_request',req::text,true);
 -- A historical creation/edit response retains the original captured timestamp.
 if public.record_treatment_v5('procedure',current_setting('test.v23.create_payload')::jsonb,current_setting('test.v23.create_request')::uuid)
  is distinct from current_setting('test.v23.create_result')::jsonb then raise exception 'Creation replay replaced captured timestamp after edits';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v23.shift')));
 if a->'procedures'->0->>'id' is distinct from current_setting('test.v23.paid') then raise exception 'Corrected earlier arrival not reflected in shift report order';end if;
end $$;
reset role;
do $$begin
 if (select visit_at from public.procedures where id=current_setting('test.v23.paid')::uuid) is distinct from timestamptz '2096-10-14 10:00+03'
  or (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v23.paid'))<>1
  or (select count(*) from private.warehouse_requests where id=current_setting('test.v23.correction_request')::uuid)<>1
  or exists(select 1 from public.stock_movements where medication_id=current_setting('test.v23.med')::uuid) then raise exception 'Combined correction changed raw booking date or duplicated writes';end if;
 if (select count(*) from public.patients where full_name='TEST exact visit patient v23')<>1 then raise exception 'Timestamp retries duplicated patient';end if;
end $$;
rollback;
