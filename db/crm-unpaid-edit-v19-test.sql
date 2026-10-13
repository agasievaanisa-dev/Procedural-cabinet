-- Every auth user, staff member, patient and treatment is synthetic and rolled back.
-- Covers comment-free pending edits, audit replay, paid/debt/discount and shift guards.
begin;
do $$declare manager_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();
 manager_staff uuid;nurse_staff uuid;peer_staff uuid;other_staff uuid;patient uuid;own_shift uuid;foreign_shift uuid;service uuid;med uuid;
begin
 insert into auth.users(id,email) values(manager_user,manager_user::text||'@v19.example.invalid'),
  (nurse_user,nurse_user::text||'@v19.example.invalid'),(other_user,other_user::text||'@v19.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST unpaid edit manager v19','admin',true,manager_user) returning id into manager_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST unpaid edit nurse v19','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active) values('TEST unpaid edit peer v19','nurse',true) returning id into peer_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST unpaid edit other v19','nurse',true,other_user) returning id into other_staff;
 perform set_config('request.jwt.claim.sub',manager_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_user,'role','authenticated')::text,true);
 insert into public.patients(full_name) values('TEST unpaid edit patient v19') returning id into patient;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-05-01',now(),now()+interval '8 hours','open') returning id into own_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-05-02',now(),now()+interval '8 hours','open') returning id into foreign_shift;
 insert into public.shift_staff(shift_id,staff_id) values(own_shift,nurse_staff),(own_shift,peer_staff),(foreign_shift,other_staff);
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST unpaid edit drip v19',500,100,true) returning id into service;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST unpaid edit medicine v19','амп.',10,100,1000,0,0) returning id into med;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v19.manager',manager_user::text,true);perform set_config('test.v19.nurse',nurse_user::text,true);
 perform set_config('test.v19.nurse_staff',nurse_staff::text,true);perform set_config('test.v19.peer_staff',peer_staff::text,true);
 perform set_config('test.v19.other_staff',other_staff::text,true);perform set_config('test.v19.patient',patient::text,true);
 perform set_config('test.v19.shift',own_shift::text,true);perform set_config('test.v19.foreign_shift',foreign_shift::text,true);
 perform set_config('test.v19.service',service::text,true);perform set_config('test.v19.med',med::text,true);
end $$;
set local role authenticated;
do $$declare p jsonb;a jsonb;
begin
 p:=jsonb_build_object('patient_id',current_setting('test.v19.patient'),'shift_id',current_setting('test.v19.shift'),
  'nurse_id',current_setting('test.v19.peer_staff'),'service_id',current_setting('test.v19.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v19.med'),'quantity',1)),
  'charge_total',1600,'paid_total',0,'payment_status','pending','expected_stock_deducted',false,'payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());perform set_config('test.v19.procedure',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('charge_total',1500,'discount_reason','Постоянная скидка','discount_comment','TEST approved discount v19'),gen_random_uuid());
 perform set_config('test.v19.discounted',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('payment_status','debt'),gen_random_uuid());perform set_config('test.v19.debt',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('payment_status','paid','paid_total',1600,'payments',jsonb_build_object('cash',1600)),gen_random_uuid());
 perform set_config('test.v19.paid',a->>'id',true);
 a:=public.record_treatment_v5('procedure',p||jsonb_build_object('shift_id',current_setting('test.v19.foreign_shift'),'nurse_id',current_setting('test.v19.other_staff')),gen_random_uuid());
 perform set_config('test.v19.foreign',a->>'id',true);
 a:=public.record_treatment_v5('sale',(p-'service_id')||jsonb_build_object('charge_total',1000),gen_random_uuid());perform set_config('test.v19.sale',a->>'id',true);
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v19.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v19.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;a jsonb;first_payload jsonb;first_result jsonb;req uuid:=gen_random_uuid();original jsonb;target text;
begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v19.procedure')));
 if original->>'nurse_id' is not distinct from current_setting('test.v19.nurse_staff') or (original->>'editable')::boolean is distinct from true then raise exception 'Peer pending treatment is not editable';end if;
 p:=jsonb_build_object('kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',1,'expected_stock_deducted',false,'services',original->'services','items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v19.med'),'quantity',2)),
  'charge_total',2600,'paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0),'edit_reason',null,'notes','TEST changed composition without edit comment');
 first_payload:=p;a:=public.crm_clinical_v10('treatment_edit',p,req);first_result:=a;
 if (a->>'version')::integer is distinct from 2 or (a->>'charge_total')::numeric is distinct from 2600::numeric
  or (a->>'paid_total')::numeric is distinct from 0::numeric or (a->>'payment_pending')::boolean is distinct from true then raise exception 'Comment-free pending composition edit failed';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Comment-free edit replay differs';end if;
 begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Stale pending edit succeeded';
 exception when others then if sqlerrm<>'Запись уже изменена. Откройте её заново' then raise;end if;end;
 -- Reopening repeatedly and old clients omitting status still work without comments.
 p:=p||jsonb_build_object('expected_version',2,'charge_total',3600,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v19.med'),'quantity',3)));
 a:=public.crm_clinical_v10('treatment_edit',p-'edit_reason'-'payment_status',gen_random_uuid());
 if (a->>'version')::integer is distinct from 3 or (a->>'payment_pending')::boolean is distinct from true then raise exception 'Second comment-free edit lost pending';end if;
 if public.crm_clinical_v10('treatment_edit',first_payload,req) is distinct from first_result then raise exception 'Historical replay did not preserve first edit';end if;
 perform set_config('test.v19.edit_request',req::text,true);
 p:=p||jsonb_build_object('expected_version',3);
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('charge_total',3500),gen_random_uuid());raise exception 'New pending discount missing reason succeeded';
 exception when others then if sqlerrm<>'Укажите причину и обязательный комментарий к изменению цены или бесплатной процедуре' then raise;end if;end;
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('paid_total',100,'payments',jsonb_build_object('cash',100)),gen_random_uuid());raise exception 'Edit accepting first payment omitted edit reason';
 exception when others then if sqlerrm<>'Укажите, что изменили и почему' then raise;end if;end;
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('payment_status','debt'),gen_random_uuid());raise exception 'Pending-to-debt edit omitted edit reason';
 exception when others then if sqlerrm<>'Укажите, что изменили и почему' then raise;end if;end;
 for target in select unnest(array['debt','paid']) loop
  original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v19.'||target)));
  begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',1,'charge_total',1600,'items',original->'items','payment_status',case when target='paid' then 'paid' else 'debt' end),gen_random_uuid());raise exception 'Paid/debt edit omitted edit reason';
  exception when others then if sqlerrm<>'Укажите, что изменили и почему' then raise;end if;end;
 end loop;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v19.discounted')));
 a:=public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',1,'charge_total',1500,'items',original->'items','discount_reason',original->>'discount_reason','discount_comment',original->>'discount_comment'),gen_random_uuid());
 if (a->>'charge_total')::numeric is distinct from 1500::numeric or a->>'discount_comment' is distinct from 'TEST approved discount v19' then raise exception 'Existing discount was discarded';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v19.sale')));
 a:=public.crm_clinical_v10('treatment_edit',jsonb_build_object('kind','sale','id',original->>'id','expected_version',1,'expected_stock_deducted',false,'items',original->'items','charge_total',1000,'payment_status','pending','payments',jsonb_build_object('cash',0)),gen_random_uuid());
 if (a->>'version')::integer is distinct from 2 or (a->>'payment_pending')::boolean is distinct from true then raise exception 'Unpaid sale edit failed';end if;
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v19.foreign')));
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',1,'patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id'),gen_random_uuid());raise exception 'Foreign pending shift edited';
 exception when others then if sqlerrm<>'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец' then raise;end if;end;
 -- A separate receipt makes the original bill ineligible, even while pending remains true.
 a:=public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',current_setting('test.v19.procedure'),'shift_id',current_setting('test.v19.shift'),'nurse_id',current_setting('test.v19.nurse_staff'),'payments',jsonb_build_object('cash',100)),gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'initial_paid_total')::numeric is distinct from 0::numeric or (a->>'paid_total')::numeric is distinct from 100::numeric then raise exception 'Partial receipt fixture is wrong';end if;
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('expected_version',4),gen_random_uuid());raise exception 'Partially paid pending edit omitted reason';
 exception when others then if sqlerrm<>'Укажите, что изменили и почему' then raise;end if;end;
 perform public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v19.shift')));
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v19.discounted')));
 begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('id',original->>'id','expected_version',2),gen_random_uuid());raise exception 'Closed pending shift edited';
 exception when others then if sqlerrm<>'Редактировать можно записи своей открытой смены. Другие записи исправляет владелец' then raise;end if;end;
end $$;
reset role;
do $$begin
 if (select count(*) from private.crm_audit_log where action='treatment_edit_v10' and entity_id=current_setting('test.v19.procedure'))<>2
  or exists(select 1 from private.crm_audit_log where action='treatment_edit_v10' and entity_id=current_setting('test.v19.procedure') and reason is distinct from 'Редактирование процедуры до оплаты') then raise exception 'Comment-free edits not audited exactly once';end if;
 if (select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.v19.procedure')::uuid)<>1
  or (select paid_total from public.procedures where id=current_setting('test.v19.procedure')::uuid) is distinct from 0::numeric
  or exists(select 1 from public.stock_movements where medication_id=current_setting('test.v19.med')::uuid) then raise exception 'Edit fabricated payment or stock movement';end if;
end $$;
rollback;
