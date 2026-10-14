const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Full application, synthetic data, and an offline SDK installed before any app script.
// The server fixture keeps receipts independently from the client and applies each
// request once, including when its first response is lost or malformed.
async function boot(page,role='admin'){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.archiveCalls=[];window.archiveReceipts=new Map();window.archiveEffects=[];window.archiveTransfers=new Map();
  window.archiveMode='';window.archiveListFailures=0;window.archiveDefer=false;
  window.archivePrompts=[];window.archiveConfirms=[];
  window.prompt=message=>{archivePrompts.push(message);return null};
  window.confirm=message=>{archiveConfirms.push(message);return true};
  window.archiveMeds=[
   {id:'m1',name:'Синтетический витамин А',generic_name:'Ретинол',search_name:'витамин',dosage:'10 мг',manufacturer:'Тестовый производитель',manufacturer_country:'Япония',category:'Витамины',consumption_unit:'амп.',purchase_unit:'упаковка',units_per_package:50,reserve_qty:0,work_qty:0,total_qty:0,reserve_available:0,work_available:0,purchase_price:725.5,sale_price:145.25,min_total_stock:3,work_threshold:1,lead_time_days:4,comment:'Сохранить карточку и историю',active:true},
   {id:'m2',name:'Синтетический препарат с остатком',manufacturer_country:'Германия',consumption_unit:'фл.',units_per_package:5,reserve_qty:10,work_qty:4,total_qty:14,reserve_available:10,work_available:4,purchase_price:200,sale_price:1000,active:true},
   {id:'m3',name:'Ранее архивированный препарат',manufacturer_country:'Россия',consumption_unit:'таб.',units_per_package:20,reserve_qty:0,work_qty:0,total_qty:0,reserve_available:0,work_available:0,purchase_price:300,sale_price:25,active:false}
  ];
  window.archiveBatches={m1:[{id:'batch-old',medication_id:'m1',quantity_remaining:0,quantity_received:50,work_quantity:0,expiry_date:'2026-01-31',received_date:'2025-11-01',purchase_price_per_unit:14.51}],m2:[{id:'batch-stock',medication_id:'m2',quantity_remaining:14,quantity_received:14,work_quantity:4,expiry_date:'2099-02-28',received_date:'2026-10-12',purchase_price_per_unit:40}]};
  window.archiveHistory={m1:[{id:'movement-old',medication_id:'m1',created_at:'2025-11-01T10:00:00Z',movement_type:'receive',quantity:50,location:'reserve',comment:'Исторический приход',staff_name:'Синтетический сотрудник'}]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={
   auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({}),onAuthStateChange:()=>{}},
   from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),
   rpc:async(name,args)=>{
    archiveCalls.push({name,args:copy(args||{})});
    if(name!=='warehouse_v5')return {data:[],error:null};
    const action=args?.p_action,p=args?.p_payload||{};
    if(action==='list'){
     if(archiveListFailures>0){archiveListFailures--;return {data:null,error:{message:'Failed to fetch'}}}
     return {data:copy(archiveMeds),error:null};
    }
    if(action==='batches')return {data:copy(archiveBatches[p.id]||[]),error:null};
    if(action==='history')return {data:copy(archiveHistory[p.id]||[]),error:null};
    if(action==='transfer'){
     let receipt=archiveTransfers.get(args.p_request_id);
     if(!receipt){
      const row=archiveMeds.find(m=>m.id===p.id),quantity=Number(p.quantity);
      if(!row||!Number.isInteger(quantity)||quantity<=0||quantity>row.reserve_qty)return {data:null,error:{code:'P0001',message:'Недостаточно препарата в запасе'}};
      row.reserve_qty-=quantity;row.reserve_available-=quantity;row.work_qty+=quantity;row.work_available+=quantity;
      archiveBatches[p.id][0].work_quantity+=quantity;
      receipt={ok:true};archiveTransfers.set(args.p_request_id,receipt);
     }
     return {data:copy(receipt),error:null};
    }
    if(!['archive','restore'].includes(action))return {data:[],error:null};
    if(!['admin','owner'].includes(currentStaff?.role))return {data:null,error:{code:'42501',message:'Нет доступа к складу'}};
    if(!args.p_request_id)return {data:null,error:{code:'22023',message:'Нужен идентификатор запроса'}};
    let receipt=archiveReceipts.get(args.p_request_id);
    if(receipt){
     if(JSON.stringify(receipt.args)!==JSON.stringify(args))return {data:null,error:{code:'22023',message:'Запрос уже использован для другой операции'}};
    }else{
     const row=archiveMeds.find(m=>m.id===p.id);
     if(!row)return {data:null,error:{code:'P0001',message:'Препарат недоступен'}};
     if(action==='archive'&&(Number(row.reserve_qty)!==0||Number(row.work_qty)!==0))return {data:null,error:{code:'P0001',message:'Архивировать можно только препарат с нулевым остатком'}};
     row.active=action==='restore';
     receipt={args:copy(args),result:{active:action==='restore'}};
     archiveReceipts.set(args.p_request_id,receipt);
     archiveEffects.push({id:p.id,action});
    }
    if(archiveDefer){archiveDefer=false;await new Promise(resolve=>{window.releaseArchive=resolve})}
    if(archiveMode==='lost')return {data:null,error:{message:'Failed to fetch'}};
    if(archiveMode==='invalid')return {data:{ok:false},error:null};
    return {data:copy(receipt.result),error:null};
   }
  };
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/vendor/supabase-2.117.2.js')||url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(url.hostname!=='127.0.0.1')return route.abort();
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,file);
  const body=fs.existsSync(location)?fs.readFileSync(location,'utf8'):'';
  return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('/');
 await page.evaluate(async role=>{currentStaff={id:'synthetic-manager',role,full_name:'Тестовый сотрудник'};await loadInventory();show('admin')},role);
 await expect(card(page,'m1')).toBeVisible();
 return errors;
}
const card=(page,id)=>page.locator(`.inventory-card[data-medication-id="${id}"]`);
const action=(page,id)=>card(page,id).locator(`[data-archive-medication-v26="${id}"]`);
const status=page=>page.locator('#medicationArchiveStatusV26');
const retry=page=>page.locator('#medicationArchiveRetryV26');
const mutations=page=>page.evaluate(()=>archiveCalls.filter(call=>call.name==='warehouse_v5'&&['archive','restore'].includes(call.args.p_action)));
async function openArchive(page){
 await page.locator('#medicationArchiveEntryV26').click();
 await expect(page.locator('#inventoryFilter')).toHaveValue('archive');
}

test('a zero-stock card archives from the list and restores with its prices, stock, and history intact',async({page})=>{
 const errors=await boot(page);
 const before=await page.evaluate(()=>({med:structuredClone(archiveMeds[0]),batches:structuredClone(archiveBatches),history:structuredClone(archiveHistory)}));
 await expect(action(page,'m1')).toHaveText('Архивировать');await action(page,'m1').click();
 await expect(status(page)).toContainText('Карточка в архиве');await expect(card(page,'m1')).toHaveCount(0);
 await expect(card(page,'m2')).toBeVisible();await openArchive(page);
 await expect(card(page,'m1')).toBeVisible();await expect(action(page,'m1')).toHaveText('Разархивировать');
 await card(page,'m1').getByRole('button',{name:'Редактировать препарат',exact:true}).click();
 await expect(page.locator('#medName')).toHaveValue(before.med.name);
 await expect(page.locator('#medSalePrice')).toHaveValue('145.25');await expect(page.locator('#medPurchasePrice')).toHaveValue('725.5');
 await expect(page.locator('#medStockSummary')).toContainText('Всего');await expect(page.locator('#movementList')).toContainText('Исторический приход');
 await page.evaluate(()=>show('admin'));await action(page,'m1').click();
 await expect(status(page)).toContainText('Карточка разархивирована');
 await page.selectOption('#inventoryFilter','active');await expect(card(page,'m1')).toBeVisible();
 await expect(action(page,'m1')).toHaveText('Архивировать');
 expect(await page.evaluate(()=>({med:archiveMeds[0],batches:archiveBatches,history:archiveHistory}))).toEqual(before);
 const calls=await mutations(page);expect(calls.map(call=>call.args.p_action)).toEqual(['archive','restore']);
 expect(calls[0].args.p_request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
 expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);
 expect(await page.evaluate(()=>archivePrompts)).toEqual([]);expect(errors).toEqual([]);
});

test('a nonzero reserve or work balance cannot be archived through the list or a direct UI call',async({page})=>{
 const errors=await boot(page);
 const button=action(page,'m2');
 if(await button.count())await expect(button).toBeDisabled();
 await page.evaluate(()=>toggleMedicationArchiveV26('m2'));
 expect(await mutations(page)).toHaveLength(0);
 expect(await page.evaluate(()=>archiveMeds.find(row=>row.id==='m2').active)).toBe(true);
 await expect(card(page,'m2')).toBeVisible();expect(errors).toEqual([]);
});

test('the server rejects archiving if stock arrives after the list was loaded',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{archiveMeds[0].reserve_qty=1;archiveMeds[0].reserve_available=1;archiveMeds[0].total_qty=1});
 await action(page,'m1').click();await expect(status(page)).toContainText('нулевым остатком');
 expect(await mutations(page)).toHaveLength(1);
 expect(await page.evaluate(()=>({active:archiveMeds[0].active,effects:archiveEffects,receipts:archiveReceipts.size}))).toEqual({active:true,effects:[],receipts:0});
 await expect(retry(page)).not.toBeVisible();expect(errors).toEqual([]);
});

test('the owner can restore a previously archived card without entering its full name',async({page})=>{
 const errors=await boot(page,'owner');await openArchive(page);await action(page,'m3').click();
 await expect(status(page)).toContainText('Карточка разархивирована');await page.selectOption('#inventoryFilter','active');
 await expect(card(page,'m3')).toBeVisible();expect(await page.evaluate(()=>archivePrompts)).toEqual([]);
 expect((await mutations(page)).map(call=>call.args.p_action)).toEqual(['restore']);expect(errors).toEqual([]);
});

for(const role of ['nurse','mentor'])test(`${role} cannot archive or restore through direct calls`,async({page})=>{
 const errors=await boot(page);
 await page.evaluate(async role=>{await signOut();currentStaff={id:`synthetic-${role}`,role};inventory=structuredClone(archiveMeds);show('workspace')},role);
 const before=await page.evaluate(()=>structuredClone(archiveMeds));
 await page.evaluate(async()=>{await toggleMedicationArchiveV26('m1');await toggleMedicationArchiveV26('m3');openMedicationArchiveV26()});
 expect(await mutations(page)).toHaveLength(0);expect(await page.evaluate(()=>archiveMeds)).toEqual(before);
 await expect(page.locator('#admin')).not.toHaveClass(/active/);expect(errors).toEqual([]);
});

for(const mode of ['lost','invalid'])test(`${mode} acknowledgement keeps the original request identity and retries without a second effect`,async({page})=>{
 const errors=await boot(page);await page.evaluate(mode=>{archiveMode=mode},mode);
 await action(page,'m1').click();await expect(retry(page)).toBeVisible();
 await expect(status(page)).toContainText('Ответ о сохранении не получен');await expect(retry(page)).toBeEnabled();
 const first=(await mutations(page))[0];expect(first.args.p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
 expect(await page.evaluate(()=>({effects:archiveEffects,receipts:archiveReceipts.size}))).toEqual({effects:[{id:'m1',action:'archive'}],receipts:1});
 await page.evaluate(()=>{archiveMode=''});await retry(page).click();
 await expect(status(page)).toContainText('Карточка в архиве');await expect(retry(page)).not.toBeVisible();
 const calls=await mutations(page);expect(calls.length).toBeGreaterThanOrEqual(2);
 for(const call of calls)expect(call.args).toEqual(first.args);
 expect(await page.evaluate(()=>({effects:archiveEffects,receipts:archiveReceipts.size}))).toEqual({effects:[{id:'m1',action:'archive'}],receipts:1});
 await expect(card(page,'m1')).toHaveCount(0);expect(errors).toEqual([]);
});

test('a confirmed archive survives failed list refreshes and refreshing never resends the mutation',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{archiveListFailures=20});await action(page,'m1').click();
 await expect(status(page)).toContainText('Карточка в архиве');await expect(status(page)).toContainText('Не удалось обновить остатки');
 await expect(retry(page)).not.toBeVisible();expect(await mutations(page)).toHaveLength(1);
 await page.evaluate(()=>{archiveListFailures=0});await page.locator('#medicationArchiveReloadV26').click();
 await expect(card(page,'m1')).toHaveCount(0);expect(await mutations(page)).toHaveLength(1);
 expect(await page.evaluate(()=>archiveEffects)).toEqual([{id:'m1',action:'archive'}]);expect(errors).toEqual([]);
});

test('inline stock controls unlock after archive, restore, a stock transfer, and an uncertain archive retry',async({page})=>{
 const errors=await boot(page);
 const toggle=card(page,'m2').locator('[data-inline-stock-toggle-v8]');
 const reserve=card(page,'m2').locator('[data-inline-stock-panel-v8] [data-inline-stock-location-v8="reserve"]');
 const input=reserve.locator('[data-inline-stock-quantity-v8]'),save=reserve.locator('[data-inline-stock-save-v8]');
 const expectEditable=async()=>{await expect(toggle).toBeEnabled();await expect(input).toBeEnabled();await expect(save).toBeEnabled()};
 await toggle.click();await expect(input).toHaveValue('10');await input.fill('8');await expectEditable();
 await action(page,'m1').click();await expect(status(page)).toContainText('Карточка в архиве');await expectEditable();
 await openArchive(page);await action(page,'m1').click();await expect(status(page)).toContainText('Карточка разархивирована');
 await page.selectOption('#inventoryFilter','active');await expectEditable();
 await card(page,'m2').getByRole('button',{name:'Перевести в работу',exact:true}).click();
 await page.fill('#transferQty','1');await page.click('#transferButton');
 await expect(page.locator('#stockOperationMessage')).toContainText('Препарат переведён в рабочий шкаф');
 await page.evaluate(()=>show('admin'));await expectEditable();
 expect(await page.evaluate(()=>({reserve:archiveMeds[1].reserve_qty,work:archiveMeds[1].work_qty,transfers:archiveTransfers.size}))).toEqual({reserve:9,work:5,transfers:1});
 await page.evaluate(()=>{archiveMode='lost'});await action(page,'m1').click();await expect(retry(page)).toBeVisible();
 await expect(status(page)).toContainText('Ответ о сохранении не получен');await expect(retry(page)).toBeEnabled();
 await expect(toggle).toBeDisabled();await expect(input).toBeDisabled();await expect(save).toBeDisabled();
 await page.evaluate(()=>{archiveMode=''});await retry(page).click();await expect(status(page)).toContainText('Карточка в архиве');
 await expectEditable();expect(await page.evaluate(()=>archiveEffects)).toEqual([{id:'m1',action:'archive'},{id:'m1',action:'restore'},{id:'m1',action:'archive'}]);
 expect(errors).toEqual([]);
});

for(const change of ['logout','role'])test(`a late archive response after ${change} cannot change the new session or navigate`,async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>{archiveDefer=true;window.pendingArchive=toggleMedicationArchiveV26('m1')});
 await page.waitForFunction(()=>typeof releaseArchive==='function');
 await page.evaluate(async change=>{
  if(change==='logout')await signOut();
  currentStaff={id:change==='logout'?'other-person':'synthetic-manager',role:change==='logout'?'owner':'nurse'};
  show('workspace');document.getElementById('medicationArchiveStatusV26').textContent='Новая сессия';
 },change);
 await page.evaluate(async()=>{releaseArchive();await pendingArchive});
 await expect(page.locator('#workspace')).toHaveClass(/active/);await expect(status(page)).toHaveText('Новая сессия');
 expect(await mutations(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('archive and restore controls remain visible without horizontal overflow on a narrow phone',async({page})=>{
 await page.setViewportSize({width:360,height:780});const errors=await boot(page);
 await expect(page.locator('#medicationArchiveEntryV26')).toBeVisible();await expect(action(page,'m1')).toBeVisible();
 await openArchive(page);await expect(action(page,'m3')).toBeVisible();
 const bounds=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('#medicationArchiveEntryV26,[data-archive-medication-v26]')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})}));
 expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
 for(const button of bounds.buttons){expect(button.width).toBeGreaterThan(0);expect(button.left).toBeGreaterThanOrEqual(0);expect(button.right).toBeLessThanOrEqual(bounds.width+1)}
 expect(errors).toEqual([]);
});
