-- Run after crm-payment-correction-v22.sql. All identities and business rows are
-- synthetic. The entire transaction, including helper functions, is rolled back.
begin;

do $$declare owner_user uuid:=gen_random_uuid();admin_user uuid:=gen_random_uuid();nurse_user uuid:=gen_random_uuid();
 owner_staff uuid;admin_staff uuid;nurse_staff uuid;patient uuid;med uuid;service uuid;first_shift uuid;receipt_shift uuid;collection_shift uuid;
begin
 insert into auth.users(id,email) values(owner_user,owner_user::text||'@v22.example.invalid'),
  (admin_user,admin_user::text||'@v22.example.invalid'),(nurse_user,nurse_user::text||'@v22.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST correction owner v22','owner',true,owner_user) returning id into owner_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST correction administrator v22','admin',true,admin_user) returning id into admin_staff;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST correction nurse v22','nurse',true,nurse_user) returning id into nurse_staff;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
 insert into public.patients(full_name) values('TEST correction patient v22') returning id into patient;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-09-01',timestamptz '2096-09-01 08:30+03',timestamptz '2096-09-01 16:00+03','open') returning id into first_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-09-02',timestamptz '2096-09-02 08:30+03',timestamptz '2096-09-02 16:00+03','open') returning id into receipt_shift;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2096-09-03',timestamptz '2096-09-03 08:30+03',timestamptz '2096-09-03 16:00+03','open') returning id into collection_shift;
 insert into public.shift_staff(shift_id,staff_id) values(first_shift,nurse_staff),(receipt_shift,nurse_staff),(collection_shift,nurse_staff);
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST correction drip v22',500,100,true) returning id into service;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST correction medicine v22','амп.',10,400,13700,0,0) returning id into med;
 insert into public.medication_batches(medication_id,quantity_received,quantity_remaining,work_quantity,purchase_price_per_unit,expiry_date,received_date)
  values(med,20,20,10,40,current_date+365,current_date);
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',10),(med,'work',10);
 update private.crm_finance_settings set payment_only=false where id;
 perform set_config('test.v22.owner',owner_user::text,true);perform set_config('test.v22.admin',admin_user::text,true);perform set_config('test.v22.nurse',nurse_user::text,true);
 perform set_config('test.v22.owner_staff',owner_staff::text,true);perform set_config('test.v22.admin_staff',admin_staff::text,true);perform set_config('test.v22.nurse_staff',nurse_staff::text,true);
 perform set_config('test.v22.patient',patient::text,true);perform set_config('test.v22.med',med::text,true);perform set_config('test.v22.service',service::text,true);
 perform set_config('test.v22.shift',first_shift::text,true);perform set_config('test.v22.receipt_shift',receipt_shift::text,true);perform set_config('test.v22.collection_shift',collection_shift::text,true);
end $$;

set local role authenticated;
do $$declare payload jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 payload:=jsonb_build_object('patient_id',current_setting('test.v22.patient'),'shift_id',current_setting('test.v22.shift'),
  'nurse_id',current_setting('test.v22.nurse_staff'),'service_id',current_setting('test.v22.service'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v22.med'),'quantity',1)),
  'charge_total',14300,'paid_total',14300,'payment_status','paid','expected_stock_deducted',true,
  'payments',jsonb_build_object('cash',10000,'terminal',3000,'owner_card',1300,'cash_received',10050),'notes','TEST original paid visit');
 a:=public.record_treatment_v5('procedure',payload,req);
 if (a->>'received_total')::numeric is distinct from 14300::numeric or (a->>'stock_deducted')::boolean is distinct from true then raise exception 'Fully paid stock fixture failed';end if;
 perform set_config('test.v22.procedure',a->>'id',true);perform set_config('test.v22.initial_request',req::text,true);
 req:=gen_random_uuid();payload:=payload||jsonb_build_object('paid_total',10000,'payment_status','debt','payments',jsonb_build_object('cash',10000));
 a:=public.record_treatment_v5('procedure',payload,req);
 perform set_config('test.v22.receipt_procedure',a->>'id',true);perform set_config('test.v22.receipt_initial_request',req::text,true);
 req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',a->>'id',
  'shift_id',current_setting('test.v22.receipt_shift'),'nurse_id',current_setting('test.v22.nurse_staff'),
  'payments',jsonb_build_object('cash',2300,'terminal',1000,'owner_card',1000,'cash_received',2500),'comment','TEST erroneous separate receipt'),req);
 if (a->>'received_total')::numeric is distinct from 14300::numeric or (a->>'version')::integer<>2 then raise exception 'Separate receipt fixture failed';end if;
 perform set_config('test.v22.old_receipt',req::text,true);
 perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.v22.shift'),'staff_id',current_setting('test.v22.nurse_staff'),'amount',2500,'reason','TEST captured wage first'));
 perform public.crm_finance_v5('salary',jsonb_build_object('shift_id',current_setting('test.v22.receipt_shift'),'staff_id',current_setting('test.v22.nurse_staff'),'amount',1700,'reason','TEST captured wage receipt'));
end $$;
reset role;
-- Fix timestamps only for the fictional records so date-period assertions are stable.
update public.procedures set visit_at=timestamptz '2096-09-01 10:00+03' where id=current_setting('test.v22.procedure')::uuid;
update public.procedures set visit_at=timestamptz '2096-09-01 11:00+03' where id=current_setting('test.v22.receipt_procedure')::uuid;
update private.crm_receipts_v10 set created_at=timestamptz '2096-09-02 10:00+03' where id=current_setting('test.v22.old_receipt')::uuid;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v22.shift')));
 if (a->'revenue'->>'total')::numeric is distinct from 24300::numeric then raise exception 'Original-shift money fixture failed';end if;
 a:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v22.receipt_shift')));
 if (a->'revenue'->>'total')::numeric is distinct from 4300::numeric then raise exception 'Receipt-shift money fixture failed';end if;
end $$;
reset role;
-- Current prices cannot replace the captured prices of the historical treatment.
update public.medications set sale_price=77777,purchase_price=9000 where id=current_setting('test.v22.med')::uuid;
update public.procedure_services set work_price=999 where id=current_setting('test.v22.service')::uuid;

create function pg_temp.v22_state() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'procedures',(select jsonb_agg(to_jsonb(p) order by p.id) from public.procedures p where p.id in(current_setting('test.v22.procedure')::uuid,current_setting('test.v22.receipt_procedure')::uuid)),
  'details',(select jsonb_agg(jsonb_build_object('procedure_id',i.procedure_id,'medication_id',i.medication_id,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total) order by i.procedure_id,i.medication_id) from public.procedure_medications i where i.procedure_id in(current_setting('test.v22.procedure')::uuid,current_setting('test.v22.receipt_procedure')::uuid)),
  'services',(select jsonb_agg(to_jsonb(i) order by i.procedure_id,i.position) from private.crm_treatment_services i where i.procedure_id in(current_setting('test.v22.procedure')::uuid,current_setting('test.v22.receipt_procedure')::uuid)),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where a.procedure_id in(current_setting('test.v22.procedure')::uuid,current_setting('test.v22.receipt_procedure')::uuid)),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.id) from private.crm_receipts_v10 r where r.procedure_id in(current_setting('test.v22.procedure')::uuid,current_setting('test.v22.receipt_procedure')::uuid)),
  'reports',(select jsonb_agg(to_jsonb(r) order by r.shift_id) from private.crm_shift_reports r where r.shift_id in(current_setting('test.v22.shift')::uuid,current_setting('test.v22.receipt_shift')::uuid)),
  'payroll',(select jsonb_agg(to_jsonb(w) order by w.shift_id,w.staff_id) from private.crm_shift_payroll w where w.shift_id in(current_setting('test.v22.shift')::uuid,current_setting('test.v22.receipt_shift')::uuid)),
  'stock',(select jsonb_agg(to_jsonb(s) order by s.location) from public.stock s where s.medication_id=current_setting('test.v22.med')::uuid),
  'batches',(select jsonb_agg(to_jsonb(b) order by b.id) from public.medication_batches b where b.medication_id=current_setting('test.v22.med')::uuid),
  'movements',(select jsonb_agg(to_jsonb(m) order by m.id) from public.stock_movements m where m.medication_id=current_setting('test.v22.med')::uuid),
  'audit_count',(select count(*) from private.crm_audit_log where entity_id in(current_setting('test.v22.procedure'),current_setting('test.v22.receipt_procedure'))));
$$;
do $$begin perform set_config('test.v22.before',pg_temp.v22_state()::text,true);end $$;

set local role authenticated;
do $$declare original jsonb;payload jsonb;bad jsonb;req uuid;failed_ids jsonb:='[]';label text;begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v22.procedure')));
 payload:=jsonb_build_object('kind','procedure','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',original->'version','expected_stock_deducted',true,'expected_received_total',14300,'confirm_no_money_received',true,
  'correction_reason','TEST mistaken paid selection, money was not received','services',original->'services','items',original->'items','own_medications',original->'own_medications',
  'charge_total',7500,'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0,'terminal',0,'owner_card',0,'cash_received',0),
  'discount_reason','Постоянный пациент','discount_comment','TEST owner approved discount','edit_reason','TEST restore debt and approved discount','notes',original->>'notes');
 perform set_config('test.v22.payload',payload::text,true);
 -- Every failed call must leave all money, stock, versions and reports unchanged.
 for label,bad in select * from(values
  ('stale version',payload||jsonb_build_object('expected_version',2)),
  ('wrong received total',payload||jsonb_build_object('expected_received_total',14000)),
  ('missing received CAS',payload-'expected_received_total'),
  ('missing confirmation',payload-'confirm_no_money_received'),
  ('false confirmation',payload||jsonb_build_object('confirm_no_money_received',false)),
  ('missing correction reason',payload-'correction_reason'),
  ('blank correction reason',payload||jsonb_build_object('correction_reason','   ')),
  ('new payment',payload||jsonb_build_object('payments',jsonb_build_object('cash',1),'paid_total',1)),
  ('invalid discount',payload-'discount_reason'-'discount_comment'),
  ('unknown drug',payload||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('medication_id',gen_random_uuid(),'quantity',1)))),
  ('overpriced bill',payload||jsonb_build_object('charge_total',14301)),
  ('zero debt',payload||jsonb_build_object('charge_total',0)),
  ('different patient',payload||jsonb_build_object('patient_id',gen_random_uuid())),
  ('different stock mode',payload||jsonb_build_object('expected_stock_deducted',false)),
  ('paid status',payload||jsonb_build_object('payment_status','paid'))
 ) v(label,bad) loop
  req:=gen_random_uuid();failed_ids:=failed_ids||to_jsonb(req::text);
  begin
   perform public.crm_payment_correction_v22(bad,req);
   raise exception 'Forbidden correction unexpectedly succeeded: %',label;
  exception when others then
   if sqlerrm like 'Forbidden correction unexpectedly succeeded:%' then raise;end if;
   if label in ('stale version','wrong received total') and sqlstate<>'40001' then raise;end if;
  end;
  if pg_temp.v22_state() is distinct from current_setting('test.v22.before')::jsonb then raise exception 'Failed validation changed financial or stock state: %',label;end if;
 end loop;
 perform set_config('test.v22.failed_ids',failed_ids::text,true);
 -- Ordinary editing must continue to reject reducing a genuine received payment.
 begin
  perform public.crm_clinical_v10('treatment_edit',payload,gen_random_uuid());
  raise exception 'Ordinary edit bypassed already received payment protection';
 exception when others then if sqlerrm='Ordinary edit bypassed already received payment protection' then raise;end if;end;
 if pg_temp.v22_state() is distinct from current_setting('test.v22.before')::jsonb then raise exception 'Ordinary edit modified state while rejected';end if;
end $$;
reset role;
do $$begin
 if exists(select 1 from private.warehouse_requests r where r.id in(select value::uuid from jsonb_array_elements_text(current_setting('test.v22.failed_ids')::jsonb))) then raise exception 'Failed correction left operation receipts';end if;
end $$;

set local role authenticated;
do $$declare payload jsonb:=current_setting('test.v22.payload')::jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 a:=public.crm_payment_correction_v22(payload,req);
 if (a->>'list_total')::numeric is distinct from 14300::numeric or (a->>'charge_total')::numeric is distinct from 7500::numeric
  or (a->>'discount_amount')::numeric is distinct from 6800::numeric or (a->>'initial_paid_total')::numeric is distinct from 0::numeric
  or (a->>'received_total')::numeric is distinct from 0::numeric or (a->>'debt_total')::numeric is distinct from 7500::numeric
  or (a->>'version')::integer is distinct from 2 or (a->>'stock_deducted')::boolean is distinct from true
  or (a->>'payment_pending')::boolean is distinct from false
  or (a->'payment_correction'->>'previous_received_total')::numeric is distinct from 14300::numeric
  or (a->'payment_correction'->>'new_received_total')::numeric is distinct from 0::numeric
  or a->'payment_correction'->>'reason' is distinct from payload->>'correction_reason' then raise exception 'Closed paid visit did not become correctly discounted debt';end if;
 if public.crm_payment_correction_v22(payload,req) is distinct from a then raise exception 'Correction replay differs';end if;
 perform set_config('test.v22.request',req::text,true);perform set_config('test.v22.result',a::text,true);
 begin
  perform public.crm_payment_correction_v22(payload||jsonb_build_object('notes','TEST changed retry'),req);
  raise exception 'Changed correction payload reused receipt';
 exception when others then if sqlerrm='Changed correction payload reused receipt' then raise;end if;end;
end $$;
reset role;
do $$declare before_state jsonb:=current_setting('test.v22.before')::jsonb;after_state jsonb:=pg_temp.v22_state();original_allocation jsonb;allocation jsonb;report_n jsonb;original_report jsonb;state_key text;begin
 select to_jsonb(a) into allocation from private.crm_payment_allocations a where a.id=current_setting('test.v22.initial_request')::uuid;
 select value into original_allocation from jsonb_array_elements(before_state->'allocations') where value->>'id'=allocation->>'id';
 if allocation-array['voided_at','voided_by','void_reason','void_request_id'] is distinct from original_allocation-array['voided_at','voided_by','void_reason','void_request_id']
  or allocation->>'voided_at' is null or allocation->>'voided_by' is distinct from current_setting('test.v22.owner')
  or allocation->>'void_request_id' is distinct from current_setting('test.v22.request')
  or allocation->>'void_reason' is distinct from (current_setting('test.v22.payload')::jsonb)->>'correction_reason' then raise exception 'Original payment numbers or void metadata were not preserved';end if;
 if (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v22.procedure'))<>1 then raise exception 'Payment correction audit missing or duplicated on replay';end if;
 if not exists(select 1 from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v22.procedure')
  and actor_user=current_setting('test.v22.owner')::uuid and actor_staff=current_setting('test.v22.owner_staff')::uuid
  and (before_data->'treatment'->>'received_total')::numeric=14300 and before_data->'allocation'=original_allocation
  and before_data->'receipts'='[]'::jsonb and (after_data->>'debt_total')::numeric=7500
  and reason=(current_setting('test.v22.payload')::jsonb)->>'correction_reason') then raise exception 'Payment correction audit lost original values or actor';end if;
 foreach state_key in array array['stock','batches','movements','payroll','details','services'] loop
  if after_state->state_key is distinct from before_state->state_key then raise exception 'Payment correction changed captured %',state_key;end if;
 end loop;
 select report into report_n from private.crm_shift_reports where shift_id=current_setting('test.v22.shift')::uuid;
 select value->'report' into original_report from jsonb_array_elements(before_state->'reports') where value->>'shift_id'=current_setting('test.v22.shift');
 if report_n->'stock' is distinct from original_report->'stock' or report_n->'used' is distinct from original_report->'used'
  or report_n->'untracked' is distinct from original_report->'untracked' or report_n->'warnings' is distinct from original_report->'warnings'
  or report_n->'staff' is distinct from original_report->'staff' or report_n->'payroll_total' is distinct from original_report->'payroll_total'
  or report_n->'float_amount' is distinct from original_report->'float_amount' then raise exception 'Closed warehouse or payroll snapshot was overwritten';end if;
 if (report_n->'revenue'->>'total')::numeric is distinct from 10000::numeric or (report_n->'revenue'->>'cash')::numeric is distinct from 10000::numeric
  or (report_n->'revenue'->>'terminal')::numeric is distinct from 0::numeric or (report_n->'revenue'->>'owner_card')::numeric is distinct from 0::numeric
  or (report_n->>'procedures_total')::numeric is distinct from 10000::numeric or (report_n->>'sales_total')::numeric is distinct from 0::numeric
  or (report_n->>'cash_total')::numeric is distinct from 10000::numeric or (report_n->>'cash_after_salary')::numeric is distinct from 7500::numeric then raise exception 'Closed initial-payment totals were not recalculated';end if;
end $$;

-- Administrators also correct erroneous later receipts, including their closed
-- collection shift. The initial allocation and all old numeric fields remain.
select set_config('request.jwt.claim.sub',current_setting('test.v22.admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v22.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare original jsonb;payload jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v22.receipt_procedure')));
 payload:=current_setting('test.v22.payload')::jsonb||jsonb_build_object('id',original->>'id','expected_version',2,'charge_total',9000,
  'correction_reason','TEST administrator correction of all mistaken receipts','edit_reason','TEST erroneous later payment correction');
 a:=public.crm_payment_correction_v22(payload,req);
 if (a->>'received_total')::numeric is distinct from 0::numeric or (a->>'debt_total')::numeric is distinct from 9000::numeric
  or (a->>'version')::integer is distinct from 3 then raise exception 'Administrator could not correct initial and subsequent payment';end if;
 if public.crm_payment_correction_v22(payload,req) is distinct from a then raise exception 'Administrator replay differs';end if;
 perform set_config('test.v22.admin_request',req::text,true);perform set_config('test.v22.admin_payload',payload::text,true);
end $$;
reset role;
do $$declare before_state jsonb:=current_setting('test.v22.before')::jsonb;receipt_n jsonb;original_receipt jsonb;report_n jsonb;original_report jsonb;begin
 select to_jsonb(r) into receipt_n from private.crm_receipts_v10 r where r.id=current_setting('test.v22.old_receipt')::uuid;
 select value into original_receipt from jsonb_array_elements(before_state->'receipts') where value->>'id'=receipt_n->>'id';
 if receipt_n-array['voided_at','voided_by','void_reason','void_request_id'] is distinct from original_receipt-array['voided_at','voided_by','void_reason','void_request_id']
  or receipt_n->>'voided_at' is null or receipt_n->>'voided_by' is distinct from current_setting('test.v22.admin')
  or receipt_n->>'void_request_id' is distinct from current_setting('test.v22.admin_request') then raise exception 'Subsequent payment numbers or void markers were altered incorrectly';end if;
 if (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v22.receipt_procedure'))<>1
  or not exists(select 1 from private.crm_audit_log where action='payment_corrected_v22' and entity_id=current_setting('test.v22.receipt_procedure')
   and before_data->'receipts'=jsonb_build_array(original_receipt) and (before_data->'treatment'->>'received_total')::numeric=14300) then raise exception 'Receipt correction lost before-history or repeated audit';end if;
 select report into report_n from private.crm_shift_reports where shift_id=current_setting('test.v22.receipt_shift')::uuid;
 select value->'report' into original_report from jsonb_array_elements(before_state->'reports') where value->>'shift_id'=current_setting('test.v22.receipt_shift');
 if (report_n->'revenue'->>'total')::numeric is distinct from 0::numeric or (report_n->>'cash_total')::numeric is distinct from 0::numeric
  or (report_n->>'debt_receipts_total')::numeric is distinct from 0::numeric or jsonb_array_length(report_n->'receipts')<>0
  or (report_n->>'cash_after_salary')::numeric is distinct from -1700::numeric then raise exception 'Closed receipt shift still counts the voided money';end if;
 if report_n->'stock' is distinct from original_report->'stock' or report_n->'staff' is distinct from original_report->'staff'
  or report_n->'payroll_total' is distinct from original_report->'payroll_total' then raise exception 'Receipt correction overwrote closed captured payroll or inventory';end if;
 select report into report_n from private.crm_shift_reports where shift_id=current_setting('test.v22.shift')::uuid;
 if (report_n->'revenue'->>'total')::numeric is distinct from 0::numeric or (report_n->>'procedures_total')::numeric is distinct from 0::numeric
  or (report_n->>'cash_total')::numeric is distinct from 0::numeric or (report_n->>'charge_total')::numeric is distinct from 16500::numeric
  or (report_n->>'debt_total')::numeric is distinct from 16500::numeric then raise exception 'Original shift does not reflect both corrected debts';end if;
end $$;

-- Permission checks occur before cached replay, not just before a fresh write.
select set_config('request.jwt.claim.sub',current_setting('test.v22.nurse'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v22.nurse'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin
 begin perform public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,current_setting('test.v22.request')::uuid);raise exception 'Nurse received cached correction';
 exception when insufficient_privilege then null;end;
 begin perform public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,gen_random_uuid());raise exception 'Nurse corrected payment';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$begin
 begin perform public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,current_setting('test.v22.request')::uuid);raise exception 'Anonymous replay succeeded';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.v22.owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v22.owner'),'role','authenticated')::text,true);
update public.staff set active=false where id=current_setting('test.v22.owner_staff')::uuid;
set local role authenticated;
do $$begin
 begin perform public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,current_setting('test.v22.request')::uuid);raise exception 'Inactive manager received cached correction';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.staff set active=true,role='nurse' where id=current_setting('test.v22.owner_staff')::uuid;
set local role authenticated;
do $$begin
 begin perform public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,current_setting('test.v22.request')::uuid);raise exception 'Demoted manager received cached correction';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.staff set role='owner' where id=current_setting('test.v22.owner_staff')::uuid;

-- A subsequent genuine payment is a new, non-void receipt in its actual shift.
set local role authenticated;
do $$declare p jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 if public.crm_payment_correction_v22(current_setting('test.v22.payload')::jsonb,current_setting('test.v22.request')::uuid) is distinct from current_setting('test.v22.result')::jsonb then raise exception 'Restored manager cannot replay original correction';end if;
 p:=jsonb_build_object('kind','procedure','id',current_setting('test.v22.procedure'),'shift_id',current_setting('test.v22.collection_shift'),
  'nurse_id',current_setting('test.v22.nurse_staff'),'payments',jsonb_build_object('cash',1000,'terminal',2500,'owner_card',500,'cash_received',1100),'comment','TEST actual collection after correction');
 a:=public.crm_clinical_v10('debt_payment',p,req);
 if (a->>'received_total')::numeric is distinct from 4000::numeric or (a->>'debt_total')::numeric is distinct from 3500::numeric
  or (a->>'initial_paid_total')::numeric is distinct from 0::numeric or (a->>'version')::integer is distinct from 3 then raise exception 'True later debt collection failed';end if;
 if public.crm_clinical_v10('debt_payment',p,req) is distinct from a then raise exception 'True collection replay differs';end if;
 perform set_config('test.v22.actual_receipt',req::text,true);
end $$;
reset role;
update private.crm_receipts_v10 set created_at=timestamptz '2096-09-03 10:00+03' where id=current_setting('test.v22.actual_receipt')::uuid;
do $$begin
 if not exists(select 1 from private.crm_receipts_v10 where id=current_setting('test.v22.actual_receipt')::uuid and voided_at is null
  and voided_by is null and void_reason is null and void_request_id is null and cash=1000 and terminal=2500 and owner_card=500 and change_amount=100) then raise exception 'New genuine payment inherited void metadata or changed amounts';end if;
 if has_function_privilege('anon','public.crm_payment_correction_v22(jsonb,uuid)','EXECUTE')
  or has_function_privilege('authenticated','private.crm_payment_correction_v22(jsonb,uuid)','EXECUTE') then raise exception 'Correction grants expose an internal or anonymous entrypoint';end if;
end $$;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-09-01','to','2096-09-01','group_by','day','patient_id',current_setting('test.v22.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 0::numeric or (a->>'charge_total')::numeric is distinct from 16500::numeric
  or (a->>'procedures_count')::integer is distinct from 2 or (a->>'debt_total')::numeric is distinct from 12500::numeric then raise exception 'Original date period still counts voided allocations';end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-09-02','to','2096-09-02','group_by','day','patient_id',current_setting('test.v22.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 0::numeric or (a->>'debt_payments_count')::integer is distinct from 0 then raise exception 'Voided later receipts remain in their financial period';end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-09-03','to','2096-09-03','group_by','day','patient_id',current_setting('test.v22.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 4000::numeric or (a->'revenue'->>'cash')::numeric is distinct from 1000::numeric
  or (a->'revenue'->>'terminal')::numeric is distinct from 2500::numeric or (a->'revenue'->>'owner_card')::numeric is distinct from 500::numeric
  or (a->>'debt_payments_count')::integer is distinct from 1 or (a->>'procedures_count')::integer is distinct from 0 then raise exception 'Actual repayment lost its date or payment method';end if;
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v22.collection_shift')));
 if (a->'revenue'->>'total')::numeric is distinct from 4000::numeric or (a->>'cash_total')::numeric is distinct from 4000::numeric
  or jsonb_array_length(a->'receipts')<>1 then raise exception 'Actual collection shift counts voids or misses genuine payment';end if;
end $$;
reset role;
do $$declare before_state jsonb:=current_setting('test.v22.before')::jsonb;after_state jsonb:=pg_temp.v22_state();begin
 if after_state->'stock' is distinct from before_state->'stock' or after_state->'batches' is distinct from before_state->'batches'
  or after_state->'movements' is distinct from before_state->'movements' or after_state->'payroll' is distinct from before_state->'payroll' then raise exception 'Correction or subsequent collection changed inventory or wages';end if;
 if (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_id in(current_setting('test.v22.procedure'),current_setting('test.v22.receipt_procedure')))<>2 then raise exception 'Permission/replay/collection repeated corrections';end if;
 perform private.assert_stock_v3(current_setting('test.v22.med')::uuid);
end $$;

-- The same endpoint is used for a previous drug sale. Exercise its separate
-- table/details path, retained prices and a historically archived patient.
do $$declare med uuid;shift_id uuid;begin
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST correction sale medicine v22','фл.',5,100,900,0,0) returning id into med;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-09-04',timestamptz '2096-09-04 08:30+03',timestamptz '2096-09-04 16:00+03','open') returning id into shift_id;
 insert into public.shift_staff(shift_id,staff_id) values(shift_id,current_setting('test.v22.nurse_staff')::uuid);
 update private.crm_finance_settings set payment_only=true where id;
 perform set_config('test.v22.sale_med',med::text,true);perform set_config('test.v22.sale_shift',shift_id::text,true);
end $$;
set local role authenticated;
do $$declare a jsonb;req uuid:=gen_random_uuid();begin
 a:=public.record_treatment_v5('sale',jsonb_build_object('patient_id',current_setting('test.v22.patient'),'shift_id',current_setting('test.v22.sale_shift'),
  'nurse_id',current_setting('test.v22.nurse_staff'),'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v22.sale_med'),'quantity',1)),
  'charge_total',900,'paid_total',900,'payment_status','paid','expected_stock_deducted',false,'payments',jsonb_build_object('cash',300,'terminal',600)),req);
 perform set_config('test.v22.sale',a->>'id',true);perform set_config('test.v22.sale_allocation',req::text,true);
end $$;
reset role;
update public.sales set sold_at=timestamptz '2096-09-04 10:00+03' where id=current_setting('test.v22.sale')::uuid;
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v22.sale_shift')));
 if (a->>'sales_total')::numeric is distinct from 900::numeric or (a->'revenue'->>'total')::numeric is distinct from 900::numeric then raise exception 'Paid sale closed report fixture failed';end if;
 perform set_config('test.v22.sale_report',a::text,true);
end $$;
reset role;
do $$begin
 perform set_config('test.v22.sale_original_allocation',(select to_jsonb(a)::text from private.crm_payment_allocations a where id=current_setting('test.v22.sale_allocation')::uuid),true);
end $$;
update public.medications set sale_price=9900 where id=current_setting('test.v22.sale_med')::uuid;
update public.patients set archived=true where id=current_setting('test.v22.patient')::uuid;
set local role authenticated;
do $$declare original jsonb;payload jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 original:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','sale','id',current_setting('test.v22.sale')));
 payload:=jsonb_build_object('kind','sale','id',original->>'id','patient_id',original->>'patient_id','shift_id',original->>'shift_id','nurse_id',original->>'nurse_id',
  'expected_version',1,'expected_stock_deducted',false,'expected_received_total',900,'confirm_no_money_received',true,'correction_reason','TEST sale payment entered mistakenly',
  'items',original->'items','charge_total',400,'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0),
  'discount_reason','Постоянный пациент','discount_comment','TEST approved sale discount','edit_reason','TEST return sale to debt');
 a:=public.crm_payment_correction_v22(payload,req);
 if (a->>'list_total')::numeric is distinct from 900::numeric or (a->>'charge_total')::numeric is distinct from 400::numeric
  or (a->>'discount_amount')::numeric is distinct from 500::numeric or (a->>'received_total')::numeric is distinct from 0::numeric
  or (a->>'debt_total')::numeric is distinct from 400::numeric or (a->>'version')::integer is distinct from 2
  or (a->>'stock_deducted')::boolean is distinct from false or (a->'items'->0->>'unit_price')::numeric is distinct from 900::numeric then raise exception 'Sale correction changed captured price or did not create correct debt';end if;
 if public.crm_payment_correction_v22(payload,req) is distinct from a then raise exception 'Sale correction replay differs';end if;
 perform set_config('test.v22.sale_request',req::text,true);
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v22.sale_shift')));
 if (a->>'sales_total')::numeric is distinct from 0::numeric or (a->>'cash_total')::numeric is distinct from 0::numeric
  or (a->'revenue'->>'cash')::numeric is distinct from 0::numeric or (a->'revenue'->>'terminal')::numeric is distinct from 0::numeric
  or (a->>'charge_total')::numeric is distinct from 400::numeric or (a->>'debt_total')::numeric is distinct from 400::numeric
  or a->'stock' is distinct from (current_setting('test.v22.sale_report')::jsonb)->'stock'
  or a->'staff' is distinct from (current_setting('test.v22.sale_report')::jsonb)->'staff' then raise exception 'Sale correction left money or overwrote the captured closed report';end if;
end $$;
reset role;
do $$declare allocation jsonb;begin
 select to_jsonb(a) into allocation from private.crm_payment_allocations a where id=current_setting('test.v22.sale_allocation')::uuid;
 if allocation-array['voided_at','voided_by','void_reason','void_request_id'] is distinct from current_setting('test.v22.sale_original_allocation')::jsonb-array['voided_at','voided_by','void_reason','void_request_id']
  or allocation->>'voided_at' is null or allocation->>'void_request_id' is distinct from current_setting('test.v22.sale_request') then raise exception 'Sale allocation history was changed instead of marked void';end if;
 if (select count(*) from private.crm_audit_log where action='payment_corrected_v22' and entity_type='sale' and entity_id=current_setting('test.v22.sale'))<>1 then raise exception 'Sale correction audit missing or repeated';end if;
 if exists(select 1 from public.stock where medication_id=current_setting('test.v22.sale_med')::uuid)
  or exists(select 1 from public.medication_batches where medication_id=current_setting('test.v22.sale_med')::uuid)
  or exists(select 1 from public.stock_movements where medication_id=current_setting('test.v22.sale_med')::uuid) then raise exception 'Payment-only sale correction fabricated warehouse changes';end if;
end $$;
do $$declare shift_id uuid;begin
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2096-09-05',timestamptz '2096-09-05 08:30+03',timestamptz '2096-09-05 16:00+03','open') returning id into shift_id;
 insert into public.shift_staff(shift_id,staff_id) values(shift_id,current_setting('test.v22.nurse_staff')::uuid);
 perform set_config('test.v22.sale_collection_shift',shift_id::text,true);
end $$;
set local role authenticated;
do $$declare payload jsonb;a jsonb;req uuid:=gen_random_uuid();begin
 payload:=jsonb_build_object('kind','sale','id',current_setting('test.v22.sale'),'shift_id',current_setting('test.v22.sale_collection_shift'),
  'nurse_id',current_setting('test.v22.nurse_staff'),'payments',jsonb_build_object('terminal',200),'comment','TEST actual sale debt collection');
 a:=public.crm_clinical_v10('debt_payment',payload,req);
 if (a->>'initial_paid_total')::numeric is distinct from 0::numeric or (a->>'received_total')::numeric is distinct from 200::numeric
  or (a->>'debt_total')::numeric is distinct from 200::numeric or (a->>'version')::integer is distinct from 3 then raise exception 'Corrected sale cannot receive genuine later debt payment';end if;
 if public.crm_clinical_v10('debt_payment',payload,req) is distinct from a then raise exception 'Genuine sale repayment repeated receipt';end if;
 perform set_config('test.v22.sale_real_receipt',req::text,true);
end $$;
reset role;
update private.crm_receipts_v10 set created_at=timestamptz '2096-09-05 10:00+03' where id=current_setting('test.v22.sale_real_receipt')::uuid;
do $$begin
 if not exists(select 1 from private.crm_receipts_v10 where id=current_setting('test.v22.sale_real_receipt')::uuid and sale_id=current_setting('test.v22.sale')::uuid
  and terminal=200 and voided_at is null and voided_by is null and void_reason is null and void_request_id is null) then raise exception 'True sale repayment inherited void metadata';end if;
end $$;
set local role authenticated;
do $$declare a jsonb;payload jsonb;id_n uuid;req uuid:=gen_random_uuid();begin
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v22.sale_collection_shift')));
 if (a->'revenue'->>'total')::numeric is distinct from 200::numeric or (a->>'cash_total')::numeric is distinct from 200::numeric
  or (a->'revenue'->>'terminal')::numeric is distinct from 200::numeric or jsonb_array_length(a->'receipts')<>1 then raise exception 'Sale repayment absent from actual collection shift';end if;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2096-09-05','to','2096-09-05','patient_id',current_setting('test.v22.patient')));
 if (a->'revenue'->>'total')::numeric is distinct from 200::numeric or (a->>'sales_count')::integer is distinct from 0
  or (a->>'debt_payments_count')::integer is distinct from 1 then raise exception 'Sale repayment lost actual financial period';end if;
 -- A sale with no identified patient cannot become a debt even for a manager.
 a:=public.record_treatment_v5('sale',jsonb_build_object('shift_id',current_setting('test.v22.sale_collection_shift'),'nurse_id',current_setting('test.v22.nurse_staff'),
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v22.sale_med'),'quantity',1)),
  'charge_total',9900,'paid_total',9900,'payment_status','paid','expected_stock_deducted',false,'payments',jsonb_build_object('cash',9900)),req);
 id_n:=(a->>'id')::uuid;perform set_config('test.v22.anonymous_sale',id_n::text,true);perform set_config('test.v22.anonymous_sale_request',req::text,true);
 payload:=jsonb_build_object('kind','sale','id',id_n,'expected_version',1,'expected_stock_deducted',false,'expected_received_total',9900,
  'confirm_no_money_received',true,'correction_reason','TEST patient-less sale should stay paid','items',a->'items','charge_total',9900,
  'paid_total',0,'payment_status','debt','payments',jsonb_build_object('cash',0),'edit_reason','TEST invalid patient-less debt');
 begin perform public.crm_payment_correction_v22(payload,gen_random_uuid());raise exception 'Patient-less sale was converted to debt';
 exception when sqlstate '22023' then null;end;
end $$;
reset role;
do $$begin
 if (select paid_total from public.sales where id=current_setting('test.v22.anonymous_sale')::uuid) is distinct from 9900::numeric
  or (select version from public.sales where id=current_setting('test.v22.anonymous_sale')::uuid) is distinct from 1
  or (select voided_at from private.crm_payment_allocations where id=current_setting('test.v22.anonymous_sale_request')::uuid) is not null then raise exception 'Rejected patient-less correction changed money or version';end if;
end $$;
select 'crm-payment-correction-v22 synthetic debt conversion, preserved history, exact replay, permissions, closed reports and repayment passed' as result;
rollback;
