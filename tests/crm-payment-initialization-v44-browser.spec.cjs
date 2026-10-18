const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Delay the optional previous-procedure hint after the actual form is visible.
// This boundary used to reset an already selected payment back to cash.
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-18T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async()=>{
  const actor={id:'nurse-race',full_name:'Тестовая Медсестра',role:'nurse',active:true};
  const staff=[{id:'nurse-race',full_name:'Тестовая Медсестра'},{id:'nurse-second',full_name:'Вторая Медсестра'}];
  const opened={id:'race-shift',date:'2026-10-18',started_at:'2026-10-18T05:30:00Z',planned_end_at:'2026-10-18T13:00:00Z',status:'open',staff};
  patients=[{id:'patient-race',full_name:'Тестов Пациент'}];nurses=staff;
  meds=[{id:'med-race',name:'Препарат для проверки',consumption_unit:'амп.',sale_price:1000,work_qty:0,active:true}];
  services=[{id:'service-race',name:'Капельница',work_price:500,consumables_price:100,active:true}];
  inventory=meds.map(item=>({...item,reserve_qty:0,reserve_available:0,work_available:0,units_per_package:5}));
  window.__raceWrites=[];window.__raceHintHeld=false;
  const report=()=>({shift:opened,staff,procedures:[],sales:[],receipts:[],patients_count:0,procedures_count:0,sales_count:0,revenue:{cash:0,terminal:0,owner_card:0,total:0},charge_total:0,debt_total:0,used:[],stock:[],untracked:[],warnings:[]});
  db.from=()=>{const query={select(){return query},eq(){return query},order(){return query},maybeSingle:async()=>({data:actor})};return query};
  db.rpc=async(name,args={})=>{
   if(name==='record_treatment_v5'){__raceWrites.push(JSON.parse(JSON.stringify(args)));return {data:{id:'saved-race',paid_total:args.p_payload.paid_total,payments:args.p_payload.payments,stock_deducted:false}}}
   if(name==='quick_ui_v4'&&args.p_action==='last_procedure'){
    __raceHintHeld=true;return new Promise(resolve=>{window.__raceReleaseHint=()=>resolve({data:null})});
   }
   if(name==='crm_finance_v5')return {data:args.p_action==='accounting_mode'?{payment_only:true,stock_deducted:false}:report()};
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='get_my_open_shift_v82')return {data:opened};if(name==='work_catalog_v2')return {data:meds};
   if(name.includes('warehouse'))return {data:inventory};return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'race-auth'});shift={id:'race-shift',aId:'nurse-race',a:'Тестовая Медсестра',bId:'nurse-second',b:'Вторая Медсестра',type:'08:30–16:00'};show('workspace');
 });
 return errors;
}

async function openWhileHintIsLoading(page){
 await page.evaluate(()=>{window.__raceOpenDone=false;window.__raceOpening=openProcedure('patient-race').then(()=>{window.__raceOpenDone=true})});
 await expect(page.locator('#procedure')).toBeVisible();await expect.poll(()=>page.evaluate(()=>__raceHintHeld)).toBe(true);
 await page.selectOption('#procService','service-race');await page.evaluate(()=>chooseMedication('procMeds','med-race'));
 await expect(page.locator('#procPaid')).toHaveValue('1600.00');
}
async function finishHint(page){
 await page.evaluate(()=>__raceReleaseHint());await expect.poll(()=>page.evaluate(()=>__raceOpenDone)).toBe(true);
}

for(const method of ['terminal','owner_card'])test(`a delayed patient history hint preserves the chosen ${method} payment and submitted allocation`,async({page})=>{
 const errors=await boot(page);await openWhileHintIsLoading(page);
 await page.locator(`#procPaymentV5 [data-pay-method="${method}"]`).click();await page.check('#procPayConfirmed');
 await finishHint(page);
 await expect(page.locator(`#procPaymentV5 [data-pay-method="${method}"]`)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#procPayConfirmed')).toBeChecked();
 await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();
 const writes=await page.evaluate(()=>__raceWrites);expect(writes).toHaveLength(1);
 expect(writes[0].p_payload.payments).toEqual({cash:0,terminal:method==='terminal'?1600:0,owner_card:method==='owner_card'?1600:0,cash_received:0});expect(errors).toEqual([]);
});

test('a delayed history hint preserves a mixed allocation and explicit cash tender',async({page})=>{
 const errors=await boot(page);await openWhileHintIsLoading(page);await page.locator('#procPaymentV5 [data-pay-method="mixed"]').click();
 await page.fill('#procPayCash','1200');await page.fill('#procPayTerminal','400');await page.fill('#procPayOwnerCard','');await page.fill('#procPayTender','1500');await page.check('#procPayConfirmed');
 await finishHint(page);await expect(page.locator('#procPaymentV5 [data-pay-method="mixed"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#procPayConfirmed')).toBeChecked();
 await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();
 const writes=await page.evaluate(()=>__raceWrites);expect(writes).toHaveLength(1);expect(writes[0].p_payload.payments).toEqual({cash:1200,terminal:400,owner_card:0,cash_received:1500});expect(errors).toEqual([]);
});

test('a delayed history hint cannot turn waiting for payment into a paid cash procedure',async({page})=>{
 const errors=await boot(page);await openWhileHintIsLoading(page);await page.selectOption('#procPaymentStatusV10','pending');
 await finishHint(page);await expect(page.locator('#procPaymentStatusV10')).toHaveValue('pending');await expect(page.locator('#procReceivedV10')).toHaveValue('0.00');
 await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();
 const writes=await page.evaluate(()=>__raceWrites);expect(writes).toHaveLength(1);expect(writes[0].p_payload).toMatchObject({paid_total:0,payment_status:'pending',payments:{cash:0,terminal:0,owner_card:0,cash_received:0}});expect(errors).toEqual([]);
});

test('a delayed history hint preserves a manually corrected visit date and time in the saved procedure',async({page})=>{
 const errors=await boot(page);await openWhileHintIsLoading(page);
 await page.fill('#procVisitDateV23','2026-10-17');await page.fill('#procVisitTimeV23','09:25');
 await finishHint(page);await expect(page.locator('#procVisitDateV23')).toHaveValue('2026-10-17');await expect(page.locator('#procVisitTimeV23')).toHaveValue('09:25');
 await page.locator('#procPaymentV5 [data-pay-method="terminal"]').click();await page.check('#procPayConfirmed');
 await page.locator('#procedure button[onclick="saveProcedure()"]').click();await expect(page.locator('#workspace')).toBeVisible();
 const writes=await page.evaluate(()=>__raceWrites);expect(writes).toHaveLength(1);expect(writes[0].p_payload).toMatchObject({arrival_at:'2026-10-17T06:25:00.000Z',payments:{cash:0,terminal:1600,owner_card:0,cash_received:0}});expect(errors).toEqual([]);
});
