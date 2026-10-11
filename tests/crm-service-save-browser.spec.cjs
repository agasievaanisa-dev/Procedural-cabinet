const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);
 await page.evaluate(async()=>{
  currentStaff={id:'owner-1',role:'owner',full_name:'Аниса'};
  window.__serviceFixtures=[{id:'existing-1',name:'Капельница',work_price:500,consumables_price:100,comment:'Первоначальная услуга',active:true}];
  window.__serviceCalls=[];window.__serviceWrites=[];window.__serviceReceipts=new Map();
  window.__serviceLostResponses=0;window.__serviceReturnedError=false;window.__serviceFailure=null;window.__serviceAfterNetworkFailure=null;window.__serviceHold=false;window.__serviceHoldList=false;window.__serviceListFailures=0;window.__serviceCatalogFailures=0;
  db.rpc=async(name,args={})=>{
   if(name==='crm_service_save_v11'){
    __serviceCalls.push(JSON.parse(JSON.stringify(args)));
    if(__serviceFailure)return {error:__serviceFailure};
    let receipt=__serviceReceipts.get(args.p_request_id);
    if(!receipt){
     const payload=JSON.parse(JSON.stringify(args.p_payload));
     let service=payload.id&&__serviceFixtures.find(s=>s.id===payload.id);
     if(!service){service={id:'created-'+(__serviceWrites.length+1)};__serviceFixtures.push(service)}
     const id=service.id;Object.assign(service,payload,{id});receipt=JSON.parse(JSON.stringify(service));
     __serviceReceipts.set(args.p_request_id,receipt);__serviceWrites.push({request_id:args.p_request_id,payload});
    }
    if(__serviceHold){__serviceHold=false;await new Promise(resolve=>window.__releaseServiceSave=resolve)}
    if(__serviceLostResponses>0){--__serviceLostResponses;if(__serviceAfterNetworkFailure)__serviceFailure=__serviceAfterNetworkFailure;if(__serviceReturnedError)return {error:{message:'TypeError: Load failed',code:'',hint:'',details:''},status:0};throw new TypeError('Load failed')}
    return {data:receipt};
   }
   if(name==='crm_management_v5'&&args.p_action==='services_list'){
    if(__serviceListFailures>0){--__serviceListFailures;throw new TypeError('Load failed')}
    if(__serviceHoldList){const captured=JSON.parse(JSON.stringify(__serviceFixtures));__serviceHoldList=false;await new Promise(resolve=>window.__releaseServiceList=resolve);return {data:captured}}
    return {data:JSON.parse(JSON.stringify(__serviceFixtures))};
   }
   if(name==='nurse_service_catalog'){
    if(__serviceCatalogFailures>0){--__serviceCatalogFailures;throw new TypeError('Load failed')}
    return {data:JSON.parse(JSON.stringify(__serviceFixtures.filter(s=>s.active)))};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[]}:null};
   return {data:[]};
  };
  await goServicesV5();
 });
 await expect(page.locator('#services')).toBeVisible();return errors;
}
const saveButton=page=>page.locator('#services button[onclick="saveService()"]');
const calls=page=>page.evaluate(()=>__serviceCalls);
const writes=page=>page.evaluate(()=>__serviceWrites);
async function draft(page,name='Внутривенный укол'){
 await page.fill('#serviceName',name);await page.fill('#serviceWork','700');await page.fill('#serviceConsumables','50');
 await page.fill('#serviceCommentV5','Сохранить подробный комментарий');await page.check('#serviceActive');
}
async function expectDraft(page,name='Внутривенный укол'){
 await expect(page.locator('#serviceName')).toHaveValue(name);await expect(page.locator('#serviceWork')).toHaveValue('700');
 await expect(page.locator('#serviceConsumables')).toHaveValue('50');await expect(page.locator('#serviceCommentV5')).toHaveValue('Сохранить подробный комментарий');await expect(page.locator('#serviceActive')).toBeChecked();
}
async function confirmed(page,name='Внутривенный укол'){
 await expect(page.locator('#serviceMessage')).toContainText('Услуга сохранена.');await expect(page.locator('#serviceList')).toContainText(name);await expect(saveButton(page)).toBeEnabled();
}

for(const returned of [false,true])test(`service creation retries a ${returned?'returned Safari':'thrown'} network failure with the identical UUID and one price entry`,async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(returned=>{__serviceLostResponses=1;__serviceReturnedError=returned},returned);await saveButton(page).click();await confirmed(page);
 const requests=await calls(page);expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
 expect(requests[0].p_payload).toMatchObject({id:null,name:'Внутривенный укол',work_price:700,consumables_price:50,comment:'Сохранить подробный комментарий',active:true});
 expect((await writes(page))).toHaveLength(1);expect(await page.evaluate(()=>__serviceFixtures.filter(s=>s.name==='Внутривенный укол').length)).toBe(1);expect(errors).toEqual([]);
});

test('two lost service responses freeze the exact draft and manual Save resolves the original receipt',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>__serviceLostResponses=2);await saveButton(page).click();
 await expect.poll(async()=>((await calls(page)).length)).toBe(2);await expect(saveButton(page)).toBeEnabled();await expect(saveButton(page)).toContainText('Повторить сохранение');await expectDraft(page);
 for(const id of ['serviceName','serviceWork','serviceConsumables','serviceCommentV5','serviceActive','serviceNewV5'])await expect(page.locator('#'+id)).toBeDisabled();
 await saveButton(page).click();await confirmed(page);const requests=await calls(page);expect(requests).toHaveLength(3);expect(requests[1]).toEqual(requests[0]);expect(requests[2]).toEqual(requests[0]);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('a lost service commit followed by an explicit permission error retains the original UUID until recovery',async({page})=>{
 const errors=await boot(page);await draft(page);
 await page.evaluate(()=>{__serviceLostResponses=1;__serviceAfterNetworkFailure={code:'42501',message:'Нет доступа к изменению прайса.'}});await saveButton(page).click();
 await expect(page.locator('#serviceMessage')).toContainText('Нет доступа к изменению прайса.');await expect(saveButton(page)).toBeEnabled();await expectDraft(page);await expect(page.locator('#serviceName')).toBeDisabled();
 const uncertain=await calls(page);expect(uncertain).toHaveLength(2);expect(uncertain[1]).toEqual(uncertain[0]);expect((await writes(page))).toHaveLength(1);
 await page.evaluate(()=>{__serviceFailure=null;__serviceAfterNetworkFailure=null});await saveButton(page).click();await confirmed(page);
 const requests=await calls(page);expect(requests).toHaveLength(3);expect(requests[2]).toEqual(requests[0]);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('double Save while awaiting a service response cannot submit another request',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__serviceHold=true;void saveService();void saveService()});await page.waitForFunction(()=>typeof __releaseServiceSave==='function');
 await expect(saveButton(page)).toBeDisabled();expect((await calls(page))).toHaveLength(1);await page.evaluate(()=>__releaseServiceSave());await confirmed(page);
 expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('reopening the service price list resumes the unresolved draft and later confirmation needs an explicit finish',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__serviceHold=true;void saveService()});await page.waitForFunction(()=>typeof __releaseServiceSave==='function');
 await page.evaluate(async()=>{show('workspace');await goServicesV5();newServiceV5()});await expectDraft(page);await expect(page.locator('#serviceName')).toBeDisabled();
 await page.evaluate(()=>__releaseServiceSave());await expect(saveButton(page)).toBeEnabled();await expect(saveButton(page)).toContainText('Завершить сохранение');await expectDraft(page);
 await saveButton(page).click();await confirmed(page);expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('a service response arriving on another screen cannot clear the draft or repaint the hidden list',async({page})=>{
 const errors=await boot(page);await draft(page);
 await page.evaluate(()=>{__serviceHold=true;void saveService()});await page.waitForFunction(()=>typeof __releaseServiceSave==='function');const initialList=await page.locator('#serviceList').innerHTML();
 await page.evaluate(()=>show('workspace'));await page.evaluate(()=>__releaseServiceSave());
 await expect(saveButton(page)).toBeEnabled();await expect(page.locator('#workspace')).toBeVisible();await expectDraft(page);expect(await page.locator('#serviceList').innerHTML()).toBe(initialList);
 await page.evaluate(()=>goServicesV5());await expect(saveButton(page)).toContainText('Завершить сохранение');await saveButton(page).click();await confirmed(page);
 expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});

test('a service response from a prior login cannot clear another draft of the same owner',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__serviceHold=true;void saveService()});await page.waitForFunction(()=>typeof __releaseServiceSave==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'owner-1',role:'owner',full_name:'Аниса'};await goServicesV5()});await draft(page,'Черновик новой сессии');
 await page.evaluate(()=>__releaseServiceSave());await expect(saveButton(page)).toBeEnabled();await expect(page.locator('#services')).toBeVisible();await expectDraft(page,'Черновик новой сессии');
 await saveButton(page).click();await confirmed(page,'Черновик новой сессии');const requests=await calls(page);expect(requests).toHaveLength(2);expect(requests[1].p_request_id).not.toBe(requests[0].p_request_id);expect((await writes(page))).toHaveLength(2);expect(errors).toEqual([]);
});

for(const error of [{code:'P0001',message:'Название услуги уже используется.'},{code:'42501',message:'Нет доступа к изменению прайса.'}])
test(`a confirmed ${error.code} service error unlocks the retained form without a network retry`,async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(error=>__serviceFailure=error,error);await saveButton(page).click();
 await expect(page.locator('#serviceMessage')).toContainText(error.message);await expect(saveButton(page)).toBeEnabled();await expectDraft(page);
 for(const id of ['serviceName','serviceWork','serviceConsumables','serviceCommentV5','serviceActive'])await expect(page.locator('#'+id)).toBeEnabled();
 expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(0);expect(errors).toEqual([]);
});

test('editing a service after a lost response updates its captured ID exactly once',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>editService(serviceRows[0]));await draft(page,'Капельница по новому прайсу');await page.uncheck('#serviceActive');
 await page.evaluate(()=>__serviceLostResponses=1);await saveButton(page).click();await confirmed(page,'Капельница по новому прайсу');
 const requests=await calls(page);expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(requests[0].p_payload).toMatchObject({id:'existing-1',active:false,work_price:700,consumables_price:50});
 expect((await writes(page))).toHaveLength(1);expect(await page.evaluate(()=>__serviceFixtures.length)).toBe(1);expect(errors).toEqual([]);
});

test('confirmed service creation is kept and clearly reported when price-list refresh fails',async({page})=>{
 const errors=await boot(page);await draft(page);await page.evaluate(()=>{__serviceListFailures=2;__serviceCatalogFailures=2});await saveButton(page).click();
 await expect(page.locator('#serviceMessage')).toContainText('Услуга сохранена.');await expect(page.locator('#serviceMessage')).toContainText('Список пока не обновился');await expect(saveButton(page)).toBeEnabled();
 expect(await page.evaluate(()=>serviceRows.some(s=>s.id==='created-1'&&s.name==='Внутривенный укол'))).toBe(true);expect(await page.evaluate(()=>services.some(s=>s.id==='created-1'&&s.name==='Внутривенный укол'))).toBe(true);
 await page.evaluate(()=>saveService());expect((await writes(page))).toHaveLength(1);expect(await page.evaluate(()=>__serviceFixtures.filter(s=>s.name==='Внутривенный укол').length)).toBe(1);expect(errors).toEqual([]);
});

test('a delayed price-list response captured before Save cannot remove the confirmed new service',async({page})=>{
 const errors=await boot(page);await draft(page);
 await page.evaluate(()=>{__serviceHoldList=true;window.__pendingOldServiceList=loadServicesAdmin()});await page.waitForFunction(()=>typeof __releaseServiceList==='function');
 await saveButton(page).click();await confirmed(page);
 await page.evaluate(async()=>{__releaseServiceList();await __pendingOldServiceList});
 await expect(page.locator('#serviceList')).toContainText('Внутривенный укол');
 expect(await page.evaluate(()=>serviceRows.some(s=>s.id==='created-1'&&s.name==='Внутривенный укол'))).toBe(true);
 expect((await calls(page))).toHaveLength(1);expect((await writes(page))).toHaveLength(1);expect(errors).toEqual([]);
});
