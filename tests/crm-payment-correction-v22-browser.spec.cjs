const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='admin',paid=8000){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:'#'}})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async({role,paid})=>{
  window.__correctionCalls=[];window.__correctionSaved=[];window.__correctionReceipts=new Map();window.__correctionLost=false;window.__correctionError=null;window.__correctionMalformed=false;window.__correctionDefer=false;
  const actor={id:role==='nurse'?'nurse-1':'admin-1',full_name:role==='nurse'?'Марья':'Аниса',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Марья'},{id:'nurse-2',full_name:'Азиза'}],opened={id:'today-shift',started_at:'2026-10-12T05:30:00Z',planned_end_at:'2026-10-12T13:00:00Z',staff};
  patients=[{id:'patient-1',full_name:'Адиль',sex:'male'}];nurses=staff;
  meds=[{id:'med-1',name:'Препарат по сохранённой цене',consumption_unit:'фл.',sale_price:99000,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Капельница',work_price:9999,consumables_price:0,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0,active:true}));
  window.__correctionRecord={id:'procedure-1',kind:'procedure',editable:true,version:3,shift_id:'yesterday-shift',patient_id:'patient-1',patient:'Адиль',nurse_id:'nurse-1',nurse:'Марья',service_id:'service-1',procedure_type:'Капельница',visit_at:'2026-10-11T07:00:00Z',at:'2026-10-11T07:00:00Z',list_total:8000,charge_total:8000,paid_total:paid,received_total:paid,initial_paid_total:paid,debt_total:8000-paid,stock_deducted:false,services:[{service_id:'service-1',name:'Капельница',quantity:1,work_price:1000,consumables_price:0,unit_price:1000,line_total:1000}],items:[{medication_id:'med-1',name:'Препарат по сохранённой цене',quantity:1,unit:'фл.',unit_price:7000,line_total:7000}],own_medications:[],notes:'Состав процедуры',discount_reason:'Постоянный пациент',discount_comment:'Скидка от начальника'};
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __correctionCalls.push({name,args:JSON.parse(JSON.stringify(args))});
   if(name==='crm_payment_correction_v22'){
    if(__correctionReceipts.has(args.p_request_id))return {data:__correctionReceipts.get(args.p_request_id)};
    if(__correctionError)return {error:__correctionError,status:400};
    const p=args.p_payload,data={...__correctionRecord,...p,version:4,paid_total:0,received_total:0,initial_paid_total:0,debt_total:p.charge_total};
    __correctionSaved.push({name,args:JSON.parse(JSON.stringify(args))});__correctionReceipts.set(args.p_request_id,data);
    if(__correctionDefer)await new Promise(resolve=>{window.__releaseCorrection=resolve});
    if(__correctionLost){__correctionLost=false;throw new TypeError('Load failed')}
    if(__correctionMalformed){__correctionMalformed=false;return {data:{}}}
    return {data};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:__correctionRecord};
    if(args.p_action==='patient_treatments')return {data:{procedures:[],sales:[]}};
    if(args.p_action==='treatment_edit')return {data:{id:'procedure-1',paid_total:paid,debt_total:0}};
    return {data:[]};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='accounting_mode')return {data:{payment_only:true,stock_deducted:false}};
    if(args.p_action==='summary')return {data:{rows:[],shifts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0}}};
    return {data:{shift:{...opened,status:'open'},staff:[],procedures:[],sales:[],revenue:{cash:0,terminal:0,owner_card:0,total:0}}};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};
   if(name==='work_catalog_v2')return {data:meds};
   if(name.includes('warehouse'))return {data:inventory};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'today-shift',aId:'nurse-1',a:'Марья',bId:'nurse-2',b:'Азиза',type:'08:30–16:00'};show('workspace');
  await editTreatmentV10('procedure','procedure-1');
 },{role,paid});
 await expect(page.locator('#procedure')).toBeVisible();return errors;
}
async function correct(page){
 await page.fill('#procChargeInPaymentV11','7500');
 await expect(page.locator('#procDebtSummaryV10')).toContainText('меньше уже полученной');
 await page.check('#procPaymentCorrectionV22');
 await expect(page.locator('#procDebtSummaryV10')).toContainText(/Ранее оплачено:\s*0/);
 await expect(page.locator('#procDebtSummaryV10')).toContainText(/Долг:\s*7\s*500/);
}
async function save(page){await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]')}
async function correctionCalls(page){return page.evaluate(()=>__correctionCalls.filter(x=>x.name==='crm_payment_correction_v22'))}

for(const role of ['admin','owner'])test(`${role} corrects phantom payment and preserves discounted past procedure in debt`,async({page})=>{
 const errors=await boot(page,role);await expect(page.locator('#procPaymentCorrectionBoxV22')).toBeVisible();await expect(page.locator('#procPaymentCorrectionAmountV22')).toContainText(/8\s*000/);
 await correct(page);await expect(page.locator('#procPaymentStatusV10')).toHaveValue('debt');await expect(page.locator('#procPaymentStatusV10')).toBeDisabled();await expect(page.locator('#procReceivedBoxV10')).not.toBeVisible();await expect(page.locator('#procEditReasonBoxV10')).not.toBeVisible();await expect(page.locator('#procDiscountInPaymentV11')).toHaveValue('Скидка от начальника');await expect(page.locator('#procedure button[onclick="saveProcedure()"]')).toHaveText('Исправить оплату и сохранить в долг');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await save(page);await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#homeMessage')).toContainText(/Оплата исправлена.*В долг:\s*7\s*500/);
 const calls=await correctionCalls(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({id:'procedure-1',kind:'procedure',shift_id:'yesterday-shift',nurse_id:'nurse-1',patient_id:'patient-1',expected_version:3,expected_received_total:8000,confirm_no_money_received:true,correction_reason:'Оплата отмечена ошибочно: деньги не получены',edit_reason:'Оплата отмечена ошибочно: деньги не получены',charge_total:7500,paid_total:0,payment_status:'debt',discount_reason:'Постоянный пациент',discount_comment:'Скидка от начальника',notes:'Состав процедуры',items:[{medication_id:'med-1',quantity:1}],services:[{service_id:'service-1',quantity:1}],payments:{cash:0,terminal:0,owner_card:0,cash_received:0},expected_stock_deducted:false});
 expect(await page.evaluate(()=>__correctionCalls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='treatment_edit'))).toHaveLength(0);expect(errors).toEqual([]);
});

test('unchecking correction restores prior money and cannot silently convert a genuine payment to debt',async({page})=>{
 const errors=await boot(page);await correct(page);await page.uncheck('#procPaymentCorrectionV22');await expect(page.locator('#procPaymentStatusV10')).toBeEnabled();await expect(page.locator('#procPaymentStatusV10')).toHaveValue('paid');await expect(page.locator('#procEditReasonBoxV10')).toBeVisible();await save(page);
 await expect(page.locator('#procedureMessage')).toContainText('меньше уже полученной');expect(await correctionCalls(page)).toHaveLength(0);expect(await page.evaluate(()=>__correctionSaved)).toHaveLength(0);await expect(page.locator('#procChargeInPaymentV11')).toHaveValue(/^7500(?:\.00)?$/);expect(errors).toEqual([]);
});

test('nurse cannot see or enable phantom-payment correction by manipulating the hidden checkbox',async({page})=>{
 const errors=await boot(page,'nurse');await expect(page.locator('#procPaymentCorrectionBoxV22')).not.toBeVisible();await page.fill('#procChargeInPaymentV11','7500');await page.evaluate(()=>{const input=document.getElementById('procPaymentCorrectionV22');input.checked=true;input.dispatchEvent(new Event('change'))});
 await expect(page.locator('#procPaymentCorrectionV22')).not.toBeChecked();await save(page);await expect(page.locator('#procedureMessage')).toContainText('меньше уже полученной');expect(await correctionCalls(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('lost correction response freezes the exact discounted request and replays the same UUID once',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{__correctionLost=true});await save(page);await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await expect(page.locator('#procChargeInPaymentV11')).toBeDisabled();await expect(page.locator('#procPaymentCorrectionV22')).toBeChecked();await expect(page.locator('#procPaymentCorrectionV22')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('procChargeInPaymentV11').value='1';document.getElementById('procDiscountComment').value='Changed';document.getElementById('procPaymentCorrectionV22').checked=false;document.getElementById('procPaymentStatusV10').value='paid'});
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await page.evaluate(()=>__correctionSaved.length)).toBe(1);await expect(page.locator('#homeMessage')).toContainText(/В долг:\s*7\s*500/);expect(errors).toEqual([]);
});

test('definitive correction rejection keeps prior paid record and editable discounted draft',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{__correctionError={code:'40001',message:'Оплата изменилась. Откройте процедуру заново'}});await save(page);await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureMessage')).toContainText('Оплата изменилась');await expect(page.locator('#procChargeInPaymentV11')).toBeEnabled();await expect(page.locator('#procPaymentCorrectionV22')).toBeEnabled();expect(await page.evaluate(()=>__correctionSaved.length)).toBe(0);expect(await page.evaluate(()=>__correctionRecord.paid_total)).toBe(8000);
 await page.evaluate(()=>{__correctionError=null});await save(page);await expect(page.locator('#workspace')).toBeVisible();const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);expect(errors).toEqual([]);
});

test('confirmed correction survives a failed dashboard refresh without inviting a second correction',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{refreshDashboard=async()=>{throw Error('Нет сети при обновлении')}});await save(page);await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#homeMessage')).toContainText(/Оплата исправлена.*В долг:\s*7\s*500.*Не удалось обновить экран/);expect(await correctionCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('malformed correction acknowledgement remains uncertain and can only replay the same request',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{__correctionMalformed=true});await save(page);await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();const calls=await correctionCalls(page);expect(calls[1].args).toEqual(calls[0].args);expect(await page.evaluate(()=>__correctionSaved.length)).toBe(1);expect(errors).toEqual([]);
});

test('no prior receipts means no payment correction control is offered',async({page})=>{
 const errors=await boot(page,'admin',0);await expect(page.locator('#procPaymentCorrectionBoxV22')).not.toBeVisible();await expect(page.locator('#procDebtSummaryV10')).toContainText(/Ранее оплачено:\s*0/);expect(errors).toEqual([]);
});

test('a delayed correction does not pull the administrator away from the patient directory',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{__correctionDefer=true});await save(page);await page.waitForFunction(()=>typeof __releaseCorrection==='function');await page.evaluate(()=>goPatients());await expect(page.locator('#patients')).toBeVisible();await page.evaluate(()=>__releaseCorrection());await expect(page.locator('#homeMessage')).toContainText('Оплата исправлена');await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#workspace')).not.toBeVisible();expect(await correctionCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('an unresolved correction cannot be replayed under a different signed-in employee',async({page})=>{
 const errors=await boot(page);await correct(page);await page.evaluate(()=>{__correctionLost=true});await save(page);await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await page.evaluate(()=>{currentStaff={id:'another-admin',full_name:'Другой администратор',role:'admin',active:true}});await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('Учётная запись изменилась');expect(await correctionCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});
