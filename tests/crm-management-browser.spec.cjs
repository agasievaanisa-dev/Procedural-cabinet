const {test}=require('@playwright/test');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root='/workspace/procedural-cabinet';
test('owner management mobile flows and nurse access restrictions',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.requests=[];
  window.staffData=[{id:'owner',full_name:'Владелец',role:'owner',active:true,email:'owner@example.com',auth_user_id:'a1'},{id:'n1',full_name:'Нина',role:'nurse',active:true,auth_user_id:'a2',email:'nina@example.com'}];
  window.serviceData=[{id:'s1',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  window.medData=[{id:'m1',name:'Самыр',manufacturer:'Производитель',release_form:'Раствор',comment:'Комментарий',consumption_unit:'амп.',work_qty:10,reserve_qty:10,work_available:10,reserve_available:10,units_per_package:5,purchase_price:100,sale_price:20,active:true}];window.templateData=[];
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},from:()=>({select(){return this},eq(){return this},order:async()=>({data:staffData.filter(s=>s.role==='nurse'),error:null})}),functions:{invoke:async(name,args)=>{requests.push({name,args});staffData.push({id:'new1',full_name:args.body.full_name,email:args.body.email,auth_user_id:'a3',role:'nurse',active:true});return {data:{staff:staffData.at(-1)},error:null}}},rpc:async(name,args)=>{
   requests.push({name,args});let data=[];const a=args?.p_action,p=args?.p_payload;
   if(name==='crm_management_v5'){
    if(a==='staff_list')data=staffData;
    if(a==='staff_save'){Object.assign(staffData.find(s=>s.id===p.id),p);data=staffData.find(s=>s.id===p.id)}
    if(a==='services_list')data=serviceData;
    if(a==='service_save'){data={...p,id:p.id||'s2'};serviceData.push(data)}
    if(a==='templates_list')data=templateData;
    if(a==='template_save'){data={...p,id:p.id||'t1'};templateData.push(data)}
    if(a==='audit_list')data=[{actor_name:'Владелец',created_at:'2026-10-06T12:00:00Z',action:'update',entity_type:'medication',reason:'<img src=x onerror=alert(1)>',before_data:{name:'Самыр',sale_price:20},after_data:{name:'Самыр',sale_price:25}}];
    if(a==='backup_export')data={version:'5',exported_at:'2026-10-06',tables:{'public.patients':[]}};
   }
   if(name==='crm_backup_status_v5')data={last_run:null,last_success:null};
   if(name==='crm_finance_v5'){if(a==='settings_get')data={float_amount:50000,time_zone:'Europe/Moscow'};if(a==='settings_save')data=p}
   if(name==='work_catalog_v2')data=medData;if(name==='nurse_service_catalog')data=serviceData;
   if(name==='warehouse_v5'||name==='warehouse_v2'){
    if(a==='list')data=medData;if(a==='save'){Object.assign(medData[0],p);data={id:'m1'}}
    if(a==='batches')data=[{id:'b1',batch_number:'N-17',supplier:'Поставщик',received_date:'2026-10-01',expiry_date:'2027-01-01',quantity_remaining:20,work_quantity:10,quantity_received:20,purchase_price_per_unit:20}];
    if(a==='history')data=[];
   }
   return {data,error:null};
  }};
 });
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname==='cdn.jsdelivr.net'||u.pathname.endsWith('/vendor/supabase-2.117.2.js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(u.hostname!=='127.0.0.1')return route.abort();const filename=u.pathname==='/'?'index.html':u.pathname.slice(1);
  let body=fs.existsSync(path.join(root,filename))?fs.readFileSync(path.join(root,filename),'utf8'):'';
  await route.fulfill({contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('http://127.0.0.1:4173/');await page.evaluate(async()=>{currentStaff={id:'owner',role:'owner',full_name:'Владелец'};await openStaffV5()});
 assert.equal(await page.locator('#staffListV5 button').count(),2);await page.fill('#staffCreateNameV5','Амина');await page.fill('#staffCreateEmailV5','amina@example.com');await page.fill('#staffCreatePasswordV5','long-secure-password');await page.click('button[onclick="createStaffAccountV5()"]');await page.waitForFunction(()=>document.getElementById('staffListV5').children.length===3);assert.equal(await page.locator('#staffCreatePasswordV5').inputValue(),'');
 await page.evaluate(()=>goServicesV5());await page.fill('#serviceName','Новая услуга');await page.fill('#serviceWork','700');await page.fill('#serviceConsumables','50');await page.fill('#serviceCommentV5','Комментарий услуги');await page.click('button[onclick="saveService()"]');await page.waitForFunction(()=>serviceData.length===2);assert.equal(await page.evaluate(()=>requests.find(x=>x.args?.p_action==='service_save').args.p_payload.comment),'Комментарий услуги');
 await page.evaluate(()=>openTemplatesV5());await page.click('button[onclick="editTemplateV5(-1)"]');await page.fill('#templateNameV5','Капельница №1');await page.selectOption('#templateServiceV5','s1');await page.click('button[onclick="addTemplateItemV5()"]');await page.selectOption('.template-med-v5','m1');await page.fill('.template-quantity-v5','2');await page.click('button[onclick="saveTemplateV5()"]');await page.waitForFunction(()=>templateData.length===1);
 await page.evaluate(async()=>{show('procedure');procService.innerHTML=services.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');await loadProcedureTemplatesV5()});const before=await page.evaluate(()=>requests.length);await page.selectOption('#procTemplateSelectV5','0');await page.click('button[onclick="applyProcedureTemplateV5()"]');assert.equal(await page.locator('#procMeds .medqty').inputValue(),'2');assert.equal(await page.evaluate(()=>requests.length),before);
 await page.evaluate(async()=>{await loadInventory();openMedForm('m1')});await page.waitForFunction(()=>document.getElementById('batchList').textContent.includes('N-17'));assert.equal(await page.locator('#medManufacturerV5').inputValue(),'Производитель');assert.ok((await page.locator('#batchList').textContent()).includes('Поставщик'));
 await page.locator('#medDetails').evaluate(el=>el.open=true);await page.fill('#medManufacturerV5','Новый производитель');await page.fill('#medReleaseFormV5','Таблетки');await page.fill('#medCommentV5','Подробности');await page.evaluate(()=>warehouseRpc('save',{id:'m1',name:'Самыр'},true));assert.equal(await page.evaluate(()=>requests.findLast(x=>x.args?.p_action==='save').args.p_payload.manufacturer),'Новый производитель');
 await page.locator('#receivePanel').evaluate(el=>el.open=true);await page.fill('#receiveBatchNumberV5','A-99');await page.fill('#receiveSupplierV5','Поставщик 2');await page.evaluate(()=>warehouseRpc('receive',{id:'m1',packages:1,price:100,expiry:'2027-01-01'},true));assert.equal(await page.evaluate(()=>requests.findLast(x=>x.args?.p_action==='receive').args.p_payload.batch_number),'A-99');
 await page.evaluate(()=>openSettingsV5());assert.ok((await page.locator('#settingsV5').textContent()).includes('Москва (UTC+3)'));assert.equal(await page.locator('#settingsTimezoneV5').count(),0);await page.fill('#settingsFloatV5','45000');await page.click('button[onclick="saveSettingsV5()"]');assert.equal(await page.evaluate(()=>requests.findLast(x=>x.args?.p_action==='settings_save').args.p_payload.time_zone),'Europe/Moscow');
 await page.evaluate(()=>openAuditV5());assert.equal(await page.locator('#auditListV5 img').count(),0);assert.ok((await page.locator('#auditListV5').textContent()).includes('Цена продажи'));
 await page.evaluate(async()=>{await signOut();currentStaff={id:'n1',role:'nurse'};openStaffV5()});assert.equal(await page.locator('#staffV5').count(),0);assert.ok((await page.locator('#homeMessage').textContent()).includes('владельцу'));
 assert.deepEqual(errors,[]);console.log('PASS: mobile staff/accounts, service comment, editable templates, metadata/batches, fixed Moscow settings, escaped audit and nurse access');
});
