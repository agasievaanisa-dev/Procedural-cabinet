const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Synthetic fixtures only. The SDK is replaced before application scripts run.
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.stockCalls=[];window.stockReceipts={};window.stockMode='';window.listFailures=0;window.deferStock=false;
  window.stockMeds=[
   {id:'m1',name:'Препарат А (Япония)',manufacturer_country:'Япония',consumption_unit:'амп.',units_per_package:50,reserve_qty:0,work_qty:0,reserve_available:0,work_available:0,purchase_price:100,sale_price:1500,active:true},
   {id:'m2',name:'Препарат Б (Германия)',manufacturer_country:'Германия',consumption_unit:'фл.',units_per_package:5,reserve_qty:10,work_qty:4,reserve_available:10,work_available:4,nearest_expiry:'2099-02-28',purchase_price:200,sale_price:1000,active:true}
  ];
  window.stockBatches={m1:[],m2:[{id:'b1',quantity_remaining:14,quantity_received:14,work_quantity:4,expiry_date:'2099-02-28',received_date:'2026-10-12',purchase_price_per_unit:40}]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  window.dbStub={
   auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({}),onAuthStateChange:()=>{}},
   from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})}),
   rpc:async(name,args)=>{
    stockCalls.push({name,args:copy(args||{})});const action=args?.p_action,p=args?.p_payload||{};
    if(name==='warehouse_v5'){
     if(action==='list'){if(listFailures>0){listFailures--;return {error:{message:'Failed to fetch'}};}return {data:copy(stockMeds),error:null};}
     if(action==='batches')return {data:copy(stockBatches[p.id]||[]),error:null};
     return {data:[],error:null};
    }
    if(name==='crm_stock_totals_v18'){
     if(deferStock){deferStock=false;await new Promise(resolve=>{window.releaseStock=resolve;});}
     let saved=stockReceipts[args.p_request_id];
     if(!saved){
      const row=stockMeds.find(m=>m.id===p.id);
      if(!row)return {error:{code:'P0001',message:'Препарат недоступен'}};
      if(row.reserve_qty!==p.expected_reserve||row.work_qty!==p.expected_work)return {error:{code:'40001',message:'Остаток уже изменился. Обновите количество и пересчитайте препарат'}};
      Object.assign(row,{reserve_qty:p.reserve,work_qty:p.work,reserve_available:p.reserve,work_available:p.work,total_qty:p.reserve+p.work});
      if(p.expiry_date)row.nearest_expiry=p.expiry_date;
      saved=copy(row);stockReceipts[args.p_request_id]=saved;
     }
     if(stockMode==='offline_after_commit')return {error:{message:'Failed to fetch'}};
     return {data:copy(saved),error:null};
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
  let body=fs.existsSync(location)?fs.readFileSync(location,'utf8'):'';
  if(file==='index.html'&&!body.includes('src="crm-stock-totals-v18.js'))body=body.replace('</body>','<link rel="stylesheet" href="crm-stock-totals-v18.css"><script src="crm-stock-totals-v18.js"></script></body>');
  return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body});
 });
 await page.goto('/');
 await page.evaluate(async()=>{currentStaff={id:'manager',role:'admin',full_name:'Администратор'};await loadInventory();show('admin');});
 await expect(page.locator('[data-stock-medication-v18="m1"][data-stock-total-v18="reserve"]')).toBeVisible();
 return errors;
}
const editor=page=>page.locator('#stockTotalsPanelV18');
const stockCalls=page=>page.evaluate(()=>stockCalls.filter(call=>call.name==='crm_stock_totals_v18'));
async function open(page,id='m1',counter='reserve'){
 await page.locator(`[data-stock-medication-v18="${id}"][data-stock-total-v18="${counter}"]`).first().click();
 await expect(editor(page)).toBeVisible();
}

test('the reserve counter saves 37 ampoules without entering package, supplier or purchase fields',async({page})=>{
 const errors=await boot(page);await open(page);
 await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('0');await expect(page.locator('#stockTotalsWorkV18')).toHaveValue('0');
 await page.fill('#stockTotalsReserveV18','37');await page.fill('#stockTotalsExpiryV18','28.02.2027');
 await expect(page.locator('#stockTotalsTotalV18')).toHaveText('Всего: 37 амп.');await expect(page.locator('#stockTotalsPackV18')).toContainText('37 амп.');
 await expect(page.locator('#stockTotalsReasonV18')).not.toBeVisible();await expect(page.locator('#openingPanel')).not.toHaveAttribute('open');
 await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 const calls=await stockCalls(page);expect(calls).toHaveLength(1);expect(calls[0].args.p_payload).toEqual({id:'m1',expected_reserve:0,expected_work:0,reserve:37,work:0,expiry_date:'2027-02-28',reason:'Исправление общего остатка'});expect(calls[0].args.p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
 await expect(page.locator('#medStockSummary [data-stock-total-v18="reserve"]')).toContainText('0 уп. + 37 амп.');await expect(page.locator('#medStockSummary [data-stock-total-v18="total"]')).toContainText('37 амп.');
 expect(await page.evaluate(()=>stockMeds[0].reserve_qty)).toBe(37);expect(errors).toEqual([]);
});

test('30 February and other impossible dates show a calendar error without sending any mutation',async({page})=>{
 const errors=await boot(page);await open(page);await page.fill('#stockTotalsReserveV18','37');
 for(const value of ['30.02.2027','31.04.2027','2027-02-29']){
  await page.fill('#stockTotalsExpiryV18',value);await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toContainText('Такой даты нет');
 }
 await page.fill('#stockTotalsExpiryV18','01.01.2020');await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toContainText('Срок годности уже истёк');
 expect(await stockCalls(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('the total opens two factual counts and is always reserve plus work; adding work uses the known expiry',async({page})=>{
 const errors=await boot(page);await open(page,'m2','total');
 await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('10');await expect(page.locator('#stockTotalsWorkV18')).toHaveValue('4');await expect(page.locator('#stockTotalsExpiryV18')).toHaveValue('28.02.2099');
 await page.fill('#stockTotalsReserveV18','11');await page.fill('#stockTotalsWorkV18','7');await expect(page.locator('#stockTotalsTotalV18')).toHaveText('Всего: 18 фл.');
 await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 expect((await stockCalls(page))[0].args.p_payload).toMatchObject({reserve:11,work:7,expected_reserve:10,expected_work:4,expiry_date:'2099-02-28'});expect(await page.evaluate(()=>stockMeds[1].total_qty)).toBe(18);expect(errors).toEqual([]);
});

test('moving counted units from reserve to work keeps the total and needs no expiry',async({page})=>{
 const errors=await boot(page);await open(page,'m2','total');await page.fill('#stockTotalsReserveV18','7');await page.fill('#stockTotalsWorkV18','7');
 await expect(page.locator('#stockTotalsTotalV18')).toHaveText('Всего: 14 фл.');await expect(page.locator('#stockTotalsExpiryBoxV18')).not.toBeVisible();await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 expect((await stockCalls(page))[0].args.p_payload).toMatchObject({expected_reserve:10,expected_work:4,reserve:7,work:7,expiry_date:null});expect(await page.evaluate(()=>stockMeds[1].nearest_expiry)).toBe('2099-02-28');expect(errors).toEqual([]);
});

test('a transfer plus a net increase requests an expiry only for the additional units',async({page})=>{
 const errors=await boot(page);await open(page,'m2','total');await page.fill('#stockTotalsReserveV18','7');await page.fill('#stockTotalsWorkV18','10');
 await expect(page.locator('#stockTotalsTotalV18')).toHaveText('Всего: 17 фл.');await expect(page.locator('#stockTotalsExpiryBoxV18')).toBeVisible();await page.fill('#stockTotalsExpiryV18','31.03.2099');await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 expect((await stockCalls(page))[0].args.p_payload).toMatchObject({expected_reserve:10,expected_work:4,reserve:7,work:10,expiry_date:'2099-03-31'});expect(errors).toEqual([]);
});

test('reductions need no expiry and reject empty, negative, fractional and unchanged quantities',async({page})=>{
 const errors=await boot(page);await open(page,'m2','work');await expect(page.locator('#stockTotalsWorkV18')).toBeFocused();await expect(page.locator('#stockTotalsSaveV18')).toBeDisabled();
 for(const value of ['', '-1','2.5','9007199254740992']){await page.fill('#stockTotalsWorkV18',value);await expect(page.locator('#stockTotalsSaveV18')).toBeDisabled();}
 await page.fill('#stockTotalsWorkV18','0');await expect(page.locator('#stockTotalsExpiryBoxV18')).not.toBeVisible();await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 expect((await stockCalls(page))[0].args.p_payload).toMatchObject({reserve:10,work:0,expiry_date:null});expect(errors).toEqual([]);
});

test('a lost response freezes all quantities and retries the same UUID and payload without adding twice',async({page})=>{
 const errors=await boot(page);await open(page);await page.fill('#stockTotalsReserveV18','37');await page.fill('#stockTotalsExpiryV18','28.02.2027');await page.evaluate(()=>{stockMode='offline_after_commit'});
 await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toContainText('Ответ о сохранении не получен');await expect(page.locator('#stockTotalsReserveV18')).toBeDisabled();await expect(page.locator('#stockTotalsExpiryV18')).toBeDisabled();await expect(page.locator('#stockTotalsSaveV18')).toHaveText('Повторить сохранение');
 await page.evaluate(()=>openMedForm('m2'));await expect(page.locator('#medId')).toHaveValue('m1');await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('37');
 await page.evaluate(()=>{stockMode=''});await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 const calls=await stockCalls(page);expect(calls).toHaveLength(3);expect(calls[0].args).toEqual(calls[1].args);expect(calls[0].args).toEqual(calls[2].args);expect(await page.evaluate(()=>Object.keys(stockReceipts).length)).toBe(1);expect(await page.evaluate(()=>stockMeds[0].reserve_qty)).toBe(37);expect(errors).toEqual([]);
});

test('a concurrent correction requires a refreshed balance and a fresh request ID',async({page})=>{
 const errors=await boot(page);await open(page,'m2');await page.fill('#stockTotalsReserveV18','8');await page.evaluate(()=>{stockMeds[1].reserve_qty=9});
 await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toContainText('Остаток уже изменился');await expect(page.locator('#stockTotalsSaveV18')).toBeDisabled();await expect(page.locator('#stockTotalsReloadV18')).toBeVisible();
 await page.click('#stockTotalsReloadV18');await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('9');await page.fill('#stockTotalsReserveV18','8');await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toHaveText('Количество сохранено.');
 const calls=await stockCalls(page);expect(calls).toHaveLength(2);expect(calls[0].args.p_request_id).not.toBe(calls[1].args.p_request_id);expect(calls[1].args.p_payload.expected_reserve).toBe(9);expect(errors).toEqual([]);
});

test('confirmed saves with a failed read show a refresh warning and do not offer another write',async({page})=>{
 const errors=await boot(page);await open(page,'m2');await page.fill('#stockTotalsReserveV18','8');await page.evaluate(()=>{listFailures=2});await page.click('#stockTotalsSaveV18');
 await expect(page.locator('#stockTotalsMessageV18')).toContainText('Количество сохранено. Не удалось обновить текущие остатки');await expect(page.locator('#stockTotalsSaveV18')).toBeDisabled();await expect(page.locator('#stockTotalsReloadV18')).toBeVisible();
 await page.click('#stockTotalsReloadV18');await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('8');expect(await stockCalls(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('a replayed old receipt cannot replace a later stock count when the fresh read fails',async({page})=>{
 const errors=await boot(page);await open(page,'m2');await page.fill('#stockTotalsReserveV18','8');await page.evaluate(()=>{stockMode='offline_after_commit'});await page.click('#stockTotalsSaveV18');await expect(page.locator('#stockTotalsMessageV18')).toContainText('Ответ о сохранении не получен');
 await page.evaluate(async()=>{stockMeds[1].reserve_qty=7;stockMeds[1].reserve_available=7;await loadInventory();stockMode='';listFailures=2});await page.click('#stockTotalsSaveV18');
 await expect(page.locator('#stockTotalsMessageV18')).toContainText('Количество сохранено. Не удалось обновить текущие остатки');expect(await page.evaluate(()=>inventory.find(m=>m.id==='m2').reserve_qty)).toBe(7);await expect(page.locator('#medStockSummary [data-stock-total-v18="reserve"]')).toContainText('7 фл.');await expect(page.locator('#stockTotalsSaveV18')).toBeDisabled();
 await page.click('#stockTotalsReloadV18');await expect(page.locator('#stockTotalsReserveV18')).toHaveValue('7');expect(await page.evaluate(()=>Object.keys(stockReceipts).length)).toBe(1);expect(errors).toEqual([]);
});

test('nurses have readonly counters and cannot open, save or reload quantities',async({page})=>{
 const errors=await boot(page);await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse',role:'nurse'};inventory=stockMeds;document.getElementById('workStockList').innerHTML=stockCells(stockMeds[0]);show('workStock');});
 await expect(page.locator('#workStockList [data-stock-total-v18]')).toHaveCount(0);
 const before=await page.evaluate(()=>stockCalls.length);await page.evaluate(async()=>{openStockTotalsV18('m1');await saveStockTotalsV18();await reloadStockTotalsV18()});expect(await page.evaluate(()=>stockCalls.length)).toBe(before);expect(errors).toEqual([]);
});

test('a new medication has six primary fields and preserves optional fields behind one disclosure',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openMedForm());
 await expect(page.locator('#medName')).toBeVisible();await expect(page.locator('#medCountry')).toBeVisible();await expect(page.locator('#medDosage')).toBeVisible();await expect(page.locator('#medUnit')).toBeVisible();await expect(page.locator('#medUnitsPerPack')).toBeVisible();await expect(page.locator('#medSalePrice')).toBeVisible();
 await expect(page.locator('#medManufacturerV5')).not.toBeVisible();await expect(page.locator('#medPurchasePrice')).not.toBeVisible();await expect(page.locator('#medPhoto')).not.toBeVisible();
 await page.locator('#medOptionalV18>summary').click();await page.fill('#medManufacturerV5','Synthetic manufacturer');await page.fill('#medCommentV5','Сохранить примечание');await page.fill('#medPurchasePrice','500');
 await page.locator('#medOptionalV18>summary').click();await expect(page.locator('#medManufacturerV5')).toHaveValue('Synthetic manufacturer');await expect(page.locator('#medCommentV5')).toHaveValue('Сохранить примечание');await expect(page.locator('#medPurchasePrice')).toHaveValue('500');expect(errors).toEqual([]);
});

test('optional batch fields stay available with the original values and handlers',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>openMedForm('m1'));
 await page.locator('#openingPanel>summary').click();await expect(page.locator('#openingQty')).toBeVisible();await expect(page.locator('#openingExpiry')).toBeVisible();await expect(page.locator('#openingLocation')).toBeVisible();await expect(page.locator('#openingSupplierV5')).not.toBeVisible();
 await page.locator('#openingOptionalV18>summary').click();await page.fill('#openingSupplierV5','Synthetic supplier');await page.fill('#openingPrice','500');await page.fill('#openingComment','Открытая упаковка');await page.locator('#openingOptionalV18>summary').click();
 const payload=await page.evaluate(()=>warehouseExtraPayloadV5('opening',{id:'m1'},true));expect(payload.supplier).toBe('Synthetic supplier');await expect(page.locator('#openingPrice')).toHaveValue('500');await expect(page.locator('#openingComment')).toHaveValue('Открытая упаковка');expect(errors).toEqual([]);
});

test('signout during a pending save cannot overwrite another administrator or their draft',async({page})=>{
 const errors=await boot(page);await open(page,'m2');await page.fill('#stockTotalsReserveV18','8');await page.evaluate(()=>{deferStock=true;window.pendingStock=saveStockTotalsV18()});await page.waitForFunction(()=>typeof releaseStock==='function');
 await page.evaluate(async()=>{await signOut();currentStaff={id:'other',role:'owner'};await loadInventory();openMedForm('m1','edit')});await page.fill('#medCommentV5','Черновик другого сотрудника');
 await page.evaluate(async()=>{releaseStock();await pendingStock});await expect(page.locator('#medId')).toHaveValue('m1');await expect(page.locator('#medCommentV5')).toHaveValue('Черновик другого сотрудника');await expect(editor(page)).not.toBeVisible();expect(errors).toEqual([]);
});

test('a late confirmed save does not navigate back to the medication card',async({page})=>{
 const errors=await boot(page);await open(page,'m2');await page.fill('#stockTotalsReserveV18','8');await page.evaluate(()=>{deferStock=true;window.pendingStock=saveStockTotalsV18()});await page.waitForFunction(()=>typeof releaseStock==='function');
 await page.evaluate(()=>show('workspace'));await page.evaluate(async()=>{releaseStock();await pendingStock});await expect(page.locator('#workspace')).toHaveClass(/active/);await expect(page.locator('#medForm')).not.toHaveClass(/active/);expect(errors).toEqual([]);
});

test('unresolved medication saves block counter edits instead of losing the original draft',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{openMedForm('m1','edit');medicationDraftV16={actor:warehouseActorV16(),payload:{id:'m1'},result:null}});
 await page.evaluate(()=>openStockTotalsV18('m1'));await expect(page.locator('#medPhotoMessage')).toContainText('Ответ о сохранении не получен');await expect(editor(page)).not.toBeVisible();expect(await stockCalls(page)).toHaveLength(0);expect(errors).toEqual([]);
});
