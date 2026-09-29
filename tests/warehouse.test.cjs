const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,classList:{toggle(){}},focus(){}});return elements.get(id)}
const context={console,Intl,Date,Number,Map,Set,JSON,Error,Promise,crypto:require('node:crypto').webcrypto,
 document:{querySelectorAll(){return[]}},localDateValue:()=> '2026-09-29',num:v=>Number(v||0),$:element,
 rub:v=>String(v)+' ₽',esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 currentStaff:{role:'admin'},inventory:[],signMedicationPhotos:async()=>{},medPhotoHtml:()=>'',medPhotoUrls:new Map()};
['inventorySearch','inventoryFilter','inventorySummary','inventoryList','inventoryCount','medId','receivePackages','receivePrice','receivePreview','transferPreview','transferQty','transferMode'].forEach(id=>context[id]=element(id));
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../warehouse.js','utf8'),context);
const evalIn=code=>vm.runInContext(code,context);
const m={id:'fixture',name:'<img src=x onerror=alert(1)>',consumption_unit:'амп.',units_per_package:10,work_qty:13,reserve_qty:20,min_total_stock:40,work_threshold:15,active:true};
context.inventory=[m];context.inventoryFilter.value='active';
assert.equal(context.packLabel(20,m),'2 уп.');assert.equal(context.packLabel(23,m),'2 уп. + 3 амп.');
assert.equal(context.stockFacts(m).total,33);assert.match(context.stockCells(m),/33 амп\./);
assert.equal(context.expiryDays('2026-09-29'),0);assert.equal(context.expiryDays('2026-09-28'),-1);
context.renderInventory();assert.match(context.inventoryList.innerHTML,/&lt;img/);assert.ok(!context.inventoryList.innerHTML.includes('<img src=x'));
context.inventoryFilter.value='archive';context.renderInventory();assert.match(context.inventoryCount.textContent,/0/);
for(const val of ['0','-1','1.5','NaN','Infinity',''])assert.throws(()=>context.positiveWhole(val,'test'));
assert.equal(context.positiveWhole('2','test'),2);assert.throws(()=>context.nonnegative('','test'));
(async()=>{
 const requests=[];let attempt=0;
 context.db={rpc:async(name,args)=>{requests.push(args);if(++attempt===1)return {error:{message:'Network error'}};return {data:{quantity:10}}}};
 await assert.rejects(context.warehouseRpc('transfer',{id:'fixture',quantity:10},true));
 await context.warehouseRpc('transfer',{id:'fixture',quantity:10},true);
 assert.equal(requests[0].p_request_id,requests[1].p_request_id);
 await context.warehouseRpc('transfer',{id:'fixture',quantity:10},true);
 assert.notEqual(requests[1].p_request_id,requests[2].p_request_id);
 context.currentStaff={role:'nurse'};await assert.rejects(context.warehouseRpc('list'),/Нет доступа/);
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate DOM IDs');
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 console.log('PASS: units/packages, totals, expiry dates, filters, escaped content, validation, retry IDs, role guard, DOM IDs and inline syntax');
})();
