-- Financial separation acceptance. All people/medications are fictional and
-- all fixture mutations, roles, initial cash and reconciliations roll back.
begin;
set local statement_timeout='90s';
create function pg_temp.v53_assert(ok boolean,why text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'v53 separate sales: %',why;end if;end $$;
create function pg_temp.v53_actor(who text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',current_setting('test.v53.'||who),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v53.'||who),'role','authenticated')::text,true);
end $$;
do $$declare adm uuid:=gen_random_uuid();own uuid:=gen_random_uuid();nur uuid:=gen_random_uuid();ina uuid:=gen_random_uuid();
 nurse_n uuid;shift_n uuid;later_n uuid;patient_n uuid;service_n uuid;med_n uuid;amino_n uuid;
begin
 insert into auth.users(id,email) values(adm,adm::text||'@separate-v53.example.invalid'),(own,own::text||'@separate-v53.example.invalid'),
  (nur,nur::text||'@separate-v53.example.invalid'),(ina,ina::text||'@separate-v53.example.invalid');
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST sales separation admin v53','admin',true,adm),
  ('TEST sales separation owner v53','owner',true,own),('TEST inactive manager v53','admin',false,ina);
 insert into public.staff(full_name,role,active,auth_user_id) values('TEST sales separation nurse v53','nurse',true,nur) returning id into nurse_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2003-07-11',timestamptz '2003-07-11 08:30+03',timestamptz '2003-07-11 16:00+03','open') returning id into shift_n;
 insert into public.shifts(shift_date,started_at,planned_end_at,status)
  values(date '2003-07-12',timestamptz '2003-07-12 08:30+03',timestamptz '2003-07-12 16:00+03','open') returning id into later_n;
 insert into public.shift_staff(shift_id,staff_id) values(shift_n,nurse_n),(later_n,nurse_n);
 insert into public.patients(full_name) values('TEST procedure patient v53') returning id into patient_n;
 insert into public.procedure_services(name,work_price,consumables_price,active)
  values('TEST drip service v53',500,100,true) returning id into service_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST medicine inside procedure v53','амп.',5,0,100,0,0) returning id into med_n;
 insert into public.medications(name,consumption_unit,units_per_package,purchase_price,sale_price,min_total_stock,work_threshold)
  values('TEST amino separate sale v53','фл.',1,0,9500,0,0) returning id into amino_n;
 update private.crm_finance_settings set payment_only=true,partial_stock=false where id;
 perform set_config('test.v53.admin',adm::text,true);perform set_config('test.v53.owner',own::text,true);
 perform set_config('test.v53.nurse',nur::text,true);perform set_config('test.v53.inactive',ina::text,true);
 perform set_config('test.v53.nurse_id',nurse_n::text,true);perform set_config('test.v53.shift',shift_n::text,true);
 perform set_config('test.v53.later_shift',later_n::text,true);perform set_config('test.v53.patient',patient_n::text,true);
 perform set_config('test.v53.service',service_n::text,true);perform set_config('test.v53.med',med_n::text,true);
 perform set_config('test.v53.amino',amino_n::text,true);perform pg_temp.v53_actor('admin');
end $$;
create function pg_temp.v53_create(kind_n text,pay jsonb,status_n text default 'paid',charge_n numeric default null) returns jsonb language sql as $$
 select public.record_treatment_v5(kind_n,jsonb_build_object('shift_id',current_setting('test.v53.shift'),
  'nurse_id',current_setting('test.v53.nurse_id'),'patient_id',case when kind_n='procedure' then current_setting('test.v53.patient') end,
  'service_id',case when kind_n='procedure' then current_setting('test.v53.service') end,
  'items',jsonb_build_array(jsonb_build_object('medication_id',current_setting(case when kind_n='procedure' then 'test.v53.med' else 'test.v53.amino' end),'quantity',1)),
  'charge_total',coalesce(charge_n,case when kind_n='procedure' then 700 else 9500 end),'payment_status',status_n,
  'payments',pay,'discount_reason','Скидка от владельца','discount_comment','TEST agreed discount v53',
  'expected_stock_deducted',false,'expected_partial_stock',false),gen_random_uuid())
$$;
set local role authenticated;
do $$declare a jsonb;begin
 a:=pg_temp.v53_create('procedure','{"cash":300,"terminal":100,"owner_card":200,"other_card":100}');
 perform set_config('test.v53.procedure',a->>'id',true);
 a:=pg_temp.v53_create('sale','{"cash":7000}','paid',7000);perform set_config('test.v53.cash_sale',a->>'id',true);
 a:=pg_temp.v53_create('sale','{"cash":1000,"terminal":2500,"owner_card":3000,"other_card":3000}');
 perform set_config('test.v53.mixed_sale',a->>'id',true);
 a:=pg_temp.v53_create('sale','{}','pending');perform set_config('test.v53.pending_sale',a->>'id',true);
 a:=pg_temp.v53_create('sale','{}','debt');perform set_config('test.v53.debt_sale',a->>'id',true);
end $$;
reset role;
-- Initial visit/collection happened on the fixture day; later receipts remain
-- at their real creation date so the date-vs-receiving-shift test is meaningful.
update public.procedures set visit_at=timestamptz '2003-07-11 10:00+03',created_at=timestamptz '2003-07-11 10:00+03',arrival_at=timestamptz '2003-07-11 10:00+03'
 where id=current_setting('test.v53.procedure')::uuid;
update public.sales set sold_at=timestamptz '2003-07-11 11:00+03',created_at=timestamptz '2003-07-11 11:00+03',arrival_at=timestamptz '2003-07-11 11:00+03'
 where shift_id=current_setting('test.v53.shift')::uuid;
update private.crm_payment_allocations set created_at=timestamptz '2003-07-11 11:00+03'
 where sale_id in(current_setting('test.v53.cash_sale')::uuid,current_setting('test.v53.mixed_sale')::uuid,current_setting('test.v53.pending_sale')::uuid,current_setting('test.v53.debt_sale')::uuid)
 or procedure_id=current_setting('test.v53.procedure')::uuid;
select set_config('test.v53.money_before',jsonb_build_object(
 'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from private.crm_payment_allocations a where sale_id in(current_setting('test.v53.cash_sale')::uuid,current_setting('test.v53.mixed_sale')::uuid)),
 'procedure',(select to_jsonb(p) from public.procedures p where id=current_setting('test.v53.procedure')::uuid))::text,true);

set local role authenticated;
do $$declare a jsonb;b jsonb;cash_n jsonb;begin
 a:=public.crm_finance_v5('shift_report',jsonb_build_object('shift_id',current_setting('test.v53.shift')));
 perform pg_temp.v53_assert(a->'sales_separate'='true'::jsonb and a->>'revenue_scope'='procedures','Report scope marker missing');
 perform pg_temp.v53_assert((a->'revenue'->>'total')::numeric=700 and(a->'revenue'->>'cash')::numeric=300
  and(a->'revenue'->>'terminal')::numeric=100 and(a->'revenue'->>'owner_card')::numeric=200 and(a->'revenue'->>'other_card')::numeric=100,
  'Standalone cash/mixed sale entered main procedure revenue');
 b:=a->'sales_summary';
 perform pg_temp.v53_assert((b->'revenue'->>'total')::numeric=16500 and(b->'revenue'->>'cash')::numeric=8000
  and(b->'revenue'->>'terminal')::numeric=2500 and(b->'revenue'->>'owner_card')::numeric=3000 and(b->'revenue'->>'other_card')::numeric=3000,
  'Separate sale channels or discounted amount wrong');
 perform pg_temp.v53_assert((a->>'charge_total')::numeric=700 and(a->>'loan_debt_total')::numeric=0 and(a->>'pending_total')::numeric=0
  and(b->>'charge_total')::numeric=35500 and(b->>'loan_debt_total')::numeric=9500 and(b->>'pending_total')::numeric=9500,
  'Sale pending/debt was merged into procedure amounts');
 perform pg_temp.v53_assert(jsonb_array_length(a->'sales')=4 and jsonb_array_length(a->'procedures')=1,
  'Separation hid sale records or procedure medication');
 perform pg_temp.v53_assert((a->'procedures'->0->'items'->0->>'line_total')::numeric=100,
  'Medicine used inside a procedure was excluded from the bill');
 cash_n:=public.crm_cash_drawer_v30('opening_set',jsonb_build_object('shift_id',current_setting('test.v53.shift'),'amount',5000,'reason','TEST actual initial procedure cash v53'),gen_random_uuid());
 perform pg_temp.v53_assert((cash_n->>'received_cash')::numeric=300 and(cash_n->>'balance')::numeric=5300
  and(cash_n->>'cash_after_salary_auto')::numeric=3300,'Cash core or automatic salary still uses sale cash');
 -- The compatibility parameter must not let an old mixed report reintroduce sales.
end $$;
reset role;
do $$declare a jsonb;begin
 a:=private.crm_cash_drawer_facts_v30_before_v37(current_setting('test.v53.shift')::uuid,8300);
 perform pg_temp.v53_assert((a->>'received_cash')::numeric=300 and(a->>'balance')::numeric=5300,'Mixed caller parameter overrides procedure cash');
end $$;

-- Preserve an old mixed-cash signed count as historical evidence. The new
-- scope must mark it stale; neither the count nor its original snapshot changes.
do $$declare snapshot_n jsonb;old_n jsonb;id_n uuid:=gen_random_uuid();actor_n uuid;begin
 snapshot_n:=private.crm_cash_financial_snapshot_v37(current_setting('test.v53.shift')::uuid);
 -- Reconstruct the former scope from the actual sale allocations and bills,
 -- rather than forcing a stale token with an unrelated marker field.
 old_n:=snapshot_n||jsonb_build_object(
  'drawer',(snapshot_n->'drawer')-array['sales_separate','revenue_scope']||jsonb_build_object('received_cash',8300,'balance',13300,'cash_after_salary_auto',11300),
  'initial_payments',coalesce(snapshot_n->'initial_payments','[]')||coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
   from private.crm_payment_allocations a join private.crm_active_sales_v52 s on s.id=a.sale_id
   where s.shift_id=current_setting('test.v53.shift')::uuid and a.voided_at is null),'[]'),
  'bills',coalesce(snapshot_n->'bills','[]')||coalesce((select jsonb_agg(jsonb_build_object('kind','sale','id',s.id,'paid_total',s.paid_total,
   'charge_total',s.charge_total,'list_total',s.list_total,'payment_pending',s.payment_pending) order by s.id)
   from private.crm_active_sales_v52 s where s.shift_id=current_setting('test.v53.shift')::uuid),'[]'));
 select id into actor_n from public.staff where auth_user_id=current_setting('test.v53.admin')::uuid;
 insert into private.crm_cash_counts_v37(id,shift_id,counted_cash,expected_cash,difference,reason,salary_confirmed,ledger_token,financial_snapshot,staff_id,staff_name,created_by)
  values(id_n,current_setting('test.v53.shift')::uuid,13300,13300,0,'TEST preserved historical mixed cash',false,md5(old_n::text),old_n,actor_n,'TEST admin v53',current_setting('test.v53.admin')::uuid);
 perform set_config('test.v53.old_count',id_n::text,true);
 perform set_config('test.v53.old_count_row',(select to_jsonb(c)::text from private.crm_cash_counts_v37 c where id=id_n),true);
 perform pg_temp.v53_assert((private.crm_cash_reconciliation_facts_v37(current_setting('test.v53.shift')::uuid)->>'stale')::boolean,
  'A historical signed count in the mixed sales scope was silently accepted');
end $$;
set local role authenticated;
do $$declare d jsonb;duplicate_n jsonb;begin
 d:=public.crm_cash_reconciliation_v37('status',jsonb_build_object('shift_id',current_setting('test.v53.shift')));
 d:=public.crm_cash_reconciliation_v37('save',jsonb_build_object('shift_id',current_setting('test.v53.shift'),
  'expected_token',d->'reconciliation_v37'->>'token','counted_cash',5300,'salary_confirmed',false,'reason','TEST procedure-only count v53'),gen_random_uuid());
 perform pg_temp.v53_assert(not(d->'reconciliation_v37'->>'stale')::boolean,'A fresh procedure-only reconciliation failed');
 perform set_config('test.v53.count_token',d->'reconciliation_v37'->>'token',true);
 -- Record the duplicate while the source shift still accepts new sales. It
 -- will be cancelled after closing, like an administrator correcting history.
 duplicate_n:=pg_temp.v53_create('sale','{}','debt');
 perform set_config('test.v53.duplicate_sale',duplicate_n::text,true);
end $$;
reset role;
-- Use the normal close trigger with the freshly signed procedure-only count.
-- Closing metadata must not change that count's financial fingerprint.
update public.shifts set status='closed',ended_at=planned_end_at
 where id=current_setting('test.v53.shift')::uuid;
set local role authenticated;
do $$declare duplicate_n jsonb:=current_setting('test.v53.duplicate_sale')::jsonb;begin
 -- A pending SALE can be paid in a different selected shift without affecting
 -- either shift's PROCEDURE cash, even though the receipt retains its real time.
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',current_setting('test.v53.pending_sale'),
  'shift_id',current_setting('test.v53.later_shift'),'nurse_id',current_setting('test.v53.nurse_id'),'payments','{"cash":400}'::jsonb),gen_random_uuid());
 perform public.crm_clinical_v10('debt_payment',jsonb_build_object('kind','sale','id',current_setting('test.v53.debt_sale'),
  'payments','{"cash":500}'::jsonb,'purpose','TEST real separate debt collection v53'),gen_random_uuid());
 perform public.crm_sale_cancel_v52(jsonb_build_object('id',duplicate_n->'id','expected_version',duplicate_n->'version',
  'expected_received_total',0,'reason','TEST duplicate separate sale v53','confirmed_duplicate',true),gen_random_uuid());
end $$;
reset role;
do $$declare a jsonb;b jsonb;d jsonb;begin
 a:=private.crm_build_shift_report_v5(current_setting('test.v53.shift')::uuid);
 b:=private.crm_build_shift_report_v5(current_setting('test.v53.later_shift')::uuid);
 perform pg_temp.v53_assert((a->'revenue'->>'cash')::numeric=300 and(b->'revenue'->>'cash')::numeric=0
  and(b->'sales_summary'->'revenue'->>'cash')::numeric=400,'Later sale receipt entered the procedure cash or wrong receiving shift');
 perform pg_temp.v53_assert((a->'sales_summary'->'revenue'->>'cash')::numeric=8000
  and(a->'sales_summary'->>'loan_debt_total')::numeric=9000 and(a->'sales_summary'->>'pending_total')::numeric=9100,
  'True debt repayment entered sale income or waiting sale became debt');
 perform pg_temp.v53_assert((select count(*) from private.crm_receipts_v10 where sale_id=current_setting('test.v53.debt_sale')::uuid and is_debt_repayment and cash=500)=1,
  'Separation changed the debt collection history');
 d:=private.crm_cash_reconciliation_facts_v37(current_setting('test.v53.shift')::uuid);
 perform pg_temp.v53_assert(not(d->>'stale')::boolean and d->>'token'=current_setting('test.v53.count_token'),
  'A sale-only receipt invalidated the procedure cash reconciliation');
 perform pg_temp.v53_assert((select to_jsonb(c) from private.crm_cash_counts_v37 c where id=current_setting('test.v53.old_count')::uuid)=current_setting('test.v53.old_count_row')::jsonb,
  'Historical mixed signed count was rewritten');
end $$;

set local role authenticated;
do $$declare a jsonb;p jsonb;event_n jsonb;begin
 a:=public.crm_payment_methods_v51('get',jsonb_build_object('kind','sale','id',current_setting('test.v53.cash_sale')));
 event_n:=a->'events'->0;
 p:=jsonb_build_object('kind','sale','id',current_setting('test.v53.cash_sale'),'expected_version',a->'version',
  'event_type',event_n->'event_type','event_id',event_n->'id',
  'expected_payments',jsonb_build_object('cash',event_n->'cash','terminal',event_n->'terminal','owner_card',event_n->'owner_card','other_card',event_n->'other_card','unclassified',event_n->'unclassified'),
  'payments','{"terminal":7000}'::jsonb,'reason','TEST corrected separate sale method v53','confirmed',true);
 perform public.crm_payment_methods_v51('save',p,gen_random_uuid());
end $$;
reset role;
do $$declare a jsonb;begin
 a:=private.crm_build_shift_report_v5(current_setting('test.v53.shift')::uuid);
 perform pg_temp.v53_assert((a->'revenue'->>'cash')::numeric=300 and(a->'sales_summary'->'revenue'->>'cash')::numeric=1000
  and(a->'sales_summary'->'revenue'->>'terminal')::numeric=9500,'Sale correction changed main cash or failed to change separate method');
 perform pg_temp.v53_assert(not(private.crm_cash_reconciliation_facts_v37(current_setting('test.v53.shift')::uuid)->>'stale')::boolean,
  'Sale method correction or unpaid cancellation invalidated procedure cash');
 perform pg_temp.v53_assert((select to_jsonb(p) from public.procedures p where id=current_setting('test.v53.procedure')::uuid)=current_setting('test.v53.money_before')::jsonb->'procedure',
  'Sale operations changed the procedure bill');
 perform pg_temp.v53_assert(not has_function_privilege('authenticated','private.crm_shift_money_v53(uuid,text)','EXECUTE'),
  'Internal unguarded money helper is client-executable');
end $$;

-- Every period grouping and its filters use the same split. There must be no
-- subtraction of already-rounded mixed totals to fabricate the two ledgers.
set local role authenticated;
do $$declare a jsonb;group_n text;row_n jsonb;begin
 foreach group_n in array array['day','employee','patient','medication','service'] loop
  a:=public.crm_finance_v5('summary',jsonb_build_object('from','2003-07-11','to','2003-07-11','group_by',group_n,'employee_id',current_setting('test.v53.nurse_id')));
  perform pg_temp.v53_assert(a->'sales_separate'='true'::jsonb and(a->'revenue'->>'total')::numeric=700
   and(a->'sales_summary'->'revenue'->>'total')::numeric=16500,'Period grouping lost separation: '||group_n);
 end loop;
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2003-07-11','to','2003-07-11','medication_id',current_setting('test.v53.amino')));
 perform pg_temp.v53_assert((a->'revenue'->>'total')::numeric=0 and(a->'sales_summary'->'revenue'->>'total')::numeric=16500,'Medication filter includes standalone sale in procedure income');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from','2003-07-11','to','2003-07-11','service_id',current_setting('test.v53.service')));
 perform pg_temp.v53_assert((a->'revenue'->>'total')::numeric=700 and(a->'sales_summary'->'revenue'->>'total')::numeric=0,'Service filter lost procedure medication or included sales');
 a:=public.crm_finance_v5('summary',jsonb_build_object('from',(now() at time zone 'Europe/Moscow')::date,'to',(now() at time zone 'Europe/Moscow')::date,'employee_id',current_setting('test.v53.nurse_id')));
 perform pg_temp.v53_assert((a->'revenue'->>'total')::numeric=0 and(a->'sales_summary'->'revenue'->>'cash')::numeric=400,
  'Calendar period used bill shift date for later sale payment or included true debt');
 a:=public.crm_dashboard_day_v25(date '2003-07-11');
 perform pg_temp.v53_assert((a->'working_day'->'revenue'->>'total')::numeric=700
  and(a->'working_day'->'sales_summary'->'revenue'->>'total')::numeric=16500,'Dashboard working-day totals mix sales');
end $$;
reset role;
select pg_temp.v53_actor('nurse');
set local role authenticated;
do $$declare a jsonb;failed_n boolean:=false;begin
 a:=public.crm_shift_journal_v12(date '2003-07-11');
 perform pg_temp.v53_assert((a->'reports'->0->'revenue'->>'total')::numeric=700
  and(a->'reports'->0->'sales_summary'->'revenue'->>'total')::numeric=16500,'Nurse journal whitelist dropped sales separation');
 begin perform public.crm_finance_v5('summary','{"from":"2003-07-11","to":"2003-07-11"}');exception when others then failed_n:=true;end;
 perform pg_temp.v53_assert(failed_n,'New split let a nurse read full manager finance');
end $$;
reset role;
select pg_temp.v53_actor('inactive');
set local role authenticated;
do $$declare denied_n boolean:=false;begin
 begin perform public.crm_finance_v5('summary','{"from":"2003-07-11","to":"2003-07-11"}');exception when others then denied_n:=true;end;
 perform pg_temp.v53_assert(denied_n,'Inactive manager gained finance access');
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$declare denied_n boolean:=false;begin
 begin perform public.crm_finance_v5('summary','{}');exception when others then denied_n:=true;end;
 perform pg_temp.v53_assert(denied_n,'Anonymous request gained finance access');
end $$;
reset role;
select 'crm_separate_sales_v53' as passed_suite;
rollback;
