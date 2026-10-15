const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-13T07:33:27Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const actor={id:role==='admin'?'admin-1':'nurse-1',full_name:role==='admin'?'Аниса':'Марья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Марья'},{id:'nurse-2',full_name:'Азиза'}],opened={id:'shift-1',date:'2026-10-13',started_at:'2026-10-13T05:30:00Z',planned_end_at:'2026-10-13T13:00:00Z',status:'open',staff};
  const clone=value=>JSON.parse(JSON.stringify(value));
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'},{id:'patient-2',full_name:'Борис',sex:'male'}];nurses=staff;
  meds=[{id:'med-1',name:'Витамин C',consumption_unit:'амп.',sale_price:100,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Капельница',work_price:100,consumables_price:50,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0}));
  window.__visitCalls=[];window.__visitWrites=[];window.__visitRecords=new Map();window.__visitReplay=new Map();window.__visitLose=false;
  window.__doseTemplate={id:'template-1',name:'Образец капельницы',active:true,service_id:'service-1',items:[{medication_id:'med-1',quantity:2,dose:'500 мг'}]};window.__visitSeeds=new Map();window.__visitConsumed=[];
  window.patientVisitSeedV23=id=>__visitSeeds.get(id)||null;
  window.consumePatientVisitSeedV23=id=>{__visitSeeds.delete(id);__visitConsumed.push(id)};
  window.__visitSeed={id:'procedure-1',kind:'procedure',editable:true,version:3,shift_id:'past-shift',patient_id:'patient-1',patient:'Анна',nurse_id:'nurse-1',nurse:'Марья',service_id:'service-1',procedure_type:'Капельница',arrival_at:'2026-10-12T06:22:43.123Z',at:'2026-10-12T06:22:43.123Z',visit_at:'2026-10-13T07:33:27.456Z',recorded_at:'2026-10-13T07:33:27.456Z',list_total:150,charge_total:150,paid_total:0,received_total:0,initial_paid_total:0,debt_total:150,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-1',name:'Капельница',quantity:1,unit_price:150,work_price:100,consumables_price:50,line_total:150}],items:[],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:'Первоначальная запись'};
  function recordFrom(payload,previous,kind='procedure'){
   const recorded=previous?.recorded_at||'2026-10-13T07:33:27.456Z',arrival=Object.hasOwn(payload,'arrival_at')?payload.arrival_at:previous?.arrival_at||recorded;
   const pricedServices=(payload.services||[]).map(item=>({...item,name:'Капельница',unit_price:150,work_price:100,consumables_price:50,line_total:150*item.quantity}));
   const items=(payload.items||[]).map(item=>({...item,name:'Витамин C',unit:'амп.',unit_price:100,line_total:100*item.quantity}));
   return {...clone(__visitSeed),...previous,...payload,id:previous?.id||kind+'-'+(__visitRecords.size+1),kind,editable:true,version:previous?previous.version+1:1,arrival_at:arrival,at:arrival,visit_at:previous?.visit_at||recorded,recorded_at:recorded,services:pricedServices,items,list_total:[...pricedServices,...items].reduce((sum,item)=>sum+item.line_total,0),paid_total:(previous?.paid_total||0)+payload.paid_total,received_total:(previous?.paid_total||0)+payload.paid_total,debt_total:payload.charge_total-(previous?.paid_total||0)-payload.paid_total,payment_pending:payload.payment_status==='pending'};
  }
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor})};return query};
  db.rpc=async(name,args={})=>{
   __visitCalls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'||name==='crm_payment_correction_v22'||(name==='crm_clinical_v10'&&args.p_action==='treatment_edit')){
    if(__visitReplay.has(args.p_request_id))return {data:clone(__visitReplay.get(args.p_request_id))};
    const payload=args.p_payload,kind=args.p_kind||payload.kind||'procedure',prior=payload.id?__visitRecords.get(payload.id):null,record=recordFrom(payload,prior,kind);
    if(name==='crm_payment_correction_v22')Object.assign(record,{paid_total:0,received_total:0,initial_paid_total:0,debt_total:payload.charge_total});
    __visitRecords.set(record.id,record);__visitWrites.push({name,args:clone(args)});__visitReplay.set(args.p_request_id,clone(record));
    if(__visitLose){__visitLose=false;throw new TypeError('Load failed')}
    return {data:clone(record)};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:clone(__visitRecords.get(args.p_payload.id))};
    if(args.p_action==='patient_treatments')return {data:{procedures:clone([...__visitRecords.values()]),sales:[]}};
    return {data:[]};
   }
   if(name==='crm_shift_journal_v12')return {data:{date:args.p_date,time_zone:'Europe/Moscow',reports:[{shift:opened,staff,procedures:clone([...__visitRecords.values()].filter(record=>record.kind==='procedure')),sales:clone([...__visitRecords.values()].filter(record=>record.kind==='sale'))}]}};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:{shift:opened,staff,procedures:[],sales:[],receipts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0}}};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Марья',bId:'nurse-2',b:'Азиза',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function procedure(page,patient='patient-1'){await page.evaluate(patient=>openProcedure(patient),patient);await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1')}
async function seedEdit(page,overrides={}){await page.evaluate(overrides=>{__visitRecords.set('procedure-1',{...__visitSeed,...overrides});return editTreatmentV10('procedure','procedure-1')},overrides);await expect(page.locator('#procedure')).toBeVisible()}
const writes=page=>page.evaluate(()=>__visitWrites);

for(const role of ['nurse','admin'])test(role+' changes a copied protocol dose, medication selection and patient charge without changing the shared template',async({page})=>{
 const errors=await boot(page,role);await procedure(page);await page.fill('#procVisitTimeV23','10:25');await page.fill('#procNotes','Индивидуальная запись');
 await page.evaluate(()=>{meds.push({id:'med-2',name:'Витамин B',consumption_unit:'амп.',sale_price:75,work_qty:0,active:true});CrmClinicalV10.applyTemplate(__doseTemplate)});
 await expect(page.locator('#procMeds .meddose-v24')).toHaveValue('500 мг');await expect(page.locator('#procPaid')).toHaveValue('350.00');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:25');await expect(page.locator('#procNotes')).toHaveValue('Индивидуальная запись');
 await page.fill('#procMeds .meddose-v24','250 мг');await page.fill('#procMeds .medqty','1');await page.evaluate(()=>chooseMedication('procMeds','med-2'));await page.locator('#procMeds .medrow[data-medication-id="med-1"] button.danger').click();await expect(page.locator('#procPaid')).toHaveValue('225.00');
 await page.fill('#procMeds .meddose-v24','2 мл');await page.fill('#procChargeInPaymentV11','200');await page.fill('#procDiscountInPaymentV11','Индивидуальная скидка');await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({patient_id:'patient-1',nurse_id:'nurse-1',arrival_at:'2026-10-13T07:25:00.000Z',charge_total:200,paid_total:0,payment_status:'pending',discount_comment:'Индивидуальная скидка',notes:'Индивидуальная запись',items:[{medication_id:'med-2',quantity:1,dose:'2 мл'}]});
 expect(await page.evaluate(()=>__doseTemplate.items)).toEqual([{medication_id:'med-1',quantity:2,dose:'500 мг'}]);expect(await page.evaluate(()=>meds[0].sale_price)).toBe(100);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('appending a protocol retains patient, visit, payment method, manual charge, own medicines and notes',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.fill('#procVisitTimeV23','10:25');await page.fill('#procNotes','Сохранить заметку');await page.click('#procAddOwnV10');await page.fill('.own-name-v10','Свой B12');await page.selectOption('#procPaymentStatusV10','debt');await page.evaluate(()=>selectPaymentMethodV5('proc','terminal'));await page.fill('#procReceivedV10','20');
 await page.fill('#procChargeInPaymentV11','100');await page.fill('#procDiscountInPaymentV11','Согласованная скидка');await page.check('#procPayConfirmed');await page.evaluate(()=>CrmClinicalV10.applyTemplate(__doseTemplate,'append'));
 await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('100');await expect(page.locator('#procPatient')).toHaveValue('patient-1');await expect(page.locator('#procNurse')).toHaveValue('nurse-1');await expect(page.locator('#procVisitTimeV23')).toHaveValue('10:25');await expect(page.locator('#procPaymentStatusV10')).toHaveValue('debt');await expect(page.locator('#procReceivedV10')).toHaveValue('20');await expect(page.locator('#procPayTerminal')).toHaveValue('20.00');await expect(page.locator('#procNotes')).toHaveValue('Сохранить заметку');await expect(page.locator('.own-name-v10')).toHaveValue('Свой B12');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();
 expect(await page.evaluate(()=>CrmClinicalV10.templateState())).toMatchObject({ready:true,locked:false,editing:false,hasSelection:true});expect(await page.evaluate(()=>CrmClinicalV10.applyTemplate({active:true,service_id:'service-1',items:[]},'append').services)).toEqual([{service_id:'service-1',quantity:1}]);expect(errors).toEqual([]);
});

test('editing an unpaid dose preserves original price snapshots, exact visit seconds and zero received',async({page})=>{
 const errors=await boot(page);await seedEdit(page,{items:[{medication_id:'med-1',name:'Витамин C',quantity:1,dose:'100 мг',unit:'амп.',unit_price:100,line_total:100}],list_total:250,charge_total:250,debt_total:250});await expect(page.locator('#procMeds .meddose-v24')).toHaveValue('100 мг');
 await page.evaluate(()=>meds[0].sale_price=9999);await page.fill('#procMeds .meddose-v24','50 мг');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const payload=(await writes(page))[0].args.p_payload;expect(payload).toMatchObject({id:'procedure-1',expected_version:3,shift_id:'past-shift',charge_total:250,paid_total:0,payment_status:'pending',edit_reason:null,items:[{medication_id:'med-1',quantity:1,dose:'50 мг'}]});expect(payload).not.toHaveProperty('arrival_at');expect(errors).toEqual([]);
});

test('lost response freezes individual doses and prevents applying another protocol until retry is confirmed',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>{CrmClinicalV10.applyTemplate(__doseTemplate);__visitLose=true});await page.fill('#procMeds .meddose-v24','250 мг');await page.click('#procSavePendingV14');await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await expect(page.locator('#procMeds .meddose-v24')).toBeDisabled();
 expect(await page.evaluate(()=>{try{CrmClinicalV10.applyTemplate(__doseTemplate);return null}catch(error){return error.message}})).toContain('подтверждения');expect(await page.evaluate(()=>CrmClinicalV10.templateState().locked)).toBe(true);await page.evaluate(()=>document.querySelector('.meddose-v24').value='999 мг');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const calls=await page.evaluate(()=>__visitCalls.filter(call=>call.name==='record_treatment_v5'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(calls[1].args.p_payload.items[0].dose).toBe('250 мг');expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('an unavailable protocol or conflicting appended dose does not partially change a patient draft',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>CrmClinicalV10.applyTemplate(__doseTemplate));
 const state=()=>page.evaluate(()=>({rows:rows('procMeds'),service:document.getElementById('procService').value,charge:document.getElementById('procPaid').value}));const before=await state();
 expect(await page.evaluate(()=>{try{CrmClinicalV10.applyTemplate({...__doseTemplate,items:[{medication_id:'med-1',quantity:1,dose:'500 мг'},{medication_id:'missing',quantity:1}]});return null}catch(error){return error.message}})).toContain('недоступный');expect(await state()).toEqual(before);
 expect(await page.evaluate(()=>{try{CrmClinicalV10.applyTemplate({...__doseTemplate,items:[{medication_id:'med-1',quantity:1,dose:'250 мг'}]},'append');return null}catch(error){return error.message}})).toContain('разные дозы');expect(await state()).toEqual(before);expect(errors).toEqual([]);
});

test('excessive dose text blocks a clinical write and sales retain their original quantity-only payload',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>{CrmClinicalV10.applyTemplate(__doseTemplate);document.querySelector('.meddose-v24').value='а'.repeat(201)});await page.click('#procSavePendingV14');await expect(page.locator('#procedureMessage')).toContainText('200 символов');expect(await writes(page)).toEqual([]);
 await page.evaluate(()=>openSale());await expect(page.locator('#sale')).toBeVisible();await page.evaluate(()=>chooseMedication('saleMeds','med-1'));await expect(page.locator('#saleMeds .meddose-v24')).toHaveCount(0);expect(await page.evaluate(()=>rows('saleMeds'))).toEqual([{medication_id:'med-1',quantity:1}]);expect(errors).toEqual([]);
});


test('a medicines-only protocol preserves the selected procedure instead of clearing its service',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>CrmClinicalV10.applyTemplate({active:true,items:[{medication_id:'med-1',quantity:1,dose:'50 мг'}]}));await expect(page.locator('#procService')).toHaveValue('service-1');await expect(page.locator('#procPaid')).toHaveValue('250.00');expect(errors).toEqual([]);
});

test('an appended protocol retains archived captured medication names, doses and original prices in an edited record',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{meds=[];__visitRecords.set('procedure-1',{...__visitSeed,items:[{medication_id:'med-1',name:'Архивный витамин C',unit:'фл.',quantity:1,dose:'50 мг',unit_price:100,line_total:100}],list_total:250,charge_total:250,debt_total:250});return editTreatmentV10('procedure','procedure-1')});await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureTemplateV5')).toBeVisible();
 await page.evaluate(()=>{meds.push({id:'med-2',name:'Новый препарат',consumption_unit:'амп.',sale_price:75,active:true,work_qty:0});CrmClinicalV10.applyTemplate({active:true,service_id:'service-1',items:[{medication_id:'med-2',quantity:1,dose:'2 мл'}]},'append')});
 await expect(page.locator('#procMeds .medrow[data-medication-id="med-1"]')).toContainText('Архивный витамин C');await expect(page.locator('#procMeds .medrow[data-medication-id="med-1"]')).toContainText('фл.');await expect(page.locator('#procMeds .medrow[data-medication-id="med-1"] .meddose-v24')).toHaveValue('50 мг');await expect(page.locator('#procList')).toContainText('325');await expect(page.locator('#procPaid')).toHaveValue('325.00');expect(await page.evaluate(()=>CrmClinicalV10.applyTemplate({active:true,service_id:'service-1',items:[]},'append').services)).toEqual([{service_id:'service-1',quantity:1}]);expect(errors).toEqual([]);
});

for(const status of ['pending','debt'])test('nurse retains an increased individual '+status+' charge independently of original catalog prices',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>CrmClinicalV10.applyTemplate(__doseTemplate));await page.fill('#procChargeInPaymentV11','400');await page.selectOption('#procPaymentStatusV10',status);
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('комментарий');expect(await writes(page)).toEqual([]);await page.fill('#procDiscountInPaymentV11','Индивидуальная цена согласована');await expect(page.locator('#procDebtSummaryV10')).toContainText('Надбавка: 50');await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({charge_total:400,paid_total:0,payment_status:status,discount_comment:'Индивидуальная цена согласована'});expect(await page.evaluate(()=>__visitRecords.get('procedure-1'))).toMatchObject({list_total:350,charge_total:400,paid_total:0,debt_total:400});expect(await page.evaluate(()=>meds[0].sale_price)).toBe(100);expect(errors).toEqual([]);
});

test('mixed payment of an increased individual charge saves exact receipt allocations and own medicine dose',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.evaluate(()=>CrmClinicalV10.applyTemplate(__doseTemplate));await page.click('#procAddOwnV10');await page.fill('.own-name-v10','Свой B12');await page.fill('.own-dose-v24','500 мкг');await page.fill('#procChargeInPaymentV11','400');await page.fill('#procDiscountInPaymentV11','Индивидуальная цена согласована');await page.evaluate(()=>selectPaymentMethodV5('proc','mixed'));
 await page.fill('#procPayCash','100');await page.fill('#procPayTerminal','200');await page.fill('#procPayOwnerCard','100');await page.fill('#procPayTender','100');await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({charge_total:400,paid_total:400,payment_status:'paid',payments:{cash:100,terminal:200,owner_card:100,cash_received:100},own_medications:[{name:'Свой B12',quantity:1,unit:'амп.',source:'patient',dose:'500 мкг'}]});expect(await page.evaluate(()=>__visitRecords.get('procedure-1'))).toMatchObject({list_total:350,charge_total:400,debt_total:0});expect(errors).toEqual([]);
});


for(const role of ['nurse','admin'])test(role+' copies a fractional milligram protocol and can adjust it for one patient without changing the specimen',async({page})=>{
 const errors=await boot(page,role);await page.evaluate(()=>{Object.assign(meds[0],{name:'Мунджаро',sale_price:1300,consumption_unit:'мг'});__doseTemplate.items=[{medication_id:'med-1',quantity:2.5,dose:'Индивидуально'}]});await procedure(page);await page.evaluate(()=>CrmClinicalV10.applyTemplate(__doseTemplate));
 await expect(page.locator('#procMeds .medqty')).toHaveValue('2.5');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('3400.00');await page.locator('#procMeds .medqty').fill('7,5');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('9900.00');await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload).toMatchObject({items:[{medication_id:'med-1',quantity:7.5,dose:'Индивидуально'}],charge_total:9900,paid_total:0,payment_status:'pending'});expect(await page.evaluate(()=>__doseTemplate.items)).toEqual([{medication_id:'med-1',quantity:2.5,dose:'Индивидуально'}]);expect(errors).toEqual([]);
});
