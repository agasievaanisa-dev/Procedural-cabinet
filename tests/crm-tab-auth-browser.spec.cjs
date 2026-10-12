const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const origin='http://127.0.0.1:4173';
const projectHost='koepwazbabovrdnnobav.supabase.co';
const legacyKey='sb-koepwazbabovrdnnobav-auth-token';
const staff=[
 {id:'10000000-0000-4000-8000-000000000001',auth_user_id:'20000000-0000-4000-8000-000000000001',full_name:'Аниса',role:'admin',active:true,email:'anisa@synthetic.example.test'},
 {id:'10000000-0000-4000-8000-000000000002',auth_user_id:'20000000-0000-4000-8000-000000000002',full_name:'Азиза',role:'nurse',active:true,email:'aziza@synthetic.example.test'},
 {id:'10000000-0000-4000-8000-000000000003',auth_user_id:'20000000-0000-4000-8000-000000000003',full_name:'Марьям',role:'nurse',active:true,email:'maryam@synthetic.example.test'}
];

// The pinned vendor SDK, its persistence, refresh locks and BroadcastChannel run
// unchanged. Only synthetic server endpoints are mocked; no real credentials,
// patient records or requests leave the BrowserContext.
async function fixture(context){
 const errors=[],unexpected=[],unauthorized=[],requests=[],logoutScopes=[];
 const tokens=new Map(),refreshTokens=new Map();let sequence=0;
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const user=member=>({id:member.auth_user_id,aud:'authenticated',role:'authenticated',email:member.email,
  app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],
  created_at:'2026-01-01T00:00:00Z',email_confirmed_at:'2026-01-01T00:00:00Z'});
 const jwt=claims=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'),Buffer.from('synthetic-signature').toString('base64url')].join('.');
 function issue(member,existing=null){
  const serial=++sequence,now=Math.floor(Date.now()/1000),record=existing||{
   member,sessionId:`30000000-0000-4000-8000-${String(serial).padStart(12,'0')}`,revoked:false};
  const access=jwt({sub:member.auth_user_id,aud:'authenticated',role:'authenticated',session_id:record.sessionId,
   iat:now,exp:now+3600,synthetic_nonce:serial}),refresh=`synthetic-refresh-${serial}`;
  tokens.set(access,record);refreshTokens.set(refresh,record);
  return {access_token:access,refresh_token:refresh,token_type:'bearer',expires_in:3600,expires_at:now+3600,user:user(member)};
 }
 const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,apikey,content-type,accept-profile,content-profile,prefer,x-client-info,x-supabase-api-version','access-control-allow-methods':'GET,POST,OPTIONS'};
 async function json(route,data,status=200){await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});}
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname===projectHost){
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   const body=request.postData()?JSON.parse(request.postData()):{},authorization=request.headers().authorization||'';
   const record=tokens.get(authorization.replace(/^Bearer\s+/i,''));
   requests.push({pathname:url.pathname,query:url.search,method:request.method(),authorization,
    staffId:record?.member.id,sessionId:record?.sessionId,body});
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
   if(!record||record.revoked){
    unauthorized.push({pathname:url.pathname,authorization});
    return json(route,{code:'invalid_token',message:'Missing or revoked synthetic session'},401);
   }
   if(url.pathname==='/auth/v1/user')return json(route,user(record.member));
   if(url.pathname==='/auth/v1/logout'){
    const scope=url.searchParams.get('scope');logoutScopes.push(scope);
    if(scope==='local')record.revoked=true;
    else for(const session of new Set(tokens.values()))if(session.member.id===record.member.id)session.revoked=true;
    return route.fulfill({status:204,headers,body:''});
   }
   if(url.pathname==='/rest/v1/staff'){
    const authFilter=url.searchParams.get('auth_user_id');
    if(authFilter){
     if(authFilter!==`eq.${record.member.auth_user_id}`){unexpected.push('A profile query used another tab\'s user ID');return json(route,[],403);}
     return json(route,request.headers().accept?.includes('vnd.pgrst.object')?record.member:[record.member]);
    }
    return json(route,staff.filter(member=>member.role==='nurse'));
   }
   if(url.pathname==='/rest/v1/rpc/crm_identity_test_v15')return json(route,{
    staff_id:record.member.id,name:record.member.full_name,role:record.member.role,session_id:record.sessionId});
   if(url.pathname==='/rest/v1/rpc/quick_ui_v4'&&body.p_action==='context')return json(route,{favorites:[],recent:[],shifts:[]});
   if(url.pathname==='/rest/v1/rpc/get_my_open_shift_v82')return json(route,null);
   if(url.pathname==='/rest/v1/rpc/crm_finance_v5'){
    if(body.p_action==='accounting_mode')return json(route,{payment_only:true,stock_deducted:false});
    if(body.p_action==='summary')return json(route,{from:body.p_payload.from,to:body.p_payload.to,rows:[],revenue:{total:0,cash:0,terminal:0,owner_card:0}});
   }
   if(['/rest/v1/rpc/work_catalog_v2','/rest/v1/rpc/nurse_service_catalog','/rest/v1/rpc/warehouse_v5'].includes(url.pathname))return json(route,[]);
   if(url.pathname==='/rest/v1/rpc/crm_management_v5'&&body.p_action==='patient_list')return json(route,[]);
   unexpected.push(`${request.method()} ${url.pathname}${url.search}`);return json(route,{message:'Unexpected synthetic endpoint'},400);
  }
  if(url.origin!==origin){unexpected.push(`External request: ${url.origin}${url.pathname}`);return route.abort();}
  const filename=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,filename);
  const contentType=filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html';
  return route.fulfill({contentType,body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
 });
 return {errors,unexpected,unauthorized,requests,logoutScopes,issue};
}
async function open(context){const page=await context.newPage();await page.goto('/');await expect(page.locator('#loginForm')).toBeVisible();return page;}
async function watch(page){await page.evaluate(()=>{
 window.syntheticAuthEvents=[];
 db.auth.onAuthStateChange((event,session)=>syntheticAuthEvents.push({event,userId:session?.user.id||null,token:session?.access_token||null}));
});}
async function login(page,member){
 await page.fill('#loginEmail',member.email);await page.fill('#loginPassword','synthetic-password');
 await page.click('#loginSubmit');await expect(page.locator('#workspace')).toHaveClass(/active/);
 await expect(page.locator('#status')).toHaveText(`${member.full_name} · ${member.role==='admin'?'Администратор':'Медсестра'}`);
 await expect(page.locator('#loginSubmit')).toBeEnabled();
}
async function identity(page){return page.evaluate(async()=>{
 const {data,error}=await db.rpc('crm_identity_test_v15');if(error)throw Error(error.message);return data;
});}
async function session(page){return page.evaluate(async()=>{
 const {data,error}=await db.auth.getSession();if(error)throw Error(error.message);
 return {userId:data.session?.user.id||null,token:data.session?.access_token||null,
  sdkKey:db.auth.storageKey,channel:db.auth.broadcastChannel?.name||null,staffId:currentStaff?.id||null};
});}
async function expectOwnSession(page,member){
 const state=await session(page);expect(state.userId).toBe(member.auth_user_id);expect(state.staffId).toBe(member.id);
 const answer=await identity(page);expect(answer).toMatchObject({staff_id:member.id,name:member.full_name,role:member.role});return {state,answer};
}
function expectClean(server){expect(server.errors).toEqual([]);expect(server.unexpected).toEqual([]);expect(server.unauthorized).toEqual([]);}

test('three tabs keep their own administrator/nurse identity, refresh token and API Authorization',async({context})=>{
 const server=await fixture(context),pages=await Promise.all(staff.map(()=>open(context)));
 await Promise.all(pages.map(watch));await Promise.all(pages.map((page,index)=>login(page,staff[index])));
 const before=await Promise.all(pages.map((page,index)=>expectOwnSession(page,staff[index])));
 expect(new Set(before.map(item=>item.state.sdkKey)).size).toBe(3);
 expect(before.map(item=>item.state.channel)).toEqual(before.map(item=>item.state.sdkKey));
 expect(new Set(before.map(item=>item.answer.session_id)).size).toBe(3);
 const refreshed=await pages[1].evaluate(async()=>{
  const {data,error}=await db.auth.refreshSession();if(error)throw Error(error.message);return data.session.access_token;
 });
 expect(refreshed).not.toBe(before[1].state.token);
 const after=await Promise.all(pages.map((page,index)=>expectOwnSession(page,staff[index])));
 expect(after[0].state.token).toBe(before[0].state.token);expect(after[1].state.token).toBe(refreshed);expect(after[2].state.token).toBe(before[2].state.token);
 for(let index=0;index<pages.length;index++){
  const events=await pages[index].evaluate(()=>syntheticAuthEvents.filter(item=>item.userId));
  expect(events.length).toBeGreaterThan(0);expect(new Set(events.map(item=>item.userId))).toEqual(new Set([staff[index].auth_user_id]));
  if(index!==1)expect(events.map(item=>item.token)).not.toContain(refreshed);
 }
 await Promise.all(pages.map(page=>page.reload()));
 for(let index=0;index<pages.length;index++){
  await expect(pages[index].locator('#status')).toHaveText(`${staff[index].full_name} · ${index===0?'Администратор':'Медсестра'}`);
  const restored=await expectOwnSession(pages[index],staff[index]);
  expect(restored.answer.session_id).toBe(before[index].answer.session_id);
  expect(restored.state.sdkKey).not.toBe(before[index].state.sdkKey);
 }
 const probeRequests=server.requests.filter(item=>item.pathname==='/rest/v1/rpc/crm_identity_test_v15');
 expect(new Set(probeRequests.map(item=>item.staffId))).toEqual(new Set(staff.map(member=>member.id)));
 expect(probeRequests.every(item=>item.authorization.startsWith('Bearer '))).toBe(true);expectClean(server);
});

test('logout and a different login affect only the selected tab, including subsequent requests',async({context})=>{
 const server=await fixture(context),pages=await Promise.all(staff.map(()=>open(context)));
 await Promise.all(pages.map((page,index)=>login(page,staff[index])));
 const before=await Promise.all(pages.map((page,index)=>expectOwnSession(page,staff[index])));
 await pages[1].evaluate(()=>signOut());await expect(pages[1].locator('#loginForm')).toBeVisible();
 expect((await session(pages[1])).userId).toBeNull();
 for(const index of [0,2]){
  const untouched=await expectOwnSession(pages[index],staff[index]);expect(untouched.state.token).toBe(before[index].state.token);
 }
 await login(pages[1],staff[2]);const switched=await expectOwnSession(pages[1],staff[2]);
 expect(switched.answer.session_id).not.toBe(before[2].answer.session_id);
 expect((await session(pages[0])).userId).toBe(staff[0].auth_user_id);
 const maryam=await expectOwnSession(pages[2],staff[2]);expect(maryam.state.token).toBe(before[2].state.token);
 expect(server.logoutScopes).toEqual(['local']);expectClean(server);
});

test('fresh navigation and an opener-cloned tab cannot inherit a login or import legacy localStorage',async({context})=>{
 const server=await fixture(context),source=await open(context);await login(source,staff[0]);
 const original=await expectOwnSession(source,staff[0]),legacy=server.issue(staff[1]);
 await source.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:legacyKey,value:legacy});
 const fresh=await open(context);expect((await session(fresh)).userId).toBeNull();
 expect(await fresh.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,legacyKey)).toBe(staff[1].auth_user_id);
 const [popup]=await Promise.all([context.waitForEvent('page'),source.evaluate(()=>{window.open('/','_blank');})]);
 await popup.waitForLoadState('domcontentloaded');await expect(popup.locator('#loginForm')).toBeVisible();
 expect((await session(popup)).userId).toBeNull();expect((await session(popup)).staffId).toBeNull();
 const untouched=await expectOwnSession(source,staff[0]);expect(untouched.state.token).toBe(original.state.token);
 await login(popup,staff[2]);await expectOwnSession(popup,staff[2]);await expectOwnSession(source,staff[0]);
 await fresh.reload();await expect(fresh.locator('#loginForm')).toBeVisible();expect((await session(fresh)).userId).toBeNull();
 expect(server.logoutScopes).toEqual([]);expectClean(server);
});

test('two independent sessions of the same user survive a local logout in one tab',async({context})=>{
 const server=await fixture(context),first=await open(context),second=await open(context);
 await Promise.all([login(first,staff[1]),login(second,staff[1])]);
 const a=await expectOwnSession(first,staff[1]),b=await expectOwnSession(second,staff[1]);
 expect(a.answer.session_id).not.toBe(b.answer.session_id);expect(a.state.sdkKey).not.toBe(b.state.sdkKey);
 await first.evaluate(()=>signOut());await expect(first.locator('#loginForm')).toBeVisible();
 const newToken=await second.evaluate(async()=>{
  const {data,error}=await db.auth.refreshSession();if(error)throw Error(error.message);return data.session.access_token;
 });
 expect(newToken).not.toBe(b.state.token);const live=await expectOwnSession(second,staff[1]);
 expect(live.answer.session_id).toBe(b.answer.session_id);await second.reload();
 await expect(second.locator('#status')).toHaveText('Азиза · Медсестра');await expectOwnSession(second,staff[1]);
 expect((await session(first)).userId).toBeNull();expect(server.logoutScopes).toEqual(['local']);expectClean(server);
});
