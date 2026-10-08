const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Only synthetic stock is used; the SDK is replaced before any application code runs.
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.requests=[];window.savedRequests={};window.transportAfterCommit=false;window.deferCorrection=false;window.deferredBatches={};window.releaseBatches={};window.listFailures=0;window.batchFailures=0;
  window.medData=[
   {id:'m1',name:'Самыр <img src=x onerror=alert(1)>',consumption_unit:'амп.',units_per_package:10,reserve_qty:20,work_qty:4,reserve_available:20,work_available:4,purchase_price:100,sale_price:20,manufacturer:'Производитель',release_form:'Раствор',comment:'Сохранить комментарий',dosage:'400 мг',manufacturer_country:'Италия',active:true},
   {id:'m2',name:'Препарат во флаконах',consumption_unit:'фл.',units_per_package:5,reserve_qty:9,work_qty:0,reserve_available:9,work_available:0,purchase_price:80,sale_price:25,comment:'Комментарий о флаконах',active:true}
  ];
  window.batchData={
   m1:[{id:'b1',batch_number:'A-1',expiry_date:'2099-01-01',received_date:'2026-10-01',quantity_remaining:14,work_quantity:4,quantity_received:14,purchase_price_per_unit:10},{id:'b2',batch_number:'A-2',expiry_date:'2099-02-01',received_date:'2026-10-01',quantity_remaining:10,work_quantity:0,quantity_received:10,purchase_price_per_unit:12}],
   m2:[{id:'b3',batch_number:'B-1',expiry_date:'2099-03-01',received_date:'2026-10-01',quantity_remaining:9,work_quantity:0,quantity_received:9,purchase_price_per_unit:16}]
  };
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={
   auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},
   from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),
   rpc:async(name,args)=>{
    requests.push({name,args:copy(args||{})});const action=args?.p_action,p=args?.p_payload||{};
    if(name==='warehouse_v5'){
     if(action==='list'){if(listFailures>0){listFailures--;return {error:{message:'Нет связи'}};}return {data:copy(medData),error:null};}
     if(action==='batches'){
      if(batchFailures>0){batchFailures--;return {error:{message:'Failed to fetch'}};}
      const result=copy(batchData[p.id]||[]);
      if(deferredBatches[p.id]){deferredBatches[p.id]=false;await new Promise(resolve=>{releaseBatches[p.id]=resolve;});}
      return {data:result,error:null};
     }
     if(action==='save'){const med=medData.find(m=>m.id===p.id);Object.assign(med,p,{consumption_unit:p.unit,manufacturer_country:p.country});return {data:{id:med.id},error:null};}
     return {data:[],error:null};
    }
    if(name==='crm_stock_correction_v6'){
     if(deferCorrection){deferCorrection=false;await new Promise(resolve=>{window.releaseCorrection=resolve;});}
     const existing=savedRequests[args.p_request_id];if(existing)return {data:copy(existing),error:null};
     const med=medData.find(m=>m.id===p.id),batch=(batchData[p.id]||[]).find(b=>b.id===p.batch_id);
     if(action!=='inventory'||!batch)return {error:{code:'P0001',message:'Выберите партию'}};
     const before=p.location==='work'?batch.work_quantity:batch.quantity_remaining-batch.work_quantity;
     if(before!==p.expected_quantity)return {error:{code:'P0001',message:'Остаток уже изменился. Обновите карточку и повторно пересчитайте препарат'}};
     const difference=p.actual_quantity-before;batch.quantity_remaining+=difference;if(p.location==='work')batch.work_quantity+=difference;
     med[p.location==='work'?'work_qty':'reserve_qty']+=difference;med[p.location==='work'?'work_available':'reserve_available']+=difference;
     const result={id:p.id,batch_id:p.batch_id,before,quantity:p.actual_quantity,difference};savedRequests[args.p_request_id]=copy(result);
     if(transportAfterCommit){transportAfterCommit=false;return {error:{message:'Failed to fetch'}};}
     return {data:copy(result),error:null};
    }
    return {data:[],error:null};
   }
  };
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/vendor/supabase-2.117.2.js')||url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(url.hostname!=='127.0.0.1')return route.abort();
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,file);
  return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
 });
 await page.goto('/');
 await page.evaluate(async()=>{currentStaff={id:'owner',role:'owner',full_name:'Владелец'};await loadInventory();show('admin');});
 await expect(page.locator('[data-inline-stock-toggle-v8="m2"]')).toBeVisible();
 return errors;
}
const panel=(page,id)=>page.locator(`[data-inline-stock-panel-v8="${id}"]`);
const row=(container,batch,location)=>container.locator(`[data-inline-stock-editor-v8="${batch}"] [data-inline-stock-location-v8="${location}"]`);
const input=container=>container.locator('[data-inline-stock-quantity-v8]');
const save=container=>container.locator('[data-inline-stock-save-v8]');
const status=container=>container.locator('[data-inline-stock-status-v8]');
async function correctionCalls(page){return page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6'));}
async function openList(page,id,batch){
 await page.locator(`[data-inline-stock-toggle-v8="${id}"]`).click();
 const editor=panel(page,id);await expect(editor).toContainText(batch);
 const choice=editor.locator('[data-inline-stock-batch-v8]');
 if(await choice.count()){
  const value=await choice.locator('option').filter({hasText:batch}).getAttribute('value');
  await choice.selectOption(value);
 }
 return editor;
}

test('single-batch quantity is edited in the inventory row as the final balance on a phone',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await expect(page.locator('#admin')).toHaveClass(/active/);await expect(input(reserve)).toHaveValue('9');
 await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
 await input(reserve).fill('6');await expect(save(reserve)).toBeEnabled();await save(reserve).click();
 await expect(status(reserve)).toContainText(/сохран/i);await expect(input(reserve)).toHaveValue('6');
 const calls=await correctionCalls(page);expect(calls).toHaveLength(1);
 expect(calls[0].args.p_payload).toMatchObject({id:'m2',batch_id:'b3',location:'reserve',actual_quantity:6,expected_quantity:9});
 expect(calls[0].args.p_payload.reason).toBeTruthy();expect(calls[0].args.p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
 expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('the expiry selector chooses the batch to correct and leaves the other expiry and location intact',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m1','A-1');
 const choice=editor.locator('[data-inline-stock-batch-v8]');await expect(choice).toContainText('01.01.2099');await expect(choice).toContainText('01.02.2099');
 await choice.selectOption('b2');const reserve=row(editor,'b2','reserve');await expect(input(reserve)).toHaveValue('10');
 await input(reserve).fill('7');await save(reserve).click();await expect(status(reserve)).toContainText(/сохран/i);
 expect((await correctionCalls(page))[0].args.p_payload).toMatchObject({batch_id:'b2',location:'reserve',actual_quantity:7,expected_quantity:10});
 const result=await page.evaluate(()=>({first:batchData.m1[0],second:batchData.m1[1],med:medData[0]}));
 expect(result.first.quantity_remaining).toBe(14);expect(result.first.work_quantity).toBe(4);expect(result.second.quantity_remaining).toBe(7);expect(result.med.reserve_qty).toBe(17);expect(result.med.work_qty).toBe(4);
 await choice.selectOption('b1');await expect(input(row(editor,'b1','reserve'))).toHaveValue('10');expect(errors).toEqual([]);
});

test('card batch rows accept zero for stock in work while keeping the unsaved medication details',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openMedForm('m1','edit'));
 const work=row(page.locator('#batchList'),'b1','work');await expect(input(work)).toHaveValue('4');
 await page.fill('#medCommentV5','Черновик комментария');await page.fill('#medSalePrice','45.25');
 await input(work).fill('0');await save(work).click();await expect(status(work)).toContainText(/сохран/i);
 expect((await correctionCalls(page))[0].args.p_payload).toMatchObject({id:'m1',batch_id:'b1',location:'work',actual_quantity:0,expected_quantity:4});
 await expect(page.locator('#medCommentV5')).toHaveValue('Черновик комментария');await expect(page.locator('#medSalePrice')).toHaveValue('45.25');
 const result=await page.evaluate(()=>({med:medData[0],first:batchData.m1[0],second:batchData.m1[1]}));
 expect(result.med.work_qty).toBe(0);expect(result.med.reserve_qty).toBe(20);expect(result.med.sale_price).toBe(20);expect(result.first.quantity_remaining).toBe(10);expect(result.first.purchase_price_per_unit).toBe(10);expect(result.second.quantity_remaining).toBe(10);
 await expect(page.locator('#batchList img')).toHaveCount(0);expect(errors).toEqual([]);
});

test('empty, fractional, negative and unchanged quantities cannot save, and a pending save cannot be duplicated',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await expect(save(reserve)).toBeDisabled();
 for(const value of ['', '-1','2.5','9007199254740992']){await input(reserve).fill(value);await expect(save(reserve)).toBeDisabled();}
 expect(await correctionCalls(page)).toHaveLength(0);
 await input(reserve).fill('7');await page.evaluate(()=>{deferCorrection=true;window.pendingSave=saveInlineStockV8('m2','b3','reserve','list');});
 await page.waitForFunction(()=>typeof releaseCorrection==='function');
 await expect(input(reserve)).toBeDisabled();await expect(save(reserve)).toBeDisabled();
 await page.evaluate(()=>saveInlineStockV8('m2','b3','reserve','list'));expect(await correctionCalls(page)).toHaveLength(1);
 await page.evaluate(async()=>{releaseCorrection();await pendingSave;});await expect(status(reserve)).toContainText(/сохран/i);expect(await correctionCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('a response lost after commit retries exactly the same operation without applying the quantity twice',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await input(reserve).fill('6');await page.evaluate(()=>transportAfterCommit=true);await save(reserve).click();
 await expect(status(reserve)).toContainText('Не получен ответ сервера');await expect(input(reserve)).toHaveValue('6');
 expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(6);await save(reserve).click();await expect(status(reserve)).toContainText(/сохран/i);
 const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);
 expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(6);expect(await page.evaluate(()=>Object.keys(savedRequests).length)).toBe(1);expect(errors).toEqual([]);
});

test('a concurrently changed balance requires a refreshed count and a new request ID',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await input(reserve).fill('6');await page.evaluate(()=>{batchData.m2[0].quantity_remaining=8;medData[1].reserve_qty=8;medData[1].reserve_available=8;});
 await save(reserve).click();await expect(status(reserve)).toContainText('Остаток уже изменился');await expect(input(reserve)).toHaveValue('6');await expect(save(reserve)).toBeDisabled();
 await editor.locator('[data-inline-stock-reload-v8]').filter({visible:true}).first().click();await expect(input(reserve)).toHaveValue('8');await expect(save(reserve)).toBeDisabled();
 await input(reserve).fill('7');await save(reserve).click();await expect(status(reserve)).toContainText(/сохран/i);
 const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args.p_request_id).not.toBe(calls[1].args.p_request_id);expect(calls[1].args.p_payload).toMatchObject({actual_quantity:7,expected_quantity:8});
 expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(7);expect(errors).toEqual([]);
});

test('late batch loading cannot replace another medication editor',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{deferredBatches.m1=true;window.pendingBatchLoad=openInlineStockV8('m1');});await page.waitForFunction(()=>typeof releaseBatches.m1==='function');
 const editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');await input(reserve).fill('7');
 await page.evaluate(async()=>{releaseBatches.m1();await pendingBatchLoad;});
 await expect(input(reserve)).toHaveValue('7');await expect(editor).not.toContainText('A-1');await expect(editor.locator('[data-inline-stock-editor-v8="b1"]')).toHaveCount(0);expect(errors).toEqual([]);
});

test('signing out during an inline save leaves the next owner card and draft untouched',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m1','A-1'),reserve=row(editor,'b1','reserve');await input(reserve).fill('7');
 await page.evaluate(()=>{deferCorrection=true;window.pendingSave=saveInlineStockV8('m1','b1','reserve','list');});await page.waitForFunction(()=>typeof releaseCorrection==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other-owner',role:'owner'};await loadInventory();openMedForm('m2','edit');});
 const next=row(page.locator('#batchList'),'b3','reserve');await expect(input(next)).toHaveValue('9');await page.fill('#medCommentV5','Комментарий другого владельца');await input(next).fill('8');
 await page.evaluate(async()=>{releaseCorrection();await pendingSave;});await expect(page.locator('#medId')).toHaveValue('m2');await expect(input(next)).toHaveValue('8');await expect(page.locator('#medCommentV5')).toHaveValue('Комментарий другого владельца');await expect(status(next)).not.toContainText(/сохран/i);expect(errors).toEqual([]);
});

test('nurses cannot open, reload or save stock editors through their public entry points',async({page})=>{
 const errors=await boot(page);await openList(page,'m2','B-1');await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse',full_name:'Медсестра'};});
 const count=await page.evaluate(()=>requests.length);
 await page.evaluate(async()=>{await openInlineStockV8('m2');await reloadInlineStockV8('m2','list');await saveInlineStockV8('m2','b3','reserve','list');renderInlineStockV8();});
 expect(await page.evaluate(()=>requests.length)).toBe(count);expect(await correctionCalls(page)).toHaveLength(0);await expect(page.locator('[data-inline-stock-panel-v8]')).toHaveCount(0);expect(errors).toEqual([]);
});


for(const externalRefresh of [false,true])test(`a confirmed retry reconciles totals when the catalogue refresh fails (external refresh: ${externalRefresh})`,async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await input(reserve).fill('6');await page.evaluate(()=>transportAfterCommit=true);await save(reserve).click();await expect(status(reserve)).toContainText('Не получен ответ сервера');
 if(externalRefresh)await page.evaluate(()=>loadInventory());
 await page.evaluate(()=>listFailures=1);await save(reserve).click();await expect(status(reserve)).toContainText('Не удалось обновить список');
 expect(await page.evaluate(()=>inventory.find(m=>m.id==='m2').reserve_qty)).toBe(6);expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(6);
 await expect(input(reserve)).toHaveValue('6');await expect(page.locator('[data-inline-stock-medication-v8="m2"] .stock-cell').first()).toContainText('6 фл.');
 const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);expect(errors).toEqual([]);
});

test('an explicit recount retires an uncertain request ID before an identical future correction',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await input(reserve).fill('6');await page.evaluate(()=>transportAfterCommit=true);await save(reserve).click();await expect(status(reserve)).toContainText('Не получен ответ сервера');
 await editor.locator('[data-inline-stock-reload-v8]').filter({visible:true}).first().click();await expect(input(reserve)).toHaveValue('6');
 await page.evaluate(async()=>{batchData.m2[0].quantity_remaining=9;medData[1].reserve_qty=9;medData[1].reserve_available=9;await reloadInlineStockV8('m2','list');});
 await expect(input(reserve)).toHaveValue('9');await input(reserve).fill('6');await save(reserve).click();await expect(status(reserve)).toContainText(/сохран/i);
 const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args.p_payload).toEqual(calls[1].args.p_payload);expect(calls[0].args.p_request_id).not.toBe(calls[1].args.p_request_id);
 expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(6);expect(errors).toEqual([]);
});

test('catalogue refreshes during batch loading and saving preserve the logical editor',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{deferredBatches.m2=true;window.pendingRead=openInlineStockV8('m2');});await page.waitForFunction(()=>typeof releaseBatches.m2==='function');
 await page.evaluate(()=>loadInventory());await page.evaluate(async()=>{releaseBatches.m2();await pendingRead;});
 const editor=panel(page,'m2'),reserve=row(editor,'b3','reserve');await expect(input(reserve)).toHaveValue('9');await expect(input(reserve)).toBeEnabled();
 await input(reserve).fill('8');await page.evaluate(()=>{deferCorrection=true;window.pendingSave=saveInlineStockV8('m2','b3','reserve','list');});await page.waitForFunction(()=>typeof releaseCorrection==='function');
 await page.evaluate(()=>loadInventory());await page.evaluate(async()=>{releaseCorrection();await pendingSave;});
 await expect(input(reserve)).toHaveValue('8');await expect(status(reserve)).toContainText(/сохран/i);await expect(input(reserve)).toBeEnabled();expect(await page.evaluate(()=>inventory.find(m=>m.id==='m2').reserve_qty)).toBe(8);expect(await correctionCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('replaying an older committed correction cannot overwrite a later card correction when reads fail',async({page})=>{
 const errors=await boot(page),editor=await openList(page,'m2','B-1'),reserve=row(editor,'b3','reserve');
 await input(reserve).fill('7');await page.evaluate(()=>transportAfterCommit=true);await save(reserve).click();await expect(status(reserve)).toContainText('Не получен ответ сервера');
 await page.evaluate(()=>openMedForm('m2','edit'));const cardReserve=row(page.locator('#batchList'),'b3','reserve');await expect(input(cardReserve)).toHaveValue('7');
 await input(cardReserve).fill('5');await save(cardReserve).click();await expect(status(cardReserve)).toContainText(/сохран/i);
 await page.evaluate(()=>{show('admin');batchFailures=1;listFailures=1;});await save(reserve).click();await expect(status(reserve)).toContainText('Не удалось проверить текущие партии');
 expect(await page.evaluate(()=>inventory.find(m=>m.id==='m2').reserve_qty)).toBe(5);expect(await page.evaluate(()=>medData[1].reserve_qty)).toBe(5);await expect(input(cardReserve)).toHaveValue('5');
 const calls=await correctionCalls(page);expect(calls).toHaveLength(3);expect(calls[0].args).toEqual(calls[2].args);expect(errors).toEqual([]);
});
