const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.requests=[];window.savedRequests={};window.transportAfterCommit=false;window.listFailures=0;window.staleNext=false;window.batchDelays={};window.deferCorrection=false;window.deletedData=[];window.deleteAfterCommit=false;window.staleDelete=false;window.deferDelete=false;
  window.medData=[{id:'m1',name:'Самыр <img src=x onerror=alert(1)>',consumption_unit:'амп.',units_per_package:10,reserve_qty:20,work_qty:4,reserve_available:20,work_available:4,purchase_price:100,sale_price:20,manufacturer:'Производитель',release_form:'Раствор',comment:'Сохранить комментарий',dosage:'400 мг',manufacturer_country:'Италия',active:true},{id:'m2',name:'Препарат во флаконах',consumption_unit:'фл.',units_per_package:5,reserve_qty:9,work_qty:0,reserve_available:9,work_available:0,purchase_price:80,sale_price:25,active:true}];
  window.batchData={m1:[{id:'b1',batch_number:'A-1',expiry_date:'2099-01-01',received_date:'2026-10-01',quantity_remaining:14,work_quantity:4,quantity_received:14,purchase_price_per_unit:10},{id:'b2',batch_number:'A-2',expiry_date:'2099-02-01',received_date:'2026-10-01',quantity_remaining:10,work_quantity:0,quantity_received:10,purchase_price_per_unit:12}],m2:[{id:'b3',batch_number:'B-1',expiry_date:'2099-03-01',received_date:'2026-10-01',quantity_remaining:9,work_quantity:0,quantity_received:9,purchase_price_per_unit:16}]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),rpc:async(name,args)=>{
   requests.push({name,args:copy(args||{})});const action=args?.p_action,p=args?.p_payload||{};
   if(name==='warehouse_v5'){
    if(action==='list'){if(listFailures>0){listFailures--;return {error:{message:'Нет связи'}};}return {data:copy(medData.filter(m=>!deletedData.some(d=>d.id===m.id))),error:null};}
    if(action==='batches'){const result=copy(batchData[p.id]||[]);if(batchDelays[p.id])await new Promise(resolve=>setTimeout(resolve,batchDelays[p.id]));return {data:result,error:null};}
    if(action==='save'){const med=medData.find(m=>m.id===p.id);Object.assign(med,p,{consumption_unit:p.unit,manufacturer_country:p.country});return {data:{id:med.id},error:null};}
    return {data:[],error:null};
   }
   if(name==='crm_medication_delete_v7'){
    if(action==='list_deleted')return {data:copy(deletedData),error:null};
    const med=medData.find(m=>m.id===p.id);
    if(action==='preview')return {data:copy({id:med.id,name:med.name,unit:med.consumption_unit,active:med.active,reserve:med.reserve_qty,work:med.work_qty,total:med.reserve_qty+med.work_qty,expected_reserve:med.reserve_qty,expected_work:med.work_qty,history_preserved:true,restore_stock:0}),error:null};
    if(deferDelete){deferDelete=false;await new Promise(resolve=>{window.releaseDelete=resolve;});}
    const existing=savedRequests[args.p_request_id];if(existing)return {data:copy(existing),error:null};
    let result;
    if(action==='delete'){
     if(staleDelete){staleDelete=false;return {error:{code:'P0001',message:'Остаток уже изменился. Обновите данные и проверьте количество перед удалением'}};}
     if(med.reserve_qty!==p.expected_reserve||med.work_qty!==p.expected_work)return {error:{code:'P0001',message:'Остаток уже изменился. Обновите данные'}};
     const entry={id:med.id,name:med.name,unit:med.consumption_unit,previous_active:med.active,deleted_at:'2026-10-07T12:00:00Z',reason:p.reason,reserve_removed:med.reserve_qty,work_removed:med.work_qty,total_removed:med.reserve_qty+med.work_qty,restore_stock:0};deletedData.push(entry);
     med.active=false;med.reserve_qty=0;med.work_qty=0;med.reserve_available=0;med.work_available=0;
     for(const batch of batchData[med.id]||[]){batch.quantity_remaining=0;batch.work_quantity=0;}
     result={...entry,deleted:true,active:false,reserve:0,work:0,total:0};
    }else if(action==='restore'){
     const entry=deletedData.find(d=>d.id===med.id);med.active=entry.previous_active;deletedData=deletedData.filter(d=>d.id!==med.id);result={id:med.id,name:med.name,restored:true,active:med.active,reserve:0,work:0,total:0};
    }
    savedRequests[args.p_request_id]=copy(result);if(deleteAfterCommit){deleteAfterCommit=false;return {error:{message:'Failed to fetch'}};}return {data:copy(result),error:null};
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
 if(await page.locator('#stockCorrectionModeV6').inputValue()==='inventory')await page.click('#stockCorrectionSetV6');
 await page.fill('#stockCorrectionActualV6',actual);await page.fill('#stockCorrectionReasonV6',reason);await page.check('#stockCorrectionConfirmV6');
}
async function correctionCalls(page){return page.evaluate(()=>requests.filter(call=>call.name==='crm_stock_correction_v6'));}

test('owner can correct a batch balance including zero, or package size without recalculating stock',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('#stockCorrectionPanelV6')).toBeVisible();
 expect(await page.evaluate(()=>document.getElementById('medStockSummary').nextElementSibling.id)).toBe('stockCorrectionEntryV6');
 await expect(page.locator('#inventoryCountV5')).toHaveCount(0);await expect(page.locator('#stockCorrectionCurrentV6')).toContainText('10 амп.');
 await page.click('#stockCorrectionSetV6');await page.fill('#stockCorrectionActualV6','3');await page.fill('#stockCorrectionReasonV6','Перепутала цифры');await page.click('#stockCorrectionSaveV6');expect((await correctionCalls(page)).length).toBe(0);await expect(page.locator('#stockCorrectionMessageV6')).toContainText('подтверждение');
 await page.check('#stockCorrectionConfirmV6');await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Останется: 3');await page.click('#stockCorrectionSaveV6');
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
 await expect(page.locator('#stockCorrectionSaveV6')).toBeDisabled();expect((await correctionCalls(page)).length).toBe(1);expect(errors).toEqual([]);
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

test('owner changes package purchase and unit sale prices without altering stock or batch costs',async({page})=>{
 const errors=await boot(page);
 await page.evaluate(()=>openMedForm('m1','edit'));
 await page.fill('#medCommentV5','Исправленный комментарий');
 await page.click('#medPricesEntry');
 await expect(page.locator('#medCommentV5')).toHaveValue('Исправленный комментарий');
 await expect(page.locator('#medDetails')).toHaveAttribute('open','');
 await expect(page.locator('#medPurchasePrice')).toBeFocused();
 await expect(page.locator('#medPriceFields')).toContainText('амп.');
 await expect(page.locator('#medPriceFields')).toContainText('упаковку');
 await expect(page.locator('#stockCorrectionPanelV6')).toBeHidden();
 await page.fill('#medPurchasePrice','155.50');await page.fill('#medSalePrice','32.25');
 await page.click('#medSaveButton');
 await expect(page.locator('#medPhotoMessage')).toContainText('сохранены');
 const saved=await page.evaluate(()=>requests.findLast(call=>call.name==='warehouse_v5'&&call.args.p_action==='save'));
 expect(saved.args.p_payload).toMatchObject({id:'m1',purchase_price:155.5,sale_price:32.25,units_per_package:10,unit:'амп.',manufacturer:'Производитель',release_form:'Раствор',comment:'Исправленный комментарий',dosage:'400 мг',country:'Италия'});
 const after=await page.evaluate(()=>({med:medData[0],batch:batchData.m1[0]}));
 expect(after.med.reserve_qty).toBe(20);expect(after.med.work_qty).toBe(4);
 expect(after.batch.purchase_price_per_unit).toBe(10);expect(after.batch.quantity_remaining).toBe(14);
 await expect(page.locator('#receivePrice')).toHaveValue('155.5');await expect(page.locator('#openingPrice')).toHaveValue('155.5');
 await page.click('button[onclick="show(\'admin\')"]');
 const card=page.locator('.inventory-card').first();await expect(card).toContainText('155,5');await expect(card).toContainText('32,25');
 await card.getByRole('button',{name:'Изменить цены',exact:true}).click();
 await expect(page.locator('#medPurchasePrice')).toHaveValue('155.5');await expect(page.locator('#medSalePrice')).toHaveValue('32.25');
 const saveCount=await page.evaluate(()=>requests.filter(call=>call.args?.p_action==='save').length);
 await page.fill('#medSalePrice','-1');await page.click('#medSaveButton');
 await expect(page.locator('#medPhotoMessage')).toContainText('число от нуля');await expect(page.locator('#medPurchasePrice')).toHaveValue('155.5');
 expect(await page.evaluate(()=>requests.filter(call=>call.args?.p_action==='save').length)).toBe(saveCount);
 await page.fill('#medSalePrice','0');await page.click('#medSaveButton');await expect(page.locator('#medPhotoMessage')).toContainText('сохранены');expect(await page.evaluate(()=>medData[0].sale_price)).toBe(0);
 await page.evaluate(()=>openMedForm('m2','prices'));await expect(page.locator('#medPriceFields')).toContainText('фл.');
 const beforeNurse=await page.evaluate(()=>requests.filter(call=>call.args?.p_action==='save').length);
 await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse'};openMedForm('m1','prices');await saveMedication();});
 expect(await page.evaluate(()=>requests.filter(call=>call.args?.p_action==='save').length)).toBe(beforeNurse);
 expect(errors).toEqual([]);
});

test('remove means subtract, add means increase, and set means the final counted balance',async({page})=>{
 const errors=await boot(page);
 await expect(page.locator('#stockCorrectionRemoveV6')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#stockCorrectionReasonV6')).toHaveValue('Исправление ошибки ввода');
 await page.fill('#stockCorrectionActualV6','3');
 await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Было: 10');
 await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Убираем: 3');
 await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Останется: 7');
 await expect(page.locator('#stockCorrectionSaveV6')).toHaveText('Убрать 3 амп.');
 await page.check('#stockCorrectionConfirmV6');await page.click('#stockCorrectionSaveV6');
 await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');
 expect((await correctionCalls(page))[0].args.p_payload).toMatchObject({actual_quantity:7,expected_quantity:10,reason:'Исправление ошибки ввода'});
 expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(17);
 await page.fill('#stockCorrectionActualV6','8');await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Нельзя убрать больше');await expect(page.locator('#stockCorrectionSaveV6')).toBeDisabled();
 await page.click('#stockCorrectionAddV6');await page.fill('#stockCorrectionActualV6','2');await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Останется: 9');await page.check('#stockCorrectionConfirmV6');await page.click('#stockCorrectionSaveV6');
 await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(19);
 await page.click('#stockCorrectionSetV6');await page.fill('#stockCorrectionActualV6','0');await expect(page.locator('#stockCorrectionPreviewV6')).toContainText('Останется: 0');await page.check('#stockCorrectionConfirmV6');await page.click('#stockCorrectionSaveV6');
 await expect(page.locator('#stockCorrectionMessageV6')).toContainText('Исправление сохранено');expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(10);expect(await page.evaluate(()=>medData[0].work_qty)).toBe(4);expect(await page.evaluate(()=>batchData.m1[1].quantity_remaining)).toBe(10);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

async function openDeletion(page){
 await page.click('#medicationDeleteEntryV7');await expect(page.locator('#medicationDeleteBalancesV7')).toContainText('24 амп.');
}
async function deletionCalls(page,action='delete'){return page.evaluate(action=>requests.filter(call=>call.name==='crm_medication_delete_v7'&&call.args.p_action===action),action);}

test('deletion shows all counted stock and preserves history data; restoration returns a zero-stock card',async({page})=>{
 const errors=await boot(page);await page.click('button[onclick="show(\'admin\')"]');
 await page.locator('.inventory-card').first().getByRole('button',{name:'Удалить препарат',exact:true}).click();
 await expect(page.locator('#medicationDeleteBalancesV7')).toContainText('24 амп.');
 expect((await deletionCalls(page)).length).toBe(0);await expect(page.locator('#medicationDeleteEffectV7')).toContainText('История сохранится');
 await page.click('#medicationDeleteConfirmButtonV7');await expect(page.locator('#medicationDeleteMessageV7')).toContainText('подтверждение');expect((await deletionCalls(page)).length).toBe(0);
 await page.check('#medicationDeleteConfirmV7');await page.click('#medicationDeleteConfirmButtonV7');
 await expect(page.locator('#admin')).toHaveClass(/active/);await expect(page.locator('#warehouseMessage')).toContainText('удалён');
 await expect(page.locator('.inventory-card')).toHaveCount(1);expect(await page.evaluate(()=>medData[0].reserve_qty+medData[0].work_qty)).toBe(0);
 expect((await deletionCalls(page))[0].args.p_payload).toEqual({id:'m1',expected_reserve:20,expected_work:4,reason:'Лишняя карточка / ошибка ввода'});
 expect(await page.evaluate(()=>batchData.m1[0].purchase_price_per_unit)).toBe(10);expect(await page.evaluate(()=>batchData.m1[0].quantity_received)).toBe(14);
 await page.click('#medicationDeletedEntryV7');await expect(page.locator('#medicationDeletedListV7')).toContainText('Самыр');await expect(page.locator('#medicationDeletedListV7 img')).toHaveCount(0);
 await page.click('[data-restore-id="m1"]');await expect(page.locator('#medPhotoMessage')).toContainText('Карточка восстановлена');await expect(page.locator('#medId')).toHaveValue('m1');expect(await page.evaluate(()=>medData[0].active)).toBe(true);expect(await page.evaluate(()=>medData[0].reserve_qty+medData[0].work_qty)).toBe(0);expect(await page.evaluate(()=>deletedData.length)).toBe(0);
 expect(errors).toEqual([]);
});

test('a lost delete response retries the original operation without removing stock twice',async({page})=>{
 const errors=await boot(page);await openDeletion(page);await page.check('#medicationDeleteConfirmV7');await page.evaluate(()=>deleteAfterCommit=true);await page.click('#medicationDeleteConfirmButtonV7');await expect(page.locator('#medicationDeleteMessageV7')).toContainText('Не получен ответ сервера');
 await expect(page.locator('#medicationDeleteReasonV7')).toHaveValue('Лишняя карточка / ошибка ввода');await page.click('#medicationDeleteConfirmButtonV7');await expect(page.locator('#warehouseMessage')).toContainText('удалён');
 const calls=await deletionCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args).toEqual(calls[1].args);expect(await page.evaluate(()=>deletedData.length)).toBe(1);expect(await page.evaluate(()=>Object.keys(savedRequests).length)).toBe(1);expect(errors).toEqual([]);
});

test('a committed deletion leaves the card hidden even if inventory refresh fails',async({page})=>{
 const errors=await boot(page);await openDeletion(page);await page.check('#medicationDeleteConfirmV7');await page.evaluate(()=>listFailures=1);await page.click('#medicationDeleteConfirmButtonV7');
 await expect(page.locator('#warehouseMessage')).toContainText('Препарат');await expect(page.locator('#warehouseMessage')).toContainText('не удалось обновить');await expect(page.locator('.inventory-card')).toHaveCount(1);await expect(page.locator('#medId')).toHaveValue('');await expect(page.locator('#medicationDeleteConfirmButtonV7')).toBeDisabled();
 await page.evaluate(()=>confirmMedicationDeleteV7());expect((await deletionCalls(page)).length).toBe(1);expect(errors).toEqual([]);
});

test('stale deletion requires a new preview and nurses cannot delete or restore cards',async({page})=>{
 const errors=await boot(page);await openDeletion(page);await page.check('#medicationDeleteConfirmV7');await page.evaluate(()=>staleDelete=true);await page.click('#medicationDeleteConfirmButtonV7');await expect(page.locator('#medicationDeleteReloadV7')).toBeVisible();expect(await page.evaluate(()=>medData[0].reserve_qty)).toBe(20);
 await page.click('#medicationDeleteReloadV7');await expect(page.locator('#medicationDeleteBalancesV7')).toContainText('24 амп.');await expect(page.locator('#medicationDeleteConfirmV7')).not.toBeChecked();await page.check('#medicationDeleteConfirmV7');await page.click('#medicationDeleteConfirmButtonV7');await expect(page.locator('#warehouseMessage')).toContainText('удалён');
 const calls=await deletionCalls(page);expect(calls[0].args.p_request_id).not.toBe(calls[1].args.p_request_id);
 const beforeNurse=await page.evaluate(()=>requests.length);await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse'};await beginMedicationDeleteV7();await confirmMedicationDeleteV7();await openDeletedMedicationsV7();await restoreMedicationV7('m1');});expect(await page.evaluate(()=>requests.length)).toBe(beforeNurse);await expect(page.locator('#medicationDeletedV7')).toHaveCount(0);await expect(page.locator('#homeMessage')).toContainText('владельцу');expect(errors).toEqual([]);
});

test('a pending deletion cannot replace the next owner card after signing out',async({page})=>{
 const errors=await boot(page);await openDeletion(page);await page.check('#medicationDeleteConfirmV7');await page.evaluate(()=>{deferDelete=true;window.pendingDelete=confirmMedicationDeleteV7();});await page.waitForFunction(()=>typeof releaseDelete==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other-owner',role:'owner'};await loadInventory();openMedForm('m2','correct');});await expect(page.locator('#medId')).toHaveValue('m2');await page.evaluate(async()=>{releaseDelete();await pendingDelete;});await expect(page.locator('#medId')).toHaveValue('m2');await expect(page.locator('#medForm')).toHaveClass(/active/);await expect(page.locator('#medicationDeleteMessageV7')).not.toContainText('удалён');expect(errors).toEqual([]);
});
