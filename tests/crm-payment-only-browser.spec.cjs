const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,role='nurse'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/vendor/supabase-*.js',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:'#'}})})},rpc:async()=>({data:[]})}}};`}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async role=>{
  window.__mode=true;window.__calls=[];window.__records=[];window.__saveError=null;window.__committed=new Map();
  const actor={id:role==='owner'?'owner-1':'nurse-1',full_name:role==='owner'?'Аниса':'Наталья',role,active:true};
  const staff=[{id:'nurse-1',full_name:'Наталья'},{id:'nurse-2',full_name:'Лилия'}];
  const opened={id:'shift-1',started_at:'2026-10-09T05:30:00Z',planned_end_at:'2026-10-09T13:00:00Z',staff};
  patients=[{id:'patient-1',full_name:'Анна',phone:''}];nurses=staff;
  meds=[{id:'med-1',name:'Самыр из прайса',dosage:'400 мг',consumption_unit:'компл.',sale_price:20,work_qty:0,active:true},{id:'med-2',name:'Цена ещё не указана',consumption_unit:'амп.',sale_price:0,work_qty:0,active:true}];
  services=[{id:'service-1',name:'Инъекция',work_price:100,consumables_price:50,active:true}];
  inventory=meds.map(m=>({...m,reserve_qty:0,reserve_available:0,work_available:0,min_total_stock:0,work_threshold:0,units_per_package:5,purchase_price:0,active:true}));
  window.__report={shift:{id:'shift-1',date:'2026-10-09',started_at:opened.started_at,planned_end_at:opened.planned_end_at,status:'open'},staff:staff.map(s=>({...s,amount:2000})),patients_count:1,procedures_count:2,sales_count:1,
   revenue:{cash:50,terminal:100,owner_card:100,total:250,unclassified:0},payroll_total:4000,payroll_unknown:0,payroll_complete:true,cash_after_salary:-3750,
   used:[{id:'tracked',name:'Реально списанный препарат',unit:'амп.',procedure_qty:1,sale_qty:0,quantity:1}],untracked:[{id:'med-1',name:'Самыр из прайса',unit:'компл.',procedure_qty:2,sale_qty:3,quantity:5}],payment_only_procedures_count:1,payment_only_sales_count:1,
   stock:[{id:'med-1',name:'Самыр из прайса',unit:'компл.',work:0,reserve:0}],warnings:[{type:'payment_only',count:2,procedures_count:1,sales_count:1}],
   procedures:[{id:'procedure-1',at:'2026-10-09T10:00:00Z',patient:'Анна',nurse:'Наталья',type:'Инъекция',paid_total:190,stock_deducted:false,items:[{name:'Самыр из прайса',quantity:2,unit:'компл.',line_total:40}]}],sales:[]};
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __calls.push({name,args});
   if(name==='record_treatment_v5'){
    if(__committed.has(args.p_request_id))return {data:__committed.get(args.p_request_id)};
    if(args.p_payload.expected_stock_deducted!==!__mode)return {error:{code:'P0001',message:'Режим учёта изменился. Откройте форму заново.'}};
    if(__saveError)return {error:__saveError};
    const data={id:'saved-'+(__records.length+1),paid_total:args.p_payload.paid_total,payments:args.p_payload.payments,stock_deducted:!__mode,payment_only:__mode};
    __records.push(args);__committed.set(args.p_request_id,data);return {data};
   }
   if(name==='crm_finance_v5'){
    if(args.p_action==='accounting_mode')return {data:{payment_only:__mode,stock_deducted:!__mode}};
    if(args.p_action==='settings_get')return {data:{float_amount:50000,time_zone:'Europe/Moscow',payment_only:__mode}};
    if(args.p_action==='settings_save'){__mode=args.p_payload.payment_only;return {data:{float_amount:50000,time_zone:'Europe/Moscow',payment_only:__mode}};}
    if(args.p_action==='summary')return {data:{revenue:__report.revenue,rows:[],shifts:[],payroll_total:4000,payroll_complete:true,cash_after_salary:-3750}};
    return {data:__report};
   }
   if(name==='quick_ui_v4')return {data:args.p_action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='work_catalog_v2')return {data:meds};
   if(name==='get_my_open_shift_v82')return {data:opened};
   if(name.includes('warehouse'))return {data:inventory};
   if(name==='crm_management_v5')return {data:[]};
   return {data:[]};
  };
  loadPatients=async()=>{};loadNurses=async()=>{};loadMeds=async()=>{};loadServices=async()=>{};loadInventory=async()=>true;signMedicationPhotos=async()=>{};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  await enterApp({id:'mock-auth'});shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};show('workspace');
 },role);
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
async function procedure(page){await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.evaluate(()=>chooseMedication('procMeds','med-1'));await page.fill('#procMeds .medqty','2');await expect(page.locator('#procPaid')).toHaveValue('190.00');}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}

test('nurse bills zero-stock price items with mixed payment while stock stays unchanged',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#workspace .home-actions>button')).toHaveCount(5);await expect(page.locator('#accountingModeBannerV5')).toContainText('без списания со склада');await noOverflow(page);
 await page.evaluate(()=>openStock());await expect(page.locator('#workStock h1')).toHaveText('Прайс препаратов');await expect(page.locator('#workStockList')).toContainText('20 ₽');await expect(page.locator('#workStockList')).toContainText('Цена не задана');
 await procedure(page);await expect(page.locator('#procAccountingModeV5')).toContainText('Остатки препаратов не меняются');await expect(page.locator('#procMeds .medrow')).not.toHaveClass(/short/);await expect(page.locator('#procMeds .stock-hint')).toContainText('без списания');
 await page.click('#procPaymentV5 [data-pay-method="mixed"]');await page.fill('#procPayCash','40');await page.fill('#procPayTerminal','50');await page.fill('#procPayOwnerCard','100');await page.fill('#procPayTender','200');await page.check('#procPayConfirmed');
 await expect(page.locator('#procPaySummary')).toContainText('Сдача: 160');await noOverflow(page);await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#homeMessage')).toContainText('Остатки склада не изменены');
 const results=await page.evaluate(()=>({records:__records,work:meds[0].work_qty}));expect(results.records).toHaveLength(1);expect(results.records[0].p_payload.expected_stock_deducted).toBe(false);expect(results.records[0].p_payload.payments).toEqual({cash:40,terminal:50,owner_card:100,cash_received:200});expect(results.work).toBe(0);expect(errors).toEqual([]);
});

test('owner can return to tracked mode; nurse keeps no setting access and tracked zero stock is blocked',async({page})=>{
 const errors=await boot(page,'owner');await page.evaluate(()=>openSettingsV5());await expect(page.locator('#settingsPaymentOnlyV5')).toBeChecked();await expect(page.locator('#settingsPaymentOnlyV5')).toBeEnabled();await noOverflow(page);
 await page.uncheck('#settingsPaymentOnlyV5');await page.click('#settingsV5 button[onclick="saveSettingsV5()"]');await expect(page.locator('#settingsMessageV5')).toContainText('сохранены');
 const setting=await page.evaluate(()=>__calls.findLast(x=>x.name==='crm_finance_v5'&&x.args.p_action==='settings_save'));expect(setting.args.p_payload.payment_only).toBe(false);
 await procedure(page);await expect(page.locator('#procAccountingModeV5')).toContainText('Складской учёт включён');await page.check('#procPayConfirmed');await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('Недостаточно');expect(await page.evaluate(()=>__records.length)).toBe(0);
 await page.evaluate(()=>{currentStaff.role='nurse';show('settingsV5')});await expect(page.locator('#settingsV5')).not.toBeVisible();expect(errors).toEqual([]);
});

test('stale mode response keeps every payment and medication; unpriced items are not billed',async({page})=>{
 const errors=await boot(page);await procedure(page);await page.click('#procPaymentV5 [data-pay-method="terminal"]');await page.check('#procPayConfirmed');await page.evaluate(()=>{__mode=false});
 await page.click('#procedure button[onclick="saveProcedure()"]');await expect(page.locator('#procedureMessage')).toContainText('Режим учёта изменился');await expect(page.locator('#procPaid')).toHaveValue('190.00');await expect(page.locator('#procPayConfirmed')).toBeChecked();await expect(page.locator('#procMeds .medqty')).toHaveValue('2');expect(await page.evaluate(()=>__records.length)).toBe(0);
 await page.evaluate(async()=>{__mode=true;await openSale('patient-1');chooseMedication('saleMeds','med-2')});await expect(page.locator('#sale')).toBeVisible();await page.check('#salePayConfirmed');await page.click('#sale button[onclick="saveSale()"]');await expect(page.locator('#saleMessage')).toContainText('не указана цена');expect(await page.evaluate(()=>__records.length)).toBe(0);expect(errors).toEqual([]);
});

test('shift report separates billed quantities from actual deductions and hides nurse finance',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openReport());await expect(page.locator('#reportBody')).toContainText('Без списания со склада');await expect(page.locator('#reportBody')).toContainText('Самыр из прайса');await expect(page.locator('#reportBody')).toContainText('Реально списанный препарат');
 const report=await page.locator('#reportBody').innerText();for(const secret of ['Выручка','Зарплата','Общая выручка','4 000','250 ₽','190 ₽'])expect(report).not.toContain(secret);await noOverflow(page);expect(errors).toEqual([]);
});
