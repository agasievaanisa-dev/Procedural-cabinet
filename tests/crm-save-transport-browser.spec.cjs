const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:4173';
const projectHost='koepwazbabovrdnnobav.supabase.co';
const uuid=index=>`70000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const staff=[
 {id:uuid(1),auth_user_id:uuid(11),full_name:'Администратор тест',role:'admin',active:true,email:'admin@synthetic.example.test'},
 {id:uuid(2),auth_user_id:uuid(12),full_name:'Медсестра первая',role:'nurse',active:true,email:'first@synthetic.example.test'},
 {id:uuid(3),auth_user_id:uuid(13),full_name:'Медсестра вторая',role:'nurse',active:true,email:'second@synthetic.example.test'},
 {id:uuid(4),auth_user_id:uuid(14),full_name:'Владелец тест',role:'owner',active:true,email:'owner@synthetic.example.test'}
];

// Exercise the deployed, pinned Supabase SDK and SaveRecoveryV16 installation.
// Auth and PostgREST endpoints are synthetic; browser RPC functions are not replaced.
async function fixture(context,plans=[]){
 const errors=[],unexpected=[],unauthorized=[],requests=[],writes=[],holds=[];
 const tokens=new Map(),refreshTokens=new Map(),ledger=new Map();let serial=0;
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const user=member=>({id:member.auth_user_id,aud:'authenticated',role:'authenticated',email:member.email,
  app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],
  created_at:'2026-01-01T00:00:00Z',email_confirmed_at:'2026-01-01T00:00:00Z'});
 const jwt=claims=>[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'),Buffer.from('synthetic-signature').toString('base64url')].join('.');
 function issue(member,previous){
  const nonce=++serial,now=Math.floor(Date.now()/1000),record=previous||{member,revoked:false,sessionId:uuid(100+nonce)};
  const access=jwt({sub:member.auth_user_id,aud:'authenticated',role:'authenticated',session_id:record.sessionId,
   iat:now,exp:now+3600,synthetic_nonce:nonce}),refresh=`synthetic-refresh-${nonce}`;
  tokens.set(access,record);refreshTokens.set(refresh,record);
  return {access_token:access,refresh_token:refresh,token_type:'bearer',expires_in:3600,expires_at:now+3600,user:user(member)};
 }
 const headers={'access-control-allow-origin':origin,
  'access-control-allow-headers':'authorization,apikey,content-type,accept-profile,content-profile,prefer,x-client-info,x-supabase-api-version',
  'access-control-allow-methods':'GET,POST,OPTIONS'};
 const json=(route,data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!==projectHost){
   if(url.origin!==origin){unexpected.push(`External request: ${url.origin}${url.pathname}`);return route.abort();}
   const filename=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,filename);
   const contentType=filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html';
   return route.fulfill({contentType,body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
  }
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
  const body=request.postData()?JSON.parse(request.postData()):{},authorization=request.headers().authorization||'';
  const record=tokens.get(authorization.replace(/^Bearer\s+/i,''));
  const observed={pathname:url.pathname,method:request.method(),authorization,staffId:record?.member.id,
   sessionId:record?.sessionId,body};requests.push(observed);
  if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password'){
   const member=staff.find(item=>item.email===body.email);
   if(!member||body.password!=='synthetic-password')return json(route,{code:'invalid_credentials',message:'Invalid login credentials'},400);
   return json(route,issue(member));
  }
  if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token'){
   const session=refreshTokens.get(body.refresh_token);
   if(!session||session.revoked)return json(route,{code:'refresh_token_not_found',message:'Invalid Refresh Token'},400);
   return json(route,issue(session.member,session));
  }
  if(!record||record.revoked){unauthorized.push(observed);return json(route,{code:'invalid_token',message:'Missing or revoked synthetic session'},401);}
  if(url.pathname==='/auth/v1/user')return json(route,user(record.member));
  if(url.pathname==='/auth/v1/logout'){
   if(url.searchParams.get('scope')!=='local')unexpected.push('Logout unexpectedly revoked another tab');
   record.revoked=true;return route.fulfill({status:204,headers,body:''});
  }
  if(url.pathname==='/rest/v1/staff'){
   const authFilter=url.searchParams.get('auth_user_id');
   if(authFilter){
    if(authFilter!==`eq.${record.member.auth_user_id}`){unexpected.push('Profile query used another tab identity');return json(route,[],403);}
    return json(route,request.headers().accept?.includes('vnd.pgrst.object')?record.member:[record.member]);
   }
   return json(route,staff.filter(member=>member.role==='nurse'));
  }
  const endpoint=url.pathname.replace('/rest/v1/rpc/',''),legacy=endpoint==='crm_save_recovery_v16';
  const name=legacy?body.p_rpc:endpoint,args=legacy?body.p_args:body;
  const plan=plans.find(item=>item.name===name&&(item.action===undefined||item.action===args.p_action));
  if(plan){
   plan.calls??=[];plan.calls.push(observed);
   const outcome=plan.outcomes?.[plan.calls.length-1]||'success';
   if(outcome==='validation'||outcome==='permission')return json(route,{
    code:outcome==='permission'?'42501':'P0001',message:outcome==='permission'?'Нет доступа':'Проверьте сумму оплаты',details:'',hint:''
   },outcome==='permission'?403:400);
   const requestId=legacy?body.p_request_id:args.p_request_id;
   if(!requestId){unexpected.push(`Save has no request UUID: ${name}`);return json(route,{code:'22023',message:'Missing request UUID'},400);}
   const existing=ledger.get(requestId),fingerprint=JSON.stringify([record.member.id,name,args]);
   if(existing&&existing.fingerprint!==fingerprint){unexpected.push('A receipt was reused for another actor or payload');return json(route,{code:'22023',message:'Request already used'},400);}
   if(!existing){
    const result=typeof plan.result==='function'?plan.result(args,record.member):plan.result;
    ledger.set(requestId,{fingerprint,result});writes.push({name,args,requestId,staffId:record.member.id});
   }
   if(outcome==='hold-gateway')await new Promise(resolve=>holds.push(resolve));
   if(outcome==='gateway'||outcome==='hold-gateway')return route.fulfill({status:503,headers,contentType:'text/plain',body:'Upstream unavailable after commit'});
   if(outcome==='malformed')return route.fulfill({status:200,headers,contentType:'application/json',body:'{"broken":'});
   if(outcome==='null')return json(route,null);
   const result=ledger.get(requestId).result;
   return json(route,legacy?{result}:result);
  }
  if(endpoint==='crm_dashboard_day_v25'){
   if(record.member.active===false||!['admin','owner'].includes(record.member.role)){unauthorized.push(observed);return json(route,{code:'42501',message:'Manager access required'},403);}
   if(request.method()!=='POST'||typeof body.p_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.p_date)){unexpected.push(`Invalid dashboard request: ${request.method()} ${url.pathname}`);return json(route,{code:'22023',message:'Expected dashboard date'},400);}
   return json(route,{date:body.p_date,working_day:{patients_count:0,procedures_count:0,revenue:{total:0,cash:0,terminal:0,owner_card:0},payroll_total:0,payroll_complete:true,cash_after_salary:0},receipts_day:{revenue:{total:0,cash:0,terminal:0,owner_card:0},breakdown:{}}});
  }
  if(endpoint==='quick_ui_v4'&&body.p_action==='context')return json(route,{favorites:[],recent:[],shifts:[]});
  if(endpoint==='get_my_open_shift_v82')return json(route,null);
  if(endpoint==='crm_finance_v5'&&body.p_action==='accounting_mode')return json(route,{payment_only:true,stock_deducted:false});
  if(endpoint==='crm_finance_v5'&&body.p_action==='summary')return json(route,{from:body.p_payload.from,to:body.p_payload.to,rows:[],revenue:{total:0,cash:0,terminal:0,owner_card:0}});
  if(['work_catalog_v2','nurse_service_catalog','warehouse_v5'].includes(endpoint))return json(route,[]);
  if(endpoint==='crm_management_v5'&&body.p_action==='patient_list')return json(route,[]);
  if(endpoint==='crm_management_v5'&&body.p_action==='staff_list')return json(route,staff);
  unexpected.push(`${request.method()} ${url.pathname}`);return json(route,{message:'Unexpected synthetic endpoint'},400);
 });
 return {errors,unexpected,unauthorized,requests,writes,ledger,release(){holds.splice(0).forEach(resolve=>resolve());}};
}
async function login(context,member=staff[0]){
 const page=await context.newPage();await page.goto('/');await expect(page.locator('#loginForm')).toBeVisible();
 await page.fill('#loginEmail',member.email);await page.fill('#loginPassword','synthetic-password');await page.click('#loginSubmit');
 await expect(page.locator('#workspace')).toHaveClass(/active/);await expect(page.locator('#loginSubmit')).toBeEnabled();
 return page;
}
function rpc(page,name,args,options){return page.evaluate(async input=>{
 const response=await db.rpc(input.name,input.args,input.options);return {data:response.data,error:response.error,status:response.status};
},{name,args,options});}
function clean(server){
 expect(server.errors).toEqual([]);expect(server.unexpected).toEqual([]);expect(server.unauthorized).toEqual([]);
 const dashboard=server.requests.filter(item=>item.pathname==='/rest/v1/rpc/crm_dashboard_day_v25');
 expect(dashboard.every(item=>['admin','owner'].includes(staff.find(member=>member.id===item.staffId)?.role))).toBe(true);
}
function recovered(plan,server,args,member=staff[0]){
 expect(plan.calls).toHaveLength(2);expect(server.writes).toHaveLength(1);
 expect(plan.calls[1].body).toEqual(plan.calls[0].body);expect(plan.calls.every(call=>call.staffId===member.id)).toBe(true);
 expect(plan.calls.every(call=>call.authorization.startsWith('Bearer '))).toBe(true);
 expect(server.writes[0].args).toEqual(args);clean(server);
}

for(const [name,result,args] of [
 ['crm_patient_save_v11',{patient:{id:uuid(21),full_name:'Пациент тест'}},{p_request_id:uuid(201),p_payload:{full_name:'Пациент тест'}}],
 ['crm_service_save_v11',{service:{id:uuid(22),name:'Услуга тест'}},{p_request_id:uuid(202),p_payload:{name:'Услуга тест',work_price:100,consumables_price:0}}],
 ['warehouse_v5',{id:uuid(23),name:'Препарат тест'},{p_action:'save',p_request_id:uuid(203),p_payload:{name:'Препарат тест',sale_price:200}}]
])test(`${name}: a committed save followed by HTTP 503 retries the same UUID exactly once`,async({context})=>{
 const plan={name,action:args.p_action,result,outcomes:['gateway','success']},server=await fixture(context,[plan]),page=await login(context);
 const answer=await rpc(page,name,args);expect(answer.error).toBeNull();expect(answer.data).toEqual(result);
 expect(plan.calls[0].pathname).toBe(`/rest/v1/rpc/${name}`);recovered(plan,server,args);
});

for(const [name,args,result] of [
 ['crm_management_v5',{p_action:'template_save',p_payload:{name:'Шаблон тест',medications:[]}},{id:uuid(31),name:'Шаблон тест'}],
 ['crm_management_v5',{p_action:'staff_save',p_payload:{id:staff[1].id,full_name:staff[1].full_name,role:'nurse',active:true}},{...staff[1]}],
 ['crm_finance_v5',{p_action:'settings_save',p_payload:{payment_only:true}},{payment_only:true}],
 ['manager_medication_details_photo_v1',{p_id:uuid(23),p_search_name:'Поиск тест',p_dosage:'2 мл',p_photo_path:null},null]
])test(`${name}/${args.p_action||'void metadata'}: legacy saves keep their result contract through the receipt envelope`,async({context})=>{
 const plan={name,action:args.p_action,result,outcomes:['gateway','success']},server=await fixture(context,[plan]),page=await login(context);
 const requestId=uuid(301),answer=await rpc(page,name,args,{saveRequestIdV16:requestId});
 expect(answer.error).toBeNull();expect(answer.data).toEqual(result);recovered(plan,server,args);
 expect(plan.calls[0].pathname).toBe('/rest/v1/rpc/crm_save_recovery_v16');
 expect(plan.calls[0].body).toEqual({p_rpc:name,p_args:args,p_request_id:requestId});
});

test('two ambiguous replies preserve the original legacy receipt for a manual retry',async({context})=>{
 const name='crm_management_v5',args={p_action:'template_save',p_payload:{name:'Не потерять шаблон',medications:[]}};
 const plan={name,action:args.p_action,result:{id:uuid(41)},outcomes:['gateway','gateway','success']};
 const server=await fixture(context,[plan]),page=await login(context),first=await rpc(page,name,args);
 expect(first.data).toBeNull();expect(first.error).toMatchObject({retryable:true,uncertain:true,recoveryAttemptedV16:true});
 expect(first.error.message).toContain('Повторить сохранение');expect(plan.calls).toHaveLength(2);expect(server.writes).toHaveLength(1);
 const next=await rpc(page,name,args);expect(next.error).toBeNull();expect(next.data).toEqual(plan.result);
 expect(plan.calls).toHaveLength(3);expect(plan.calls[2].body).toEqual(plan.calls[0].body);expect(server.writes).toHaveLength(1);clean(server);
});

for(const outcome of ['malformed','null'])test(`${outcome} JSON after commit is not accepted as a confirmed patient save`,async({context})=>{
 const name='crm_patient_save_v11',args={p_request_id:uuid(401),p_payload:{full_name:'Сохранён один раз'}};
 const plan={name,result:{patient:{id:uuid(42),full_name:args.p_payload.full_name}},outcomes:[outcome,'success']};
 const server=await fixture(context,[plan]),page=await login(context),answer=await rpc(page,name,args);
 expect(answer.error).toBeNull();expect(answer.data.patient.full_name).toBe(args.p_payload.full_name);recovered(plan,server,args);
});

for(const [outcome,code] of [['validation','P0001'],['permission','42501']])test(`${code}: a definitive business or permission rejection is returned without replay or alternate endpoints`,async({context})=>{
 const args={p_action:'staff_save',p_payload:{id:staff[1].id,role:'owner'}};
 const plan={name:'crm_management_v5',action:args.p_action,outcomes:[outcome]},server=await fixture(context,[plan]),page=await login(context);
 const answer=await rpc(page,plan.name,args);expect(answer.data).toBeNull();
 expect(answer.error).toMatchObject({code,retryable:false,uncertain:false,recoveryAttemptedV16:true});
 expect(plan.calls).toHaveLength(1);expect(server.writes).toHaveLength(0);
 expect(plan.calls[0].pathname).toBe('/rest/v1/rpc/crm_save_recovery_v16');clean(server);
});

test('save retries and refreshes use each tab session; logging out suppresses an in-flight retry across actors',async({context})=>{
 const name='crm_management_v5',args={p_action:'template_save',p_payload:{name:'Отдельная сессия',medications:[]}};
 const plan={name,action:args.p_action,result:{id:uuid(51)},outcomes:['hold-gateway','success','success']};
 const patientPlan={name:'crm_patient_save_v11',outcomes:['gateway','success','success'],
  result:args=>({patient:{id:args.p_request_id,full_name:args.p_payload.full_name}})};
 const server=await fixture(context,[plan,patientPlan]),pages=await Promise.all(staff.slice(0,3).map(member=>login(context,member)));
 const before=await Promise.all(pages.map(page=>page.evaluate(async()=>({
  token:(await db.auth.getSession()).data.session.access_token,staffId:currentStaff.id
 }))));
 const refreshed=await pages[2].evaluate(async()=>{
  const {data,error}=await db.auth.refreshSession();if(error)throw Error(error.message);return data.session.access_token;
 });
 expect(refreshed).not.toBe(before[2].token);
 const pending=rpc(pages[0],name,args);
 await expect.poll(()=>plan.calls?.length||0).toBe(1);
 await pages[0].evaluate(()=>signOut());await expect(pages[0].locator('#loginForm')).toBeVisible();server.release();
 const stale=await pending;expect(stale.data).toBeNull();expect(stale.error.code).toBe('CRM_SESSION_CHANGED');expect(plan.calls).toHaveLength(1);
 await pages[0].fill('#loginEmail',staff[3].email);await pages[0].fill('#loginPassword','synthetic-password');await pages[0].click('#loginSubmit');
 await expect(pages[0].locator('#status')).toHaveText(`${staff[3].full_name} · Владелец`);await expect(pages[0].locator('#workspace')).toHaveClass(/active/);
 const fresh=await rpc(pages[0],name,args);expect(fresh.error).toBeNull();expect(plan.calls).toHaveLength(2);
 expect(plan.calls[1].body.p_request_id).not.toBe(plan.calls[0].body.p_request_id);
 expect(plan.calls.map(call=>call.staffId)).toEqual([staff[0].id,staff[3].id]);
 const reads=await Promise.all(pages.slice(1).map(page=>rpc(page,'crm_management_v5',{p_action:'patient_list'})));
 expect(reads.every(answer=>answer.error===null)).toBe(true);
 const later=server.requests.filter(call=>call.pathname==='/rest/v1/rpc/crm_management_v5'&&call.body.p_action==='patient_list').slice(-2);
 expect(later.map(call=>call.staffId).sort()).toEqual([staff[1].id,staff[2].id].sort());
 expect(later.find(call=>call.staffId===staff[1].id).authorization).toBe(`Bearer ${before[1].token}`);
 expect(later.find(call=>call.staffId===staff[2].id).authorization).toBe(`Bearer ${refreshed}`);
 const saves=await Promise.all(pages.slice(1).map((page,index)=>rpc(page,patientPlan.name,{
  p_request_id:uuid(501+index),p_payload:{full_name:`Пациент отдельной вкладки ${index+1}`}
 })));
 expect(saves.every(answer=>answer.error===null)).toBe(true);expect(patientPlan.calls).toHaveLength(3);
 for(const [index,token] of [[1,before[1].token],[2,refreshed]]){
  const own=patientPlan.calls.filter(call=>call.staffId===staff[index].id);expect(own.length).toBeGreaterThan(0);
  expect(own.every(call=>call.authorization===`Bearer ${token}`&&call.body.p_request_id===uuid(500+index))).toBe(true);
 }
 expect(server.writes).toHaveLength(4);clean(server);
});

for(const member of [staff[0],staff[3]])test(`desktop ${member.role}: Patients and Staff buttons keep labels and navigation without human icons`,async({context})=>{
 const server=await fixture(context),page=await login(context,member);await page.setViewportSize({width:1280,height:900});
 const patients=page.locator('.home-actions button[onclick="goPatients()"]'),employees=page.locator('.home-actions button[onclick="openStaffV5()"]');
 await expect(patients).toBeVisible();await expect(patients.locator('strong')).toHaveText('Пациенты');await expect(patients.locator('span')).toBeHidden();
 await expect(employees).toBeVisible();await expect(employees.locator('strong')).toHaveText('Сотрудники');await expect(employees.locator('span')).toBeHidden();
 await patients.click();await expect(page.locator('#patients')).toHaveClass(/active/);
 await page.evaluate(()=>show('workspace'));await employees.click();await expect(page.locator('#staffV5')).toHaveClass(/active/);
 await expect(page.locator('#staffListV5')).toContainText(staff[1].full_name);clean(server);
});
