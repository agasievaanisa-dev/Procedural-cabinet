const {test,expect}=require('@playwright/test');
const clone=value=>JSON.parse(JSON.stringify(value));
async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},rpc:async()=>({data:[]})})}'}));
 await page.goto('/');await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));window.__templateCalls=[];window.__templates=[];window.__templateReceipts=new Map();
  window.__meds=[{id:'med1',name:'Самыр (Италия)',dosage:'400 мг',sale_price:2500,consumption_unit:'компл.',active:true,work_qty:0},{id:'med2',name:'Витамин C (Германия)',dosage:'1 г',sale_price:1200,consumption_unit:'амп.',active:true,work_qty:0}];
  window.__services=[{id:'service1',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  currentStaff={id:role==='nurse'?'nurse1':'admin1',role,full_name:role==='nurse'?'Марья':'Аниса',active:true};
  const staff=[{id:'nurse1',full_name:'Марья',role:'nurse'},{id:'nurse2',full_name:'Азиза',role:'nurse'}];nurses=staff;patients=[{id:'patient1',full_name:'Анна',sex:'female'}];meds=clone(__meds);services=clone(__services);inventory=clone(__meds);
  db.rpc=async(name,args={},options)=>{
   if(name==='crm_save_recovery_v16'){const response=await db.rpc(args.p_rpc,args.p_args,{requestId:args.p_request_id});return response.error?response:{data:{result:response.data}}}
   __templateCalls.push({name,args:clone(args),options:options?clone(options):null});
   if(name==='crm_management_v5'){
    if(args.p_action==='templates_list')return {data:clone(__templates)};
    if(args.p_action==='template_save'){
     const id=options?.requestId||args.p_request_id;
     if(id&&__templateReceipts.has(id))return {data:clone(__templateReceipts.get(id))};
     const t={...clone(args.p_payload),id:args.p_payload.id||'template'+(__templates.length+1)};const i=__templates.findIndex(row=>row.id===t.id);if(i<0)__templates.push(t);else __templates[i]=t;if(id)__templateReceipts.set(id,t);return {data:clone(t)};
    }
   }
   if(name==='work_catalog_v2')return {data:clone(__meds)};if(name==='nurse_service_catalog')return {data:clone(__services)};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:[]};
   if(name.startsWith('warehouse'))return {data:clone(__meds)};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[{id:'shift1',staff,started_at:'2026-10-13T05:30:00Z',planned_end_at:'2026-10-13T13:00:00Z'}]}};signMedicationPhotos=async()=>{};
  shift={id:'shift1',aId:'nurse1',bId:'nurse2',a:'Марья',b:'Азиза',type:'08:30–16:00'};financeAccountingMode5={payment_only:true,stock_deducted:false};show('workspace');
 },role);return errors;
}
async function create(page,name='Готовый протокол'){
 await page.click('button[onclick="openTemplatesV5()"]');await expect(page.locator('#templatesV5')).toBeVisible();await expect(page.locator('button[onclick="editTemplateV5(-1)"]')).toBeEnabled();
 await page.click('button[onclick="editTemplateV5(-1)"]');await page.fill('#templateNameV5',name);await page.selectOption('#templateServiceV5','service1');await page.click('button[onclick="addTemplateItemV5()"]');
 await page.fill('.template-med-search-v24','Самыр');await page.selectOption('.template-med-v5','med1');await page.fill('.template-quantity-v5','2');await page.fill('.template-dose-input-v24','400 мг / 5 мл');await page.click('button[onclick="saveTemplateV5()"]');await expect(page.locator('#templatesMessageV5')).toContainText('Шаблон сохранён');
}
async function procedure(page){await page.evaluate(()=>openProcedure('patient1'));await expect(page.locator('#procedure')).toBeVisible();await page.click('#procTemplatesToggleV24');await page.selectOption('#procTemplateSelectV5','template1')}
test('nurse creates searchable shared protocol with dose and whole container quantity while owner controls remain restricted',async({page})=>{
 const errors=await boot(page);await create(page);const data=await page.evaluate(()=>__templates[0]);expect(data.items).toEqual([{medication_id:'med1',quantity:2,dose:'400 мг / 5 мл'}]);
 expect(await page.evaluate(()=>__templateCalls.some(call=>call.name.startsWith('warehouse')))).toBe(false);await expect(page.locator('#templatesListV5')).toContainText('Доза: 400 мг / 5 мл');
 await page.fill('#templatesSearchV24','не существует');await expect(page.locator('#templatesListV5')).toContainText('не найдены');await page.fill('#templatesSearchV24','Готовый');await expect(page.locator('#templatesListV5 button')).toHaveCount(1);
 await page.evaluate(()=>openStaffV5());await expect(page.locator('#staffV5')).toHaveCount(0);await expect(page.locator('#homeMessage')).toContainText('владельцу');expect(errors).toEqual([]);
});
test('patient template application requires replacement choice then dose, quantity and individual price edits leave shared specimen unchanged',async({page})=>{
 const errors=await boot(page);await create(page);await procedure(page);await page.evaluate(()=>{addMedRow('procMeds','med2',1);procNotes.value='Личная заметка'});
 await page.click('button[onclick="applyProcedureTemplateV5()"]');await expect(page.locator('#procTemplateConfirmV24')).toBeVisible();await expect(page.locator('#procMeds .medrow')).toHaveCount(1);await expect(page.locator('#procMeds')).toContainText('Витамин C');
 await page.click('button[onclick="confirmProcedureTemplateV24(\'replace\')"]');await expect(page.locator('#procMeds')).toContainText('Самыр');await expect(page.locator('#procMeds .meddose-v24')).toHaveValue('400 мг / 5 мл');await expect(page.locator('#procMeds .medqty')).toHaveValue('2');
 await page.fill('#procMeds .meddose-v24','200 мг');await page.fill('#procMeds .medqty','1');await page.fill('#procPaid','2000');await page.fill('#procDiscountComment','Скидка администратора');
 expect(await page.evaluate(()=>__templates[0].items)).toEqual([{medication_id:'med1',quantity:2,dose:'400 мг / 5 мл'}]);await expect(page.locator('#procNotes')).toHaveValue('Личная заметка');await expect(page.locator('#procPaid')).toHaveValue('2000');await expect(page.locator('#procPatient')).toHaveValue('patient1');
 expect(await page.evaluate(()=>__templateCalls.some(call=>call.name==='record_treatment_v5'))).toBe(false);expect(errors).toEqual([]);
});
test('nurse archives shared template and administrator can restore it through same template button',async({page})=>{
 const errors=await boot(page);await create(page);await page.click('#templatesListV5 button');await page.uncheck('#templateActiveV5');await page.click('button[onclick="saveTemplateV5()"]');await expect(page.locator('#templatesListV5')).toContainText('В архиве');
 await page.evaluate(()=>{currentStaff={id:'admin1',full_name:'Аниса',role:'admin',active:true};show('workspace')});await page.click('button[onclick="openTemplatesV5()"]');await page.click('#templatesListV5 button');await page.check('#templateActiveV5');await page.fill('#templateNameV5','Исправленный образец');await page.click('button[onclick="saveTemplateV5()"]');await expect(page.locator('#templatesListV5')).toContainText('Исправленный образец');await expect(page.locator('#templatesListV5')).toContainText('Активен');expect(errors).toEqual([]);
});
test('unpriced or deactivated catalog medicine rejects the whole protocol before replacing the patient draft',async({page})=>{
 const errors=await boot(page);await create(page);await procedure(page);await page.evaluate(()=>{addMedRow('procMeds','med2',1);meds.find(row=>row.id==='med1').sale_price=null});await page.click('button[onclick="applyProcedureTemplateV5()"]');await expect(page.locator('#procTemplateMessageV5')).toContainText('не указана цена');await expect(page.locator('#procMeds')).toContainText('Витамин C');await expect(page.locator('#procMeds .medrow')).toHaveCount(1);
 await page.evaluate(()=>{meds.find(row=>row.id==='med1').sale_price=2500;meds.find(row=>row.id==='med1').active=false});await page.click('button[onclick="applyProcedureTemplateV5()"]');await expect(page.locator('#procTemplateMessageV5')).toContainText('недоступен');await expect(page.locator('#procMeds')).toContainText('Витамин C');expect(errors).toEqual([]);
});
test('append preserves patient data, actual visit, payment choice and manual charge without doubling existing service',async({page})=>{
 const errors=await boot(page);await create(page);await procedure(page);await page.evaluate(()=>addMedRow('procMeds','med2',1));await page.fill('#procVisitDateV23','2026-10-11');await page.fill('#procVisitTimeV23','10:25');await page.fill('#procPaid','1500');await page.fill('#procDiscountComment','Постоянная скидка');await page.selectOption('#procPaymentStatusV10','debt');
 await page.click('button[onclick="applyProcedureTemplateV5()"]');await page.click('button[onclick="confirmProcedureTemplateV24(\'append\')"]');await expect(page.locator('#procMeds .medrow')).toHaveCount(2);await expect(page.locator('#procAdditionalServicesV10 .clinical-service-v10')).toHaveCount(0);await expect(page.locator('#procPaid')).toHaveValue('1500');await expect(page.locator('#procPaymentStatusV10')).toHaveValue('debt');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:25');await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-11');expect(errors).toEqual([]);
});


for(const role of ['nurse','admin'])test(role+' saves a reusable 2.5 mg protocol without coercing its quantity to a whole ampoule',async({page})=>{
 const errors=await boot(page,role);await page.evaluate(()=>{Object.assign(__meds[0],{name:'Рета',dosage:'1 мг',sale_price:1500,consumption_unit:'мг'});meds=structuredClone(__meds);inventory=structuredClone(__meds)});
 await page.click('button[onclick="openTemplatesV5()"]');await page.click('button[onclick="editTemplateV5(-1)"]');await page.fill('#templateNameV5','Мерный образец');await page.selectOption('#templateServiceV5','service1');await page.click('button[onclick="addTemplateItemV5()"]');await page.selectOption('.template-med-v5','med1');await page.fill('.template-quantity-v5','2,5');await page.click('button[onclick="saveTemplateV5()"]');await expect(page.locator('#templatesMessageV5')).toContainText('Шаблон сохранён');
 expect(await page.evaluate(()=>__templates[0].items)).toEqual([{medication_id:'med1',quantity:2.5,dose:null}]);const saved=await page.evaluate(()=>__templateCalls.filter(call=>call.name==='crm_management_v5'&&call.args.p_action==='template_save'));expect(saved).toHaveLength(1);expect(saved[0].args.p_payload.items[0].quantity).toBe(2.5);expect(errors).toEqual([]);
});
