begin;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from public.staff where active and role in ('admin','owner') limit 1),true);
do $$ declare a uuid;b uuid;c uuid;begin
 insert into public.staff(full_name,role) values('Тестовая медсестра A','nurse') returning id into a;
 insert into public.staff(full_name,role) values('Тестовая медсестра B','nurse') returning id into b;
 insert into public.staff(full_name,role) values('Тестовая медсестра C','nurse') returning id into c;
 perform set_config('test.a',a::text,true);perform set_config('test.b',b::text,true);perform set_config('test.c',c::text,true);
end $$;
set local role authenticated;
do $$ declare a uuid:=current_setting('test.a')::uuid;b uuid:=current_setting('test.b')::uuid;c uuid:=current_setting('test.c')::uuid;s uuid;failed boolean:=false;r jsonb;
begin
 s:=public.start_shift_v82(current_date,now(),now()+interval '8 hours',a,b);
 if public.start_shift_v82(current_date,now(),now()+interval '8 hours',a,b)<>s then raise exception 'Duplicate shift';end if;
 begin perform public.start_shift_v82(current_date,now(),now()+interval '8 hours',a,c);exception when raise_exception then failed:=true;end;
 if not failed then raise exception 'Overlapping membership allowed';end if;
 r:=public.quick_ui_v4('close',jsonb_build_object('shift_id',s));
 if r->'shift'->>'status'<>'closed' then raise exception 'Close report wrong';end if;
 if public.start_shift_v82(current_date,now(),now()+interval '8 hours',a,b)=s then raise exception 'Closed shift reused';end if;
end $$;
reset role;
rollback;
