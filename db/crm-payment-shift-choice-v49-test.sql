-- v49 acceptance through the released public RPCs. Synthetic identities only;
-- all settings, patients, shifts, procedures, receipts and cash counts roll back.
-- Two deliberately overdue OPEN shifts prove that planned_end_at is not a
-- cash-ownership cutoff. The selected shift, not the clock or global UI state,
-- owns an ordinary waiting payment; genuine loan repayments stay separate.
begin;
set local statement_timeout='90s';
create function pg_temp.v49_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v49 acceptance: %',why;end if;end $$;
create function pg_temp.v49_actor(key_n text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v49.'||key_n),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v49.'||key_n),'role','authenticated')::text,true);
end $$;
do $$declare admin_u uuid:=gen_random_uuid();am_u uuid:=gen_random_uuid();pm_u uuid:=gen_random_uuid();
 am_n uuid;pm_n uuid;sh_am uuid;sh_pm uuid;sh_closed uuid;pt uuid;sv uuid;m uuid;
begin
 insert into auth.users(id,email) values(admin_u,admin_u::text||'@v49.example.invalid'),
  (am_u,am_u::text||'@v49.example.invalid'),(pm_u,pm_u::text||'@v49.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST shift-choice admin v49','admin',true,admin_u);
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST shift-choice AM nurse v49','nurse',true,am_u) returning id into am_n;
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST shift-choice PM nurse v49','nurse',true,pm_u) returning id into pm_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2001-01-18',timestamptz '2001-01-18 08:30+03',timestamptz '2001-01-18 16:00+03','open') returning id into sh_am;
 insert into public.shifts(shift_date,started_at,planned_end_at,status) values(date '2001-01-18',timestamptz '2001-01-18 16:00+03',timestamptz '2001-01-18 23:30+03','open') returning id into sh_pm;
 insert into public.shifts(shift_date,started_at,planned_end_at,status,ended_at) values(date '2001-01-19',timestamptz '2001-01-19 08:30+03',timestamptz '2001-01-19 16:00+03','closed',timestamptz '2001-01-19 16:00+03') returning id into sh_closed;
 insert into public.shift_staff(shift_id,staff_id) values(sh_am,am_n),(sh_pm,pm_n);
 insert into public.patients(full_name) values('TEST receiving-shift patient v49') returning id into pt;
 insert into public.procedure_services(name,work_price,consumables_price,active) values('TEST receiving-shift service v49',1000,0,true) returning id into sv;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST receiving-shift medicine v49','амп.',5,0,1000,0,0) returning id into m;
 insert into public.stock(medication_id,location,quantity) values(m,'reserve',0),(m,'work',0);
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v49.admin',admin_u::text,true);perform set_config('test.v49.am_user',am_u::text,true);perform set_config('test.v49.pm_user',pm_u::text,true);
 perform set_config('test.v49.am_nurse',am_n::text,true);perform set_config('test.v49.pm_nurse',pm_n::text,true);
 perform set_config('test.v49.am_shift',sh_am::text,true);perform set_config('test.v49.pm_shift',sh_pm::text,true);perform set_config('test.v49.closed_shift',sh_closed::text,true);
 perform set_config('test.v49.patient',pt::text,true);perform set_config('test.v49.service',sv::text,true);perform set_config('test.v49.med',m::text,true);
 perform pg_temp.v49_assert((select planned_end_at<now() from public.shifts where id=sh_am),'Fixture must be past its planned end');
 perform pg_temp.v49_actor('admin');
end $$;
create function pg_temp.v49_create(kind_n text,status_n text,pay_n jsonb default '{}') returns jsonb language sql as $$
 select public.record_treatment_v5(kind_n,jsonb_build_object('patient_id',current_setting('test.v49.patient'),
  'shift_id',current_setting('test.v49.am_shift'),'nurse_id',current_setting('test.v49.am_nurse'),
  'service_id',case when kind_n='procedure' then current_setting('test.v49.service') else null end,
  'items',case when kind_n='sale' then jsonb_build_array(jsonb_build_object('medication_id',current_setting('test.v49.med'),'quantity',1)) else '[]'::jsonb end,
  'charge_total',1000,'payment_status',status_n,'expected_stock_deducted',false,'payments',pay_n),gen_random_uuid())
$$;
create function pg_temp.v49_payment(key_n text,shift_n text,nurse_n text,pay_n jsonb,kind_n text default 'procedure') returns jsonb language sql as $$
 select jsonb_build_object('kind',kind_n,'id',current_setting('test.v49.'||key_n),
  'shift_id',current_setting('test.v49.'||shift_n),'nurse_id',current_setting('test.v49.'||nurse_n),
  'payments',pay_n,'comment','TEST explicit receiving shift v49')
$$;
set local role authenticated;
do $$declare a jsonb;b jsonb;p jsonb;req uuid;failed_n boolean;message_n text;
begin
 a:=public.quick_ui_v4('context');
 perform pg_temp.v49_assert(exists(select 1 from jsonb_array_elements(a->'shifts') s where s->>'id'=current_setting('test.v49.am_shift'))
  and exists(select 1 from jsonb_array_elements(a->'shifts') s where s->>'id'=current_setting('test.v49.pm_shift'))
  and not exists(select 1 from jsonb_array_elements(a->'shifts') s where s->>'id'=current_setting('test.v49.closed_shift')),'Manager choices must include both open shifts, even after their planned ends');
 a:=pg_temp.v49_create('procedure','pending');perform set_config('test.v49.waiting',a->>'id',true);
 a:=pg_temp.v49_create('procedure','pending');perform set_config('test.v49.later',a->>'id',true);
 a:=pg_temp.v49_create('sale','pending');perform set_config('test.v49.sale',a->>'id',true);
 a:=pg_temp.v49_create('procedure','paid','{"terminal":1000}');perform set_config('test.v49.edit',a->>'id',true);
 a:=pg_temp.v49_create('procedure','debt');perform set_config('test.v49.loan',a->>'id',true);
 -- Backward-compatible same-source receipt: no new flag required.
 p:=pg_temp.v49_payment('waiting','am_shift','am_nurse','{"cash":300,"cash_received":500}');req:=gen_random_uuid();
 a:=public.crm_clinical_v10('debt_payment',p,req);b:=public.crm_clinical_v10('debt_payment',p,req);
 perform pg_temp.v49_assert(a=b and(a->>'debt_total')::numeric=700 and(a->>'payment_pending')::boolean,'Overdue but open original shift must receive and replay normally');
 perform set_config('test.v49.first_request',req::text,true);perform set_config('test.v49.first_payload',p::text,true);perform set_config('test.v49.first_answer',a::text,true);
 -- A stale browser's global PM shift must not silently take AM's cash.
 p:=pg_temp.v49_payment('waiting','pm_shift','pm_nurse','{"terminal":100}');req:=gen_random_uuid();failed_n:=false;
 begin perform public.crm_clinical_v10('debt_payment',p,req);
 exception when raise_exception then message_n:=sqlerrm;failed_n:=position('Исходная смена ещё открыта' in message_n)>0;end;
 perform pg_temp.v49_assert(failed_n,'Unconfirmed different-shift receipt must be rejected');
 perform set_config('test.v49.rejected_request',req::text,true);
 p:=p||'{"payment_shift_explicit":true}';req:=gen_random_uuid();a:=public.crm_clinical_v10('debt_payment',p,req);
 perform pg_temp.v49_assert(a=public.crm_clinical_v10('debt_payment',p,req) and(a->>'debt_total')::numeric=600,'Explicit other open shift must receive exactly once');
 perform set_config('test.v49.explicit_request',req::text,true);
 -- Neither a previous request's true context nor changing a completed
 -- request's flag may authorize an otherwise unconfirmed transfer.
 failed_n:=false;begin perform public.crm_clinical_v10('debt_payment',p-'payment_shift_explicit',gen_random_uuid());
 exception when raise_exception then failed_n:=position('Исходная смена ещё открыта' in sqlerrm)>0;end;
 perform pg_temp.v49_assert(failed_n,'Explicit intent leaked from a previous request');
 failed_n:=false;begin perform public.crm_clinical_v10('debt_payment',p||'{"payment_shift_explicit":false}',req);
 exception when raise_exception then failed_n:=sqlerrm='Номер операции уже использован';end;
 perform pg_temp.v49_assert(failed_n,'Replay accepted a changed receiving-shift intent');
 p:=pg_temp.v49_payment('sale','am_shift','am_nurse','{"other_card":250}','sale');
 a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 perform pg_temp.v49_assert((a->>'debt_total')::numeric=750,'Sale payment must use original open shift too');
 -- Editing a settled visit to add another service creates an ordinary receipt.
 a:=public.crm_clinical_v10('treatment_get',jsonb_build_object('kind','procedure','id',current_setting('test.v49.edit')));
 p:=jsonb_build_object('kind','procedure','id',a->>'id','expected_version',a->'version','expected_stock_deducted',false,
  'services',jsonb_build_array(jsonb_build_object('service_id',current_setting('test.v49.service'),'quantity',2)),
  'items','[]'::jsonb,'own_medications','[]'::jsonb,'charge_total',2000,'payment_status','pending',
  'edit_reason','TEST added service v49','payments',jsonb_build_object('owner_card',500),
  'payment_shift_id',current_setting('test.v49.pm_shift'),'payment_nurse_id',current_setting('test.v49.pm_nurse'));
 failed_n:=false;begin perform public.crm_clinical_v10('treatment_edit',p,gen_random_uuid());
 exception when raise_exception then failed_n:=position('Исходная смена ещё открыта' in sqlerrm)>0;end;
 perform pg_temp.v49_assert(failed_n,'Positive edit may not inherit a hidden global receiving shift');
 a:=public.crm_clinical_v10('treatment_edit',p||'{"payment_shift_explicit":true}',gen_random_uuid());
 perform pg_temp.v49_assert((a->>'debt_total')::numeric=500 and(a->>'payment_pending')::boolean,'Explicit positive-edit receiving shift was lost');
 -- A true loan repayment retains only amount, date and purpose, outside cash.
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','procedure','id',current_setting('test.v49.loan'),
  'amount',100,'paid_on','2001-01-18','purpose','TEST separate genuine debt v49'),gen_random_uuid());
end $$;
reset role;
do $$declare a jsonb;b jsonb;begin
 perform pg_temp.v49_assert(not exists(select 1 from private.crm_receipts_v10 where id=current_setting('test.v49.rejected_request')::uuid)
  and not exists(select 1 from private.warehouse_requests where id=current_setting('test.v49.rejected_request')::uuid),'Rejected receiving shift left a financial or request row');
 a:=private.crm_build_shift_report_v5(current_setting('test.v49.am_shift')::uuid);b:=private.crm_build_shift_report_v5(current_setting('test.v49.pm_shift')::uuid);
 perform pg_temp.v49_assert((a->'revenue'->>'cash')::numeric=300 and(a->'revenue'->>'terminal')::numeric=1000
  and(a->'revenue'->>'other_card')::numeric=250 and(a->'revenue'->>'total')::numeric=1550,'Original report must own only explicitly attached receipts');
 perform pg_temp.v49_assert((b->'revenue'->>'cash')::numeric=0 and(b->'revenue'->>'terminal')::numeric=100
  and(b->'revenue'->>'owner_card')::numeric=500 and(b->'revenue'->>'total')::numeric=600,'Other shift report lost its explicit receipts');
 perform pg_temp.v49_assert((private.crm_cash_drawer_facts_v30(current_setting('test.v49.am_shift')::uuid)->>'received_cash')::numeric=300
  and(private.crm_cash_drawer_facts_v30(current_setting('test.v49.pm_shift')::uuid)->>'received_cash')::numeric=0,'Cash counted noncash, separate debt, or a receipt twice');
end $$;
-- Nurse A sees only her open shift and cannot route money into nurse B's shift.
select pg_temp.v49_actor('am_user');
set local role authenticated;
do $$declare a jsonb;p jsonb;failed_n boolean:=false;begin
 a:=public.quick_ui_v4('context');
 perform pg_temp.v49_assert(exists(select 1 from jsonb_array_elements(a->'shifts') s where s->>'id'=current_setting('test.v49.am_shift'))
  and not exists(select 1 from jsonb_array_elements(a->'shifts') s where s->>'id'=current_setting('test.v49.pm_shift')),'Nurse context exposed another receiving shift');
 p:=pg_temp.v49_payment('waiting','pm_shift','pm_nurse','{"terminal":100}')||'{"payment_shift_explicit":true}';
 begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 exception when raise_exception then failed_n:=sqlerrm='Нет доступа к смене оплаты';end;
 perform pg_temp.v49_assert(failed_n,'Explicit flag bypassed nurse shift authorization');
end $$;
reset role;
select pg_temp.v49_actor('admin');
set local role authenticated;
do $$declare a jsonb;p jsonb;failed_n boolean;begin
 -- Simulate a shift being closed after it was offered in a payment dialog.
 a:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v49.am_shift')));
 perform public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v49.am_shift'),
  'expected_token',a->'reconciliation_v37'->>'token','counted_cash',300,'salary_confirmed',false,'opening_amount',0,'reason','TEST close without salary payout v49'),gen_random_uuid());
 perform public.crm_finance_v5('close',jsonb_build_object('shift_id',current_setting('test.v49.am_shift')));
 -- The exact successful request remains a replay after closure and later edits.
 a:=public.crm_clinical_v10('debt_payment',current_setting('test.v49.first_payload')::jsonb,current_setting('test.v49.first_request')::uuid);
 perform pg_temp.v49_assert(a=current_setting('test.v49.first_answer')::jsonb,'Shift closure changed successful-request replay');
 p:=pg_temp.v49_payment('later','am_shift','am_nurse','{"terminal":400}');failed_n:=false;
 begin perform public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 exception when raise_exception then failed_n:=sqlerrm='Для приёма оплаты выберите открытую смену';end;
 perform pg_temp.v49_assert(failed_n,'A closed receiving shift accepted a stale dialog save');
 -- Existing clients can still settle a closed original visit into a real open shift.
 p:=pg_temp.v49_payment('later','pm_shift','pm_nurse','{"terminal":400}');
 a:=public.crm_clinical_v10('debt_payment',p,gen_random_uuid());
 perform pg_temp.v49_assert((a->>'debt_total')::numeric=600,'Closed-source waiting payment lost its open receiving shift');
 failed_n:=false;begin perform public.crm_clinical_v10('debt_payment',p||'{"payment_shift_explicit":"true"}',gen_random_uuid());
 exception when raise_exception then failed_n:=sqlerrm='Выберите смену оплаты заново';end;
 perform pg_temp.v49_assert(failed_n,'Explicit receiving-shift intent must be a JSON boolean');
end $$;
reset role;
do $$declare a jsonb;b jsonb;begin
 perform pg_temp.v49_assert((select count(*) from private.crm_receipts_v10 where id=current_setting('test.v49.first_request')::uuid)=1
  and(select count(*) from private.crm_receipts_v10 where id=current_setting('test.v49.explicit_request')::uuid)=1,'Replay duplicated a receipt');
 a:=private.crm_build_shift_report_v5(current_setting('test.v49.am_shift')::uuid);b:=private.crm_build_shift_report_v5(current_setting('test.v49.pm_shift')::uuid);
 perform pg_temp.v49_assert((a->'revenue'->>'total')::numeric=1550 and(b->'revenue'->>'total')::numeric=1000,'Closed-source receipt moved historical shift collections');
 perform pg_temp.v49_assert((select count(*) from private.crm_receipts_v10 where procedure_id=current_setting('test.v49.loan')::uuid and is_debt_repayment and shift_id is null)=1,'True-debt repayment became a receiving-shift receipt');
 perform pg_temp.v49_assert(not exists(select 1 from public.stock_movements where medication_id=current_setting('test.v49.med')::uuid),'Financial selection touched stock');
end $$;
rollback;
