-- Run after crm-sale-debt-v27.sql. All identities, medicines, sales, receipts,
-- requests, stock and settings below are synthetic and roll back in full.
begin;
do $$declare owner_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();outsider_user uuid:=gen_random_uuid();
 owner_staff uuid;nurse_staff uuid;outsider_staff uuid;sh uuid;foreign_sh uuid;med uuid;service uuid;
begin
 insert into auth.users(id,email) values(owner_user,owner_user::text||'@v27.example.invalid'),
  (nurse_user,nurse_user::text||'@v27.example.invalid'),(outsider_user,outsider_user::text||'@v27.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST anonymous debt owner v27','owner',true,owner_user) returning id into owner_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST anonymous debt nurse v27','nurse',true,nurse_user) returning id into nurse_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST anonymous debt outsider v27','nurse',true,outsider_user) returning id into outsider_staff;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-10-27',timestamptz '2096-10-27 08:30+03',timestamptz '2096-10-27 16:00+03','open') returning id into sh;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-10-28',timestamptz '2096-10-28 08:30+03',timestamptz '2096-10-28 16:00+03','open') returning id into foreign_sh;
 insert into public.shift_staff(shift_id,staff_id) values(sh,nurse_staff),(foreign_sh,outsider_staff);
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST anonymous debt medicine v27','амп.',10,400,1000,0,0) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date,received_date)
  values(med,20,20,20,40,current_date+365,current_date);
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',0),(med,'work',20);
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST anonymous debt procedure v27',100,0,true) returning id into service;
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v27.owner',owner_user::text,true);perform set_config('test.v27.nurse',nurse_user::text,true);
 perform set_config('test.v27.outsider',outsider_user::text,true);perform set_config('test.v27.nurse_staff',nurse_staff::text,true);
 perform set_config('test.v27.outsider_staff',outsider_staff::text,true);perform set_config('test.v27.shift',sh::text,true);
 perform set_config('test.v27.foreign_shift',foreign_sh::text,true);perform set_config('test.v27.med',med::text,true);
 perform set_config('test.v27.service',service::text,true);perform set_config('test.v27.patient_count',(select count(*)::text from public.patients),true);
 perform set_config('test.v27.stock_before',(select jsonb_agg(to_jsonb(s) order by location)::text from public.stock s where medication_id=med),true);
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.v27.nurse'),true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();original jsonb;report_n jsonb;
begin
 p:=jsonb_build_object('patient_id',null,'shift_id',current_setting('test.v27.shift'),'nurse_id',current_setting('test.v27.nurse_staff'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',2,'dose','По назначению')),
  'charge_total',1800,'paid_total',0,'payment_status','debt','discount_reason','Скидка от владельца','discount_comment','TEST agreed sale price',
  'expected_stock_deducted',false,'payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0),'notes','TEST unnamed buyer sale v27');
 a:=public.record_treatment_v5('sale',p,req);
 if a->>'patient_id' is not null or a->>'patient'<>'Без пациента' or (a->>'list_total')::numeric<>2000
  or (a->>'charge_total')::numeric<>1800 or (a->>'debt_total')::numeric<>1800 or (a->>'received_total')::numeric<>0
  or (a->>'discount_amount')::numeric<>200 or (a->>'stock_deducted')::boolean is distinct from false then
  raise exception 'Anonymous full-debt sale was not saved correctly: %',a;
 end if;
 if public.record_treatment_v5('sale',p,req) is distinct from a then raise exception 'Anonymous create replay changed result';end if;
 begin perform public.record_treatment_v5('sale',p||jsonb_build_object('notes','changed request'),req);raise exception 'Create reused UUID with changed payload';
 exception when others then if sqlerrm<>'Номер операции уже использован' then raise;end if;end;
 perform set_config('test.v27.debt_sale',a->>'id',true);perform set_config('test.v27.debt_request',req::text,true);
 -- Procedures retain their patient requirement for every payment state.
 begin perform public.record_treatment_v5('procedure',p||jsonb_build_object('service_id',current_setting('test.v27.service')),gen_random_uuid());
  raise exception 'Anonymous procedure in debt unexpectedly saved';
 exception when others then if sqlerrm<>'Выберите пациента' then raise;end if;end;
 -- An omitted patient key also works; only actually received amounts enter cash.
 p:=(p-array['patient_id','discount_reason','discount_comment'])||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',1)),
  'charge_total',1000,'paid_total',250,'payments',jsonb_build_object('cash',100,'terminal',150,'owner_card',0,'cash_received',200));
 req:=gen_random_uuid();a:=public.record_treatment_v5('sale',p,req);
 if a->>'patient_id' is not null or (a->>'received_total')::numeric<>250 or (a->>'debt_total')::numeric<>750
  or (a->'payments'->>'change')::numeric<>100 then raise exception 'Anonymous partially paid sale is incorrect';end if;
 if public.record_treatment_v5('sale',p,req) is distinct from a then raise exception 'Partial create replay differs';end if;
 perform set_config('test.v27.partial_sale',a->>'id',true);
 p:=p||jsonb_build_object('paid_total',0,'payment_status','pending','payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('sale',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from true or a->>'patient_id' is not null then raise exception 'Anonymous awaiting-payment sale failed';end if;
 perform set_config('test.v27.pending_sale',a->>'id',true);
 original:=a;
 -- Unpaid pending sales remain editable without a new edit comment.
 p:=jsonb_build_object('kind','sale','id',a->>'id','expected_version',1,'expected_stock_deducted',false,'items',a->'items',
  'charge_total',1000,'payment_status','pending','notes','TEST anonymous pending edited','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 if (a->>'version')::integer<>2 or (a->>'payment_pending')::boolean is distinct from true or a->>'notes'<>'TEST anonymous pending edited' then raise exception 'Anonymous pending edit failed';end if;
 -- A paid sale is retained for the mistaken-payment correction case below.
 p:=jsonb_build_object('shift_id',current_setting('test.v27.shift'),'nurse_id',current_setting('test.v27.nurse_staff'),
  'items',a->'items','charge_total',1000,'paid_total',1000,'payment_status','paid','expected_stock_deducted',false,'payments',jsonb_build_object('cash',1000));
 req:=gen_random_uuid();a:=public.record_treatment_v5('sale',p,req);
 perform set_config('test.v27.paid_sale',a->>'id',true);perform set_config('test.v27.paid_request',req::text,true);
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v27.shift')));
 if (report_n->'revenue'->>'total')::numeric<>1250 or (report_n->>'charge_total')::numeric<>4800
  or (report_n->>'debt_total')::numeric<>3550 or jsonb_array_length(report_n->'sales')<>4
  or report_n?'stock' then raise exception 'Nurse report counts debt as money or omits anonymous sales';end if;
 report_n:=public.crm_shift_journal_v12(date '2096-10-27');
 if jsonb_array_length(report_n->'reports')<>1 or jsonb_array_length(report_n->'reports'->0->'sales')<>4 then raise exception 'Nurse cannot reopen anonymous sale from own shift journal';end if;
end $$;
reset role;
-- Only synthetic timestamps change: period reports use actual sale/receipt dates.
update public.sales set sold_at=timestamptz '2096-10-27 10:00+03' where shift_id=current_setting('test.v27.shift')::uuid;

set local role authenticated;
do $$declare original jsonb;p jsonb;a jsonb;req uuid:=gen_random_uuid();
begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v27.debt_sale')));
 p:=jsonb_build_object('kind','sale','id',original->>'id','patient_id',null,'shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',1,'expected_stock_deducted',false,'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',3,'dose','По назначению')),
  'charge_total',2500,'payment_status','debt','discount_reason','Скидка от владельца','discount_comment','TEST revised bill',
  'edit_reason','TEST added a medicine before debt collection','payments',jsonb_build_object('cash',0));
 a:=public.crm_clinical_v10('treatment_edit',p,req);
 if a->>'patient_id' is not null or (a->>'list_total')::numeric<>3000 or (a->>'charge_total')::numeric<>2500
  or (a->>'debt_total')::numeric<>2500 or (a->>'received_total')::numeric<>0 or (a->>'version')::integer<>2 then raise exception 'Anonymous debt sale edit is incorrect';end if;
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Anonymous sale edit replay differs';end if;
 begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());raise exception 'Stale anonymous sale edit accepted';
 exception when others then if sqlerrm<>'Запись уже изменена. Откройте её заново' then raise;end if;end;
 -- Receive money twice, preserving one receipt per request UUID.
 p:=jsonb_build_object('kind','sale','id',a->>'id','shift_id',current_setting('test.v27.shift'),'nurse_id',current_setting('test.v27.nurse_staff'),
  'payments',jsonb_build_object('cash',400,'terminal',600,'cash_received',500),'comment','TEST anonymous debt first collection');
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 if (a->>'received_total')::numeric<>1000 or (a->>'debt_total')::numeric<>1500 or (a->'payments'->>'change')::numeric<>100 then raise exception 'Anonymous partial debt receipt is incorrect';end if;
 if public.crm_clinical_v10('debt_payment',p,req) is distinct from a then raise exception 'Anonymous receipt replay differs';end if;
 perform set_config('test.v27.first_receipt',req::text,true);
 begin perform public.crm_clinical_v10('debt_payment',p||jsonb_build_object('payments',jsonb_build_object('cash',1600)),gen_random_uuid());raise exception 'Anonymous sale overpayment accepted';
 exception when others then if sqlerrm<>'Оплата должна быть больше нуля и не превышать остаток долга' then raise;end if;end;
 p:=p||jsonb_build_object('payments',jsonb_build_object('owner_card',1500));a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 if (a->>'received_total')::numeric<>2500 or (a->>'debt_total')::numeric<>0 then raise exception 'Anonymous debt did not settle';end if;
 -- Pending status stays pending during a partial receipt and clears on settlement.
 p:=p||jsonb_build_object('id',current_setting('test.v27.pending_sale'),'payments',jsonb_build_object('cash',200));
 a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from true or (a->>'debt_total')::numeric<>800 then raise exception 'Partial anonymous pending receipt lost pending state';end if;
 p:=p||jsonb_build_object('payments',jsonb_build_object('terminal',800));a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 if (a->>'payment_pending')::boolean is distinct from false or (a->>'debt_total')::numeric<>0 then raise exception 'Anonymous pending receipt did not settle';end if;
 -- An assigned nurse may not void an allegedly mistaken payment.
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v27.paid_sale')));
 p:=jsonb_build_object('kind','sale','id',original->>'id','expected_version',1,'expected_stock_deducted',false,'expected_received_total',1000,
  'confirm_no_money_received',true,'correction_reason','TEST incorrectly marked paid','items',original->'items','charge_total',1000,
  'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0));
 perform set_config('test.v27.correction_payload',p::text,true);
 begin perform public.crm_payment_correction_v22(p,gen_random_uuid());raise exception 'Nurse corrected mistaken anonymous sale payment';
 exception when sqlstate '42501' then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v27.owner'),true);
set local role authenticated;
do $$declare p jsonb:=current_setting('test.v27.correction_payload')::jsonb;a jsonb;report_n jsonb;req uuid:=gen_random_uuid();
begin
 a:=public.crm_payment_correction_v22(p,req);
 if a->>'patient_id' is not null or (a->>'received_total')::numeric<>0 or (a->>'debt_total')::numeric<>1000
  or (a->>'version')::integer<>2 then raise exception 'Manager cannot correct anonymous mistaken sale payment';end if;
 if public.crm_payment_correction_v22(p,req) is distinct from a then raise exception 'Anonymous correction replay differs';end if;
 report_n:=public.crm_clinical_v10('debts','{}');
 if not exists(select 1 from jsonb_array_elements(report_n->'debts') x where x->>'id'=current_setting('test.v27.paid_sale') and x->>'patient_id' is null and (x->>'debt_total')::numeric=1000)
  or not exists(select 1 from jsonb_array_elements(report_n->'debts') x where x->>'id'=current_setting('test.v27.partial_sale') and (x->>'debt_total')::numeric=750) then raise exception 'Manager debt register omits anonymous sales';end if;
 report_n:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v27.shift')));
 if (report_n->'revenue'->>'total')::numeric<>3750 or (report_n->'revenue'->>'cash')::numeric<>700
  or (report_n->'revenue'->>'terminal')::numeric<>1550 or (report_n->'revenue'->>'owner_card')::numeric<>1500
  or (report_n->>'charge_total')::numeric<>5500 or (report_n->>'debt_total')::numeric<>1750
  or (report_n->>'debt_receipts_total')::numeric<>3500 or jsonb_array_length(report_n->'sales')<>4
  or jsonb_array_length(report_n->'receipts')<>4 then raise exception 'Anonymous shift report revenue, methods, debt or receipt count is incorrect: %',report_n;end if;
end $$;
reset role;
update private.crm_receipts_v10 set created_at=timestamptz '2096-10-27 12:00+03' where shift_id=current_setting('test.v27.shift')::uuid;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-10-27','to','2096-10-27','group_by','patient','medication_id',current_setting('test.v27.med')));
 if (a->'revenue'->>'total')::numeric<>3750 or (a->>'charge_total')::numeric<>5500 or (a->>'debt_total')::numeric<>1750
  or (a->>'sales_count')::integer<>4 or (a->>'debt_payments_count')::integer<>4 then raise exception 'Anonymous period report omits sales, receipts or debts: %',a;end if;
end $$;
reset role;
do $$begin
 if (select count(*) from public.patients)<>current_setting('test.v27.patient_count')::bigint then raise exception 'Anonymous debt flow created a dummy patient';end if;
 if (select jsonb_agg(to_jsonb(s) order by location) from public.stock s where medication_id=current_setting('test.v27.med')::uuid) is distinct from current_setting('test.v27.stock_before')::jsonb
  or exists(select 1 from public.stock_movements where medication_id=current_setting('test.v27.med')::uuid) then raise exception 'Payment-only anonymous debt or replay touched inventory';end if;
 if (select count(*) from private.crm_payment_allocations where sale_id=current_setting('test.v27.debt_sale')::uuid)<>1
  or (select count(*) from private.crm_receipts_v10 where sale_id=current_setting('test.v27.debt_sale')::uuid)<>2
  or not exists(select 1 from private.crm_payment_allocations where id=current_setting('test.v27.paid_request')::uuid and cash=1000 and voided_at is not null)
  or (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v27.paid_sale'))<>1 then raise exception 'Anonymous create/receipt/correction retry changed audit history twice';end if;
 -- Exercise existing inventory deductions as well; changing the patient rule
 -- must neither skip nor duplicate an already enabled warehouse movement.
 update private.crm_finance_settings set payment_only=false where id;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v27.nurse'),true);
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 p:=jsonb_build_object('shift_id',current_setting('test.v27.shift'),'nurse_id',current_setting('test.v27.nurse_staff'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',1)),
  'charge_total',1000,'paid_total',0,'payment_status','debt','expected_stock_deducted',true,'payments',jsonb_build_object('cash',0));
 a:=public.record_treatment_v5('sale',p,req);
 if (a->>'stock_deducted')::boolean is distinct from true or a->>'patient_id' is not null then raise exception 'Warehouse-tracked anonymous debt failed';end if;
 if public.record_treatment_v5('sale',p,req) is distinct from a then raise exception 'Warehouse-tracked debt create replay differs';end if;
 perform set_config('test.v27.stock_sale',a->>'id',true);
 p:=jsonb_build_object('kind','sale','id',a->>'id','expected_version',1,'expected_stock_deducted',true,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',2)),
  'charge_total',2000,'payment_status','debt','edit_reason','TEST one more ampoule','payments',jsonb_build_object('cash',0));
 req:=gen_random_uuid();a:=public.crm_clinical_v10('treatment_edit',p,req);
 if public.crm_clinical_v10('treatment_edit',p,req) is distinct from a then raise exception 'Warehouse-tracked debt edit replay differs';end if;
end $$;
reset role;
do $$begin
 if (select quantity from public.stock where medication_id=current_setting('test.v27.med')::uuid and location='work')<>18
  or (select count(*) from public.stock_movements where sale_id=current_setting('test.v27.stock_sale')::uuid and movement_type='sale' and quantity=1)<>2 then raise exception 'Warehouse-tracked debt duplicated or skipped deduction';end if;
 perform private.assert_stock_v3(current_setting('test.v27.med')::uuid);
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.v27.outsider'),true);
set local role authenticated;
do $$declare p jsonb;begin
 p:=jsonb_build_object('shift_id',current_setting('test.v27.shift'),'nurse_id',current_setting('test.v27.nurse_staff'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v27.med'),'quantity',1)),
  'charge_total',1000,'paid_total',0,'payment_status','debt','expected_stock_deducted',true,'payments',jsonb_build_object('cash',0));
 begin perform public.record_treatment_v5('sale',p,gen_random_uuid());raise exception 'Outsider nurse saved debt in another shift';
 exception when others then if sqlerrm<>'Нет доступа к этой смене' then raise;end if;end;
 p:=jsonb_build_object('kind','sale','id',current_setting('test.v27.partial_sale'),'shift_id',current_setting('test.v27.shift'),
  'nurse_id',current_setting('test.v27.nurse_staff'),'payments',jsonb_build_object('cash',100));
 begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());raise exception 'Outsider nurse collected into another shift';
 exception when others then if sqlerrm<>'Нет доступа к смене оплаты' then raise;end if;end;
end $$;
reset role;
select true as anonymous_sale_debt_verified;
rollback;
