const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:'#'}})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  window.__v10Calls=[];window.__v10Saved=[];window.__v10Error=null;window.__v10MutationError=null;window.__v10LostResponse=false;window.__v10Replay=new Map();window.__v10History=[];window.__v10EditReceipt={id:'procedure-1',version:4,paid_total:235,charge_total:235,debt_total:0,stock_deducted:false};
  const actor={id:role==='owner'?'owner-1':'nurse-1',full_name:role==='owner'?'Аниса':'Наталья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-2',full_name:'Лилия'}],opened={id:'shift-1',started_at:'2026-10-11T05:30:00Z',planned_end_at:'2026-10-11T13:00:00Z',staff};
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'}];nurses=staff;
  meds=[{id:'med-1',name:'Самыр 400 мг',consumption_unit:'компл.',sale_price:20,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Внутримышечный укол',work_price:100,consumables_price:50,active:true},{id:'service-2',name:'Внутривенный укол',work_price:25,consumables_price:0,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5,purchase_price:0,active:true}));
  window.__v10Record={id:'procedure-1',kind:'procedure',editable:true,version:3,shift_id:'shift-1',patient_id:'patient-1',patient:'Анна',nurse_id:'nurse-1',nurse:'Наталья',service_id:'service-1',procedure_type:'Внутримышечный укол',visit_at:'2026-10-11T07:00:00Z',at:'2026-10-11T07:00:00Z',list_total:190,charge_total:190,paid_total:190,debt_total:0,stock_deducted:false,services:[{service_id:'service-1',name:'Внутримышечный укол',quantity:1,work_price:100,consumables_price:50,unit_price:150,line_total:150}],items:[{medication_id:'med-1',name:'Самыр 400 мг',quantity:2,unit:'компл.',unit_price:20,line_total:40}],own_medications:[],notes:'Первоначальная запись'};
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __v10Calls.push({name,args});
   if(name==='record_treatment_v5'){
    if(__v10Replay.has(args.p_request_id))return {data:__v10Replay.get(args.p_request_id)};
    if(__v10Error)return {error:__v10Error};
    const p=args.p_payload,data={id:'saved-'+(__v10Saved.length+1),paid_total:p.paid_total,charge_total:p.charge_total,debt_total:p.charge_total-p.paid_total,stock_deducted:false,payments:p.payments};
    __v10Saved.push({name,args});__v10Replay.set(args.p_request_id,data);
    if(__v10LostResponse){__v10LostResponse=false;throw new TypeError('Load failed')}
    return {data};
   }
   if(name==='crm_clinical_v10'){
    if(args.p_action==='treatment_get')return {data:__v10Record};
    if(args.p_action==='debts')return {data:{debts:__v10History.filter(event=>event.debt_total>0)}};
    if(args.p_action==='patient_treatments')return {data:{procedures:__v10History.filter(x=>x.kind!=='sale'),sales:__v10History.filter(x=>x.kind==='sale')}};
    if(args.p_action==='treatment_edit'&&!Number.isInteger(args.p_payload.expected_version))return {error:{code:'P0001',message:'Expected captured record version'}};
    if(__v10MutationError)return {error:__v10MutationError};
    if(__v10Replay.has(args.p_request_id))return {data:__v10Replay.get(args.p_request_id)};
    const data=args.p_action==='debt_payment'?{id:'payment-1',debt_total:100}:__v10EditReceipt;
    __v10Saved.push({name,args});__v10Replay.set(args.p_request_id,data);
    if(args.p_action==='debt_payment'&&__v10History[0])Object.assign(__v10History[0],{paid_total:90,debt_total:100});
    if(__v10LostResponse){__v10LostResponse=false;throw new TypeError('Load failed')}
    return {data};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='accounting_mode')return {data:{payment_only:true,stock_deducted:false}};
    if(args.p_action==='summary')return {data:{from:args.p_payload.from,to:args.p_payload.to,rows:[],shifts:[],revenue:{cash:40,terminal:0,owner_card:0,total:40},charge_total:190,debt_total:150,payroll_total:4000,payroll_complete:true,cash_after_salary:-3960}};
    return {data:{shift:{...opened,date:'2026-10-11',status:'open'},staff:staff.map(s=>({...s,amount:2000})),patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:40,terminal:0,owner_card:0,total:40},charge_total:190,debt_total:150,payroll_total:4000,cash_after_salary:-3960,procedures:[{...__v10Record,charge_total:190,paid_total:40,debt_total:150,payments:{cash:40,terminal:0,owner_card:0}}],sales:[],used:[{name:'Только склад',quantity:99}],stock:[{name:'Остаток склада',work:98,reserve:97}],untracked:[],warnings:[]}};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};
   if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   if(name.includes('warehouse'))return {data:inventory};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function procedure(page,withMedicine=true){
 await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');
 if(withMedicine){await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2')}
 await expect(page.locator('#procPaid')).toHaveValue(withMedicine?'190.00':'150.00');
}
async function save(page){await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]')}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true)}
async function created(page){return page.evaluate(()=>__v10Calls.filter(x=>x.name==='record_treatment_v5'))}
async function discountedDebtUi(page){
 await expect(page.locator('#procDebtHintV13')).toBeVisible();await expect(page.locator('#procDebtHintV13')).toContainText('0');
 await expect(page.locator('#procDebtSummaryV10')).toContainText(/К оплате с учётом скидки:\s*11\s*500/);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Скидка:\s*2\s*800/);
 await expect(page.locator('#procedure button[onclick="saveProcedure()"]')).toHaveText('Сохранить процедуру в долг');await expect(page.locator('#procPayConfirmed').locator('..')).toContainText('остаток долга');
}

for(const received of [0,40])test(`nurse records ${received?'partial payment':'full debt'} without counting unpaid money as receipts`,async({page})=>{
 const errors=await boot(page);await procedure(page);await page.selectOption('#procPaymentStatusV10','debt');
 if(received)await page.fill('#procReceivedV10',String(received));
 await expect(page.locator('#procDebtSummaryV10')).toContainText(String(190-received));await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const calls=await created(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({patient_id:'patient-1',charge_total:190,paid_total:received,payment_status:'debt',payments:{cash:received,terminal:0,owner_card:0,cash_received:received},expected_stock_deducted:false});
 expect(await page.evaluate(()=>meds[0].work_qty)).toBe(0);expect(errors).toEqual([]);
});

test('a wholly unpaid discounted procedure keeps its agreed 11500 charge separate from zero received',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{Object.assign(services[0],{work_price:300,consumables_price:0});meds[0].sale_price=7000});
 await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2');
 await expect(page.locator('#procList')).toContainText('14 300');await expect(page.locator('#procPaid')).toHaveValue('14300.00');await page.selectOption('#procPaymentStatusV10','debt');
 await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');await expect(page.locator('#procChargeInPaymentV11')).toBeVisible();await expect(page.locator('#procChargeInPaymentV11')).toBeEditable();await page.fill('#procChargeInPaymentV11','11500');
 await expect(page.locator('#procPaid')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procDiscountInPaymentV11')).toBeVisible();await page.fill('#procNotes','Пациент оплатит позже; согласована скидка');await save(page);
 await expect(page.locator('#procedureMessage')).toContainText(/комментарий|причин/i);expect(await created(page)).toHaveLength(0);await expect(page.locator('#procPaymentStatusV10')).toHaveValue('debt');await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procNotes')).toHaveValue('Пациент оплатит позже; согласована скидка');
 await page.check('#procPayConfirmed');await page.fill('#procDiscountInPaymentV11','Стоимость 11 500 ₽ согласована владельцем вместо 14 300 ₽');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();await expect(page.locator('#procDiscountComment')).toHaveValue('Стоимость 11 500 ₽ согласована владельцем вместо 14 300 ₽');
 await discountedDebtUi(page);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Оплата сейчас:\s*0/);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Долг:\s*11\s*500/);await expect(page.locator('#procPayCash')).toHaveValue('0.00');await expect(page.locator('#procShortCashBoxV11')).not.toBeVisible();await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const requests=await created(page);expect(requests).toHaveLength(1);expect(requests[0].args.p_payload).toMatchObject({patient_id:'patient-1',charge_total:11500,paid_total:0,payment_status:'debt',items:[{medication_id:'med-1',quantity:2}],discount_comment:'Стоимость 11 500 ₽ согласована владельцем вместо 14 300 ₽',notes:'Пациент оплатит позже; согласована скидка',payments:{cash:0,terminal:0,owner_card:0,cash_received:0},expected_stock_deducted:false});
 await expect(page.locator('#homeMessage')).toContainText(/Оплачено:\s*0/);await expect(page.locator('#homeMessage')).toContainText(/Долг:\s*11\s*500/);expect(await page.evaluate(()=>meds[0].work_qty)).toBe(0);expect(errors).toEqual([]);
});

for(const role of ['nurse','owner'])test(`${role} can edit a wholly unpaid procedure to an agreed 11500 without recording a receipt`,async({page})=>{
 const errors=await boot(page,role);
 await page.evaluate(()=>{
  Object.assign(__v10Record,{list_total:14300,charge_total:14300,paid_total:0,debt_total:14300});
  Object.assign(__v10Record.services[0],{unit_price:300,work_price:300,consumables_price:0,line_total:300});Object.assign(__v10Record.items[0],{unit_price:7000,line_total:14000});
  __v10EditReceipt={id:'procedure-1',version:4,charge_total:11500,paid_total:0,debt_total:11500,stock_deducted:false};return editTreatmentV10('procedure','procedure-1');
 });
 await expect(page.locator('#procedure h1')).toHaveText('Редактирование процедуры');await expect(page.locator('#procPaymentStatusV10')).toHaveValue('debt');await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');await expect(page.locator('#procList')).toContainText('14 300');await expect(page.locator('#procChargeInPaymentV11')).toBeVisible();await expect(page.locator('#procChargeInPaymentV11')).toBeEditable();
 await page.fill('#procChargeInPaymentV11','11500');await page.fill('#procEditReasonV10','Исправлена согласованная стоимость неоплаченной процедуры');await save(page);
 await expect(page.locator('#procedureMessage')).toContainText(/комментарий|причин/i);expect(await page.evaluate(()=>__v10Calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit'))).toHaveLength(0);await expect(page.locator('#procChargeInPaymentV11')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');await expect(page.locator('#procEditReasonV10')).toHaveValue('Исправлена согласованная стоимость неоплаченной процедуры');
 await page.fill('#procDiscountInPaymentV11','Скидка от начальника; вся согласованная сумма остаётся в долг');await discountedDebtUi(page);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Ранее оплачено:\s*0/);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Оплата сейчас:\s*0/);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Долг:\s*11\s*500/);await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const edits=await page.evaluate(()=>__v10Calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit'));expect(edits).toHaveLength(1);expect(edits[0].args.p_payload).toMatchObject({id:'procedure-1',kind:'procedure',expected_version:3,shift_id:'shift-1',charge_total:11500,paid_total:0,payment_status:'debt',items:[{medication_id:'med-1',quantity:2}],services:[{service_id:'service-1',quantity:1}],discount_comment:'Скидка от начальника; вся согласованная сумма остаётся в долг',edit_reason:'Исправлена согласованная стоимость неоплаченной процедуры',payments:{cash:0,terminal:0,owner_card:0,cash_received:0},expected_stock_deducted:false});
 expect(await created(page)).toHaveLength(0);await expect(page.locator('#homeMessage')).toContainText(/Оплачено:\s*0/);await expect(page.locator('#homeMessage')).toContainText(/Долг:\s*11\s*500/);expect(errors).toEqual([]);
});

test('switching payment modes retains the agreed discounted charge and records only the partial receipt',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{Object.assign(services[0],{work_price:300,consumables_price:0});meds[0].sale_price=7000});await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2');
 await expect(page.locator('#procList')).toContainText('14 300');await page.fill('#procChargeInPaymentV11','11500');await page.fill('#procDiscountInPaymentV11','Согласована стоимость 11 500 ₽; часть оплаты будет позже');
 await page.selectOption('#procPaymentStatusV10','debt');await discountedDebtUi(page);await expect(page.locator('#procChargeInPaymentV11')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');
 await page.selectOption('#procPaymentStatusV10','paid');await expect(page.locator('#procDebtHintV13')).not.toBeVisible();await expect(page.locator('#procedure button[onclick="saveProcedure()"]')).toHaveText('Сохранить процедуру');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procPayCash')).toHaveValue('11500.00');
 await page.selectOption('#procPaymentStatusV10','debt');await discountedDebtUi(page);await expect(page.locator('#procPaid')).toHaveValue(/^11500(?:\.00)?$/);await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');await expect(page.locator('#procDiscountInPaymentV11')).toHaveValue('Согласована стоимость 11 500 ₽; часть оплаты будет позже');await page.fill('#procReceivedV10','2800');
 await discountedDebtUi(page);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Оплата сейчас:\s*2\s*800/);await expect(page.locator('#procDebtSummaryV10')).toContainText(/Долг:\s*8\s*700/);await expect(page.locator('#procPayCash')).toHaveValue('2800.00');await expect(page.locator('#procPayTender')).toHaveValue('2800.00');await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const requests=await created(page);expect(requests).toHaveLength(1);expect(requests[0].args.p_payload).toMatchObject({charge_total:11500,paid_total:2800,payment_status:'debt',discount_comment:'Согласована стоимость 11 500 ₽; часть оплаты будет позже',payments:{cash:2800,terminal:0,owner_card:0,cash_received:2800},expected_stock_deducted:false});
 await expect(page.locator('#homeMessage')).toContainText(/Оплачено:\s*2\s*800/);await expect(page.locator('#homeMessage')).toContainText(/Долг:\s*8\s*700/);expect(errors).toEqual([]);
});

test('nurse discount and free service require a written explanation and preserve draft on rejection',async({page})=>{
 const errors=await boot(page);await procedure(page);await expect(page.locator('#procPaid')).toBeEditable();await page.fill('#procPaid','170');await save(page);
 await expect(page.locator('#procedureMessage')).toContainText('комментарий');expect(await created(page)).toHaveLength(0);await expect(page.locator('#procPaid')).toHaveValue('170');
 await page.selectOption('#procDiscountReason','Постоянный пациент');await page.fill('#procDiscountComment','Постоянная скидка по согласованию с владельцем');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const discounted=(await created(page))[0].args.p_payload;expect(discounted).toMatchObject({charge_total:170,paid_total:170,discount_reason:'Постоянный пациент',discount_comment:'Постоянная скидка по согласованию с владельцем'});
 await procedure(page,false);await page.selectOption('#procPaymentStatusV10','free');await save(page);await expect(page.locator('#procedureMessage')).toContainText('комментарий');expect(await created(page)).toHaveLength(1);
 await page.fill('#procDiscountComment','Бесплатно: решение владельца');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const free=(await created(page))[1].args.p_payload;expect(free).toMatchObject({charge_total:0,paid_total:0,payment_status:'free',payments:{cash:0,terminal:0,owner_card:0,cash_received:0},discount_comment:'Бесплатно: решение владельца'});expect(errors).toEqual([]);
});

test('own and previously purchased medicines can accompany intramuscular and intravenous services without selling them again',async({page})=>{
 const errors=await boot(page);await procedure(page,false);await page.click('#procAddOwnV10');await page.fill('#procOwnMedsV10 .own-name-v10','Свой витамин B12 500 мкг');
 await page.click('#procAddOwnV10');const previous=page.locator('#procOwnMedsV10 .clinical-own-v10').nth(1);await previous.locator('.own-name-v10').fill('Ранее купленный Самыр');await previous.locator('.own-source-v10').selectOption('previously_purchased');await previous.locator('.own-quantity-v10').fill('2');
 await page.click('#procAddServiceV10');await page.selectOption('#procAdditionalServicesV10 select','service-2');await expect(page.locator('#procPaid')).toHaveValue('175.00');await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const payload=(await created(page))[0].args.p_payload;expect(payload.items).toEqual([]);expect(payload.services).toEqual([{service_id:'service-1',quantity:1},{service_id:'service-2',quantity:1}]);expect(payload.own_medications).toEqual([{name:'Свой витамин B12 500 мкг',quantity:1,unit:'амп.',source:'patient'},{name:'Ранее купленный Самыр',quantity:2,unit:'амп.',source:'previously_purchased'}]);expect(payload.charge_total).toBe(175);expect(errors).toEqual([]);
});

test('committed creation with a lost response retries the same receipt instead of duplicating it',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.selectOption('#procPaymentStatusV10','debt');await page.fill('#procReceivedV10','40');await page.fill('#procNotes','Не стирать после сбоя');await page.evaluate(()=>{__v10LostResponse=true});await save(page);
 await expect(page.locator('#procedureMessage')).toContainText(/ответ|сервер/i);await expect(page.locator('#procPaid')).toHaveValue('190.00');await expect(page.locator('#procReceivedV10')).toHaveValue('40');await expect(page.locator('#procNotes')).toHaveValue('Не стирать после сбоя');await expect(page.locator('#procMeds .medqty')).toHaveValue('2');await expect(page.locator('#procPayConfirmed')).toBeChecked();
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();const calls=await created(page);expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).toBe(calls[0].args.p_request_id);expect(await page.evaluate(()=>__v10Saved.length)).toBe(1);expect(errors).toEqual([]);
});

test('editing a procedure adds another injection and medicine using saved prices and optimistic version',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>editTreatmentV10('procedure','procedure-1'));await expect(page.locator('#procedure h1')).toHaveText('Редактирование процедуры');await expect(page.locator('#procPatient')).toBeDisabled();await expect(page.locator('#procPaid')).toHaveValue('190.00');await expect(page.locator('#procDebtSummaryV10')).toContainText('Ранее оплачено');
 await page.fill('#procMeds .medqty','3');await page.click('#procAddServiceV10');await page.selectOption('#procAdditionalServicesV10 select','service-2');await expect(page.locator('#procList')).toContainText('235');await page.fill('#procPaid','235');await page.fill('#procEditReasonV10','Добавлен внутривенный укол и ещё один комплект препарата');
 await page.evaluate(()=>{__v10MutationError={code:'P0001',message:'Запись уже изменена другим сотрудником. Откройте её заново.'}});await save(page);await expect(page.locator('#procedureMessage')).toContainText('другим сотрудником');await expect(page.locator('#procMeds .medqty')).toHaveValue('3');await expect(page.locator('#procEditReasonV10')).toHaveValue('Добавлен внутривенный укол и ещё один комплект препарата');
 await page.evaluate(()=>{__v10MutationError=null;__v10LostResponse=true});await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('Черновик сохранён');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();
 const calls=await page.evaluate(()=>__v10Calls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='treatment_edit'));expect(calls).toHaveLength(3);expect(calls[2].args.p_request_id).toBe(calls[1].args.p_request_id);expect(calls[2].args.p_payload).toMatchObject({id:'procedure-1',kind:'procedure',expected_version:3,shift_id:'shift-1',charge_total:235,paid_total:45,payment_status:'paid',services:[{service_id:'service-1',quantity:1},{service_id:'service-2',quantity:1}],items:[{medication_id:'med-1',quantity:3}]});expect(await page.evaluate(()=>__v10Saved.length)).toBe(1);expect(errors).toEqual([]);
});

test('nurse sale action is explicit and own shift PDF shows patients, all services, debt and receipts without stock or salaries',async({page})=>{
 const errors=await boot(page);const sale=page.locator('#workspace .home-actions button').filter({hasText:'Продажа препарата'});await expect(sale).toHaveCount(1);await sale.click();await expect(page.locator('#sale')).toBeVisible();
 await page.evaluate(()=>openReport());await expect(page.locator('#reportBody')).toContainText('В долг');await expect(page.locator('#reportBody')).toContainText('150');await page.evaluate(()=>{window.__v10Prints=0;window.print=()=>__v10Prints++});await page.click('#reportPrintV5');await expect(page.locator('#shiftPrintV5')).toHaveCount(1);
 const printed=await page.locator('#shiftPrintV5').innerText();for(const word of ['Наталья','Лилия','Анна','Внутримышечный укол','Самыр 400 мг','190','40','150','Итоги смены'])expect(printed).toContain(word);for(const secret of ['Зарплата','Списано со склада','Остаток склада','Только склад','рабочего шкафа','4 000'])expect(printed).not.toContain(secret);expect(await page.evaluate(()=>__v10Prints)).toBe(1);await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('#shiftPrintV5')).toHaveCount(0);await noOverflow(page);expect(errors).toEqual([]);
});


test('later debt receipt belongs to the collecting nurse shift and a lost response never duplicates it',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__v10History=[{...__v10Record,paid_total:40,debt_total:150}];return openPatient('patient-1')});await expect(page.locator('#patientClinicalV10')).toContainText('В долг:');
 await page.click('#patientClinicalV10 button:has-text("Принять оплату долга")');await expect(page.locator('#debtPaymentV10')).toBeVisible();await page.fill('#debtAmountV10','50');await page.selectOption('#debtMethodV10','terminal');await page.fill('#debtNoteV10','Частичное погашение долга');await page.check('#debtConfirmV10');await page.evaluate(()=>{__v10LostResponse=true});await page.click('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');
 await expect(page.locator('#debtMessageV10')).toContainText('Черновик сохранён');await expect(page.locator('#debtAmountV10')).toHaveValue('50');await expect(page.locator('#debtMethodV10')).toHaveValue('terminal');await expect(page.locator('#debtConfirmV10')).toBeChecked();await page.click('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');await expect(page.locator('#patientCard')).toBeVisible();await expect(page.locator('#patientCardMessageV5')).toContainText('100');
 const calls=await page.evaluate(()=>__v10Calls.filter(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='debt_payment'));expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).toBe(calls[0].args.p_request_id);expect(calls[1].args.p_payload).toMatchObject({kind:'procedure',id:'procedure-1',shift_id:'shift-1',nurse_id:'nurse-1',payments:{cash:0,terminal:50,owner_card:0,cash_received:0},comment:'Частичное погашение долга'});expect(await page.evaluate(()=>__v10Saved.length)).toBe(1);await noOverflow(page);expect(errors).toEqual([]);
});

test('delayed automatic shift restoration cannot replace a later patient navigation',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  const original=db.rpc;window.__restoreFinished=false;
  db.rpc=async(name,args)=>{const result=await original(name,args);if(name==='get_my_open_shift_v82')return new Promise(resolve=>{window.__releaseRestore=()=>resolve(result)});return result};
  window.__restorePromise=enterApp({id:'mock-auth'}).then(()=>{__restoreFinished=true});
 });
 await page.waitForFunction(()=>!!window.__releaseRestore);await page.locator('#workspace .home-actions button').filter({hasText:'Пациенты'}).click();await expect(page.locator('#patients')).toBeVisible();
 await page.evaluate(async()=>{__releaseRestore();await __restorePromise});await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#shift')).not.toBeVisible();await expect(page.locator('#workspace')).not.toBeVisible();expect(errors).toEqual([]);
});

test('a delayed procedure shift lookup cannot send the nurse away from patients',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{shift=null;loadQuickContext=()=>new Promise(resolve=>{window.__releaseProcedureContext=()=>{quickContext={favorites:[],recent:[],shifts:[]};resolve()}})});
 await page.locator('#workspace .home-actions button').filter({hasText:'Процедуры'}).click();await page.waitForFunction(()=>!!window.__releaseProcedureContext);
 await page.locator('#workspace .home-actions button').filter({hasText:'Пациенты'}).click();await expect(page.locator('#patients')).toBeVisible();await page.evaluate(()=>__releaseProcedureContext());await expect(page.locator('#patients')).toBeVisible();await expect(page.locator('#shift')).not.toBeVisible();await expect(page.locator('#procedure')).not.toBeVisible();expect(errors).toEqual([]);
});

test('editing keeps multiple primary services and captured prices after a catalogue price change',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  Object.assign(__v10Record,{list_total:490,charge_total:490,paid_total:490});Object.assign(__v10EditReceipt,{paid_total:490,charge_total:490});__v10Record.services[0].quantity=3;__v10Record.services[0].line_total=450;
  meds[0].sale_price=99;services[0].work_price=1000;
  return editTreatmentV10('procedure','procedure-1');
 });
 await expect(page.locator('#procList')).toContainText('490');await expect(page.locator('#procPaid')).toHaveValue('490.00');await expect(page.locator('#procAdditionalServicesV10 input')).toHaveValue('2');await page.fill('#procEditReasonV10','Исправлен комментарий без изменения услуг и оплаты');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 const call=await page.evaluate(()=>__v10Calls.find(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='treatment_edit'));expect(call.args.p_payload.expected_version).toBe(3);expect(call.args.p_payload.charge_total).toBe(490);expect(call.args.p_payload.paid_total).toBe(0);expect(call.args.p_payload.services.filter(x=>x.service_id==='service-1').reduce((sum,x)=>sum+x.quantity,0)).toBe(3);expect(call.args.p_payload.items).toEqual([{medication_id:'med-1',quantity:2}]);expect(errors).toEqual([]);
});


test('owner collects preserved debt directly after a patient has been removed from the directory',async({page})=>{
 const errors=await boot(page,'owner');await page.evaluate(()=>{patients=[];__v10History=[{...__v10Record,paid_total:40,debt_total:150}];return openDebtsV10()});
 await expect(page.locator('#debtsV10')).toBeVisible();await expect(page.locator('#debtsBodyV10')).toContainText('Анна');
 await page.locator('#debtsBodyV10 button').filter({hasText:'Принять оплату долга'}).click();await expect(page.locator('#debtPaymentV10')).toBeVisible();
 await page.fill('#debtAmountV10','50');await page.check('#debtConfirmV10');await page.click('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]');
 await expect(page.locator('#debtsV10')).toBeVisible();await expect(page.locator('#debtsMessageV10')).toContainText('100');await expect(page.locator('#debtsBodyV10')).toContainText('100');
 const call=await page.evaluate(()=>__v10Calls.find(x=>x.name==='crm_clinical_v10'&&x.args.p_action==='debt_payment'));
 expect(call.args.p_payload).toMatchObject({id:'procedure-1',shift_id:'shift-1',nurse_id:'nurse-1',payments:{cash:50,cash_received:50}});expect(errors).toEqual([]);
});

async function shortCashProcedure(page){
 await page.evaluate(()=>{services[0].work_price=600;services[0].consumables_price=0;meds[0].sale_price=3500});
 await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2');await expect(page.locator('#procPaid')).toHaveValue('7600.00');
}

test('a smaller cash tender and general discount note never silently change the charge',async({page})=>{
 const errors=await boot(page);await shortCashProcedure(page);await page.fill('#procNotes','Скидка от начальника');await page.fill('#procPayTender','6800');await expect(page.locator('#procShortCashBoxV11')).toBeVisible();
 await expect(page.locator('#procPaid')).toHaveValue('7600.00');await expect(page.locator('#procPayCash')).toHaveValue('7600.00');await save(page);await expect(page.locator('#procedureMessage')).toContainText(/меньше|скидк|коррект/i);expect(await created(page)).toHaveLength(0);
 await expect(page.locator('#procPaid')).toHaveValue('7600.00');await expect(page.locator('#procPayTender')).toHaveValue('6800');await expect(page.locator('#procNotes')).toHaveValue('Скидка от начальника');expect(errors).toEqual([]);
});

test('explicit cash discount requires a reason then records the agreed 6800 without a debt',async({page})=>{
 const errors=await boot(page);await shortCashProcedure(page);await page.fill('#procNotes','Скидка от начальника');await page.fill('#procPayTender','6800');await page.check('#procPayConfirmed');await page.click('#procApplyDiscountV11');await expect(page.locator('#procApplyDiscountMessageV11')).toContainText('причину скидки');await expect(page.locator('#procDiscountInPaymentV11')).toBeFocused();
 await expect(page.locator('#procPaid')).toHaveValue('7600.00');expect(await created(page)).toHaveLength(0);await expect(page.locator('#procShortCashBoxV11')).toBeVisible();
 await page.fill('#procDiscountInPaymentV11','Скидка от владельца согласована: 800 ₽');await page.click('#procApplyDiscountV11');await expect(page.locator('#procPayConfirmed')).not.toBeChecked();await expect(page.locator('#procPaid')).toHaveValue('6800.00');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue('6800.00');await expect(page.locator('#procList')).toContainText('7 600');await expect(page.locator('#procPayCash')).toHaveValue('6800.00');await expect(page.locator('#procShortCashBoxV11')).not.toBeVisible();await expect(page.locator('#procDebtSummaryV10')).toContainText('Долг: 0');
 await noOverflow(page);await save(page);await expect(page.locator('#workspace')).toBeVisible();const payload=(await created(page))[0].args.p_payload;expect(payload).toMatchObject({charge_total:6800,paid_total:6800,payment_status:'paid',discount_comment:'Скидка от владельца согласована: 800 ₽',notes:'Скидка от начальника',payments:{cash:6800,terminal:0,owner_card:0,cash_received:6800}});expect(errors).toEqual([]);
});

test('cash discount preserves the terminal and owner-card parts of a mixed receipt',async({page})=>{
 const errors=await boot(page);await shortCashProcedure(page);await page.click('#procPaymentV5 [data-pay-method="mixed"]');await page.fill('#procPayCash','3600');await page.fill('#procPayTerminal','2000');await page.fill('#procPayOwnerCard','2000');await page.fill('#procPayTender','2800');await page.fill('#procDiscountInPaymentV11','Согласована скидка на наличную часть');await page.click('#procApplyDiscountV11');
 await expect(page.locator('#procPaid')).toHaveValue('6800.00');await expect(page.locator('#procPayCash')).toHaveValue('2800.00');await expect(page.locator('#procPayTerminal')).toHaveValue(/^2000(?:\.00)?$/);await expect(page.locator('#procPayOwnerCard')).toHaveValue(/^2000(?:\.00)?$/);await save(page);await expect(page.locator('#workspace')).toBeVisible();expect((await created(page))[0].args.p_payload).toMatchObject({charge_total:6800,paid_total:6800,payments:{cash:2800,terminal:2000,owner_card:2000,cash_received:2800}});expect(errors).toEqual([]);
});

test('cash above the charge remains change and needs no discount correction',async({page})=>{
 const errors=await boot(page);await shortCashProcedure(page);await page.fill('#procPayTender','7800');await expect(page.locator('#procShortCashBoxV11')).not.toBeVisible();await expect(page.locator('#procPaid')).toHaveValue('7600.00');await expect(page.locator('#procPaySummary')).toContainText('Сдача: 200');await save(page);await expect(page.locator('#workspace')).toBeVisible();expect((await created(page))[0].args.p_payload).toMatchObject({charge_total:7600,paid_total:7600,discount_comment:null,payments:{cash:7600,terminal:0,owner_card:0,cash_received:7800}});expect(errors).toEqual([]);
});

test('short tender in debt mode cannot become a cash discount or erase the agreed debt',async({page})=>{
 const errors=await boot(page);await shortCashProcedure(page);await page.selectOption('#procPaymentStatusV10','debt');await page.fill('#procReceivedV10','6800');await page.fill('#procPayTender','6700');await expect(page.locator('#procShortCashBoxV11')).not.toBeVisible();await save(page);await expect(page.locator('#procedureMessage')).toContainText(/меньше/);expect(await created(page)).toHaveLength(0);await expect(page.locator('#procPaid')).toHaveValue('7600.00');await expect(page.locator('#procDebtSummaryV10')).toContainText('800');
 await page.fill('#procPayTender','6800');await save(page);await expect(page.locator('#workspace')).toBeVisible();expect((await created(page))[0].args.p_payload).toMatchObject({charge_total:7600,paid_total:6800,payment_status:'debt',discount_comment:null});expect(errors).toEqual([]);
});

test('the payment-area charge and reason mirrors work for medication sales too',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{meds[0].sale_price=3800;await openSale();chooseMedication('saleMeds','med-1')});await page.fill('#saleMeds .medqty','2');await expect(page.locator('#salePaid')).toHaveValue('7600.00');await page.fill('#saleChargeInPaymentV11','6800');await expect(page.locator('#salePaid')).toHaveValue(/^6800(?:\.00)?$/);await page.fill('#saleDiscountInPaymentV11','Постоянная скидка на продажу');await expect(page.locator('#saleDiscountComment')).toHaveValue('Постоянная скидка на продажу');await page.check('#salePayConfirmed');await page.click('#sale button[onclick="saveSale()"]');await expect(page.locator('#workspace')).toBeVisible();const payload=(await created(page))[0].args.p_payload;expect(payload).toMatchObject({charge_total:6800,paid_total:6800,discount_comment:'Постоянная скидка на продажу',payments:{cash:6800,terminal:0,owner_card:0,cash_received:6800}});expect(errors).toEqual([]);
});

test('editing cannot reduce the charge below money already received through the payment mirror',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{Object.assign(__v10Record,{list_total:7600,charge_total:7600,paid_total:7000,debt_total:600});Object.assign(__v10Record.services[0],{unit_price:600,work_price:600,consumables_price:0,line_total:600});Object.assign(__v10Record.items[0],{unit_price:3500,line_total:7000});return editTreatmentV10('procedure','procedure-1')});
 await page.fill('#procChargeInPaymentV11','6800');await page.fill('#procDiscountInPaymentV11','Попытка уменьшить стоимость ниже ранее оплаченной');await page.fill('#procEditReasonV10','Проверка ограничения корректировки');await save(page);await expect(page.locator('#procedureMessage')).toContainText(/уже полученной|меньше уже/);await expect(page.locator('#procPaid')).toHaveValue(/^6800(?:\.00)?$/);await expect(page.locator('#procDiscountInPaymentV11')).toHaveValue('Попытка уменьшить стоимость ниже ранее оплаченной');expect(await page.evaluate(()=>__v10Calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit'))).toHaveLength(0);expect(errors).toEqual([]);
});
