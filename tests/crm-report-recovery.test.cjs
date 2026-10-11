const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../crm-finance-v5.js', 'utf8');
const networkFailure = () => ({data:null,error:{message:'TypeError: Load failed',code:'',details:'TypeError: Load failed'},status:0});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({manualTimers = false} = {}) {
 const elements = new Map(), calls = [], timers = [], messages = [], downloads = [];
 let rpc = async () => ({data:summary('CURRENT')});
 let prints = 0, blobs = 0;
 function el(id) {
  if (!elements.has(id)) {
   const classes = new Set();
   elements.set(id, {id,value:'',checked:false,disabled:false,innerHTML:'',textContent:'',
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,state){if(state ?? !classes.has(x))classes.add(x);else classes.delete(x);}},
    querySelector:()=>null,querySelectorAll:()=>[],setAttribute(){},
    insertAdjacentHTML(where,html){this.innerHTML = where === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;}
   });
  }
  return elements.get(id);
 }
 const c = {
  console,Map,Set,Date,JSON,Error,TypeError,Number,Math,String,Promise,Blob,
  crypto:require('node:crypto').webcrypto,
  setTimeout(fn,delay){timers.push({fn,delay});if(!manualTimers)queueMicrotask(fn);return timers.length;},
  document:{querySelectorAll:()=>[],createElement(tag){return {tag,setAttribute(){},click(){downloads.push({name:this.download,href:this.href});}};}},
  URL:{createObjectURL(){blobs++;return 'blob:test-' + blobs;},revokeObjectURL(){}},
  $:el,window:{print(){prints++;}},
  currentStaff:{id:'owner-1',role:'owner'},shift:null,
  patients:[],nurses:[],inventory:[],meds:[],services:[],
  rows:()=>[],esc:v=>String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  num:v=>Number(v || 0),qty:v=>String(v || 0),rub:v=>String(Number(v || 0)) + ' ₽',unit:()=> 'амп.',
  isManager:()=>['owner','admin'].includes(c.currentStaff?.role),
  message(id,text){messages.push({id,text});el(id).textContent=text;},show(){},
  localDateValue:()=> '2026-10-10',shiftLabel:()=> '',expiryDays:()=>null,
  loadInventory:async()=>{},loadQuickContext:async()=>{},openShiftMenu:async()=>{},
  prepareTreatment4:async()=>true,calcProcedure(){},calcSale(){},
  enterApp:async()=>{},signOut:async()=>{c.currentStaff=null;},refreshDashboard:async()=>{},
  db:{rpc:async(name,args)=>{calls.push({name,args});return rpc(name,args);}}
 };
 vm.createContext(c);vm.runInContext(source,c);
 el('reportsV5From').value='2026-10-01';el('reportsV5To').value='2026-10-10';el('reportsV5Group').value='day';
 return {c,el,calls,timers,messages,downloads,setRpc:fn=>{rpc=fn;},get prints(){return prints;},get blobs(){return blobs;}};
}

function summary(label,from='2026-10-01',to='2026-10-10') {
 return {from,to,time_zone:'Europe/Moscow',patients_count:1,procedures_count:1,sales_count:0,
  revenue:{cash:100,terminal:0,owner_card:0,total:100},payroll_total:0,cash_after_salary:100,payroll_complete:true,
  rows:[{label,revenue:{cash:100,total:100},patients_count:1,procedures_count:1,sales_count:0}],shifts:[]};
}

test('report reads recover once from a Safari network failure without altering the request',async()=>{
 for(const action of ['summary','settings_get','accounting_mode','shift_report']) {
  const f=fixture();let attempts=0;
  f.setRpc(async()=>++attempts===1 ? networkFailure() : {data:{recovered:true}});
  const payload={from:'2026-10-01',to:'2026-10-10',group_by:'day'};
  assert.equal((await f.c.crmFinanceRpcV5(action,payload)).recovered,true,action);
  assert.equal(f.calls.length,2,action);
  assert.deepEqual(f.calls[0],f.calls[1],action+' retries the same read');
  assert.deepEqual(f.timers.map(t=>t.delay),[350]);
 }
});

test('returned and thrown network failures stop after one retry and show a Russian message',async()=>{
 for(const thrown of [false,true]) {
  const f=fixture();
  f.setRpc(async()=>{if(thrown)throw new TypeError('Failed to fetch');return networkFailure();});
  await assert.rejects(f.c.crmFinanceRpcV5('summary'),error=>/Не удалось связаться с сервером/.test(error.message) && /Проверьте интернет/.test(error.message));
  assert.equal(f.calls.length,2);
  assert.equal(f.timers.length,1);
 }
});

test('database, authorization and HTTP errors do not cause an automatic retry',async()=>{
 for(const response of [
  {error:{code:'P0001',message:'Недостаточно прав'},status:400},
  {error:{code:'42501',message:'permission denied'},status:403},
  {error:{code:'PGRST301',message:'JWT expired'},status:401},
  {error:{message:'TypeError: Load failed'},status:500},
  {error:{code:'P0001',message:'TypeError: Load failed'},status:400}
 ]) {
  const f=fixture();f.setRpc(async()=>response);
  await assert.rejects(f.c.crmFinanceRpcV5('summary'));
  assert.equal(f.calls.length,1);
  assert.equal(f.timers.length,0);
 }
});

test('closing shifts and changing money or settings are never automatically retried',async()=>{
 for(const action of ['close','salary','settings_save']) {
  const f=fixture();f.setRpc(async()=>networkFailure());
  await assert.rejects(f.c.crmFinanceRpcV5(action,{shift_id:'shift-1',amount:2000}));
  assert.equal(f.calls.length,1,action);
  assert.equal(f.timers.length,0,action);
 }
});

test('switching accounts or roles while waiting cancels a pending read retry',async()=>{
 for(const replacement of [null,{id:'owner-2',role:'owner'},{id:'owner-1',role:'nurse'}]) {
  const f=fixture({manualTimers:true});f.setRpc(async()=>networkFailure());
  const read=f.c.crmFinanceRpcV5('summary');
  const rejection=assert.rejects(read,/Учётная запись изменилась/);
  await tick();assert.equal(f.timers.length,1);
  f.c.currentStaff=replacement;f.timers[0].fn();await rejection;
  assert.equal(f.calls.length,1,'No report query is sent for a different account');
 }
});

test('late read results are rejected after logout, even after the same account signs in again',async()=>{
 const f=fixture();let release;
 f.setRpc(()=>new Promise(resolve=>{release=resolve;}));
 const read=f.c.crmFinanceRpcV5('summary');const rejection=assert.rejects(read,/Учётная запись изменилась/);
 await tick();await f.c.signOut();f.c.currentStaff={id:'owner-1',role:'owner'};
 release({data:summary('OLD SESSION')});await rejection;
 assert.equal(f.calls.length,1);
});

test('a failed new report clears the previous period and blocks CSV and print',async()=>{
 const f=fixture();await f.c.loadFinanceSummaryV5('reportsV5');
 assert.match(f.el('reportsV5Body').innerHTML,/CURRENT/);
 assert.equal(f.el('reportsV5Print').disabled,false);assert.equal(f.el('reportsV5Csv').disabled,false);
 f.c.downloadFinanceCsvV5('reportsV5');f.c.printFinanceReportV5('reportsV5');
 assert.equal(f.blobs,1);assert.equal(f.prints,1);
 f.el('reportsV5From').value='2026-10-05';f.setRpc(async()=>networkFailure());
 await f.c.loadFinanceSummaryV5('reportsV5');
 assert.equal(f.el('reportsV5Body').innerHTML,'');
 assert.equal(f.el('reportsV5Print').disabled,true);assert.equal(f.el('reportsV5Csv').disabled,true);
 assert.match(f.el('reportsV5Message').textContent,/Не удалось связаться с сервером/);
 f.c.downloadFinanceCsvV5('reportsV5');f.c.printFinanceReportV5('reportsV5');
 assert.equal(f.blobs,1,'Old CSV cannot be downloaded');assert.equal(f.prints,1,'Old period cannot be printed');
});

test('changed filters cannot export the previous report, including direct calls',async()=>{
 for(const field of ['reportsV5From','reportsV5To','reportsV5Group','reportsV5Filter']) {
  const f=fixture();await f.c.loadFinanceSummaryV5('reportsV5');
  f.el(field).value=field.endsWith('Group') ? 'employee' : field.endsWith('Filter') ? 'employee-1' : '2026-10-06';
  f.c.downloadFinanceCsvV5('reportsV5');f.c.printFinanceReportV5('reportsV5');
  assert.equal(f.blobs,0,field);assert.equal(f.prints,0,field);
  assert.equal(f.calls.length,1,'Export guards do not make a replacement query');
 }
});

test('an invalid period clears a previously loaded report without a server query',async()=>{
 const f=fixture();await f.c.loadFinanceSummaryV5('reportsV5');const count=f.calls.length;
 f.el('reportsV5From').value='2026-10-11';await f.c.loadFinanceSummaryV5('reportsV5');
 assert.equal(f.calls.length,count);assert.equal(f.el('reportsV5Body').innerHTML,'');
 assert.equal(f.el('reportsV5Csv').disabled,true);assert.equal(f.el('reportsV5Print').disabled,true);
 assert.match(f.el('reportsV5Message').textContent,/корректный период/);
});

test('a slower previous request cannot replace the latest report or exported period',async()=>{
 const f=fixture();let release,attempt=0;
 f.setRpc(()=>++attempt===1 ? new Promise(resolve=>{release=resolve;}) : Promise.resolve({data:summary('LATEST','2026-10-05')}));
 const old=f.c.loadFinanceSummaryV5('reportsV5');await tick();
 f.el('reportsV5From').value='2026-10-05';await f.c.loadFinanceSummaryV5('reportsV5');
 release({data:summary('OBSOLETE')});await old;
 assert.match(f.el('reportsV5Body').innerHTML,/LATEST/);assert.doesNotMatch(f.el('reportsV5Body').innerHTML,/OBSOLETE/);
 f.c.downloadFinanceCsvV5('reportsV5');assert.match(f.downloads[0].name,/2026-10-05-2026-10-10/);
});

test('changing filters while a report loads invalidates its eventual response',async()=>{
 const f=fixture();let release;
 f.setRpc(()=>new Promise(resolve=>{release=resolve;}));
 const read=f.c.loadFinanceSummaryV5('reportsV5');await tick();
 f.el('reportsV5To').value='2026-10-06';f.c.invalidateFinanceSummaryV5('reportsV5');
 release({data:summary('OLD FILTERS')});await read;
 assert.equal(f.el('reportsV5Body').innerHTML,'');assert.equal(f.el('reportsV5Csv').disabled,true);assert.equal(f.el('reportsV5Print').disabled,true);
 f.c.downloadFinanceCsvV5('reportsV5');assert.equal(f.blobs,0);
});

test('failed inventory loading does not publish an incomplete analytics report',async()=>{
 for(const thrown of [false,true]) {
  const f=fixture();
  f.el('analyticsV5From').value='2026-10-01';f.el('analyticsV5To').value='2026-10-10';
  await f.c.loadFinanceSummaryV5('analyticsV5');
  assert.match(f.el('analyticsV5Body').innerHTML,/CURRENT/);assert.equal(f.el('analyticsV5Csv').disabled,false);
  f.c.loadInventory=async()=>{if(thrown)throw new Error('Не удалось обновить остатки склада');return false;};
  await f.c.loadFinanceSummaryV5('analyticsV5');
  assert.equal(f.el('analyticsV5Body').innerHTML,'');
  assert.equal(f.el('analyticsV5Csv').disabled,true);assert.equal(f.el('analyticsV5Print').disabled,true);
  assert.match(f.el('analyticsV5Message').textContent,/Не удалось обновить остатки склада/);
  f.c.downloadFinanceCsvV5('analyticsV5');f.c.printFinanceReportV5('analyticsV5');
  assert.equal(f.blobs,0);assert.equal(f.prints,0);
 }
});
