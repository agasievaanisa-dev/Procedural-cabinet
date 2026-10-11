-- Genuine transaction regression: deferred payment, peer edits and later receipts.
-- Synthetic fixtures only; all patients, requests, receipts and flags roll back.
-- Run after crm-payment-pending-v14.sql and the existing patient-save-v11 migration.
begin;
select set_config('test.v14.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null order by id limit 1),true);
select set_config('test.v14.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null order by id limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.v14.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v14.manager'),'role','authenticated')::text,true);
do $$declare actor uuid;peer uuid;patient uuid;own_shift uuid;later_shift uuid;foreign_shift uuid;service uuid;med uuid;
begin
 if nullif(current_setting('test.v14.manager'),'') is null or nullif(current_setting('test.v14.nurse'),'') is null then raise exception 'Test requires linked active manager and nurse';end if;
 select id into actor from public.staff where auth_user_id=current_setting('test.v14.nurse')::uuid and active;
 insert into public.staff(full_name,role) values('TEST peer nurse v14','nurse') returning id into peer;
 insert into public.patients(full_name) values('TEST pending patient v14 — rollback only') returning id into patient;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-04-01',now(),now()+interval '8 hours','open') returning id into own_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-04-02',now(),now()+interval '8 hours','open') returning id into later_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-04-03',now(),now()+interval '8 hours','open') returning id into foreign_shift;
 insert into public.shift_staff(shift_id,staff_id) values(own_shift,actor),(own_shift,peer),(later_shift,actor),(foreign_shift,peer);
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST pending drip v14',500,100,true) returning id into service;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST pending medication v14','амп.',10,100,1000,0,0) returning id into med;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v14.actor',actor::text,true);perform set_config('test.v14.peer',peer::text,true);
 perform set_config('test.v14.patient',patient::text,true);perform set_config('test.v14.shift',own_shift::text,true);
 perform set_config('test.v14.later_shift',later_shift::text,true);perform set_config('test.v14.foreign_shift',foreign_shift::text,true);
 perform set_config('test.v14.service',service::text,true);perform set_config('test.v14.med',med::text,true);
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();sale_req uuid:=gen_random_uuid();
begin
 p:=jsonb_build_object('patient_id',current_setting('test.v14.patient'),'shift_id',current_setting('test.v14.shift'),'nurse_id',current_setting('test.v14.peer'),
  'service_id',current_setting('test.v14.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v14.med'),'quantity',2)),
  'own_medications',jsonb_build_array(jsonb_build_object('name','TEST previously purchased','quantity',1,'unit','фл.','source','previously_purchased')),
  'notes','TEST original pending note','charge_total',2300,'paid_total',0,'payment_status','pending','expected_stock_deducted',false,
  'discount_reason','Постоянная скидка','discount_comment','TEST owner-approved 300 discount','payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0));
 a:=public.record_treatment_v5('procedure',p,req);
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'list_total')::numeric is distinct from 2600::numeric
  or (a->>'charge_total')::numeric is distinct from 2300::numeric or (a->>'received_total')::numeric is distinct from 0::numeric
  or (a->>'debt_total')::numeric is distinct from 2300::numeric or (a->>'version')::integer is distinct from 1 then raise exception 'Pending discounted procedure was not saved correctly: %',a;end if;
 if public.record_treatment_v5('procedure',p,req) is distinct from a then raise exception 'Pending create retry differs';end if;
 perform set_config('test.v14.procedure',a->>'id',true);perform set_config('test.v14.create_request',req::text,true);
 begin
  perform public.record_treatment_v5('procedure',p||jsonb_build_object('paid_total',2300,'payments',jsonb_build_object('cash',2300)),gen_random_uuid());
  raise exception 'Pending with full payment unexpectedly allowed';
 exception when others then if sqlerrm<>'Для оплаты после процедуры должен остаться неоплаченный остаток' then raise;end if;end;
 begin
  perform public.record_treatment_v5('procedure',p-'discount_comment',gen_random_uuid());raise exception 'Pending discount without comment unexpectedly allowed';
 exception when others then if sqlerrm<>'Укажите причину и обязательный комментарий к скидке или бесплатной процедуре' then raise;end if;end;
 p:=jsonb_build_object('patient_id',current_setting('test.v14.patient'),'shift_id',current_setting('test.v14.shift'),'nurse_id',current_setting('test.v14.peer'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v14.med'),'quantity',1)),
  'charge_total',900,'paid_total',0,'payment_status','pending','discount_reason','Постоянная скидка','discount_comment','TEST sale discount','notes','TEST sale note',
  'expected_stock_deducted',false,'payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('sale',p,sale_req);
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'debt_total')::numeric is distinct from 900::numeric then raise exception 'Pending sale not saved';end if;
 if public.record_treatment_v5('sale',p,sale_req) is distinct from a then raise exception 'Pending sale retry differs';end if;
 perform set_config('test.v14.sale',a->>'id',true);
 begin
  perform public.record_treatment_v5('sale',p-'patient_id',gen_random_uuid());raise exception 'Anonymous pending sale unexpectedly allowed';
 exception when others then if sqlerrm<>'Для оплаты в долг выберите пациента' then raise;end if;end;
 -- A zero-cost anonymous legacy sale lets us test pending's patient guard on edit.
 p:=p-'patient_id';p:=p||jsonb_build_object('charge_total',0,'payment_status','free','discount_reason','Бесплатно','discount_comment','TEST free anonymous sale');
 a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from false then raise exception 'Free sale was marked pending';end if;
 perform set_config('test.v14.anonymous_sale',a->>'id',true);
 p:=jsonb_build_object('patient_id',current_setting('test.v14.patient'),'shift_id',current_setting('test.v14.foreign_shift'),'nurse_id',current_setting('test.v14.peer'),
  'service_id',current_setting('test.v14.service'),'items','[]'::jsonb,'charge_total',600,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.v14.foreign_procedure',a->>'id',true);
end $$;
reset role;
-- Dates of synthetic events are fixed; the API still determines collection shift/nurse.
update public.procedures set visit_at=timestamptz '2096-04-01 09:00+03' where id=current_setting('test.v14.procedure')::uuid;
update public.sales set sold_at=timestamptz '2096-04-01 09:30+03' where id in(current_setting('test.v14.sale')::uuid,current_setting('test.v14.anonymous_sale')::uuid);
select set_config('request.jwt.claim.sub',current_setting('test.v14.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v14.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;original jsonb;p jsonb;req uuid:=gen_random_uuid();peer_result jsonb;report jsonb;
begin
 -- Saving the next patient does not require receiving money for the pending visit.
 a:=public.crm_patient_save_v11(jsonb_build_object('full_name','TEST next patient after pending v14'),gen_random_uuid());
 if nullif(a->>'id','') is null then raise exception 'Next patient could not be saved';end if;
 perform set_config('test.v14.next_patient',a->>'id',true);
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v14.procedure')));
 if original->>'nurse_id' is not distinct from current_setting('test.v14.actor') or (original->>'editable')::boolean is distinct from true
  or (original->>'payment_pending')::boolean is distinct from true then raise exception 'Peer record is not editable on assigned open shift';end if;
 p:=jsonb_build_object('kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',1,'expected_stock_deducted',original->'stock_deducted','services',original->'services','items',original->'items','own_medications',original->'own_medications',
  'notes','TEST peer updated note','charge_total',2300,'discount_reason',original->>'discount_reason','discount_comment',original->>'discount_comment',
  'edit_reason','TEST colleague corrected note','payments',jsonb_build_object('cash',0));
 -- Omitted status preserves pending, including on a peer's record.
 a:=public.crm_clinical_v10('treatment_edit',p,req);peer_result:=a;
 if (a->>'version')::integer is distinct from 2 or (a->>'payment_pending')::boolean is distinct from true
  or a->'services' is distinct from original->'services' or a->'items' is distinct from original->'items'
  or a->'own_medications' is distinct from original->'own_medications' or a->>'nurse_id' is distinct from current_setting('test.v14.peer') then raise exception 'Peer edit lost pending or original details';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Peer edit retry differs';end if;
 perform set_config('test.v14.peer_request',req::text,true);perform set_config('test.v14.peer_payload',p::text,true);
 begin
  perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Stale peer version unexpectedly accepted';
 exception when others then if sqlerrm<>'Запись уже изменена. Откройте её заново' then raise;end if;end;
 p:=p||jsonb_build_object('expected_version',2);
 begin
  perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('nurse_id',current_setting('test.v14.actor')),gen_random_uuid());raise exception 'Peer edit rewrote original nurse';
 exception when others then if sqlerrm<>'Пациент, смена и медсестра исходной записи не меняются' then raise;end if;end;
 begin
  perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('expected_stock_deducted',true),gen_random_uuid());raise exception 'Peer edit changed original stock mode';
 exception when others then if sqlerrm<>'Режим исходной процедуры не совпадает' then raise;end if;end;
 a:=public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('payment_status','debt'),gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from false or (a->>'debt_total')::numeric is distinct from 2300::numeric then raise exception 'Explicit debt did not clear pending while retaining balance';end if;
 p:=p||jsonb_build_object('expected_version',3,'payment_status','pending');a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'version')::integer is distinct from 4 then raise exception 'Explicit pending did not restore pending';end if;
 perform set_config('test.v14.closed_payload',(p||jsonb_build_object('expected_version',4))::text,true);
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v14.sale')));
 if (original->>'editable')::boolean is distinct from true then raise exception 'Peer sale is not editable';end if;
 p:=jsonb_build_object('kind','sale','id',original->>'id','expected_version',1,'expected_stock_deducted',false,'items',original->'items','own_medications','[]'::jsonb,
  'notes',original->'notes','charge_total',900,'discount_reason',original->>'discount_reason','discount_comment',original->>'discount_comment',
  'edit_reason','TEST peer sale status correction','payment_status','debt','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from false or a->>'nurse_id' is distinct from current_setting('test.v14.peer') then raise exception 'Peer sale edit changed identity or pending transition';end if;
 p:=p||jsonb_build_object('expected_version',2,'payment_status','pending');a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from true then raise exception 'Sale pending transition failed';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v14.anonymous_sale')));
 p:=p||jsonb_build_object('id',original->>'id','expected_version',1,'charge_total',500,'items',original->'items');
 begin
  perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Anonymous sale edited into pending';
 exception when others then if sqlerrm<>'Для оплаты после процедуры выберите пациента' then raise;end if;end;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v14.foreign_procedure')));
 if (original->>'editable')::boolean is distinct from false then raise exception 'Other shift was marked editable';end if;
 p:=current_setting('test.v14.closed_payload')::jsonb||jsonb_build_object('id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id','expected_version',1);
 begin
  perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Nurse edited another shift';
 exception when others then if sqlerrm<>'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец' then raise;end if;end;
 report:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v14.shift')));
 if (report->'revenue'->>'total')::numeric is distinct from 0::numeric or (report->>'charge_total')::numeric is distinct from 3200::numeric
  or (report->>'debt_total')::numeric is distinct from 3200::numeric or jsonb_array_length(report->'receipts')<>0
  or (report->'procedures'->0->>'payment_pending')::boolean is distinct from true then raise exception 'Pending report lost flag or fabricated receipts';end if;
 report:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v14.shift')));
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v14.procedure')));
 if (original->>'editable')::boolean is distinct from false then raise exception 'Closed peer record remains editable to nurse';end if;
 begin
  perform public.crm_clinical_v10('treatment_edit',current_setting('test.v14.closed_payload')::jsonb,gen_random_uuid());raise exception 'Nurse edited closed shift';
 exception when others then if sqlerrm<>'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец' then raise;end if;end;
 -- Prior successful same-actor request still replays; no fresh closed edit occurs.
 if public.crm_clinical_v10('treatment_edit',current_setting('test.v14.peer_payload')::jsonb,current_setting('test.v14.peer_request')::uuid) is distinct from peer_result then raise exception 'Successful peer request did not replay after closure';end if;
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.v14.procedure'),'shift_id',current_setting('test.v14.later_shift'),'nurse_id',current_setting('test.v14.actor'),
  'payments',jsonb_build_object('cash',800,'cash_received',1000),'comment','TEST partial collection after procedure');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'paid_total')::numeric is distinct from 800::numeric
  or (a->>'initial_paid_total')::numeric is distinct from 0::numeric or (a->>'debt_total')::numeric is distinct from 1500::numeric
  or (a->>'version')::integer is distinct from 5 or (a->'payments'->>'change')::numeric is distinct from 200::numeric then raise exception 'Partial collection changed pending/debt/cash';end if;
 if public.crm_clinical_v10('debt_payment',p,req) is distinct from a then raise exception 'Partial collection replay differs';end if;
 perform set_config('test.v14.partial_request',req::text,true);
 p:=p||jsonb_build_object('payments',jsonb_build_object('cash',0,'terminal',1500),'comment','TEST final collection after procedure');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);
 if (a->>'payment_pending')::boolean is distinct from false or (a->>'paid_total')::numeric is distinct from 2300::numeric
  or (a->>'initial_paid_total')::numeric is distinct from 0::numeric or (a->>'debt_total')::numeric is distinct from 0::numeric or (a->>'version')::integer is distinct from 6 then raise exception 'Full collection did not clear pending';end if;
 if public.crm_clinical_v10('debt_payment',p,req) is distinct from a then raise exception 'Full collection replay differs';end if;
 perform set_config('test.v14.full_request',req::text,true);
 begin
  perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());raise exception 'Settled pending bill received money twice';
 exception when others then if sqlerrm<>'Оплата должна быть больше нуля и не превышать остаток долга' then raise;end if;end;
 p:=p||jsonb_build_object('kind','sale','id',current_setting('test.v14.sale'),'payments',jsonb_build_object('owner_card',900));
 a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from false or (a->>'debt_total')::numeric is distinct from 0::numeric or (a->>'initial_paid_total')::numeric is distinct from 0::numeric then raise exception 'Pending sale settlement failed';end if;
 report:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v14.shift')));
 if (report->'revenue'->>'total')::numeric is distinct from 0::numeric or (report->>'debt_total')::numeric is distinct from 0::numeric then raise exception 'Later collection rewrote original shift revenue/debt';end if;
 report:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v14.later_shift')));
 if (report->'revenue'->>'total')::numeric is distinct from 3200::numeric or (report->'revenue'->>'cash')::numeric is distinct from 800::numeric
  or (report->'revenue'->>'terminal')::numeric is distinct from 1500::numeric or (report->'revenue'->>'owner_card')::numeric is distinct from 900::numeric
  or jsonb_array_length(report->'receipts')<>3 or jsonb_array_length(report->'procedures')<>0 then raise exception 'Collections did not stay in actual collection shift';end if;
end $$;
reset role;
do $$declare a jsonb;
begin
 if (select payment_pending from public.procedures where id=current_setting('test.v14.procedure')::uuid) is distinct from false
  or (select payment_pending from public.sales where id=current_setting('test.v14.sale')::uuid) is distinct from false then raise exception 'Full collection did not persist cleared flags';end if;
 if (select paid_total from public.procedures where id=current_setting('test.v14.procedure')::uuid) is distinct from 0::numeric
  or (select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.v14.procedure')::uuid)<>2
  or (select count(*) from private.crm_payment_allocations where procedure_id=current_setting('test.v14.procedure')::uuid)<>1
  or (select cash from private.crm_payment_allocations where id=current_setting('test.v14.create_request')::uuid) is distinct from 0::numeric then raise exception 'Pending rewrote initial money or duplicated collection';end if;
 if (select count(*) from private.crm_audit_log where action='treatment_edit_v10' and entity_type='procedure' and entity_id=current_setting('test.v14.procedure'))<>3
  or (select count(*) from private.crm_audit_log where action='debt_payment_v10' and entity_type='procedure' and entity_id=current_setting('test.v14.procedure'))<>2
  or (select actor_staff from private.crm_audit_log where action='treatment_edit_v10' and entity_type='procedure' and entity_id=current_setting('test.v14.procedure') and after_data->>'version'='2') is distinct from current_setting('test.v14.actor')::uuid then raise exception 'Peer/replay audits are wrong';end if;
 if exists(select 1 from public.stock_movements where medication_id=current_setting('test.v14.med')::uuid)
  or exists(select 1 from public.stock where medication_id=current_setting('test.v14.med')::uuid)
  or exists(select 1 from public.medication_batches where medication_id=current_setting('test.v14.med')::uuid) then raise exception 'Payment-only pending mutated warehouse';end if;
 -- Defensive display rule: even an inconsistent persisted true flag cannot label a fully paid visit pending.
 update public.procedures set payment_pending=true where id=current_setting('test.v14.procedure')::uuid;
 a:=private.crm_treatment_snapshot_v10('procedure',current_setting('test.v14.procedure')::uuid);
 if (a->>'payment_pending')::boolean is distinct from false then raise exception 'Fully paid snapshot still displays pending';end if;
 update public.procedures set payment_pending=false where id=current_setting('test.v14.procedure')::uuid;
end $$;
-- Fix only the synthetic receipt timestamps to the simulated later accounting day.
update private.crm_receipts_v10 set created_at=timestamptz '2096-04-02 11:00+03' where procedure_id=current_setting('test.v14.procedure')::uuid or sale_id=current_setting('test.v14.sale')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.v14.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v14.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;p jsonb;original jsonb;
begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-04-01','to','2096-04-01','group_by','day','patient_id',current_setting('test.v14.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 0::numeric or (a->>'charge_total')::numeric is distinct from 3200::numeric
  or (a->>'procedures_count')::integer is distinct from 1 or (a->>'sales_count')::integer is distinct from 1 or (a->>'debt_total')::numeric is distinct from 0::numeric then raise exception 'Original day counts pending bill as received money: %',a;end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-04-02','to','2096-04-02','group_by','day','patient_id',current_setting('test.v14.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 3200::numeric or (a->>'charge_total')::numeric is distinct from 0::numeric
  or (a->>'procedures_count')::integer is distinct from 0 or (a->>'debt_payments_count')::integer is distinct from 3 then raise exception 'Later day duplicates bill or loses collections: %',a;end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v14.procedure')));
 if (original->>'editable')::boolean is distinct from true then raise exception 'Manager cannot edit closed peer record';end if;
 p:=current_setting('test.v14.closed_payload')::jsonb-'payment_status';p:=p||jsonb_build_object('expected_version',6,'notes','TEST owner corrected closed visit','edit_reason','TEST owner closed correction');
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->>'version')::integer is distinct from 7 or (a->>'payment_pending')::boolean is distinct from false
  or (a->>'received_total')::numeric is distinct from 2300::numeric or a->>'nurse_id' is distinct from current_setting('test.v14.peer') then raise exception 'Owner closed edit changed receipt/pending/identity';end if;
end $$;
reset role;
rollback;
