-- Synthetic fixtures only. Run after crm-warehouse-report-v5.sql; always rolls back.
begin;
select set_config('test.manager',(select auth_user_id::text from public.staff where active and role in ('owner','admin') and auth_user_id is not null limit 1),true);
select set_config('test.nurse',(select auth_user_id::text from public.staff where active and role='nurse' and auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.manager'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.manager'),'role','authenticated')::text,true);
do $$declare med uuid:=gen_random_uuid(); other_med uuid:=gen_random_uuid();
begin
 if nullif(current_setting('test.manager'),'') is null or nullif(current_setting('test.nurse'),'') is null then raise exception 'Test requires an active owner and nurse';end if;
 insert into public.medications(id,name,consumption_unit,units_per_package,purchase_price,sale_price,active)
 values(med,'=Тест отчёта <script>','амп.',1,0,0,false),(other_med,'Посторонний тест отчёта','амп.',1,0,0,true);
 insert into public.stock(medication_id,location,quantity) values(med,'reserve',12),(med,'work',3);
 insert into public.stock_movements(medication_id,movement_type,quantity,from_location,to_location,created_at,comment) values
 (med,'purchase',99,null,'reserve','2026-10-06 20:59:59+00','До начала московского дня'),
 (med,'purchase',7,null,'reserve','2026-10-06 21:00:00+00','Включается в 7 октября'),
 (med,'reserve_to_work',2,'reserve','work','2026-10-07 12:00:00+00','Перевод'),
 (med,'sale',1,'work',null,'2026-10-07 20:59:59+00','Включается в конец дня'),
 (med,'purchase',88,null,'reserve','2026-10-07 21:00:00+00','После окончания'),
 (other_med,'purchase',66,null,'reserve','2026-10-07 12:00:00+00','Другой препарат');
 perform set_config('test.med',med::text,true);
end $$;
set local role authenticated;
do $$declare r jsonb; m jsonb; denied boolean;
begin
 r:=public.crm_warehouse_report_v5(jsonb_build_object('from','2026-10-07','to','2026-10-07','medication_id',current_setting('test.med')));
 if r->>'time_zone'<>'Europe/Moscow' or (r->>'movements_count')::int<>3 or (r->>'medications_count')::int<>1 then raise exception 'Moscow boundaries or medication filter failed';end if;
 m:=r->'medications'->0;
 if (m->>'reserve_current')::numeric<>12 or (m->>'work_current')::numeric<>3 or (m->>'total_current')::numeric<>15 then raise exception 'Current stock must be separate from historical movements';end if;
 if (m->>'reserve_delta')::numeric<>5 or (m->>'work_delta')::numeric<>1 then raise exception 'Location movement deltas incorrect';end if;
 if (m->>'active')::boolean or m->>'name'<>'=Тест отчёта <script>' then raise exception 'Archived medication or safe raw name missing';end if;
 if (r->'movements'->0->>'quantity')::numeric<>7 then raise exception 'Movements not ordered';end if;
 denied:=false;begin perform public.crm_warehouse_report_v5('{"from":"2026-10-08","to":"2026-10-07"}');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Reversed dates accepted';end if;
 denied:=false;begin perform public.crm_warehouse_report_v5('[]');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Invalid payload accepted';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.nurse'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.nurse'),'role','authenticated')::text,true);
 denied:=false;begin perform public.crm_warehouse_report_v5('{}');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Nurse obtained warehouse report';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;begin perform private.crm_warehouse_report_v5('{}');exception when raise_exception then denied:=true;end;
 if not denied then raise exception 'Unregistered user obtained private warehouse report';end if;
end $$;
reset role;
set local role anon;
do $$declare denied boolean:=false;
begin
 begin perform public.crm_warehouse_report_v5('{}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous execute was granted';end if;
end $$;
reset role;
rollback;
