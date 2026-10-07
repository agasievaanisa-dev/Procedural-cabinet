const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.requests=[];window.savedRequests={};window.transportAfterCommit=false;window.listFailures=0;window.staleNext=false;window.batchDelays={};window.deferCorrection=false;
  window.medData=[{id:'m1',name:'Самыр <img src=x onerror=alert(1)>',consumption_unit:'амп.',units_per_package:10,reserve_qty:20,work_qty:4,reserve_available:20,work_available:4,purchase_price:100,sale_price:20,active:true},{id:'m2',name:'Препарат во флаконах',consumption_unit:'фл.',units_per_package:5,reserve_qty:9,work_qty:0,reserve_available:9,work_available:0,purchase_price:80,sale_price:25,active:true}];
  window.batchData={m1:[{id:'b1',batch_number:'A-1',expiry_date:'2099-01-01',received_date:'2026-10-01',quantity_remaining:14,work_quantity:4,quantity_received:14,purchase_price_per_unit:10},{id:'b2',batch_number:'A-2',expiry_date:'2099-02-01',received_date:'2026-10-01',quantity_remaining:10,work_quantity:0,quantity_received:10,purchase_price_per_unit:12}],m2:[{id:'b3',batch_number:'B-1',expiry_date:'2099-03-01',received_date:'2026-10-01',quantity_remaining:9,work_quantity:0,quantity_received:9,purchase_price_per_unit:16}]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),rpc:async(name,args)=>{
   requests.push({name,args:copy(args||{})});const action=args?.p_action,p=args?.p_payload||{};
   if(name==='warehouse_v5'){
    if(action==='list'){if(listFailures>0){listFailures--;return {error:{message:'Нет связи'}};}return {data:copy(medData),error:null};}
    if(action==='batches'){const result=copy(batchData[p.id]||[]);if(batchDelays[p.id])await new Promise(resolve=>setTimeout(resolve,batchDelays[p.id]));return {data:result,error:null};}
    return {data:[],error:null};
   }
   if(name==='crm_stock_correction_v6'){
    if(deferCorrection){deferCorrection=false;await new Promise(resolve=>{window.releaseCorrection=resolve;});}
    const existing=savedRequests[args.p_request_id];if(existing)return {data:copy(existing),error:null};
    const med=medData.find(m=>m.id===p.id),batch=(batchData[p.id]||[]).find(b=>b.id===p.batch_id);
    if(staleNext){staleNext=false;return {error:{code:'P0001',message:'Остаток уже изменился. Обновите карточку и повторно пересчитайте препарат'}};}
    let result;
    if(action==='package'){
     if(med.units_per_package!==p.expected_units_per_package)return {error:{code:'P0001',message:'Размер упаковки уже изменился. Обновите карточку'}};
     result={id:p.id,before:med.units_per_package,units_per_package:p.units_per_package,difference:p.units_per_package-med.units_per_package};med.units_per_package=p.units_per_package;
    }else{
     const before=p.location==='work'?batch.work_quantity:batch.quantity_remaining-batch.work_quantity;
     if(before!==p.expected_quantity)return {error:{code:'P0001',message:'Остаток уже изменился. Обновите карточку'}};
     const difference=p.actual_quantity-before;batch.quantity_remaining+=difference;if(p.location==='work')batch.work_quantity+=difference;
     med[p.location==='work'?'work_qty':'reserve_qty']+=difference;med[p.location==='work'?'work_available':'reserve_available']+=difference;
     result={id:p.id,batch_id:p.batch_id,before,quantity:p.actual_quantity,difference};
    }
    savedRequests[args.p_request_id]=copy(result);if(transportAfterCommit){transportAfterCommit=false;return {error:{message:'Failed to fetch'}};}return {data:copy(result),error:null};
   }
   return {data:[],error:null};
  }};
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/vendor/supabase-2.117.2.js')||url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(url.hostname!=='127.0.0.1')return route.abort();
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,file);
  return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
 });
 await page.goto('/');
 await page.evaluate(async()=>{currentStaff={id:'owner',role:'owner',full_name:'Владелец'};await loadInventory();openMedForm('m1','correct');});
 await expect(page.locator('#stockCorrectionBatchV6')).toContainText('A-1');
 return errors;
}
async function fillCorrection(page,actual='3',reason='Перепутала цифры'){
 await page.fill('#stockCorrectionActualV6',actual);await page.fill('#stockCorrectionReasonV6',reason);await page.check('#stockCorrectionConfirmV6');
}
async function correctionCalls(page){return page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6'));}

test('owner can correct a batch balance including zero, or package size without recalculating stock',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('#stockCorrectionPanelV6')).toBeVisible();
 expect(await page.evaluate(()=>document.getElementById('medStockSummary').nextElementSibling.id)).toBe('stockCorrectionEntryV6');
 await expect(page.locator('#inventoryCountV5')).toHaveCount(0);await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('10 амп.');
 await page.fill('#stockCorrectionActualV6','3');await page.fill('#stockCorrectionReasonV6','Перепутала цифры');await page.click('#stockCorrectionSaveV6');expect((await correctionCalls(page)).length).toBe(0);await expect(page.locator('#stockCorrectionMessageV6')).toContainText('подтверждение');
 await page.check('#stockCorrectionConfirmV6');await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('10 → 3');await page.click('#stockCorrectionSaveV6');
 await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('3 амп.');
 let calls=await correctionCalls(page);expect(calls[0].args.p_payload).toEqual({id:'m1',batch_id:'b1',location:'reserve',actual_quantity:3,expected_quantity:10,reason:'Перепутала цифры'});
 expect(await page.evaluate(()=>batchData.m1[1].quantity_remaining)).toBe(10);expect(await page.evaluate(()=>batchData.m1[0].work_quantity)).toBe(4);
 await page.selectOption('#stockCorrectionLocationV6','work');await fillCorrection(page,'0','Исправила количество в шкафу');await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');expect(await page.evaluate(()=>medData[0].work_qty)).toBe(0);
 await page.selectOption('#stockCorrectionModeV6','package');await expect(page.locator('#stockCorrectionPackageNoteV6')).toContainText('не пересчитываются');await fillCorrection(page,'5','В упаковке пять ампул');await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');
 expect(await page.evaluate(()=>medData[0].units_per_package)).toBe(5);expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(13);expect(await page.evaluate(()=>batchData.m1[0].purchase_price_per_unit)).toBe(10);await expect(page.locator('#medUnitsPerPack')).toHaveValue('5');await expect(page.locator('#medUnitsPerPack')).toBeDisabled();
 await page.evaluate(()=>openMedForm('m1','edit'));await expect(page.locator('#medDetails')).toHaveAttribute('open','');await expect(page.locator('#medName')).toBeVisible();await expect(page.locator('#stockCorrectionPanelV6')).toBeHidden();await expect(page.locator('#stockCorrectionEntryV6')).toBeVisible();await expect(page.locator('#medFormTitle img')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('a response lost after commit is retried once with the same ID and unchanged draft',async({page})=>{
 const errors=await boot(page);await fillCorrection(page);await page.evaluate(()=>transportAfterCommit=true);await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Не получен ответ сервера');await expect(page.locator('#stockCorrectionActualV6')).toHaveValue('3');await expect(page.locator('#stockCorrectionReasonV6')).toHaveValue('Перепутала цифры');
 await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');const calls=await correctionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);expect(await page.evaluate(()=>batchData.m1[0].quantity_remaining)).toBe(7);expect(await page.evaluate(()=>Object.keys(savedRequests).length)).toBe(1);expect(errors).toEqual([]);
});

test('stale balance preserves the draft, offers a refresh, and requires recounting',async({page})=>{
 const errors=await boot(page);await fillCorrection(page);await page.evaluate(()=>staleNext=true);await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionReloadV6')).toBeVisible();await expect(page.locator('#stockCorrectionActualV6')).toHaveValue('3');await expect(page.locator('#stockCorrectionReasonV6')).toHaveValue('Перепутала цифры');
 await page.click('#stockCorrectionReloadV6');await expect(page.locator('#stockCorrectionActualV6')).toHaveValue('');await expect(page.locator('#stockCorrectionReasonV6')).toHaveValue('Перепутала цифры');await expect(page.locator('#stockCorrectionConfirmV6')).not.toBeChecked();await expect(page.locator('#stockCorrectionBatchV6')).toContainText('A-1');await fillCorrection(page);await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');const calls=await correctionCalls(page);expect(calls[0].args.p_request_id).not.toBe(calls[1].args.p_request_id);expect(errors).toEqual([]);
});

test('successful write clears the draft before a failed refresh and updates package metadata locally',async({page})=>{
 const errors=await boot(page);await page.selectOption('#stockCorrectionModeV6','package');await fillCorrection(page,'5');await page.evaluate(()=>listFailures=1);await page.click('#stockCorrectionSaveV6');await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');await expect(page.locator('#stockCorrectionReloadV6')).toBeVisible();await expect(page.locator('#stockCorrectionActualV6')).toHaveValue('');await expect(page.locator('#stockCorrectionReasonV6')).toHaveValue('');await expect(page.locator('#medUnitsPerPack')).toHaveValue('5');await expect(page.locator('#medUnitsPerPack')).toBeDisabled();await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('5 амп.');
 await page.click('#stockCorrectionSaveV6');expect((await correctionCalls(page)).length).toBe(1);expect(errors).toEqual([]);
});

test('late batch responses cannot overwrite another card; nurses cannot call correction APIs',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{batchDelays.m1=150;openMedForm('m1','correct');openMedForm('m2','correct');});await expect(page.locator('#stockCorrectionBatchV6')).toContainText('B-1');await page.waitForTimeout(250);await expect(page.locator('#stockCorrectionBatchV6')).not.toContainText('A-1');await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('9 фл.');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse',full_name:'Медсестра'};openMedForm('m1','correct');await saveStockCorrectionV6();await saveInventoryV5();});expect((await correctionCalls(page)).length).toBe(0);await expect(page.locator('#stockCorrectionPanelV6')).toHaveCount(0);await expect(page.locator('#homeMessage')).toContainText('владельцу');expect(errors).toEqual([]);
});

test('signing out during a pending save keeps the next owner card untouched',async({page})=>{
 const errors=await boot(page);await fillCorrection(page);await page.evaluate(()=>{deferCorrection=true;window.pendingSave=saveStockCorrectionV6();});await page.waitForFunction(()=>typeof releaseCorrection==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other-owner',role:'owner',full_name:'Другой владелец'};await loadInventory();openMedForm('m2','correct');});await expect(page.locator('#stockCorrectionBatchV6')).toContainText('B-1');
 await page.evaluate(async()=>{releaseCorrection();await pendingSave;});await expect(page.locator('#medId')).toHaveValue('m2');await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('9 фл.');await expect(page.locator('#stockCorrectionActualV6')).toHaveValue('');await expect(page.locator('#stockCorrectionMessageV6')).not.toContainText('Исправление сохранено');expect(errors).toEqual([]);
});
