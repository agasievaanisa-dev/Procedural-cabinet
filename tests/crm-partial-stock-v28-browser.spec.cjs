const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

// Full application against a synthetic server contract. The server owns stock
// facts and replay receipts; the browser must not infer that every priced item
// has already been entered into the warehouse.
async function boot(page,{role='nurse',mode='partial',legacy=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-10-14T07:30:00Z'));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]}),createSignedUrl:async()=>({data:{signedUrl:"#"}})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(async({role,mode,legacy})=>{
  const copy=value=>JSON.parse(JSON.stringify(value));let actor;
  const staff=[{id:'nurse-1',full_name:'Наталья',amount:2000},{id:'nurse-2',full_name:'Лилия',amount:2000}];
  const opened={id:'shift-1',date:'2026-10-14',started_at:'2026-10-14T05:30:00Z',planned_end_at:'2026-10-14T13:00:00Z',status:'open',staff};
  window.__partialMode=mode;
  const modeData=()=>({payment_only:__partialMode!=='strict',stock_deducted:__partialMode==='strict',...(legacy?{}:{partial_stock:__partialMode==='partial',stock_mode:__partialMode==='partial'?'partial':__partialMode==='strict'?'full':'payment_only'})});
  window.__partialData=[
   {id:'tracked',name:'Препарат с подтверждённым остатком',sale_price:200,consumption_unit:'амп.',units_per_package:10,work_qty:1,reserve_qty:2,work_available:1,reserve_available:2,total_available:3,total_qty:3,stock_tracking_enabled:true,active:true},
   {id:'untracked',name:'Препарат только из прайса',sale_price:100,consumption_unit:'фл.',units_per_package:5,work_qty:0,reserve_qty:0,work_available:0,reserve_available:0,total_available:0,total_qty:0,stock_tracking_enabled:false,active:true},
   {id:'unknown',name:'Препарат с неуказанным сроком',sale_price:50,consumption_unit:'амп.',units_per_package:10,work_qty:7,reserve_qty:0,work_available:0,reserve_available:0,total_available:0,total_qty:7,unknown_expiry_qty:7,stock_tracking_enabled:true,active:true}
  ];
  window.__partialCalls=[];window.__partialRecords=[];window.__partialReplay=new Map();window.__partialEffects=[];window.__partialLoseTracking=false;window.__partialDeferTracking=false;window.__partialDeferReview=false;
  const summary=()=>({pending_quantity:6,medications:[{medication_id:'untracked',name:'Препарат только из прайса',unit:'фл.',pending_quantity:4,records_count:2,reasons:['untracked']},{medication_id:'unknown',name:'Препарат с неуказанным сроком',unit:'амп.',pending_quantity:2,records_count:1,reasons:['unknown_expiry']}]});
  db.from=()=>{const q={select(){return q},eq(){return q},order(){return q},maybeSingle:async()=>({data:actor})};return q};
  db.rpc=async(name,args={})=>{
   __partialCalls.push({name,args:copy(args)});const action=args.p_action,p=args.p_payload||{};
   if(name==='crm_partial_stock_v28'){
    if(action==='status')return {data:{...modeData(),tracked_count:2}};
    if(!['admin','owner'].includes(actor.role))return {error:{code:'42501',message:'Нет доступа к сверке склада'}};
    if(action==='review_summary'){
     if(__partialDeferReview){__partialDeferReview=false;await new Promise(resolve=>window.__releasePartialReview=resolve)}
     return {data:summary()};
    }
    if(action==='tracking_set'){
     let result=__partialReplay.get(args.p_request_id);
     if(!result){const row=__partialData.find(x=>x.id===p.id);row.stock_tracking_enabled=p.enabled;result=copy(row);__partialReplay.set(args.p_request_id,result);__partialEffects.push({id:p.id,enabled:p.enabled});}
     if(__partialDeferTracking){__partialDeferTracking=false;await new Promise(resolve=>window.__releasePartialTracking=resolve)}
     if(__partialLoseTracking){__partialLoseTracking=false;throw new TypeError('Load failed')}
     return {data:copy(result)};
    }
   }
   if(name==='crm_finance_v5'){
    if(action==='accounting_mode')return {data:modeData()};
    if(action==='settings_get')return {data:{...modeData(),float_amount:500,time_zone:'Europe/Moscow'}};
    if(action==='settings_save'){__partialMode=p.partial_stock?'partial':p.payment_only?'finance':'strict';return {data:{...p,...modeData()}};}
    return {data:[]};
   }
   if(name==='record_treatment_v5'){
    const items=p.items.map(x=>{
     const m=__partialData.find(m=>m.id===x.medication_id);
     const deducted=__partialMode==='partial'&&m.stock_tracking_enabled?Math.min(x.quantity,m.total_available):__partialMode==='strict'?x.quantity:0;
     return {...x,name:m.name,unit:m.consumption_unit,unit_price:m.sale_price,line_total:m.sale_price*x.quantity,stock_deducted_quantity:deducted,stock_pending_quantity:x.quantity-deducted,pending_reason:deducted===x.quantity?null:m.stock_tracking_enabled?'unknown_expiry':'untracked'};
    });
    const stock_summary={requested_quantity:items.reduce((n,x)=>n+x.quantity,0),deducted_quantity:items.reduce((n,x)=>n+x.stock_deducted_quantity,0),pending_quantity:items.reduce((n,x)=>n+x.stock_pending_quantity,0)};
    const record={id:'record-1',kind:args.p_kind,items,paid_total:p.paid_total,debt_total:p.charge_total-p.paid_total,stock_deducted:__partialMode==='strict',...(__partialMode==='partial'?{stock_mode:'partial',stock_summary}:{})};
    __partialRecords.push(copy(record));return {data:record};
   }
   if(name==='get_my_open_shift_v82')return {data:opened};
   if(name==='quick_ui_v4')return {data:action==='context'?{favorites:[],recent:[],shifts:[opened]}:null};
   if(name==='work_catalog_v2')return {data:copy(__partialData)};
   if(name.includes('warehouse'))return {data:copy(__partialData)};
   if(name==='patient_history_v8')return {data:{procedures:[],sales:[]}};
   return {data:[]};
  };
  patients=[{id:'patient-1',full_name:'Анна',sex:'female'}];nurses=staff;services=[{id:'service-1',name:'Капельница',work_price:100,consumables_price:50,active:true}];
  loadPatients=async()=>{};loadNurses=async()=>{};loadServices=async()=>{};signMedicationPhotos=async()=>{};
  loadMeds=async()=>{meds=copy(__partialData)};
  loadInventory=async()=>{inventory=copy(__partialData);renderInventory();return true};
  loadQuickContext=async()=>{quickContext={favorites:[],recent:[],shifts:[opened]}};
  refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};
  window.__partialLogin=async role=>{actor={id:role==='nurse'?'nurse-1':'owner-1',full_name:role==='nurse'?'Наталья':'Аниса',role,active:true};await loadMeds();await loadInventory();await enterApp({id:'synthetic-auth-'+role});shift={id:'shift-1',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия',type:'08:30–16:00'};show('workspace')};
  await __partialLogin(role);
 },{role,mode,legacy});
 await expect(page.locator('#workspace')).toBeVisible();return errors;
}
const tile=(page,id)=>page.locator('#salePhotoCatalog .med-tile[data-medication-id="'+id+'"]');
const card=(page,id)=>page.locator('#inventoryList [data-medication-id="'+id+'"]');
const calls=(page,name,action)=>page.evaluate(({name,action})=>__partialCalls.filter(x=>x.name===name&&(!action||x.args.p_action===action)),{name,action});
async function openSale(page){await page.evaluate(()=>openSale());await expect(page.locator('#sale')).toBeVisible()}
async function choose(page,id,quantity=1){await tile(page,id).locator('.photo-choice').click();await page.locator('#saleMeds .medrow[data-medication-id="'+id+'"] .medqty').fill(String(quantity))}
async function saveSale(page){await page.check('#salePayConfirmed');await page.locator('#sale button[onclick="saveSale()"]' ).click()}

test('partial mode explains gradual adoption and distinguishes tracked, price-only and undated stock',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#accountingModeBannerV5')).toContainText('Поэтапный складской учёт');await expect(page.locator('#partialStockReviewHomeV28')).toHaveCount(0);await openSale(page);
 await expect(page.locator('#saleAccountingModeV5')).toContainText('при необходимости из запаса');
 await expect(tile(page,'tracked')).toContainText('Учёт подключён · доступно 3 амп.');
 await expect(tile(page,'untracked')).toContainText('Пока только прайс');await expect(tile(page,'unknown')).toContainText('Есть остаток без срока');
 await choose(page,'tracked',4);await expect(page.locator('#saleMeds [data-medication-id="tracked"] .stock-hint')).toContainText('к списанию 3 амп. · к сверке 1 амп.');
 await choose(page,'untracked',2);await expect(page.locator('#saleMeds [data-medication-id="untracked"] .stock-hint')).toContainText('к сверке 2 фл.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('nurse stock catalogue does not claim that partial-mode stock never changes',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openStock());await expect(page.locator('#workStock')).toBeVisible();await expect(page.locator('#workStockList')).not.toContainText('Количество на складе не ограничивает запись и не меняется');await expect(page.locator('#workStockList')).not.toContainText('Учёт оплаты без складского списания');await expect(page.locator('#workStockList')).toContainText(/Поэтапн|Учёт подключён|списыва/);expect(errors).toEqual([]);
});

test('nurse catalogue without reserve totals explains server-side deduction and still saves a mixed sale',async({page})=>{
 const errors=await boot(page);await openSale(page);
 // The nurse API intentionally supplies work-only quantities. A hidden reserve
 // must not be treated as zero or used to predict how much the server will take.
 await page.evaluate(()=>{
  for(const m of meds){m.physical_work_qty=m.work_qty;delete m.total_available;delete m.reserve_available;delete m.reserve_qty;delete m.total_qty;}
  renderMedVisualCatalog('saleMeds');
 });
 const trackedLabel=tile(page,'tracked').locator('.partial-stock-label-v28.connected');
 await expect(trackedLabel).toContainText('в работе 1 амп.');await expect(trackedLabel).not.toContainText('доступно');
 await choose(page,'tracked',3);await choose(page,'untracked',1);
 const hint=page.locator('#saleMeds [data-medication-id="tracked"] .stock-hint');
 await expect(hint).toContainText(/автосписание при сохранении/i);await expect(hint).not.toContainText('к списанию');await expect(hint).not.toContainText('к сверке 2 амп.');
 await page.selectOption('#salePaymentStatusV10','debt');await saveSale(page);await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({expected_stock_deducted:false,expected_partial_stock:true,items:[{medication_id:'tracked',quantity:3},{medication_id:'untracked',quantity:1}],charge_total:700,paid_total:0});
 await expect(page.locator('#homeMessage')).toContainText('Склад: списано 3 ед.; к сверке 1 ед.');expect(errors).toEqual([]);
});

for(const role of ['nurse','admin'])test(`${role} saves mixed available, unentered and undated medicines without blocking the financial record`,async({page})=>{
 const errors=await boot(page,{role});await openSale(page);await choose(page,'tracked',3);await choose(page,'untracked',2);await choose(page,'unknown',1);await page.selectOption('#salePaymentStatusV10','debt');await saveSale(page);await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved).toHaveLength(1);expect(saved[0].args).toMatchObject({p_kind:'sale',p_payload:{patient_id:null,items:[{medication_id:'tracked',quantity:3},{medication_id:'untracked',quantity:2},{medication_id:'unknown',quantity:1}],charge_total:850,paid_total:0,payment_status:'debt',expected_stock_deducted:false,expected_partial_stock:true}});
 await expect(page.locator('#homeMessage')).toContainText('Склад: списано 3 ед.; к сверке 3 ед.');
 expect(await page.evaluate(()=>__partialRecords[0])).toMatchObject({stock_mode:'partial',stock_summary:{requested_quantity:6,deducted_quantity:3,pending_quantity:3},debt_total:850});expect(errors).toEqual([]);
});

test('nurse saves an unpaid procedure containing an unentered medicine and its individual dose',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');await page.locator('#procPhotoCatalog [data-medication-id="untracked"] .photo-choice').click();await page.locator('#procMeds .meddose-v24').fill('2 мл');await expect(page.locator('#procMeds .stock-hint')).toContainText('к сверке 1 фл.');await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved).toHaveLength(1);expect(saved[0].args).toMatchObject({p_kind:'procedure',p_payload:{patient_id:'patient-1',items:[{medication_id:'untracked',quantity:1,dose:'2 мл'}],services:[{service_id:'service-1',quantity:1}],charge_total:250,paid_total:0,payment_status:'pending',expected_stock_deducted:false,expected_partial_stock:true}});await expect(page.locator('#homeMessage')).toContainText('Склад: списано 0 ед.; к сверке 1 ед.');expect(errors).toEqual([]);
});

for(const [mode,paymentOnly,partialStock] of [['partial',true,true],['finance',true,false],['strict',false,false]])test(`administrator saves explicit ${mode} accounting mode`,async({page})=>{
 const errors=await boot(page,{role:'admin'});await page.evaluate(()=>openSettingsV5());await expect(page.locator('#settingsStockModeV28')).toBeEnabled();await expect(page.locator('#settingsLegacyModeV28')).toBeHidden();await page.selectOption('#settingsStockModeV28',mode);await page.click('#settingsSaveV5');await expect(page.locator('#settingsMessageV5')).toContainText('Настройки сохранены');
 const saved=await calls(page,'crm_finance_v5','settings_save');expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({float_amount:500,time_zone:'Europe/Moscow',payment_only:paymentOnly,partial_stock:partialStock});expect(errors).toEqual([]);
});

test('administrator reviews aggregated unsent quantities with reasons and a direct stock correction action',async({page})=>{
 const errors=await boot(page,{role:'owner'});await page.locator('#partialStockReviewHomeV28').click();await expect(page.locator('#partialStockReviewV28')).toBeVisible();await expect(page.locator('#partialStockReviewBodyV28')).toContainText('К сверке: 6 ед.');
 const articles=page.locator('#partialStockReviewBodyV28 article');await expect(articles).toHaveCount(2);await expect(articles.nth(0)).toContainText('4 фл. · записей: 2');await expect(articles.nth(0)).toContainText('Остаток ещё не подключён');await expect(articles.nth(1)).toContainText('Срок не указан');
 await page.evaluate(()=>{window.__corrected=[];openMedForm=(id,action)=>__corrected.push({id,action})});await articles.nth(0).getByRole('button',{name:'Проверить остаток',exact:true}).click();expect(await page.evaluate(()=>__corrected)).toEqual([{id:'untracked',action:'correct'}]);expect(errors).toEqual([]);
});

test('nurse has neither review controls nor a callable review screen',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#partialStockReviewHomeV28')).toHaveCount(0);await expect(page.locator('#partialStockReviewEntryV28')).toHaveCount(0);await page.evaluate(()=>openPartialStockReviewV28());await expect(page.locator('#partialStockReviewV28')).toHaveCount(0);expect(await calls(page,'crm_partial_stock_v28','review_summary')).toHaveLength(0);expect(errors).toEqual([]);
});

test('lost tracking reply retries its exact request identifier and changes server tracking once',async({page})=>{
 const errors=await boot(page,{role:'admin'});await page.evaluate(()=>{show('admin');renderInventory();__partialLoseTracking=true});const button=card(page,'untracked').getByRole('button',{name:'Подключить списание',exact:true});await button.click();await expect(page.locator('#warehouseMessage')).toContainText(/Load failed|связ|ответ/i);await expect(button).toBeEnabled();await button.click();await expect(card(page,'untracked')).toContainText('Автосписание подключено');
 const attempts=await calls(page,'crm_partial_stock_v28','tracking_set');expect(attempts).toHaveLength(2);expect(attempts[0].args.p_request_id).toBeTruthy();expect(attempts[1].args).toEqual(attempts[0].args);expect(await page.evaluate(()=>__partialEffects)).toEqual([{id:'untracked',enabled:true}]);await expect(page.locator('#warehouseMessage')).toContainText('Прежние процедуры повторно не списываются');expect(errors).toEqual([]);
});

test('tracking reply from a signed-out administrator does not update the new nurse session',async({page})=>{
 const errors=await boot(page,{role:'owner'});await page.evaluate(()=>{__partialDeferTracking=true;window.__trackingPromise=setMedicationStockTrackingV28('untracked',true)});await expect.poll(()=>page.evaluate(()=>typeof __releasePartialTracking)).toBe('function');await page.evaluate(async()=>{await signOut();await __partialLogin('nurse');__releasePartialTracking();await __trackingPromise});
 await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#partialStockReviewHomeV28')).toHaveCount(0);await expect(page.locator('#partialStockReviewEntryV28')).toHaveCount(0);expect(await calls(page,'crm_partial_stock_v28','tracking_set')).toHaveLength(1);expect(errors).toEqual([]);
});

test('deferred review data from the old administrator cannot reappear after nurse login',async({page})=>{
 const errors=await boot(page,{role:'owner'});await page.evaluate(()=>{__partialDeferReview=true;window.__reviewPromise=openPartialStockReviewV28()});await expect.poll(()=>page.evaluate(()=>typeof __releasePartialReview)).toBe('function');await page.evaluate(async()=>{await signOut();await __partialLogin('nurse');__releasePartialReview();await __reviewPromise});await expect(page.locator('#partialStockReviewV28')).toHaveCount(0);await expect(page.locator('#workspace')).toBeVisible();expect(errors).toEqual([]);
});

test('older backend retains payment-only controls and does not send an unsupported partial flag',async({page})=>{
 const errors=await boot(page,{role:'owner',mode:'finance',legacy:true});await expect(page.locator('#accountingModeBannerV5')).toContainText('Учёт оплаты без списания');await expect(page.locator('#partialStockReviewHomeV28')).toHaveCount(0);await page.evaluate(()=>openSettingsV5());await expect(page.locator('#settingsStockModeV28')).toBeDisabled();await expect(page.locator('#settingsLegacyModeV28')).toBeVisible();await page.uncheck('#settingsPaymentOnlyV5');await page.click('#settingsSaveV5');await expect(page.locator('#settingsMessageV5')).toContainText('Настройки сохранены');const saved=await calls(page,'crm_finance_v5','settings_save');expect(saved[0].args.p_payload.payment_only).toBe(false);expect(saved[0].args.p_payload).not.toHaveProperty('partial_stock');expect(errors).toEqual([]);
});

test('strict stock mode still blocks selling a zero-stock medicine before any save RPC',async({page})=>{
 const errors=await boot(page,{mode:'strict'});await openSale(page);await expect(page.locator('#saleAccountingModeV5')).toContainText('Складской учёт включён');await choose(page,'untracked',1);await saveSale(page);await expect(page.locator('#sale')).toBeVisible();await expect(page.locator('#saleMessage')).toContainText(/Недостаточно препарата|Не хватает/);expect(await calls(page,'record_treatment_v5')).toHaveLength(0);expect(errors).toEqual([]);
});

for(const mode of ['partial','finance','strict']) test(`selected sale prices stay visible in ${mode} mode and follow quantity without stock changes`,async({page})=>{
 const errors=await boot(page,{mode});await page.evaluate(()=>__partialData[0].sale_price=200.25);await openSale(page);await choose(page,'tracked',3);
 const row=page.locator('#saleMeds [data-medication-id="tracked"]');
 await expect(row.locator('.medication-price-v31')).toContainText(/Цена:\s*200,25\s*₽\s*\/\s*амп\..*Сумма:\s*600,75\s*₽/);
 await expect(page.locator('#saleList')).toContainText(/600,75\s*₽/);await expect(row.locator('.stock-hint')).not.toBeEmpty();
 await row.locator('.medqty').fill('2');await expect(row.locator('.medication-price-v31')).toContainText(/Сумма:\s*400,5\s*₽/);
 expect(await page.evaluate(()=>__partialData[0].total_qty)).toBe(3);expect(await calls(page,'record_treatment_v5')).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('procedure selection shows every medicine price and line total alongside gradual stock labels',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});
 const errors=await boot(page);await page.evaluate(()=>openProcedure('patient-1'));await expect(page.locator('#procedure')).toBeVisible();await page.selectOption('#procService','service-1');
 await page.evaluate(()=>{chooseMedication('procMeds','tracked');chooseMedication('procMeds','untracked')});
 const tracked=page.locator('#procMeds [data-medication-id="tracked"]'),untracked=page.locator('#procMeds [data-medication-id="untracked"]');
 await tracked.locator('.medqty').fill('2');await untracked.locator('.medqty').fill('3');
 await expect(tracked.locator('.medication-price-v31')).toContainText(/Цена:\s*200\s*₽.*Сумма:\s*400\s*₽/);
 await expect(untracked.locator('.medication-price-v31')).toContainText(/Цена:\s*100\s*₽.*Сумма:\s*300\s*₽/);
 await expect(untracked.locator('.stock-hint')).toContainText('Поэтапный учёт');await expect(page.locator('#procList')).toContainText(/850\s*₽/);
 await tracked.locator('.meddose-v24').fill('50 мг');await expect(tracked.locator('.medication-price-v31')).toContainText(/Сумма:\s*400\s*₽/);await page.locator('#procMeds').screenshot({path:testInfo.outputPath('selected-prices-desktop.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});


// A measured medicine is billed by milligrams; an ordinary ampoule is still a
// whole container. These are synthetic billing fixtures, not dosing guidance.
async function measuredCatalogV31(page,rows=[{id:'reta-mg',name:'Рета',sale_price:1500},{id:'mounjaro-mg',name:'Мунджаро',sale_price:1300}]){
 await page.evaluate(async rows=>{
  __partialData.push(...rows.map(row=>({...row,consumption_unit:'мг',units_per_package:1,work_qty:20,reserve_qty:0,work_available:20,reserve_available:0,total_available:20,total_qty:20,stock_tracking_enabled:true,active:true})));
  await loadMeds();
 },rows);
}
for(const [id,price] of [['reta-mg',1500],['mounjaro-mg',1300]])test(`measured sale ${id}: comma and dot quantities recalculate the displayed price and save numeric milligrams`,async({page})=>{
 const errors=await boot(page);await measuredCatalogV31(page);await openSale(page);await choose(page,id,'2,5');
 const row=page.locator(`#saleMeds [data-medication-id="${id}"]`),q=row.locator('.medqty');
 await expect(q).toHaveAttribute('inputmode','decimal');
 await expect(row.locator('.medication-price-v31')).toContainText(new RegExp('Сумма:\\s*'+(price*2.5).toLocaleString('ru-RU').replace(/\s/g,'\\s*')+'\\s*₽'));
 await expect(page.locator('#saleChargeInPaymentV11')).toHaveValue((price*2.5).toFixed(2));
 await q.fill('7.5');await expect(page.locator('#saleChargeInPaymentV11')).toHaveValue((price*7.5).toFixed(2));
 await page.selectOption('#salePaymentStatusV10','debt');await saveSale(page);await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({items:[{medication_id:id,quantity:7.5}],charge_total:price*7.5,paid_total:0,payment_status:'debt'});expect(typeof saved[0].args.p_payload.items[0].quantity).toBe('number');expect(errors).toEqual([]);
});
for(const [id,price] of [['reta-mg',1500],['mounjaro-mg',1300]])test(`pending procedure ${id} stores a comma-entered 2.5 mg quantity without rounding up to an ampoule`,async({page})=>{
 const errors=await boot(page);await measuredCatalogV31(page);await page.evaluate(()=>openProcedure('patient-1'));await page.selectOption('#procService','service-1');await page.evaluate(id=>chooseMedication('procMeds',id),id);
 await page.locator('#procMeds .medqty').fill('2,5');await expect(page.locator('#procChargeInPaymentV11')).toHaveValue((150+price*2.5).toFixed(2));await page.click('#procSavePendingV14');await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved).toHaveLength(1);expect(saved[0].args.p_payload).toMatchObject({items:[{medication_id:id,quantity:2.5}],services:[{service_id:'service-1',quantity:1}],charge_total:150+price*2.5,paid_total:0,payment_status:'pending'});expect(errors).toEqual([]);
});
test('fractional measured charges round each medicine line to kopecks before the bill is summed',async({page})=>{
 const errors=await boot(page);await measuredCatalogV31(page,[{id:'micro-a',name:'Мерный А',sale_price:0.05},{id:'micro-b',name:'Мерный Б',sale_price:0.05}]);await openSale(page);await choose(page,'micro-a','0,333');await choose(page,'micro-b','0.333');
 await expect(page.locator('#saleChargeInPaymentV11')).toHaveValue('0.04');await page.selectOption('#salePaymentStatusV10','debt');await saveSale(page);await expect(page.locator('#workspace')).toBeVisible();
 const saved=await calls(page,'record_treatment_v5');expect(saved[0].args.p_payload).toMatchObject({items:[{medication_id:'micro-a',quantity:0.333},{medication_id:'micro-b',quantity:0.333}],charge_total:0.04});expect(errors).toEqual([]);
});
test('fractional ordinary ampoules remain invalid and never produce a sale RPC',async({page})=>{
 const errors=await boot(page);await openSale(page);await choose(page,'tracked','0.5');await page.selectOption('#salePaymentStatusV10','debt');await saveSale(page);await expect(page.locator('#sale')).toBeVisible();await expect(page.locator('#saleMessage')).toContainText(/цел|количеств/i);expect(await calls(page,'record_treatment_v5')).toHaveLength(0);expect(errors).toEqual([]);
});
for(const entry of ['own','service'])test(`fractional ${entry} counts remain whole-container counts despite milligram support`,async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openProcedure('patient-1'));await page.selectOption('#procService','service-1');
 if(entry==='own'){await page.click('#procAddOwnV10');await page.locator('.own-name-v10').fill('Свой препарат');await page.locator('.own-quantity-v10').fill('0.5')}
 else {await page.click('#procAddServiceV10');await page.locator('.clinical-service-v10 select').selectOption('service-1');await page.locator('.clinical-service-v10 input').fill('0.5')}
 await page.click('#procSavePendingV14');await expect(page.locator('#procedure')).toBeVisible();await expect(page.locator('#procedureMessage')).toContainText(/цел|количеств/i);expect(await calls(page,'record_treatment_v5')).toHaveLength(0);expect(errors).toEqual([]);
});
