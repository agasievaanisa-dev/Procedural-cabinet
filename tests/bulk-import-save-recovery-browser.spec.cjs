const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const line=name=>`${name};Россия;ампула;упаковка;5;100;200;0;0;3`;
async function setup(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.importCalls=[];window.importReceipts=new Map();window.importRecords=[];window.failImportName='';window.holdImport=false;window.releaseImport=null;
  window.dbStub={auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},rpc:async(name,args)=>{
   importCalls.push({name,args:structuredClone(args)});
   if(name==='warehouse_v5'&&args.p_action==='save'){
    if(!importReceipts.has(args.p_request_id)){const saved={...args.p_payload,id:'import-'+(importRecords.length+1),consumption_unit:args.p_payload.unit,manufacturer_country:args.p_payload.country,active:true,reserve_qty:0,work_qty:0};importRecords.push(saved);importReceipts.set(args.p_request_id,{id:saved.id})}
    const response={data:importReceipts.get(args.p_request_id)};
    if(holdImport)return new Promise(resolve=>{releaseImport=()=>resolve(response)});
    return args.p_payload.name===failImportName?{error:{message:'Load failed'},status:0}:response;
   }
   if(name==='warehouse_v5'&&args.p_action==='list')return {data:importRecords};
   if(name==='warehouse_v5'&&['batches','history'].includes(args.p_action))return {data:[]};
   if(name==='crm_finance_v5')return {data:{payment_only:true,stock_deducted:false}};
   return {data:[]};
  }};
 });
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname==='cdn.jsdelivr.net'||u.pathname.endsWith('/vendor/supabase-2.117.2.js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(u.hostname!=='127.0.0.1')return route.abort();const filename=u.pathname==='/'?'index.html':u.pathname.slice(1),full=path.join(root,filename);
  return route.fulfill({contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(full)?fs.readFileSync(full,'utf8'):''});
 });
 await page.goto('http://127.0.0.1:4173/');await page.evaluate(()=>{currentStaff={id:'manager',role:'admin',full_name:'Test administrator'};show('bulkImport')});return errors;
}

test('bulk UI retries the exact ambiguous next row without reimporting the confirmed prefix',async({page})=>{
 const errors=await setup(page);await page.fill('#bulkText',[line('First medicine'),line('Second medicine')].join('\n'));
 await page.evaluate(()=>{failImportName='Second medicine'});await page.evaluate(()=>bulkImportMeds());
 await expect(page.locator('#bulkText')).toHaveValue(line('Second medicine'));await expect(page.locator('#bulkText')).toBeDisabled();await expect(page.locator('#bulkMessage')).toContainText('ответ сервера не получен');
 const before=await page.evaluate(()=>importCalls.filter(x=>x.name==='warehouse_v5'&&x.args.p_action==='save').length);
 await page.evaluate(async()=>{show('workspace');openMedForm('','edit');await saveMedication()});await expect(page.locator('#workspace')).toHaveClass(/active/);
 expect(await page.evaluate(()=>importCalls.filter(x=>x.name==='warehouse_v5'&&x.args.p_action==='save').length)).toBe(before);await page.evaluate(()=>show('bulkImport'));
 await page.evaluate(()=>{document.getElementById('bulkText').value='Changed name;Россия;ампула;упаковка;5;100;900;0;0;3';failImportName=''});
 await page.locator('#bulkImport button[onclick="bulkImportMeds()"]').click();await expect(page.locator('#bulkMessage')).toContainText('Карточек добавлено: 2');await expect(page.locator('#bulkText')).toHaveValue('');await expect(page.locator('#bulkText')).toBeEnabled();
 const writes=await page.evaluate(()=>importCalls.filter(x=>x.name==='warehouse_v5'&&x.args.p_action==='save'));
 expect(writes.filter(x=>x.args.p_payload.name==='First medicine').length).toBe(1);const second=writes.filter(x=>x.args.p_payload.name==='Second medicine');expect(new Set(second.map(x=>x.args.p_request_id)).size).toBe(1);expect(new Set(second.map(x=>JSON.stringify(x.args.p_payload))).size).toBe(1);
 expect(await page.evaluate(()=>importRecords.map(x=>x.name))).toEqual(['First medicine','Second medicine']);expect(errors).toEqual([]);
});

test('navigating away during bulk confirmation keeps a result to acknowledge without importing again',async({page})=>{
 const errors=await setup(page);await page.fill('#bulkText',line('One medicine'));await page.evaluate(()=>{holdImport=true;window.pendingBulk=bulkImportMeds()});
 await page.waitForFunction(()=>typeof releaseImport==='function');await page.evaluate(()=>{quickNavigation4++;show('workspace');document.getElementById('bulkMessage').textContent='Screen left';holdImport=false;releaseImport()});await page.evaluate(()=>window.pendingBulk);
 expect(await page.locator('#bulkMessage').textContent()).toBe('Screen left');await page.evaluate(()=>show('bulkImport'));await expect(page.locator('#bulkImport button[onclick="bulkImportMeds()"]')).toHaveText('Показать результат импорта');await expect(page.locator('#bulkText')).toBeDisabled();
 await page.locator('#bulkImport button[onclick="bulkImportMeds()"]').click();await expect(page.locator('#bulkText')).toHaveValue('');await expect(page.locator('#bulkText')).toBeEnabled();expect(await page.evaluate(()=>importRecords.length)).toBe(1);expect(await page.evaluate(()=>importCalls.filter(x=>x.name==='warehouse_v5'&&x.args.p_action==='save').length)).toBe(1);expect(errors).toEqual([]);
});
