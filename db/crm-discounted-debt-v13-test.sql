-- Regression for an existing unpaid 14,300 bill corrected to 11,500.
-- Uses only synthetic fixtures and the audited public API; every change rolls back.
-- Run after clinical-v10 and clinical-finance-v10. No migration is needed.
begin;
select set_config('test.v13.manager',(select auth_user_id::text from public.staff
 where active and role in ('owner','admin') and auth_user_id is not null order by id limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.v13.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v13.manager'),'role','authenticated')::text,true);
do $$
declare nurse_id uuid;patient_id uuid;shift_id uuid;service_one uuid;service_two uuid;medicine_one uuid;medicine_two uuid;
begin
 if nullif(current_setting('test.v13.manager'),'') is null then raise exception 'Test requires an active linked owner/admin';end if;
 select id into nurse_id from public.staff where active and role='nurse' order by id limit 1;
 if nurse_id is null then raise exception 'Test requires an active nurse';end if;
 insert into public.patients(full_name) values('TEST synthetic discounted debt v13 — rollback only') returning id into patient_id;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-02-17',timestamptz '2096-02-17 08:00:00+03',timestamptz '2096-02-17 16:00:00+03','open') returning id into shift_id;
 insert into public.shift_staff(shift_id,staff_id) values(shift_id,nurse_id);
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST drip v13',500,100,true) returning id into service_one;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST injection v13',100,0,true) returning id into service_two;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST medication A v13','амп.',10,1000,4500,0,0) returning id into medicine_one;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST medication B v13','фл.',10,1000,2300,0,0) returning id into medicine_two;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date)
  values(medicine_one,10,10,10,100,current_date+100),(medicine_two,10,10,10,100,current_date+100);
 insert into public.stock(medication_id,location,quantity)
  values(medicine_one,'work',10),(medicine_one,'reserve',0),(medicine_two,'work',10),(medicine_two,'reserve',0);
 -- Exercise the harder case: correction of a record that already deducted stock.
 update private.crm_finance_settings set payment_only=false where id;
 perform set_config('test.v13.nurse',nurse_id::text,true);
 perform set_config('test.v13.patient',patient_id::text,true);
 perform set_config('test.v13.shift',shift_id::text,true);
 perform set_config('test.v13.service_one',service_one::text,true);
 perform set_config('test.v13.service_two',service_two::text,true);
 perform set_config('test.v13.med_one',medicine_one::text,true);
 perform set_config('test.v13.med_two',medicine_two::text,true);
end $$;
set local role authenticated;
do $$
declare result jsonb;payload jsonb;
begin
 payload:=jsonb_build_object(
  'patient_id',current_setting('test.v13.patient'),'shift_id',current_setting('test.v13.shift'),'nurse_id',current_setting('test.v13.nurse'),
  'services',jsonb_build_array(
   jsonb_build_object('service_id',current_setting('test.v13.service_one'),'quantity',1),
   jsonb_build_object('service_id',current_setting('test.v13.service_two'),'quantity',1)),
  'items',jsonb_build_array(
   jsonb_build_object('medication_id',current_setting('test.v13.med_one'),'quantity',2),
   jsonb_build_object('medication_id',current_setting('test.v13.med_two'),'quantity',2)),
  'own_medications',jsonb_build_array(
   jsonb_build_object('name','TEST own medication','quantity',2,'unit','амп.','source','patient'),
   jsonb_build_object('name','TEST previously purchased medication','quantity',1,'unit','фл.','source','previously_purchased')),
  'notes',E'Оставить исходные назначения и заметки.\nДополнительный укол.',
  'charge_total',14300,'paid_total',0,'payment_status','debt','expected_stock_deducted',true,
  'payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0));
 result:=public.record_treatment_v5('procedure',payload,gen_random_uuid());
 if (result->>'list_total')::numeric is distinct from 14300::numeric
  or (result->>'charge_total')::numeric is distinct from 14300::numeric
  or (result->>'paid_total')::numeric is distinct from 0::numeric
  or (result->>'debt_total')::numeric is distinct from 14300::numeric
  or (result->>'version')::integer is distinct from 1 then raise exception 'Exact unpaid fixture is wrong: %',result;end if;
 perform set_config('test.v13.procedure',result->>'id',true);
end $$;
reset role;
-- Fixture timestamp only: place the synthetic visit inside its synthetic accounting day.
update public.procedures set visit_at=timestamptz '2096-02-17 09:15:00+03' where id=current_setting('test.v13.procedure')::uuid;
update public.shifts set ended_at=timestamptz '2096-02-17 16:00:00+03' where id=current_setting('test.v13.shift')::uuid;
set local role authenticated;
do $$
declare result jsonb;
begin
 result:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v13.shift')));
 if (result->'revenue'->>'total')::numeric is distinct from 0::numeric
  or (result->>'charge_total')::numeric is distinct from 14300::numeric
  or (result->>'debt_total')::numeric is distinct from 14300::numeric then raise exception 'Original closed financial report is wrong';end if;
end $$;
reset role;
-- A later price change/archive must not reprice the existing visit.
update public.medications set sale_price=sale_price+777,active=false
 where id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid);
update public.procedure_services set work_price=work_price+999,consumables_price=consumables_price+99,active=false
 where id in(current_setting('test.v13.service_one')::uuid,current_setting('test.v13.service_two')::uuid);
do $$
declare original jsonb;baseline jsonb;report jsonb;
begin
 original:=private.crm_treatment_snapshot_v10('procedure',current_setting('test.v13.procedure')::uuid);
 if (original->>'stock_deducted')::boolean is distinct from true
  or (select count(*) from public.stock where medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid) and location='work' and quantity=8)<>2
  or (select count(*) from public.medication_batches where medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid) and work_quantity=8 and quantity_remaining=8)<>2
  or (select count(*) from public.stock_movements where procedure_id=current_setting('test.v13.procedure')::uuid and movement_type='procedure_use' and quantity=2)<>2 then
  raise exception 'Fixture did not exercise actual prior stock deduction';
 end if;
 perform set_config('test.v13.original',original::text,true);
 select r.report into report from private.crm_shift_reports r where r.shift_id=current_setting('test.v13.shift')::uuid;
 baseline:=jsonb_build_object(
  'stock',(select jsonb_agg(to_jsonb(s) order by s.medication_id,s.location) from public.stock s where s.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.medication_batches b where b.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'returns',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.crm_stock_returns_v10 r join public.stock_movements m on m.id=r.movement_id where m.procedure_id=current_setting('test.v13.procedure')::uuid),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id=current_setting('test.v13.procedure')::uuid),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.crm_receipts_v10 r where r.procedure_id=current_setting('test.v13.procedure')::uuid),
  'protected_report',report-array['procedures','sales','receipts','charge_total','debt_total','debt_created_total','debt_receipts_total','revenue','cash_after_salary'],
  'revenue',report->'revenue',
  'audit_count',(select count(*) from private.crm_audit_log a where a.entity_type='procedure' and a.entity_id=current_setting('test.v13.procedure')));
 perform set_config('test.v13.baseline',baseline::text,true);
end $$;
set local role authenticated;
do $$
declare original jsonb;payload jsonb;result jsonb;readback jsonb;report jsonb;request_id uuid:=gen_random_uuid();stale_id uuid:=gen_random_uuid();
begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v13.procedure')));
 if original is distinct from current_setting('test.v13.original')::jsonb
  or (original->>'version')::integer is distinct from 1
  or (original->>'list_total')::numeric is distinct from 14300::numeric
  or (original->>'charge_total')::numeric is distinct from 14300::numeric
  or (original->>'initial_paid_total')::numeric is distinct from 0::numeric
  or (original->>'paid_total')::numeric is distinct from 0::numeric
  or (original->>'received_total')::numeric is distinct from 0::numeric
  or (original->>'stock_deducted')::boolean is distinct from true
  or (original->>'editable')::boolean is distinct from true then raise exception 'Original identity/version/receipt guards failed';end if;
 payload:=jsonb_build_object(
  'kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',1,'expected_stock_deducted',original->'stock_deducted',
  'services',(select jsonb_agg(jsonb_build_object('service_id',x.value->>'service_id','quantity',x.value->'quantity') order by x.ordinality) from jsonb_array_elements(original->'services') with ordinality x(value,ordinality)),
  'items',(select jsonb_agg(jsonb_build_object('medication_id',x.value->>'medication_id','quantity',x.value->'quantity') order by x.ordinality) from jsonb_array_elements(original->'items') with ordinality x(value,ordinality)),
  'own_medications',original->'own_medications','notes',original->'notes',
  'charge_total',11500,'payment_status','debt',
  'discount_reason','Скидка по решению владельца','discount_comment','TEST согласовано 11 500 ₽ вместо 14 300 ₽; деньги не получены',
  'edit_reason','TEST исправлена согласованная сумма неоплаченной процедуры без приёма денег',
  'payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0));
 perform set_config('test.v13.request',request_id::text,true);
 perform set_config('test.v13.payload',payload::text,true);
 result:=public.crm_clinical_v10('treatment_edit',payload,request_id);
 if (result->>'version')::integer is distinct from 2
  or (result->>'list_total')::numeric is distinct from 14300::numeric
  or (result->>'charge_total')::numeric is distinct from 11500::numeric
  or (result->>'debt_total')::numeric is distinct from 11500::numeric
  or (result->>'initial_paid_total')::numeric is distinct from 0::numeric
  or (result->>'paid_total')::numeric is distinct from 0::numeric
  or (result->>'received_total')::numeric is distinct from 0::numeric
  or (result->>'discount_amount')::numeric is distinct from 2800::numeric
  or (result->>'discount_percent')::numeric is distinct from 19.58::numeric
  or (result->'payments'->>'total')::numeric is distinct from 0::numeric then raise exception 'Discount changed money or computed bill incorrectly: %',result;end if;
 -- Captured prices, original note, quantities and identities survive the correction.
 if result->'services' is distinct from original->'services'
  or result->'items' is distinct from original->'items'
  or result->'own_medications' is distinct from original->'own_medications'
  or result->'notes' is distinct from original->'notes'
  or result->'patient_id' is distinct from original->'patient_id'
  or result->'shift_id' is distinct from original->'shift_id'
  or result->'nurse_id' is distinct from original->'nurse_id'
  or result->'visit_at' is distinct from original->'visit_at'
  or result->'stock_deducted' is distinct from original->'stock_deducted' then raise exception 'Correction changed original clinical details';end if;
 if public.crm_clinical_v10('treatment_edit',payload,request_id) is distinct from result then raise exception 'Transport retry did not return original result';end if;
 begin
  perform public.crm_clinical_v10('treatment_edit',payload,stale_id);
  raise exception 'Stale version unexpectedly succeeded';
 exception when others then
  if sqlerrm<>'Запись уже изменена. Откройте её заново' then raise;end if;
 end;
 begin
  perform public.crm_clinical_v10('treatment_edit',payload||jsonb_build_object('charge_total',11000),request_id);
  raise exception 'Changed request payload unexpectedly succeeded';
 exception when others then
  if sqlerrm<>'Номер операции уже использован' then raise;end if;
 end;
 readback:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',original->>'id'));
 if readback is distinct from result-'payments' then raise exception 'Saved snapshot differs after retries';end if;
 report:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',original->>'shift_id'));
 if (report->>'charge_total')::numeric is distinct from 11500::numeric
  or (report->>'debt_total')::numeric is distinct from 11500::numeric
  or (report->>'debt_created_total')::numeric is distinct from 11500::numeric
  or report->'revenue' is distinct from current_setting('test.v13.baseline')::jsonb->'revenue'
  or jsonb_array_length(report->'receipts')<>0 then raise exception 'Closed financial report changed cash or missed discount';end if;
 report:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-02-17','to','2096-02-17','group_by','day','patient_id',original->>'patient_id'));
 if (report->'revenue'->>'total')::numeric is distinct from 0::numeric
  or (report->>'charge_total')::numeric is distinct from 11500::numeric
  or (report->>'debt_total')::numeric is distinct from 11500::numeric
  or (report->>'debt_created_total')::numeric is distinct from 11500::numeric
  or (report->>'procedures_count')::integer is distinct from 1 then raise exception 'Period summary invents money or misses reduced debt: %',report;end if;
 report:=public.crm_clinical_v10('debts',jsonb_build_object('patient_id',original->>'patient_id'));
 if (report->>'debt_total')::numeric is distinct from 11500::numeric or jsonb_array_length(report->'debts')<>1 then raise exception 'Patient debt register missed corrected debt';end if;
 perform set_config('test.v13.stale_request',stale_id::text,true);
end $$;
reset role;
do $$
declare baseline jsonb:=current_setting('test.v13.baseline')::jsonb;after_n jsonb;report jsonb;audit_n private.crm_audit_log%rowtype;original jsonb:=current_setting('test.v13.original')::jsonb;
begin
 select r.report into report from private.crm_shift_reports r where r.shift_id=current_setting('test.v13.shift')::uuid;
 after_n:=jsonb_build_object(
  'stock',(select jsonb_agg(to_jsonb(s) order by s.medication_id,s.location) from public.stock s where s.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.medication_batches b where b.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.medication_id in(current_setting('test.v13.med_one')::uuid,current_setting('test.v13.med_two')::uuid)),
  'returns',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.crm_stock_returns_v10 r join public.stock_movements m on m.id=r.movement_id where m.procedure_id=current_setting('test.v13.procedure')::uuid),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id=current_setting('test.v13.procedure')::uuid),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from private.crm_receipts_v10 r where r.procedure_id=current_setting('test.v13.procedure')::uuid),
  'protected_report',report-array['procedures','sales','receipts','charge_total','debt_total','debt_created_total','debt_receipts_total','revenue','cash_after_salary'],
  'revenue',report->'revenue');
 if after_n is distinct from baseline-'audit_count' then raise exception 'Discount/retry mutated stock, batches, cash receipt, allocation or protected closed report';end if;
 if (select count(*) from private.crm_audit_log a where a.entity_type='procedure' and a.entity_id=current_setting('test.v13.procedure'))
  is distinct from (baseline->>'audit_count')::bigint+1 then raise exception 'Correction/retry did not add exactly one audit';end if;
 select * into audit_n from private.crm_audit_log a where a.entity_type='procedure' and a.entity_id=current_setting('test.v13.procedure') and a.action='treatment_edit_v10';
 if audit_n.before_data is distinct from original
  or (audit_n.after_data->>'charge_total')::numeric is distinct from 11500::numeric
  or audit_n.reason is distinct from current_setting('test.v13.payload')::jsonb->>'edit_reason' then raise exception 'Audited correction has wrong before/after/reason';end if;
 if exists(select 1 from private.crm_receipts_v10 where id=current_setting('test.v13.request')::uuid)
  or exists(select 1 from private.crm_payment_allocations where id=current_setting('test.v13.request')::uuid)
  or exists(select 1 from private.warehouse_requests where id=current_setting('test.v13.stale_request')::uuid) then raise exception 'Zero-payment correction or failed retry persisted unexpected receipt';end if;
 if (select version from public.procedures where id=current_setting('test.v13.procedure')::uuid) is distinct from 2
  or (select paid_total from public.procedures where id=current_setting('test.v13.procedure')::uuid) is distinct from 0::numeric then raise exception 'Persisted version/original payment changed';end if;
 perform private.assert_stock_v3(current_setting('test.v13.med_one')::uuid);
 perform private.assert_stock_v3(current_setting('test.v13.med_two')::uuid);
end $$;
rollback;
