// Run with: node tests/crm-patients-browser.cjs. All Supabase requests are mocked.
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let browser;
(async()=>{
browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await page.addInitScript(()=>{
 window.requests=[];window.patientData=[{id:'p1',full_name:'Анна',sex:'female',created_at:'2026-10-06'},{id:'p2',full_name:'Анна',phone:'1234567',created_at:'2026-10-06'}];
 window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},rpc:async(name,args)=>{
 requests.push({name,args});let data=null;
 if(name==='crm_management_v5'){
  const p=args.p_payload;
  if(args.p_action==='patient_list')data=patientData.filter(x=>p.include_archived||!x.archived_at);
  if(args.p_action==='patient_save'){let x=patientData.find(x=>x.id===p.id);if(x)Object.assign(x,p);else{ x={...p,id:'p'+(patientData.length+1)};patientData.push(x);}data=x;}
  if(args.p_action==='patient_archive'){const x=patientData.find(x=>x.id===p.id);x.archived_at=p.archived?'2026-10-06':null;data=x;}
 }
 if(name==='patient_history_v8')data={procedures:[{visit_at:'2026-10-06T10:00:00Z',procedure_type:'Капельница',paid_total:5000,discount_amount:100,medications:[{name:'Самыр',quantity:1}]}],sales:[]};
 if(name==='patient_files_v8'||name==='patient_courses_test')data=[];
 if(name==='quick_ui_v4')data=args.p_action==='last_procedure'?{at:'2026-10-06',service_name:'Капельница',items:[]}:{favorites:[],recent:[],shifts:[]};
 return {data,error:null};
 }};
});
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='cdn.jsdelivr.net'||u.pathname.includes('/vendor/supabase-')){await route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});return;}
 if(u.hostname!=='crm.test'){await route.abort();return;}
 let filename=u.pathname==='/'?'index.html':u.pathname.slice(1);
 if(!fs.existsSync(path.join(root,filename))){await route.abort();return;}
 let body=fs.readFileSync(path.join(root,filename),'utf8');
 await route.fulfill({contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body});
});
await page.goto('http://crm.test/');
await page.evaluate(async()=>{currentStaff={id:'owner',role:'owner',full_name:'Владелец'};await loadPatients();goNewPatient()});
assert.equal(await page.locator('#psexV5').inputValue(),'unknown');
assert.match(await page.locator('label[for=pname]').textContent(),/Имя/);
await page.fill('#pname','Аниса');await page.evaluate(()=>addPatient());
assert.equal(await page.locator('#patientCardName').textContent(),'Аниса');assert.ok(await page.locator('#patientHistory').textContent().then(x=>x.includes('5')));
await page.click('#patientEditV5');await page.fill('#pname','Аниса обновлено');await page.evaluate(()=>addPatient());
assert.equal(await page.locator('#patientCardName').textContent(),'Аниса обновлено');assert.equal(await page.evaluate(()=>patientData.length),3);
await page.click('#patientArchiveV5');await page.waitForFunction(()=>document.getElementById('patientArchiveV5').textContent==='Восстановить из архива');
assert.equal(await page.evaluate(()=>patients.some(p=>p.id==='p3')),false);assert.equal(await page.locator('button[onclick="openProcedure(currentPatientId)"]').isDisabled(),true);
await page.evaluate(()=>goPatients());await page.check('#patientIncludeArchivedV5');assert.equal(await page.locator('[data-patient-id="p3"]').count(),1);
await page.evaluate(async()=>{currentStaff={id:'nurse',role:'nurse',full_name:'Медсестра'};await loadPatients();await openPatient('p1')});
assert.equal(await page.locator('#patientEditV5').isVisible(),false);assert.equal(await page.locator('#patientHistory').textContent().then(x=>x.includes('5 000')||x.includes('5 000')),false);
await page.evaluate(()=>{window.SpeechRecognition=null;window.webkitSpeechRecognition=null;openVoiceV5()});
assert.equal(await page.locator('#voiceListenV5').isDisabled(),true);
await page.fill('#voiceTextV5','Создай пациента Нина');await page.click('#voicePreviewButtonV5');
const before=await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='patient_save').length);
assert.equal(await page.locator('#voiceApplyV5').isEnabled(),true);await page.click('#voiceApplyV5');assert.equal(await page.locator('#pname').inputValue(),'Нина');
assert.equal(await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='patient_save').length),before);
await page.evaluate(()=>openVoiceV5());await page.fill('#voiceTextV5','Создай процедуру для Анна');await page.click('#voicePreviewButtonV5');await page.waitForSelector('#voiceChoiceV5');
assert.equal(await page.locator('#voiceApplyV5').isDisabled(),true);await page.selectOption('#voiceChoiceV5','p2');assert.equal(await page.locator('#voiceApplyV5').isEnabled(),true);
await page.fill('#voiceTextV5','Сохрани процедуру');assert.equal(await page.locator('#voiceApplyV5').isDisabled(),true);await page.click('#voicePreviewButtonV5');assert.equal(await page.locator('#voiceApplyV5').isDisabled(),true);
await page.click('#voiceCloseV5');
await page.evaluate(()=>{meds=[{id:'m1',name:'Самыр',work_qty:5,sale_price:100,consumption_unit:'ampoule'}];loadMeds=async()=>{};show('procedure');openVoiceV5()});
await page.fill('#voiceTextV5','Добавь препарат Самыр количество 2');await page.click('#voicePreviewButtonV5');assert.equal(await page.locator('#procMeds .medrow').count(),0);
await page.click('#voiceApplyV5');assert.equal(await page.locator('#procMeds .medqty').inputValue(),'2');
assert.equal(await page.evaluate(()=>requests.some(x=>/save_procedure|save_sale|warehouse_v2/.test(x.name))),false);
await page.evaluate(()=>openVoiceV5());await page.fill('#voiceTextV5','Создай препарат Самыр');await page.click('#voicePreviewButtonV5');assert.equal(await page.locator('#voiceApplyV5').isDisabled(),true);
assert.deepEqual(errors,[]);
console.log('PASS: mobile installation, patient create/edit/archive, nurse money hidden, voice typed fallback, confirmation draft only, ambiguity choice, invalidation, no event/stock writes');
await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1});
