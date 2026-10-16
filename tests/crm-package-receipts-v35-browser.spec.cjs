const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Exercise the actual card wrappers and retry transport. The synthetic database
// enforces the new receipt contract, snapshots old batches and deduplicates UUIDs.
async function boot(page,{mobile=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 if(mobile)await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  window.requests=[];window.receipts=[];window.savedRequests={};window.lostReplies=0;window.malformedReplies=0;window.malformedReplyKind='empty';window.listFailures=0;window.holdReceipt=false;window.staleSize=false;
  window.medData=[
   {id:'m1',name:'Препарат 10 мл',consumption_unit:'амп.',units_per_package:1,reserve_qty:10,work_qty:4,reserve_available:10,work_available:4,purchase_price:100,sale_price:500,dosage:'10 мл',manufacturer_country:'Германия',active:true},
   {id:'m2',name:'Другой препарат',consumption_unit:'фл.',units_per_package:10,reserve_qty:20,work_qty:3,reserve_available:20,work_available:3,purchase_price:200,sale_price:300,active:true},
   {id:'mg',name:'Рета',consumption_unit:'мг',units_per_package:10,reserve_qty:20,work_qty:2.5,reserve_available:20,work_available:2.5,purchase_price:200,sale_price:1500,active:true}
  ];
  window.batchData={m1:[{id:'old',batch_number:'OLD',expiry_date:'2099-01-01',received_date:'2026-10-01',quantity_received:14,quantity_remaining:14,work_quantity:4,purchase_price_per_unit:100}],m2:[],mg:[]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),rpc:async(name,args)=>{
   requests.push({name,args:copy(args||{})});
   const action=args?.p_action,p=args?.p_payload||{};
   if(name==='crm_stock_correction_v6'){
    const old=savedRequests[args.p_request_id];if(old)return {data:copy(old.result),error:null};
    const med=medData.find(item=>item.id===p.id),batch=batchData[p.id]?.find(item=>item.id===p.batch_id),rounded=value=>med?.consumption_unit==='мг'?Math.round(value*1000)/1000:value;
    if(!batch||action!=='inventory')return {error:{code:'P0001',message:'Выберите партию'}};
    const before=rounded(p.location==='work'?batch.work_quantity:batch.quantity_remaining-batch.work_quantity);
    if(before!==p.expected_quantity)return {error:{code:'P0001',message:'Остаток уже изменился. Обновите карточку'}};
    const difference=rounded(p.actual_quantity-before);batch.quantity_remaining=rounded(batch.quantity_remaining+difference);
    if(p.location==='work')batch.work_quantity=p.actual_quantity;if(difference>0)batch.quantity_received=rounded(batch.quantity_received+difference);
    med[p.location+'_qty']=rounded(med[p.location+'_qty']+difference);med[p.location+'_available']=rounded(med[p.location+'_available']+difference);
    const result={id:p.id,batch_id:p.batch_id,before,quantity:p.actual_quantity,difference};savedRequests[args.p_request_id]={result};return {data:copy(result),error:null};
   }
   if(name!=='warehouse_v5')return {data:[],error:null};
   if(action==='list'){
    if(listFailures>0){listFailures--;return {error:{message:'Нет связи'}};}
    return {data:copy(medData),error:null};
   }
   if(action==='batches')return {data:copy(batchData[p.id]||[]),error:null};
   if(action==='history')return {data:[],error:null};
   if(action==='save'){
    let med=medData.find(item=>item.id===p.id);
    if(!med){med={id:'created',reserve_qty:0,work_qty:0,reserve_available:0,work_available:0,active:true};medData.push(med);batchData[med.id]=[];}
    Object.assign(med,p,{id:med.id,consumption_unit:p.unit,manufacturer_country:p.country});
    return {data:{id:med.id},error:null};
   }
   if(!['receive','opening'].includes(action))return {data:[],error:null};
   if(holdReceipt){holdReceipt=false;await new Promise(resolve=>{window.releaseReceipt=resolve;});}
   const requestId=args.p_request_id,old=savedRequests[requestId],fingerprint=JSON.stringify([action,p]);
   if(old&&old.fingerprint!==fingerprint)return {error:{code:'22023',message:'Повторное использование запроса с другим количеством'}};
   if(!old){
    const med=medData.find(item=>item.id===p.id);
    if(staleSize){staleSize=false;med.units_per_package=10;}
    if(!med||p.expected_units_per_package!==med.units_per_package)return {error:{code:'P0001',message:'Размер упаковки уже изменился. Обновите карточку'}};
    const size=p.units_per_package,packs=p.packages,quantity=action==='receive'?packs*size:p.quantity;
    if(!Number.isSafeInteger(size)||size<=0||!Number.isFinite(quantity)||quantity<=0||packs!==undefined&&(!Number.isSafeInteger(packs)||packs<=0||quantity!==packs*size))return {error:{code:'22023',message:'Неверный размер упаковки или количество'}};
    const location=action==='receive'?'reserve':p.location;
    if(!Number.isSafeInteger(med.reserve_qty+med.work_qty+quantity)&&med.consumption_unit!=='мг')return {error:{code:'22003',message:'Слишком большое количество'}};
    med.units_per_package=size;med[location+'_qty']+=quantity;med[location+'_available']+=quantity;
    const batch={id:'new-'+receipts.length,quantity_received:quantity,quantity_remaining:quantity,work_quantity:location==='work'?quantity:0,purchase_price_per_unit:p.price/size,expiry_date:p.expiry,batch_number:p.batch_number,supplier:p.supplier,received_date:p.received_date};
    (batchData[med.id]??=[]).push(batch);receipts.push({action,payload:copy(p),requestId,quantity,location});
    savedRequests[requestId]={fingerprint,result:{id:med.id,batch_id:batch.id,quantity,units_per_package:size,location}};
   }
   if(lostReplies>0){lostReplies--;return {error:{message:'Failed to fetch'}};}
   if(malformedReplies>0){malformedReplies--;const confirmed=copy(savedRequests[requestId].result);return {data:malformedReplyKind==='quantity'?{...confirmed,quantity:confirmed.quantity+1}:malformedReplyKind==='batch'?{...confirmed,batch_id:''}:{},error:null};}
   return {data:copy(savedRequests[requestId].result),error:null};
  }};
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/vendor/supabase-2.117.2.js')||url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(url.hostname!=='127.0.0.1')return route.abort();
  const filename=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,filename);
  return route.fulfill({contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
 });
 await page.goto('/');
 await page.evaluate(async()=>{currentStaff={id:'admin',role:'admin',full_name:'Администратор тест'};await loadInventory();openMedForm('m1','receive');});
 await expect(page.locator('#receiveUnitsPerPackV35')).toBeVisible();
 return errors;
}
async function receipt(page,{packs='2',size='5',price='100'}={}){
 await page.fill('#receivePackages',packs);await page.fill('#receiveUnitsPerPackV35',size);
 await page.evaluate(value=>{document.getElementById('receivePrice').value=value;},price);
 await page.fill('#receiveExpiry','2099-06-30');
}
function receiveButton(page){return page.locator('#receiveButton');}
function openingButton(page){return page.locator('#openingPanel button[onclick="saveOpeningStock()"]');}
async function mutations(page){return page.evaluate(()=>requests.filter(call=>call.name==='warehouse_v5'&&['receive','opening'].includes(call.args.p_action)));}

test('two packages of five are received as ten ampoules; existing ampoules and batch costs stay unchanged',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('1');
 await receipt(page);await expect(page.locator('#receivePreview')).toContainText('10');await expect(page.locator('#receivePreview')).toContainText('24');
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Партия добавлена');
 const calls=await mutations(page);expect(calls).toHaveLength(1);
 expect(calls[0].args.p_payload).toMatchObject({id:'m1',packages:2,units_per_package:5,expected_units_per_package:1,price:100,expiry:'2099-06-30'});
 const snapshot=await page.evaluate(()=>({med:medData[0],old:batchData.m1[0],fresh:batchData.m1[1]}));
 expect(snapshot.med).toMatchObject({units_per_package:5,reserve_qty:20,work_qty:4});
 expect(snapshot.old).toMatchObject({quantity_received:14,quantity_remaining:14,work_quantity:4,purchase_price_per_unit:100});
 expect(snapshot.fresh).toMatchObject({quantity_received:10,quantity_remaining:10,work_quantity:0,purchase_price_per_unit:20});
 await expect(page.locator('#medStockSummary')).toContainText('4 уп.');await expect(page.locator('#medStockSummary')).toContainText('24 амп.');
 await expect(page.locator('#receivePackages')).toHaveValue('');await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('5');expect(errors).toEqual([]);
});

test('a saved new card seeds receipt package size and retains batch metadata in the atomic request',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openMedForm());
 await page.fill('#medName','Новый препарат');await page.fill('#medDosage','10 мл');await page.fill('#medUnitsPerPack','5');
 await page.click('#medSaveButton');await expect(page.locator('#medPhotoMessage')).toContainText('Карточка сохранена');
 await expect(page.locator('#medId')).toHaveValue('created');await page.locator('#receivePanel>summary').click();
 await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('5');await receipt(page);
 await page.evaluate(()=>{document.getElementById('receiveBatchNumberV5').value='B-10';document.getElementById('receiveSupplierV5').value='Поставщик тест';document.getElementById('receiveReceivedDateV5').value=localDateValue();document.getElementById('receiveComment').value='Накладная 15';});
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Партия добавлена');
 const calls=await mutations(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({id:'created',packages:2,units_per_package:5,expected_units_per_package:5,price:100,batch_number:'B-10',supplier:'Поставщик тест',comment:'Накладная 15',expiry:'2099-06-30'});
 expect(calls[0].args.p_payload.received_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(await page.evaluate(()=>medData.find(m=>m.id==='created').reserve_qty)).toBe(10);expect(errors).toEqual([]);
});

test('opening stock accepts either package multiplication or actual units and respects the selected location',async({page})=>{
 const errors=await boot(page);await page.locator('#openingPanel>summary').click();
 await expect(page.locator('#openingModeV35')).toHaveValue('units');await page.selectOption('#openingModeV35','packs');
 await page.fill('#openingQty','2');await page.fill('#openingUnitsPerPackV35','5');await page.selectOption('#openingLocation','work');await page.fill('#openingExpiry','2099-07-01');
 await expect(page.locator('#openingPreviewV35')).toContainText('10');await openingButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Имеющийся остаток добавлен');
 let calls=await mutations(page);expect(calls[0].args.p_payload).toMatchObject({id:'m1',quantity:10,packages:2,units_per_package:5,expected_units_per_package:1,location:'work'});
 expect(await page.evaluate(()=>({reserve:medData[0].reserve_qty,work:medData[0].work_qty}))).toEqual({reserve:10,work:14});
 await page.evaluate(()=>{document.getElementById('openingPanel').open=true;});await page.selectOption('#openingModeV35','units');await page.fill('#openingQty','3');await page.fill('#openingExpiry','2099-07-02');
 await openingButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Имеющийся остаток добавлен');
 calls=await mutations(page);expect(calls).toHaveLength(2);expect(calls[1].args.p_payload).toMatchObject({quantity:3,units_per_package:5,expected_units_per_package:5});expect(calls[1].args.p_payload).not.toHaveProperty('packages');expect(errors).toEqual([]);
});

test('blank, zero, fractional packages and invalid package sizes cannot trigger a receipt',async({page})=>{
 const errors=await boot(page);await receipt(page);
 for(const [packs,size] of [['','5'],['0','5'],['1.5','5'],['-1','5'],['2',''],['2','0'],['2','2.5'],['2','-1']]){
  await page.fill('#receivePackages',packs);await page.fill('#receiveUnitsPerPackV35',size);await receiveButton(page).click();
  expect(await mutations(page)).toHaveLength(0);await expect(page.locator('#stockOperationMessage')).not.toHaveText('');
 }
 await page.fill('#receivePackages','2');await page.fill('#receiveUnitsPerPackV35','5');await page.fill('#receiveUnitsPerPackV35','');
 await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('');await page.fill('#receivePackages','');await expect(page.locator('#receivePackages')).toHaveValue('');
 await page.evaluate(()=>updateStockPreview());await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('');await expect(page.locator('#receivePackages')).toHaveValue('');expect(errors).toEqual([]);
});

test('unsafe products and unsafe resulting totals are rejected before a warehouse write',async({page})=>{
 const errors=await boot(page);
 for(const [packs,size] of [['9007199254740991','2'],['9007199254740990','1']]){
  await receipt(page,{packs,size});await receiveButton(page).click();expect(await mutations(page)).toHaveLength(0);
 }
 expect(errors).toEqual([]);
});

test('opening package counts can be cleared, and neither invalid counts nor invalid expiry reach the database',async({page})=>{
 const errors=await boot(page);await page.locator('#openingPanel>summary').click();await page.selectOption('#openingModeV35','packs');await page.fill('#openingUnitsPerPackV35','5');await page.fill('#openingExpiry','2099-07-01');
 for(const value of ['','0','-1','1.5']){await page.fill('#openingQty',value);await openingButton(page).click();expect(await mutations(page)).toHaveLength(0);}
 await page.fill('#openingQty','2');await page.fill('#openingQty','');await page.evaluate(()=>updateStockPreview());await expect(page.locator('#openingQty')).toHaveValue('');
 await receipt(page);
 for(const expiry of ['','2000-01-01']){await page.fill('#receiveExpiry',expiry);await receiveButton(page).click();expect(await mutations(page)).toHaveLength(0);}
 expect(errors).toEqual([]);
});

test('opening actual measured units permits fractional milligrams; package counts remain whole',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{openMedForm('mg');document.getElementById('openingPanel').open=true;});
 await expect(page.locator('#openingModeV35')).toHaveValue('units');await page.fill('#openingQty','2.5');await page.fill('#openingExpiry','2099-08-01');await openingButton(page).click();
 await expect(page.locator('#stockOperationMessage')).toContainText('Имеющийся остаток добавлен');let calls=await mutations(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({id:'mg',quantity:2.5,units_per_package:10,expected_units_per_package:10});
 await page.evaluate(()=>{document.getElementById('openingPanel').open=true;});await page.selectOption('#openingModeV35','packs');await page.fill('#openingQty','2.5');await page.fill('#openingExpiry','2099-08-01');await openingButton(page).click();expect(await mutations(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('lost replies freeze package size, count and metadata and retry exactly once without a doubled receipt',async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(()=>{lostReplies=2;document.getElementById('receiveBatchNumberV5').value='FROZEN';});
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText(/Ответ.*(?:получен|сервера|подтвержд)/);
 await expect(page.locator('#receivePackages')).toBeDisabled();await expect(page.locator('#receiveUnitsPerPackV35')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('receiveUnitsPerPackV35').value='99';document.getElementById('receivePackages').value='99';document.getElementById('receiveBatchNumberV5').value='CHANGED';openMedForm('m2','receive');});
 await expect(page.locator('#medId')).toHaveValue('m1');await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Партия добавлена');
 const calls=await mutations(page);expect(calls).toHaveLength(3);expect(calls[1].args).toEqual(calls[0].args);expect(calls[2].args).toEqual(calls[0].args);expect(calls[0].args.p_payload).toMatchObject({packages:2,units_per_package:5,batch_number:'FROZEN'});
 expect(await page.evaluate(()=>receipts.length)).toBe(1);expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(20);expect(errors).toEqual([]);
});

for(const kind of ['empty','quantity','batch'])test(`a malformed ${kind} receipt after commit keeps the same frozen request until a valid confirmation`,async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(value=>{malformedReplies=2;malformedReplyKind=value;},kind);
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText(/Ответ.*(?:получен|сервера|подтвержд)/);
 await expect(page.locator('#receivePackages')).toHaveValue('2');await expect(page.locator('#receivePackages')).toBeDisabled();await expect(page.locator('#receiveUnitsPerPackV35')).toBeDisabled();
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText(/Ответ.*(?:получен|подтвержд)/);await expect(page.locator('#receivePackages')).toBeDisabled();
 await receiveButton(page).click();await expect(page.locator('#stockOperationMessage')).toContainText('Партия добавлена');
 const calls=await mutations(page);expect(calls).toHaveLength(3);expect(calls[1].args).toEqual(calls[0].args);expect(calls[2].args).toEqual(calls[0].args);
 expect(await page.evaluate(()=>receipts.length)).toBe(1);expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(20);await expect(page.locator('#receivePackages')).toHaveValue('');expect(errors).toEqual([]);
});

test('a confirmed receipt clears count and saves local package metadata even when the catalogue refresh fails',async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(()=>listFailures=1);await receiveButton(page).click();
 await expect(page.locator('#stockOperationMessage')).toContainText(/(?:добавлена|сохранен)/);await expect(page.locator('#stockOperationMessage')).toContainText(/(?:не обнов|Обновите)/);
 await expect(page.locator('#receivePackages')).toHaveValue('');await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('5');
 expect(await page.evaluate(()=>inventory.find(m=>m.id==='m1').units_per_package)).toBe(5);
 await receiveButton(page).click();expect(await mutations(page)).toHaveLength(1);expect(await page.evaluate(()=>receipts.length)).toBe(1);expect(errors).toEqual([]);
});

test('a concurrent package-size change rejects the stale receipt without adding stock',async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(()=>staleSize=true);await receiveButton(page).click();
 await expect(page.locator('#stockOperationMessage')).toContainText('Размер упаковки уже изменился');expect(await page.evaluate(()=>receipts.length)).toBe(0);expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(10);await expect(page.locator('#receivePackages')).toHaveValue('2');expect(errors).toEqual([]);
});

test('a delayed receipt cannot clear or replace the next signed-in administrator card',async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(()=>{holdReceipt=true;window.pendingReceipt=receiveStock();});await page.waitForFunction(()=>typeof releaseReceipt==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other-admin',role:'admin',full_name:'Другой администратор'};await loadInventory();openMedForm('m2','receive');});
 await page.fill('#receivePackages','3');await page.fill('#receiveUnitsPerPackV35','7');await page.evaluate(async()=>{releaseReceipt();await pendingReceipt;});
 await expect(page.locator('#medId')).toHaveValue('m2');await expect(page.locator('#receivePackages')).toHaveValue('3');await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('7');await expect(page.locator('#stockOperationMessage')).not.toContainText('Партия добавлена');expect(errors).toEqual([]);
});

test('package receipt editing stays within a mobile viewport and reseeds from each selected card',async({page})=>{
 const errors=await boot(page,{mobile:true});await receipt(page);await expect(page.locator('#receivePreview')).toContainText('10');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>openMedForm('m2','receive'));await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('10');await expect(page.locator('#receivePackages')).toHaveValue('');
 await page.evaluate(()=>openMedForm('m1','receive'));await expect(page.locator('#receiveUnitsPerPackV35')).toHaveValue('1');await expect(page.locator('#receivePackages')).toHaveValue('');expect(errors).toEqual([]);
});

test('the new package entry points keep nurses outside warehouse mutations',async({page})=>{
 const errors=await boot(page);await receipt(page);await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse',full_name:'Медсестра'};await receiveStock();await saveOpeningStock();});
 expect(await mutations(page)).toHaveLength(0);expect(await page.evaluate(()=>receipts.length)).toBe(0);expect(errors).toEqual([]);
});

test('inline batch editing preserves fractional milligrams and optimistic checks while ampoules remain whole',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{
  Object.assign(medData.find(m=>m.id==='mg'),{reserve_qty:3.2,work_qty:.7,reserve_available:3.2,work_available:.7});
  batchData.mg=[{id:'mg1',batch_number:'MG-1',expiry_date:'2099-01-01',received_date:'2026-10-01',quantity_remaining:1.5,work_quantity:.3,quantity_received:1.5,purchase_price_per_unit:20},{id:'mg2',batch_number:'MG-2',expiry_date:'2099-02-01',received_date:'2026-10-01',quantity_remaining:2.4,work_quantity:.4,quantity_received:2.4,purchase_price_per_unit:20}];
  await loadInventory();show('admin');await openInlineStockV8('mg');
 });
 const panel=page.locator('[data-inline-stock-panel-v8="mg"]');await expect(panel).toContainText('MG-1');await panel.locator('[data-inline-stock-batch-v8]').selectOption('mg1');
 const row=(host,location)=>host.locator(`[data-inline-stock-editor-v8="mg1"] [data-inline-stock-location-v8="${location}"]`),input=host=>host.locator('[data-inline-stock-quantity-v8]'),save=host=>host.locator('[data-inline-stock-save-v8]');
 const work=row(panel,'work');await expect(input(work)).toHaveAttribute('inputmode','decimal');await expect(input(work)).toHaveAttribute('min','0');await expect(input(work)).toHaveValue('0.3');
 await input(work).fill('1,25');await save(work).click();await expect(work.locator('[data-inline-stock-status-v8]')).toContainText('Сохранено');await expect(input(work)).toHaveValue('1.25');
 let calls=await page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6'));expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toMatchObject({id:'mg',batch_id:'mg1',location:'work',actual_quantity:1.25,expected_quantity:.3});
 expect(await page.evaluate(()=>({reserve:inventory.find(m=>m.id==='mg').reserve_qty,work:inventory.find(m=>m.id==='mg').work_qty}))).toEqual({reserve:3.2,work:1.65});
 await page.evaluate(()=>openMedForm('mg','edit'));const card=page.locator('#batchList'),reserve=row(card,'reserve');await expect(input(reserve)).toHaveValue('1.2');await input(reserve).fill('0.1');await save(reserve).click();await expect(reserve.locator('[data-inline-stock-status-v8]')).toContainText('Сохранено');
 calls=await page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6'));expect(calls).toHaveLength(2);expect(calls[1].args.p_payload).toMatchObject({actual_quantity:.1,expected_quantity:1.2});
 expect(await page.evaluate(()=>({reserve:inventory.find(m=>m.id==='mg').reserve_qty,work:inventory.find(m=>m.id==='mg').work_qty,other:batchData.mg[1]}))).toMatchObject({reserve:2.1,work:1.65,other:{quantity_remaining:2.4,work_quantity:.4}});
 const staleWork=row(card,'work');await page.evaluate(()=>{batchData.mg[0].work_quantity=1.4;batchData.mg[0].quantity_remaining=1.5;});await input(staleWork).fill('1.5');await save(staleWork).click();await expect(staleWork.locator('[data-inline-stock-status-v8]')).toContainText('Остаток уже изменился');await expect(input(staleWork)).toBeDisabled();
 await page.evaluate(()=>openMedForm('m1','edit'));const amp=page.locator('#batchList [data-inline-stock-location-v8="reserve"]').first();await expect(input(amp)).toHaveAttribute('inputmode','numeric');await input(amp).fill('1.25');await expect(save(amp)).toBeDisabled();expect(await page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6').length)).toBe(3);expect(errors).toEqual([]);
});
