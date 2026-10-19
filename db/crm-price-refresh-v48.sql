-- Explicit per-line catalogue refresh for an existing treatment or sale.
-- Untouched historical prices, custom charges, receipts and stock quantities stay
-- under the released validation, locking, version and idempotency rules.
begin;
set local lock_timeout='10s';
do $v48$
declare helper_oid oid;helper_acl aclitem[];helper_definer boolean;helper_config text[];actual_n text;
begin
 helper_oid:=to_regprocedure('private.crm_prepare_treatment_v10(text,jsonb,jsonb)');
 if helper_oid is null then raise exception 'v48: released price helper is missing';end if;
 select proacl,prosecdef,proconfig into helper_acl,helper_definer,helper_config from pg_proc where oid=helper_oid;
 actual_n:=md5(pg_get_functiondef(helper_oid));
 if actual_n='5ecabcc140a37401a460c690f0cc445d' then return;end if;
 if actual_n<>'19f3bc314369774e103107f230285887' then raise exception 'v48: price helper changed since review';end if;
 execute $definition$
CREATE OR REPLACE FUNCTION private.crm_prepare_treatment_v10(p_kind text, p_payload jsonb, p_original jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare items jsonb:=coalesce(p_payload->'items','[]');services jsonb;own_n jsonb:=coalesce(p_payload->'own_medications','[]');
 i jsonb;m public.medications%rowtype;s public.procedure_services%rowtype;old_n jsonb;
 normalized_items jsonb:='[]';result_own jsonb:='[]';dose_n text;refresh_n boolean;expected_price_n numeric;
 result_items jsonb:='[]';result_services jsonb:='[]';q numeric;price_n numeric;list_n numeric:=0;work_n numeric:=0;consumables_n numeric:=0;charge_n numeric;reason_n text;comment_n text;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>200 then raise exception 'Проверьте список препаратов';end if;
 for i in select value from jsonb_array_elements(items) loop
  q:=(i->>'quantity')::numeric;
  if nullif(i->>'medication_id','') is null or not private.crm_valid_quantity_v31(nullif(i->>'medication_id','')::uuid,q) or q>1000000 then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;
  if i?'dose' then dose_n:=private.crm_normalize_dose_v24(i->'dose');
  else
   select value into old_n from jsonb_array_elements(coalesce(p_original->'items','[]'))
    where (value->>'medication_id')::uuid=(i->>'medication_id')::uuid limit 1;
   dose_n:=private.crm_normalize_dose_v24(old_n->'dose');
  end if;
  -- Catalogue edits never silently reprice saved history. A deliberate refresh
  -- carries an optional displayed-price expectation so a concurrent price edit
  -- cannot save a different amount from the one the employee reviewed.
  if i?'refresh_price' and jsonb_typeof(i->'refresh_price') is distinct from 'boolean' then
   raise exception 'Проверьте обновление цены препарата';end if;
  refresh_n:=coalesce((i->>'refresh_price')::boolean,false);expected_price_n:=null;
  if i?'expected_catalog_price' then
   if not refresh_n or jsonb_typeof(i->'expected_catalog_price') is distinct from 'number' then
    raise exception 'Проверьте ожидаемую цену препарата';end if;
   expected_price_n:=(i->>'expected_catalog_price')::numeric;
   if expected_price_n<=0 or expected_price_n<>round(expected_price_n,2)
    or expected_price_n::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Проверьте ожидаемую цену препарата';end if;
  end if;
  normalized_items:=normalized_items||jsonb_build_array(jsonb_build_object('medication_id',(i->>'medication_id')::uuid,'quantity',q,'dose',dose_n)
   ||case when refresh_n then jsonb_build_object('refresh_price',true)
    ||case when expected_price_n is not null then jsonb_build_object('expected_catalog_price',expected_price_n) else '{}'::jsonb end
    else '{}'::jsonb end);
 end loop;
 if exists(select 1 from jsonb_array_elements(normalized_items) x
  group by (x->>'medication_id')::uuid having count(distinct x->'dose')>1) then
  raise exception 'Укажите одну дозу для повторяющегося препарата';end if;
 if exists(select 1 from jsonb_array_elements(normalized_items) x
  where coalesce((x->>'refresh_price')::boolean,false)
  group by (x->>'medication_id')::uuid having count(distinct (x->>'expected_catalog_price')::numeric)>1) then
  raise exception 'Для повторяющегося препарата указаны разные ожидаемые цены';end if;
 select coalesce(jsonb_agg(jsonb_build_object('medication_id',z.id,'quantity',z.q,'dose',z.dose)
   ||case when z.refresh then jsonb_build_object('refresh_price',true)
    ||case when z.expected_price is not null then jsonb_build_object('expected_catalog_price',z.expected_price) else '{}'::jsonb end
    else '{}'::jsonb end order by z.id),'[]') into items
  from(select (x->>'medication_id')::uuid id,sum((x->>'quantity')::numeric) q,x->'dose' dose,
    bool_or(coalesce((x->>'refresh_price')::boolean,false)) refresh,
    min((x->>'expected_catalog_price')::numeric) expected_price
   from jsonb_array_elements(normalized_items) x group by (x->>'medication_id')::uuid,x->'dose') z;
 if p_kind='sale' and jsonb_array_length(items)=0 then raise exception 'Добавьте препарат';end if;
 for i in select value from jsonb_array_elements(items) loop
  select * into m from public.medications where id=(i->>'medication_id')::uuid for update;
  if not found then raise exception 'Препарат не найден';end if;
  if not private.crm_valid_quantity_v31(m.id,(i->>'quantity')::numeric) or (i->>'quantity')::numeric>1000000 then raise exception 'Количество препарата: больше нуля; для мг — до трёх знаков после запятой, для остальных единиц — целое число';end if;
  select value into old_n from jsonb_array_elements(coalesce(p_original->'items','[]')) where value->>'medication_id'=m.id::text limit 1;
  if not m.active and(old_n is null or(i->>'quantity')::numeric>(old_n->>'quantity')::numeric) then raise exception 'Архивный препарат можно только оставить или уменьшить в исходной записи';end if;
  if old_n is null or coalesce((i->>'refresh_price')::boolean,false) then
   if not m.active or m.sale_price is null or m.sale_price<=0 or m.sale_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Укажите действующий препарат с ценой';end if;
   if i?'expected_catalog_price' and (i->>'expected_catalog_price')::numeric<>m.sale_price then
    raise exception 'Цена препарата изменилась. Обновите цену из прайса и проверьте сумму перед сохранением';end if;
   price_n:=m.sale_price;
  else price_n:=(old_n->>'unit_price')::numeric;end if;
  q:=(i->>'quantity')::numeric;list_n:=list_n+round(price_n*q,2);
  result_items:=result_items||jsonb_build_array(i||jsonb_build_object('unit_price',price_n,'line_total',round(price_n*q,2)));
 end loop;
 if p_kind='procedure' then
  services:=coalesce(p_payload->'services',jsonb_build_array(jsonb_build_object('service_id',p_payload->>'service_id','quantity',1)));
  if jsonb_typeof(services)<>'array' or jsonb_array_length(services) not between 1 and 100 then raise exception 'Добавьте услугу';end if;
  if exists(select 1 from jsonb_array_elements(services) x group by x->>'service_id' having count(*)>1) then raise exception 'Объедините повторяющиеся услуги';end if;
  for i in select value from jsonb_array_elements(services) loop
   q:=coalesce((i->>'quantity')::numeric,1);
   if nullif(i->>'service_id','') is null or q<=0 or q<>trunc(q) or q>1000 or q::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте услугу и количество';end if;
   select value into old_n from jsonb_array_elements(coalesce(p_original->'services','[]')) where value->>'service_id'=i->>'service_id' limit 1;
   if old_n is null then
    select * into s from public.procedure_services where id=(i->>'service_id')::uuid and active for share;
    if not found then raise exception 'Выберите действующую услугу';end if;
    old_n:=jsonb_build_object('service_id',s.id,'name',s.name,'work_price',s.work_price,'consumables_price',s.consumables_price);
   end if;
   if(old_n->>'work_price')::numeric<0 or(old_n->>'consumables_price')::numeric<0 or(old_n->>'work_price')::numeric::text in ('NaN','Infinity','-Infinity') or(old_n->>'consumables_price')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Проверьте цены услуги';end if;
   work_n:=work_n+(old_n->>'work_price')::numeric*q;consumables_n:=consumables_n+(old_n->>'consumables_price')::numeric*q;
   result_services:=result_services||jsonb_build_array(old_n||jsonb_build_object('quantity',q));
  end loop;
 end if;
 if jsonb_typeof(own_n)<>'array' or jsonb_array_length(own_n)>200 or(p_kind='sale' and jsonb_array_length(own_n)>0) then raise exception 'Проверьте препараты пациента';end if;
 for i in select value from jsonb_array_elements(own_n) loop
  q:=(i->>'quantity')::numeric;
  if coalesce(length(trim(i->>'name')),0) not between 1 and 500 or q is null or q<=0 or q<>trunc(q) or q>1000000 or q::text in ('NaN','Infinity','-Infinity') or coalesce(i->>'source','patient') not in ('patient','previously_purchased') or coalesce(length(i->>'unit'),0)>100 then raise exception 'Укажите название и целое количество препарата пациента';end if;
  if i?'dose' then dose_n:=private.crm_normalize_dose_v24(i->'dose');
  else
   -- Own rows have no stable input ID: inherit only an unambiguous identity dose.
   if (select count(distinct coalesce(to_jsonb(private.crm_normalize_dose_v24(x.value->'dose')),'null'::jsonb))
    from jsonb_array_elements(coalesce(p_original->'own_medications','[]')) x(value)
    where trim(x.value->>'name')=trim(i->>'name')
     and coalesce(x.value->>'source','patient')=coalesce(i->>'source','patient')
     and coalesce(nullif(trim(x.value->>'unit'),''),'амп.')=coalesce(nullif(trim(i->>'unit'),''),'амп.'))>1 then
    raise exception 'Укажите дозу для повторяющегося препарата пациента';end if;
   select x.value into old_n from jsonb_array_elements(coalesce(p_original->'own_medications','[]')) x(value)
    where trim(x.value->>'name')=trim(i->>'name')
     and coalesce(x.value->>'source','patient')=coalesce(i->>'source','patient')
     and coalesce(nullif(trim(x.value->>'unit'),''),'амп.')=coalesce(nullif(trim(i->>'unit'),''),'амп.')
    limit 1;
   dose_n:=private.crm_normalize_dose_v24(old_n->'dose');
  end if;
  result_own:=result_own||jsonb_build_array(i||jsonb_build_object('dose',dose_n));
 end loop;
 own_n:=result_own;
 list_n:=round(list_n+work_n+consumables_n,2);
 if p_payload ? 'charge_total' then charge_n:=(p_payload->>'charge_total')::numeric;
 elsif p_original is not null then charge_n:=list_n-((p_original->>'list_total')::numeric-(p_original->>'charge_total')::numeric);
 elsif p_payload ? 'paid_total' then charge_n:=(p_payload->>'paid_total')::numeric;
 else charge_n:=list_n;end if;
 if charge_n is null or charge_n<0 or charge_n<>round(charge_n,2) or charge_n::text in ('NaN','Infinity','-Infinity') then raise exception 'Сумма к оплате должна быть неотрицательной с точностью до копеек';end if;
 reason_n:=nullif(trim(p_payload->>'discount_reason'),'');comment_n:=nullif(trim(p_payload->>'discount_comment'),'');
 if charge_n<>list_n or p_payload->>'payment_status'='free' then
  if reason_n is null or comment_n is null then raise exception 'Укажите причину и обязательный комментарий к изменению цены или бесплатной процедуре';end if;
 else reason_n:=null;comment_n:=null;end if;
 return jsonb_build_object('items',result_items,'services',result_services,'own_medications',own_n,'list_total',list_n,'charge_total',charge_n,'work_price',work_n,'consumables_price',consumables_n,
  'discount_amount',greatest(list_n-charge_n,0),'discount_percent',case when list_n>0 then greatest(round((list_n-charge_n)*100/list_n,2),0) else 0 end,'discount_reason',reason_n,'discount_comment',comment_n);
end $function$
$definition$;
 if to_regprocedure('private.crm_prepare_treatment_v10(text,jsonb,jsonb)')::oid is distinct from helper_oid
  or (select proacl from pg_proc where oid=helper_oid) is distinct from helper_acl
  or (select prosecdef from pg_proc where oid=helper_oid) is distinct from helper_definer
  or (select proconfig from pg_proc where oid=helper_oid) is distinct from helper_config then
  raise exception 'v48: helper identity, privileges or security changed';end if;
 if md5(pg_get_functiondef(helper_oid))<>'5ecabcc140a37401a460c690f0cc445d' then raise exception 'v48: price helper verification failed';end if;
end $v48$;
notify pgrst,'reload schema';
commit;
