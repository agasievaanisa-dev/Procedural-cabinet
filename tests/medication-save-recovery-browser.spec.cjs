const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
async function setup(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.requests=[];window.receipts=new Map();window.failWrites=false;window.failList=false;window.failPhoto=false;window.failSigning=false;window.partiesAdded=0;
  window.medData=[{id:'11111111-1111-4111-8111-111111111111',name:'Medicine A',manufacturer:'Maker',release_form:'Раствор',comment:'Old comment',consumption_unit:'амп.',units_per_package:5,purchase_price:100,sale_price:200,work_qty:5,reserve_qty:10,work_available:5,reserve_available:10,active:true},{id:'22222222-2222-4222-8222-222222222222',name:'Medicine B',consumption_unit:'амп.',units_per_package:5,purchase_price:100,sale_price:100,work_qty:0,reserve_qty:10,reserve_available:10,active:true}];
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},storage:{from:()=>({upload:async()=>failPhoto?{error:{statusCode:'403',message:'Photo upload denied'}}:{data:{path:'uploaded'}},createSignedUrls:async()=>{if(failSigning)throw Error('Load failed');return {data:[]}}})},rpc:async(name,args)=>{
   requests.push({name,args:structuredClone(args)});const action=args?.p_action,p=args?.p_payload;
   if(name==='warehouse_v5'){
    if(action==='list')return failList?{error:{message:'Load failed'},status:0}:{data:medData};
    if(action==='batches')return {data:[{id:'33333333-3333-4333-8333-333333333333',medication_id:p.id,quantity_received:15,quantity_remaining:15,work_quantity:5,received_date:'2026-10-01',expiry_date:'2027-12-01',purchase_price_per_unit:20}]};
    if(action==='history')return {data:[]};
    if(['save','receive','transfer'].includes(action)){
     if(!receipts.has(args.p_request_id)){
      const med=medData.find(m=>m.id===p.id);if(action==='save')Object.assign(med,p,{manufacturer_country:p.country,consumption_unit:p.unit});
      if(action==='receive'){med.units_per_package=p.units_per_package??med.units_per_package;med.reserve_qty+=p.packages*med.units_per_package;med.reserve_available=med.reserve_qty;partiesAdded++}
      if(action==='transfer'){med.reserve_qty-=p.quantity;med.work_qty+=p.quantity;med.reserve_available=med.reserve_qty;med.work_available=med.work_qty}
      receipts.set(args.p_request_id,action==='receive'?{quantity:p.packages*med.units_per_package,batch_id:'44444444-4444-4444-8444-444444444444'}:{id:p.id});
     }
     return failWrites?{error:{message:'Load failed'},status:0}:{data:receipts.get(args.p_request_id)};
    }
   }
   if(name==='work_catalog_v2')return {data:medData};
   if(name==='crm_finance_v5')return {data:{payment_only:true,stock_deducted:false}};
   if(name==='manager_medication_details_photo_v1')return {data:null};
   return {data:[],error:null};
  }};
 });
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname==='cdn.jsdelivr.net'||u.pathname.endsWith('/vendor/supabase-2.117.2.js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(u.hostname!=='127.0.0.1')return route.abort();const filename=u.pathname==='/'?'index.html':u.pathname.slice(1),full=path.join(root,filename);
  return route.fulfill({contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(full)?fs.readFileSync(full,'utf8'):''});
 });
 await page.goto('http://127.0.0.1:4173/');await page.evaluate(async()=>{currentStaff={id:'manager',role:'admin',full_name:'Test administrator'};await loadInventory();openMedForm(medData[0].id,'prices')});
 await expect(page.locator('#medSaveButton')).toBeVisible();return errors;
}

test('full wrapper stack preserves medication and metadata draft after ambiguous save and reopening',async({page})=>{
 const errors=await setup(page);await page.fill('#medSalePrice','350');await page.fill('#medManufacturerV5','New manufacturer');await page.fill('#medCommentV5','Captured comment');
 await page.evaluate(()=>{failWrites=true});await page.evaluate(()=>saveMedication());
 await expect(page.locator('#medSalePrice')).toBeDisabled();await expect(page.locator('#medSaveButton')).toBeEnabled();
 await page.evaluate(()=>{show('admin');openMedForm(medData[0].id,'prices')});
 await expect(page.locator('#medManufacturerV5')).toHaveValue('New manufacturer');await expect(page.locator('#medCommentV5')).toHaveValue('Captured comment');
 await expect(page.locator('#medSalePrice')).toHaveValue('350');await expect(page.locator('#medicationDeleteEntryV7')).toBeDisabled();
 await page.evaluate(()=>{failWrites=false});await page.click('#medSaveButton');await expect(page.locator('#medPhotoMessage')).toContainText('сохранены');
 const writes=await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='save'));
 expect(new Set(writes.map(x=>x.args.p_request_id)).size).toBe(1);expect(new Set(writes.map(x=>JSON.stringify(x.args.p_payload))).size).toBe(1);
 expect(await page.evaluate(()=>medData[0].sale_price)).toBe(350);expect(await page.evaluate(()=>medData[0].manufacturer)).toBe('New manufacturer');expect(errors).toEqual([]);
});

test('full wrapper stack retains incoming stock quantity and batch metadata while retrying one party',async({page})=>{
 const errors=await setup(page);await page.evaluate(()=>openMedForm(medData[0].id,'receive'));
 await page.locator('#receiveOptionalV18>summary').click();await page.fill('#receivePackages','2');await page.fill('#receivePrice','100');await page.fill('#receiveExpiry','2027-12-01');await page.fill('#receiveBatchNumberV5','B-17');await page.fill('#receiveSupplierV5','New supplier');
 await page.evaluate(()=>{failWrites=true});await page.evaluate(()=>receiveStock());await expect(page.locator('#receivePackages')).toBeDisabled();
 await page.evaluate(()=>{show('admin');openMedForm(medData[0].id,'receive')});await expect(page.locator('#receiveBatchNumberV5')).toHaveValue('B-17');await expect(page.locator('#receiveSupplierV5')).toHaveValue('New supplier');await expect(page.locator('#receivePackages')).toHaveValue('2');
 await page.evaluate(()=>{failWrites=false});await page.click('#receiveButton');await expect(page.locator('#stockOperationMessage')).toContainText('Партия добавлена');
 const writes=await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='receive'));expect(new Set(writes.map(x=>x.args.p_request_id)).size).toBe(1);expect(new Set(writes.map(x=>JSON.stringify(x.args.p_payload))).size).toBe(1);expect(await page.evaluate(()=>partiesAdded)).toBe(1);expect(errors).toEqual([]);
});

test('a failed optional photo can be left for later after the card and price are confirmed',async({page})=>{
 const errors=await setup(page);await page.fill('#medSalePrice','400');await page.setInputFiles('#medPhoto',{name:'pack.jpg',mimeType:'image/jpeg',buffer:Buffer.from('synthetic-image')});await page.evaluate(()=>{failPhoto=true});await page.click('#medSaveButton');
 await expect(page.locator('#medPhotoMessage')).toContainText('уже сохранены');await expect(page.locator('#medFinishPhotoV16')).toBeVisible();await page.click('#medFinishPhotoV16');
 await expect(page.locator('#medPhotoMessage')).toContainText('Фото можно добавить позже');await page.evaluate(()=>openMedForm(medData[1].id,'prices'));await expect(page.locator('#medId')).toHaveValue('22222222-2222-4222-8222-222222222222');
 expect(await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='save').length)).toBe(1);expect(await page.evaluate(()=>medData[0].sale_price)).toBe(400);expect(errors).toEqual([]);
});

test('quick stock transfer is blocked while another warehouse mutation awaits acknowledgement',async({page})=>{
 const errors=await setup(page);await page.evaluate(()=>{failWrites=true});await page.evaluate(()=>stockMutation('transfer',{id:medData[0].id,quantity:1,comment:'Captured transfer'},'Перевод сохранён.'));
 const before=await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='transfer').length);await page.evaluate(()=>quickTransfer4(medData[1].id,1));
 expect(await page.evaluate(()=>requests.filter(x=>x.args?.p_action==='transfer').length)).toBe(before);expect(await page.evaluate(()=>medData[1].work_qty)).toBe(0);
 await page.evaluate(()=>{failWrites=false});await page.evaluate(()=>stockMutation('transfer',{id:medData[0].id,quantity:1,comment:'Captured transfer'},'Перевод сохранён.'));expect(errors).toEqual([]);
});
