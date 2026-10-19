const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-18T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  const actor={id:role==='nurse'?'nurse-other':'admin-other',full_name:'Сотрудник проверки',role,active:true};
  const staff=[{id:'nurse-other',full_name:'Медсестра проверки'},{id:'nurse-second',full_name:'Вторая медсестра'}];
  const opened={id:'shift-other',date:'2026-10-18',status:'open',started_at:'2026-10-18T05:30:00Z',planned_end_at:'2026-10-18T13:00:00Z',staff};
  patients=[{id:'patient-other',full_name:'Пациент проверки',sex:'male'}];nurses=staff;
  meds=[{id:'med-procedure',name:'Препарат процедуры',consumption_unit:'амп.',sale_price:1000,work_qty:0,active:true},{id:'med-sale',name:'Препарат продажи',consumption_unit:'фл.',sale_price:1600,work_qty:0,active:true}];
  services=[{id:'service-other',name:'Капельница',work_price:500,consumables_price:100,active:true}];inventory=[];
  const seed={id:'saved-procedure',kind:'procedure',editable:true,version:3,shift_id:'shift-other',patient_id:'patient-other',patient:'Пациент проверки',nurse_id:'nurse-other',nurse:'Медсестра проверки',service_id:'service-other',procedure_type:'Капельница',at:'2026-10-18T06:30:00Z',visit_at:'2026-10-18T06:30:00Z',list_total:1600,charge_total:1600,paid_total:0,received_total:0,initial_paid_total:0,debt_total:1600,payment_pending:true,payment_status:'pending',stock_deducted:false,services:[{service_id:'service-other',name:'Капельница',quantity:1,unit_price:600,work_price:500,consumables_price:100,line_total:600}],items:[{medication_id:'med-procedure',name:'Препарат процедуры',quantity:1,unit:'амп.',unit_price:1000,line_total:1000}],own_medications:[],payments:{cash:0,terminal:0,owner_card:0},notes:''};
  window.__otherV47={calls:[],writes:[],replay:new Map(),records:new Map([[seed.id,seed]]),lose:false};
  const report=()=>({shift:opened,staff,procedures:[],sales:[],receipts:[],revenue:{cash:0,terminal:0,owner_card:0,total:0},used:[],stock:[],warnings:[]});
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   const state=__otherV47;state.calls.push({name,args:clone(args)});
   if(name==='record_treatment_v5'||name==='crm_clinical_v10'&&['treatment_edit','debt_payment'].includes(args.p_action)){
    if(state.replay.has(args.p_request_id))return {data:clone(state.replay.get(args.p_request_id))};
    const p=args.p_payload,old=state.records.get(p.id),paid=p.payments?['cash','terminal','owner_card','other_card'].reduce((sum,key)=>sum+Number(p.payments[key]||0),0):Number(p.paid_total||0);
    const received=Number(old?.received_total||0)+paid,charge=Number(p.charge_total??old?.charge_total??0);
    const result={...(old||{}),...clone(p),id:old?.id||'new-'+(state.writes.length+1),version:Number(old?.version||0)+1,paid_total:received,received_total:received,debt_total:charge-received,payment_pending:charge>received&&(p.payment_status==='pending'||args.p_action==='debt_payment'&&old.payment_pending)};
    state.records.set(result.id,result);state.writes.push({name,args:clone(args)});state.replay.set(args.p_request_id,clone(result));
    if(state.lose){state.lose=false;throw new TypeError('Load failed')}
    return {data:clone(result)};
   }
   if(name==='crm_clinical_v10')return {data:args.p_action==='treatment_get'?clone(state.records.get(args.p_payload.id)):args.p_action==='patient_treatments'?{procedures:[],sales:[]}:[]};
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:report()};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'auth-other'});shift={id:'shift-other',aId:'nurse-other',a:'Медсестра проверки',bId:'nurse-second',b:'Вторая медсестра',type:'08:30–16:00'};refreshDashboard=async()=>{};show('workspace');
 },role);
 return errors;
}
const writes=page=>page.evaluate(()=>__otherV47.writes);
async function form(page,kind='procedure',edit=false){
 if(edit)await page.evaluate(()=>editTreatmentV10('procedure','saved-procedure'));
 else if(kind==='sale')await page.evaluate(async()=>{await openSale();chooseMedication('saleMeds','med-sale')});
 else{await page.evaluate(()=>openProcedure('patient-other'));await page.selectOption('#procService','service-other');await page.evaluate(()=>chooseMedication('procMeds','med-procedure'))}
 await expect(page.locator('#'+kind)).toBeVisible();return kind==='sale'?'sale':'proc';
}
async function save(page,prefix='proc'){await page.check('#'+prefix+'PayConfirmed');await page.locator('#'+(prefix==='sale'?'sale':'procedure')+' button[onclick="'+(prefix==='sale'?'saveSale()':'saveProcedure()')+'"]').click()}
async function pending(page){await page.evaluate(()=>openSavedPaymentV14('procedure','saved-procedure',1600,null,true));await expect(page.locator('#debtPaymentV10')).toBeVisible()}
async function savePending(page){await page.check('#debtConfirmV10');await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]' ).click()}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}

for(const role of ['admin','nurse'])for(const kind of ['procedure','sale'])test(`${role} saves a ${kind} to other card without owner-card or cash allocation`,async({page})=>{
 const errors=await boot(page,role),prefix=await form(page,kind);await page.locator('#'+prefix+'PaymentV5 [data-pay-method="other_card"]').click();await expect(page.locator('#'+prefix+'PaySummary')).toContainText(/Другая карта:.*1\s*600/);await expect(page.locator('#'+prefix+'PayTenderBox')).toBeHidden();await save(page,prefix);await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:0,terminal:0,owner_card:0,other_card:1600,cash_received:0});await noOverflow(page);expect(errors).toEqual([]);
});

test('an edited pending procedure can receive other-card payment without changing its original shift',async({page})=>{
 const errors=await boot(page);await form(page,'procedure',true);await page.selectOption('#procPaymentStatusV10','paid');await page.locator('#procPaymentV5 [data-pay-method="other_card"]').click();await page.fill('#procEditReasonV10','Принята оплата по другой карте');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args).toMatchObject({p_action:'treatment_edit',p_payload:{id:'saved-procedure',shift_id:'shift-other',payments:{cash:0,terminal:0,owner_card:0,other_card:1600,cash_received:0}}});expect(errors).toEqual([]);
});

test('mixed clinical payment sums four separate channels and excludes card amounts from cash change',async({page})=>{
 const errors=await boot(page);await form(page);await page.locator('#procPaymentV5 [data-pay-method="mixed"]').click();
 for(const[suffix,value]of[['Cash','400'],['Terminal','500'],['OwnerCard','300'],['OtherCard','400'],['Tender','1000']])await page.fill('#procPay'+suffix,value);
 await expect(page.locator('#procPaySummary')).toContainText('Другая карта: 400');await expect(page.locator('#procPaySummary')).toContainText('Сдача: 600');await save(page);await expect(page.locator('#workspace')).toBeVisible();
 expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:400,terminal:500,owner_card:300,other_card:400,cash_received:1000});expect(errors).toEqual([]);
});

test('mixed clinical payment cannot omit another-card amount from exact-total validation',async({page})=>{
 const errors=await boot(page);await form(page);await page.locator('#procPaymentV5 [data-pay-method="mixed"]').click();await page.fill('#procPayCash','1200');await page.fill('#procPayOtherCard','399.99');await save(page);await expect(page.locator('#procedureMessage')).toContainText('Распределите ровно');expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

for(const mixed of [false,true])test(`saved ordinary ${mixed?'mixed cash/other-card':'other-card'} collection preserves its channel and confirmation`,async({page})=>{
 const errors=await boot(page);await pending(page);await page.selectOption('#debtMethodV10',mixed?'mixed':'other_card');
 if(mixed){await page.fill('#debtCashV43','1200');await page.fill('#debtOtherCardV47','400');await page.check('#debtConfirmV10');await page.fill('#debtOtherCardV47','400.00');await expect(page.locator('#debtConfirmV10')).not.toBeChecked()}
 else await expect(page.locator('#debtTenderV10')).toBeHidden();
 await expect(page.locator('#debtMethodSummaryV44')).toContainText('Другая карта');await savePending(page);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:mixed?1200:0,terminal:0,owner_card:0,other_card:mixed?400:1600,cash_received:mixed?1200:0});await noOverflow(page);expect(errors).toEqual([]);
});

for(const mixed of [false,true])test(`uncertain ${mixed?'mixed':'single'} other-card collection reopens with the same allocation and receipt UUID`,async({page})=>{
 const errors=await boot(page);await pending(page);await page.selectOption('#debtMethodV10',mixed?'mixed':'other_card');if(mixed){await page.fill('#debtCashV43','1200');await page.fill('#debtOtherCardV47','400')}
 await page.evaluate(()=>{__otherV47.lose=true});await savePending(page);await expect(page.locator('#debtMessageV10')).toContainText(/Черновик|подтвержден|Повтор/i);await pending(page);await expect(page.locator('#debtMethodV10')).toHaveValue(mixed?'mixed':'other_card');await expect(page.locator('#debtOtherCardV47')).toHaveValue(mixed?'400':'1600');await expect(page.locator('#debtOtherCardV47')).toBeDisabled();
 await page.locator('#debtPaymentV10 button[onclick="saveDebtPaymentV10()"]' ).click();await expect(page.locator('#workspace')).toBeVisible();expect(await writes(page)).toHaveLength(1);const calls=await page.evaluate(()=>__otherV47.calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='debt_payment'));expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(errors).toEqual([]);
});

test('a cash discount keeps the other-card component and reduces only the cash component',async({page})=>{
 const errors=await boot(page);await form(page);await page.locator('#procPaymentV5 [data-pay-method="mixed"]').click();await page.fill('#procPayCash','1200');await page.fill('#procPayOtherCard','400');await page.fill('#procPayTender','1000');await page.fill('#procDiscountInPaymentV11','Скидка согласована');await page.click('#procApplyDiscountV11');await expect(page.locator('#procPaid')).toHaveValue('1400.00');await expect(page.locator('#procPayOtherCard')).toHaveValue('400');await save(page);await expect(page.locator('#workspace')).toBeVisible();expect((await writes(page))[0].args.p_payload.payments).toEqual({cash:1000,terminal:0,owner_card:0,other_card:400,cash_received:1000});expect(errors).toEqual([]);
});

test('toggling mistaken-payment correction disables and restores the other-card allocation',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{const record=__otherV47.records.get('saved-procedure');Object.assign(record,{paid_total:1600,received_total:1600,initial_paid_total:1600,debt_total:0,payment_pending:false,payment_status:'paid',payments:{cash:1600,terminal:0,owner_card:0}})});await form(page,'procedure',true);await page.fill('#procChargeInPaymentV11','1800');await page.fill('#procDiscountInPaymentV11','Корректировка стоимости');await page.locator('#procPaymentV5 [data-pay-method="other_card"]').click();
 await expect(page.locator('#procPayOtherCard')).toHaveValue('200.00');await page.check('#procPaymentCorrectionV22');await expect(page.locator('#procPayOtherCard')).toBeDisabled();await expect(page.locator('#procPayOtherCard')).toHaveValue('0.00');await page.uncheck('#procPaymentCorrectionV22');await expect(page.locator('#procPayOtherCard')).toBeEnabled();await expect(page.locator('#procPayOtherCard')).toHaveValue('200.00');await expect(page.locator('#procPaymentV5 [data-pay-method="other_card"]')).toHaveAttribute('aria-pressed','true');expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});
