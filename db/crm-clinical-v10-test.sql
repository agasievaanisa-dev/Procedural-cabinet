-- Genuine transaction tests. Every synthetic patient, receipt and stock mutation rolls back.
-- Run after clinical-v10, clinical-finance-v10 and patient-delete-v10.
begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
do $$declare n uuid;peer uuid;sh uuid;next_sh uuid;other_sh uuid;pt uuid;sv uuid;inj uuid;med uuid;
begin
 if nullif(current_setting('test.manager'),'') is null or nullif(current_setting('test.nurse'),'') is null then raise exception 'Tests require linked owner and nurse';end if;
 select id into n from public.staff where auth_user_id=current_setting('test.nurse')::uuid and active;
 insert into public.staff(full_name,role) values('Синтетическая медсестра v10','nurse') returning id into peer;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-10-10',now(),now()+interval '8 hours','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-10-11',now(),now()+interval '8 hours','open') returning id into next_sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-10-12',now(),now()+interval '8 hours','open') returning id into other_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,n),(next_sh,n),(other_sh,peer);
 insert into public.patients(full_name) values('Синтетический пациент v10 — только rollback') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('Синтетическая капельница v10',100,50,true) returning id into sv;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('Синтетический в/м укол v10',50,0,true) returning id into inj;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('Синтетический препарат v10','амп.',10,100,20,0,0) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(med,5,5,5,10,current_date+100),(med,7,7,7,10,current_date+200);
 insert into public.stock(medication_id,location,quantity) values(med,'work',12),(med,'reserve',0);
 update private.crm_finance_settings set payment_only=false where id;
 perform set_config('test.shift',sh::text,true);perform set_config('test.next_shift',next_sh::text,true);perform set_config('test.other_shift',other_sh::text,true);
 perform set_config('test.patient',pt::text,true);perform set_config('test.service',sv::text,true);perform set_config('test.injection',inj::text,true);
 perform set_config('test.med',med::text,true);perform set_config('test.nurse_id',n::text,true);perform set_config('test.peer',peer::text,true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare p jsonb;req uuid:=gen_random_uuid();a jsonb;b jsonb;failed boolean;edit_req uuid:=gen_random_uuid();return_req uuid:=gen_random_uuid();
begin
 p:=jsonb_build_object('patient_id',current_setting('test.patient'),'shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),
  'service_id',current_setting('test.service'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',2)),
  'own_medications',jsonb_build_array(jsonb_build_object('name','Препарат ранее куплен пациентом','quantity',1,'unit','фл.','source','previously_purchased')),
  'charge_total',170,'paid_total',100,'payment_status','debt','discount_reason','Постоянный пациент','discount_comment','Постоянная скидка согласована владельцем',
  'payments',jsonb_build_object('cash',100,'terminal',0,'owner_card',0,'cash_received',150),'expected_stock_deducted',true);
 a:=public.record_treatment_v5('procedure',p,req);
 if(a->>'list_total')::numeric<>190 or(a->>'charge_total')::numeric<>170 or(a->>'paid_total')::numeric<>100 or(a->>'debt_total')::numeric<>70 then raise exception 'Bill/partial receipt/own medication wrong: %',a;end if;
 if a->'payments'->>'change'<>'50' then raise exception 'Cash tender was counted as income';end if;
 if public.record_treatment_v5('procedure',p,req)<>a then raise exception 'Create retry differs';end if;
 perform set_config('test.procedure',a->>'id',true);
 failed:=false;begin perform public.record_treatment_v5('procedure',p-'discount_comment',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse discount without comment accepted';end if;
 failed:=false;begin perform public.record_treatment_v5('procedure',p||jsonb_build_object('payment_status','paid'),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Paid status accepted an unpaid balance';end if;
 failed:=false;begin perform public.crm_clinical_v10('debts','{}');exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse saw global debt list';end if;
 b:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',current_setting('test.patient')));
 if(b->>'debt_total')::numeric<>70 then raise exception 'Patient debt is missing';end if;
 failed:=false;begin perform private.crm_record_treatment_v10('procedure',p,gen_random_uuid(),false);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Internal unallocated helper remains exposed';end if;
 -- Additional injection and one additional medicine in the same visit.
 p:=jsonb_build_object('kind','procedure','id',a->>'id','expected_version',1,'expected_stock_deducted',true,'edit_reason','Добавили в/м укол и ампулу',
  'services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.service'),'quantity',1),jsonb_build_object('service_id',current_setting('test.injection'),'quantity',1)),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',3)),'own_medications',a->'own_medications',
  'charge_total',240,'payment_status','debt','discount_reason','Постоянный пациент','discount_comment','Скидка сохранена','payments',jsonb_build_object('cash',50));
 a:=public.crm_clinical_v10('treatment_edit',p,edit_req);
 if(a->>'list_total')::numeric<>260 or(a->>'paid_total')::numeric<>150 or(a->>'initial_paid_total')::numeric<>100 or(a->>'debt_total')::numeric<>90 or jsonb_array_length(a->'services')<>2 then raise exception 'Visit extension or receipts wrong: %',a;end if;
 if public.crm_clinical_v10('treatment_edit',p,edit_req)<>a then raise exception 'Edit retry differs';end if;
 failed:=false;begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Stale version accepted';end if;
 p:=p||jsonb_build_object('expected_version',2,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',2)),
  'charge_total',220,'payments',jsonb_build_object('cash',0),'edit_reason','Исправили лишнюю ампулу');
 failed:=false;begin perform public.crm_clinical_v10('treatment_edit',p-'edit_reason',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Edit without audit reason accepted';end if;
 a:=public.crm_clinical_v10('treatment_edit',p,return_req);
 if(a->>'debt_total')::numeric<>70 or(a->>'version')::integer<>3 then raise exception 'Return edit bill wrong';end if;
 if public.crm_clinical_v10('treatment_edit',p,return_req)<>a then raise exception 'Stock return retry differs';end if;
 -- Own medication is valid for an injection, and a free visit still needs a comment.
 p:=jsonb_build_object('patient_id',current_setting('test.patient'),'shift_id',current_setting('test.shift'),'nurse_id',current_setting('test.nurse_id'),
  'service_id',current_setting('test.injection'),'items','[]'::jsonb,'own_medications',jsonb_build_array(jsonb_build_object('name','Свой витамин','quantity',1,'unit','амп.','source','patient')),
  'charge_total',0,'paid_total',0,'payment_status','free','discount_reason','Бесплатно по решению владельца','discount_comment','Помощь пациенту','payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('procedure',p,gen_random_uuid());
 if(a->>'list_total')::numeric<>50 or(a->>'charge_total')::numeric<>0 or(a->>'debt_total')::numeric<>0 or jsonb_array_length(a->'own_medications')<>1 then raise exception 'Free own-medication injection wrong';end if;
 failed:=false;begin perform public.record_treatment_v5('procedure',p-'discount_comment',gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Free visit without reason accepted';end if;
 b:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if(b->'revenue'->>'cash')::numeric<>150 then raise exception 'Own-shift cash excludes extra receipt: %',b;end if;
 if b ? 'stock' or b ? 'used' or b ? 'untracked' or b ? 'warnings' then raise exception 'Nurse saw warehouse';end if;
 if not(b ? 'payroll_total') or not(b->'staff'->0 ? 'amount') then raise exception 'Assigned-shift payroll missing';end if;
 b:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.shift')));
 failed:=false;begin perform public.crm_clinical_v10('treatment_edit',p||jsonb_build_object('kind','procedure','id',current_setting('test.procedure'),'expected_version',3,'expected_stock_deducted',true,'edit_reason','После закрытия'),gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse edited closed shift';end if;
 -- Pay the remaining debt on another open shift. The old cash is never rewritten.
 req:=gen_random_uuid();p:=jsonb_build_object('kind','procedure','id',current_setting('test.procedure'),'shift_id',current_setting('test.next_shift'),'nurse_id',current_setting('test.nurse_id'),'payments',jsonb_build_object('cash',70),'comment','Погашение долга');
 a:=public.crm_clinical_v10('debt_payment',p,req);
 if(a->>'paid_total')::numeric<>220 or(a->>'debt_total')::numeric<>0 then raise exception 'Debt payment total wrong';end if;
 if public.crm_clinical_v10('debt_payment',p,req)<>a then raise exception 'Debt settlement retry differs';end if;
 failed:=false;begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Overpayment accepted';end if;
 b:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.next_shift')));
 if(b->'revenue'->>'cash')::numeric<>70 or jsonb_array_length(b->'procedures')<>0 or jsonb_array_length(b->'receipts')<>1 then raise exception 'Later receipt was assigned to original shift';end if;
 b:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if(b->'revenue'->>'cash')::numeric<>150 or(b->>'debt_total')::numeric<>0 then raise exception 'Closed shift cash was rewritten or its debt stale';end if;
 failed:=false;begin perform public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.other_shift')));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse read another shift';end if;
end $$;
reset role;
do $$begin
 if(select paid_total from public.procedures where id=current_setting('test.procedure')::uuid)<>100 then raise exception 'Historical initial receipt changed';end if;
 if(select quantity from public.stock where medication_id=current_setting('test.med')::uuid and location='work')<>10 then raise exception 'Edit/replay/own medications changed wrong stock';end if;
 if(select work_quantity from public.medication_batches where medication_id=current_setting('test.med')::uuid and expiry_date=current_date+100)<>3 then raise exception 'Return did not restore original FEFO batch';end if;
 if(select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.procedure')::uuid)<>2 then raise exception 'Edit/debt replay double-counted receipt';end if;
 perform private.assert_stock_v3(current_setting('test.med')::uuid);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;old_stock jsonb;p jsonb;
begin
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));old_stock:=a->'stock';
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.procedure'),'expected_version',4,'expected_stock_deducted',true,'edit_reason','Владелец уточнил дополнительную услугу после закрытия',
  'services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.service'),'quantity',1),jsonb_build_object('service_id',current_setting('test.injection'),'quantity',2)),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.med'),'quantity',2)),'own_medications','[]'::jsonb,
  'charge_total',240,'payment_status','debt','discount_reason','Скидка от владельца','discount_comment','Владелец уточнил итог','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if(a->>'debt_total')::numeric<>20 then raise exception 'Owner closed-edit bill is wrong';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if(a->'revenue'->>'cash')::numeric<>150 or(a->>'charge_total')::numeric<>240 or(a->>'debt_total')::numeric<>20 or(a->'stock') is distinct from old_stock then raise exception 'Closed report snapshot or clinical totals stale';end if;
 a:=public.crm_clinical_v10('debts','{}');if(a->>'debt_total')::numeric<20 then raise exception 'Owner debt register missing';end if;
end $$;
reset role;
-- Receipt-date regression: original visit and later payments have different accounting days.
update public.procedures set visit_at=timestamptz '2096-10-10 10:00:00+03' where id=current_setting('test.procedure')::uuid;
update private.crm_receipts_v10 set created_at=case when shift_id=current_setting('test.shift')::uuid then timestamptz '2096-10-10 11:00:00+03' else timestamptz '2096-10-11 11:00:00+03' end where procedure_id=current_setting('test.procedure')::uuid;
set local role authenticated;
do $$declare a jsonb;
begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-10','to','2096-10-10','group_by','day','patient_id',current_setting('test.patient')));
 if(a->'revenue'->>'total')::numeric<>150 or(a->>'procedures_count')::integer<>1 then raise exception 'Original accounting day wrong: %',a;end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-11','to','2096-10-11','group_by','day','patient_id',current_setting('test.patient')));
 if(a->'revenue'->>'total')::numeric<>70 or(a->>'procedures_count')::integer<>0 then raise exception 'Settlement day repeated procedure or cash: %',a;end if;
end $$;
reset role;
-- Deleting a patient hides the clinical card from nurses, while retaining the
-- receivable and receipt history for the owner.
update public.patients set deleted_at=now(),deleted_by=current_setting('test.manager')::uuid where id=current_setting('test.patient')::uuid;
select set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare failed boolean;p jsonb;
begin
 failed:=false;begin perform public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.procedure')));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse read a deleted patient treatment';end if;
 failed:=false;begin perform public.crm_clinical_v10('patient_treatments',jsonb_build_object('patient_id',current_setting('test.patient')));exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse read deleted patient history';end if;
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.procedure'),'shift_id',current_setting('test.next_shift'),'nurse_id',current_setting('test.nurse_id'),'payments',jsonb_build_object('cash',20),'comment','Погашение после удаления');
 failed:=false;begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Nurse collected against a deleted patient';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare a jsonb;p jsonb;
begin
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.procedure'),'shift_id',current_setting('test.next_shift'),'nurse_id',current_setting('test.nurse_id'),'payments',jsonb_build_object('cash',20),'comment','Владелец принял оплату сохранённого долга');
 a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 if(a->>'debt_total')::numeric<>0 or(a->>'paid_total')::numeric<>240 or(a->>'initial_paid_total')::numeric<>100 then raise exception 'Owner cannot collect retained patient debt';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.shift')));
 if(a->'revenue'->>'cash')::numeric<>150 or(a->>'debt_total')::numeric<>0 then raise exception 'Owner settlement changed old cash or left stale debt';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.next_shift')));
 if(a->'revenue'->>'cash')::numeric<>90 then raise exception 'Owner retained debt receipt not in collection shift';end if;
end $$;
reset role;
rollback;
