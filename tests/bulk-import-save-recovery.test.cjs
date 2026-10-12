const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const warehouse=fs.readFileSync(__dirname+'/../warehouse-v3.js','utf8'),workflow=fs.readFileSync(__dirname+'/../workflow-v3.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const line=(name,price=200,lead=3)=>`${name};Россия;ампула;упаковка;5;100;${price};0;0;${lead}`;
function fixture(){
 const nodes=new Map(),button={disabled:false,textContent:''};
 const get=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{contains:key=>classes.has(key),add:key=>classes.add(key),remove:key=>classes.delete(key),toggle(key,on){(on===undefined?!classes.has(key):on)?classes.add(key):classes.delete(key)}},querySelector:()=>button,querySelectorAll:()=>[]})}return nodes.get(id)};
 const context={console:{warn(){}},Intl,Date,Number,Map,Set,JSON,Error,Promise,crypto:require('node:crypto').webcrypto,SaveRecoveryV16:require('../crm-save-recovery-v16.js'),
  document:{querySelectorAll:()=>[]},$:get,currentStaff:{id:'owner-a',role:'owner'},inventory:[],quickNavigation4:0,localDateValue:()=> '2026-10-12',num:v=>Number(v||0),esc:v=>String(v??''),rub:String,
  saveProcedure:null,saveSale:null,bulkImportMeds:null,bulkText:get('bulkText'),bulkMessage:get('bulkMessage'),
  show(id){for(const node of nodes.values())node.classList.remove('active');get(id).classList.add('active')},async signOut(){context.currentStaff=null;context.show('login')}
 };
 const calls=[],receipts=new Map(),records=[];let refreshes=0;
 context.db={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});if(!receipts.has(args.p_request_id)){const saved={id:'record-'+(records.length+1),...args.p_payload};saved.id='record-'+(records.length+1);records.push(saved);receipts.set(args.p_request_id,{id:saved.id})}return {data:receipts.get(args.p_request_id)}}};
 vm.createContext(context);vm.runInContext(warehouse,context);vm.runInContext(workflow,context);context.loadInventory=async()=>{refreshes++;return true};context.restoreFieldLocks=()=>{};context.show('bulkImport');
 return {context,get,button,calls,records,receipts,refreshes:()=>refreshes,evaluate:code=>vm.runInContext(code,context)};
}

test('confirmed rows leave the list; ambiguous next-row retry preserves original payload and UUID despite edited text',async()=>{
 const f=fixture(),{context:c,calls,records}=f;let lost=true;const rpc=c.db.rpc;c.db.rpc=async(name,args)=>{const response=await rpc(name,args);if(args.p_payload.name==='Second'&&lost){lost=false;return {error:{message:'Load failed'}}}return response};
 c.bulkText.value=[line('First'),line('Second',300),line('Third',400)].join('\n');await c.bulkImportMeds();
 assert.equal(records.length,2);assert.equal(c.bulkText.value,[line('Second',300),line('Third',400)].join('\n'));assert.equal(c.bulkText.disabled,true);assert.equal(f.button.disabled,false);assert.match(c.bulkMessage.textContent,/По следующей строке ответ сервера не получен/);
 c.bulkText.value=[line('Replacement',900),line('Third',999)].join('\n');await c.bulkImportMeds();
 assert.equal(records.length,3);assert.deepEqual(records.map(r=>[r.name,r.sale_price]),[['First',200],['Second',300],['Third',400]]);
 const first=calls.filter(x=>x.args.p_payload.name==='First'),second=calls.filter(x=>x.args.p_payload.name==='Second');assert.equal(first.length,1);assert.equal(second.length,2);assert.equal(second[0].args.p_request_id,second[1].args.p_request_id);assert.deepEqual(second[0].args.p_payload,second[1].args.p_payload);
 assert.equal(c.bulkText.value,'');assert.equal(c.bulkText.disabled,false);assert.match(c.bulkMessage.textContent,/Карточек добавлено: 3/);
});

test('confirmed bulk import succeeds when later refresh rejects; committed lines cannot be re-imported',async()=>{
 const f=fixture(),{context:c,records,calls}=f;c.bulkText.value=[line('First'),line('Second')].join('\n');c.loadInventory=async()=>{throw Error('Load failed')};
 await c.bulkImportMeds();assert.equal(records.length,2);assert.equal(c.bulkText.value,'');assert.match(c.bulkMessage.textContent,/Карточек добавлено: 2/);assert.match(c.bulkMessage.textContent,/Добавленные карточки сохранены.*Список не обновился/);
 await c.bulkImportMeds();assert.equal(calls.length,2);assert.match(c.bulkMessage.textContent,/Введите список/);
});

test('definitive validation failure retains only remaining lines and permits a corrected payload with a new UUID',async()=>{
 const f=fixture(),{context:c,calls,records}=f;const rpc=c.db.rpc;let reject=true;c.db.rpc=async(name,args)=>{if(args.p_payload.name==='Invalid'&&reject){reject=false;calls.push({name,args:structuredClone(args)});return {error:{code:'P0001',message:'Исправьте цену'}}}return rpc(name,args)};
 c.bulkText.value=[line('First'),line('Invalid',300)].join('\n');await c.bulkImportMeds();assert.equal(records.length,1);assert.equal(c.bulkText.value,line('Invalid',300));assert.equal(c.bulkText.disabled,false);
 c.bulkText.value=line('Corrected',500);await c.bulkImportMeds();assert.equal(records.length,2);assert.equal(records[1].name,'Corrected');assert.notEqual(calls[1].args.p_request_id,calls[2].args.p_request_id);
});

test('local invalid lead time issues no write for the bad row and leaves confirmed prefix removed',async()=>{
 const f=fixture(),{context:c,calls}=f;c.bulkText.value=[line('First'),line('Invalid',200,1.5)].join('\n');await c.bulkImportMeds();
 assert.equal(calls.length,1);assert.equal(c.bulkText.value,line('Invalid',200,1.5));assert.equal(c.bulkText.disabled,false);assert.match(c.bulkMessage.textContent,/Срок поставки.*целых днях/);
});

test('double-click while importing sends each batch row only once',async()=>{
 const f=fixture(),{context:c,calls}=f,reply=deferred();c.bulkText.value=line('First');const rpc=c.db.rpc;c.db.rpc=async(name,args)=>{const response=await rpc(name,args);await reply.promise;return response};
 const importing=c.bulkImportMeds();await c.bulkImportMeds();assert.equal(calls.length,1);assert.equal(f.button.disabled,true);reply.resolve();await importing;assert.equal(f.button.disabled,false);
});

test('identical rows intentionally listed twice receive distinct successful write IDs',async()=>{
 const f=fixture(),{context:c,calls,records}=f;c.bulkText.value=[line('Same'),line('Same')].join('\n');await c.bulkImportMeds();assert.equal(records.length,2);assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);
});

test('completion after navigation retains a result snapshot until acknowledgement, without duplicate imports',async()=>{
 const f=fixture(),{context:c,calls}=f,reply=deferred();c.bulkText.value=line('First');const original=c.bulkText.value,rpc=c.db.rpc;c.db.rpc=async(name,args)=>{const response=await rpc(name,args);await reply.promise;return response};
 const importing=c.bulkImportMeds();c.quickNavigation4++;c.show('workspace');c.bulkMessage.textContent='Navigated away';reply.resolve();await importing;
 assert.equal(c.bulkText.value,original);assert.equal(c.bulkMessage.textContent,'Navigated away');assert.equal(c.bulkText.disabled,true);assert.match(f.button.textContent,/Показать результат импорта/);
 c.show('bulkImport');await c.bulkImportMeds();assert.equal(calls.length,1);assert.equal(c.bulkText.value,'');assert.equal(c.bulkText.disabled,false);assert.match(c.bulkMessage.textContent,/Карточек добавлено: 1/);
});

test('definitive failure after navigation acknowledges only remaining lines before permitting editing',async()=>{
 const f=fixture(),{context:c,calls}=f,reply=deferred();c.bulkText.value=[line('First'),line('Invalid')].join('\n');const rpc=c.db.rpc;
 c.db.rpc=async(name,args)=>{if(args.p_payload.name==='Invalid'){calls.push({name,args:structuredClone(args)});await reply.promise;return {error:{code:'P0001',message:'Invalid'}}}return rpc(name,args)};
 const importing=c.bulkImportMeds();await Promise.resolve();await Promise.resolve();await Promise.resolve();c.quickNavigation4++;c.show('workspace');reply.resolve();await importing;
 assert.equal(c.bulkText.disabled,true);assert.match(f.button.textContent,/Показать оставшиеся строки/);c.show('bulkImport');await c.bulkImportMeds();assert.equal(c.bulkText.value,line('Invalid'));assert.equal(c.bulkText.disabled,false);assert.equal(calls.filter(x=>x.args.p_payload.name==='First').length,1);
});

test('logout invalidates late import responses and cannot overwrite another account text or release its operation',async()=>{
 const f=fixture(),{context:c,calls}=f,old=deferred(),next=deferred();c.bulkText.value=line('Old account');c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return calls.length===1?old.promise:next.promise};
 const previous=c.bulkImportMeds();await c.signOut();assert.equal(c.bulkText.value,'');c.currentStaff={id:'owner-b',role:'owner'};c.show('bulkImport');c.bulkText.value=line('New account');const current=c.bulkImportMeds();
 old.resolve({data:{id:'old'}});await previous;assert.equal(c.bulkText.value,line('New account'));assert.equal(f.evaluate('bulkBusy'),true);assert.equal(f.button.disabled,true);
 next.resolve({data:{id:'new'}});await current;assert.equal(c.bulkText.value,'');assert.equal(f.evaluate('bulkBusy'),false);assert.match(c.bulkMessage.textContent,/Карточек добавлено: 1/);assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);
});

test('a nurse cannot import and another unresolved warehouse draft must finish first',async()=>{
 const f=fixture(),{context:c,calls}=f;c.bulkText.value=line('First');c.currentStaff={id:'nurse',role:'nurse'};await c.bulkImportMeds();assert.equal(calls.length,0);
 c.currentStaff={id:'owner-a',role:'owner'};f.evaluate('stockDraftV16={actor:warehouseActorV16(),payload:{id:"pending"},action:"receive"}');await c.bulkImportMeds();assert.equal(calls.length,0);assert.match(c.bulkMessage.textContent,/Сначала завершите/);
});

test('active and ambiguous bulk batches block unrelated card writes until the original row is resolved',async()=>{
 const f=fixture(),{context:c,calls}=f,reply=deferred();c.bulkText.value=line('First');const rpc=c.db.rpc;let lose=true;
 c.db.rpc=async(name,args)=>{const response=await rpc(name,args);await reply.promise;if(lose){lose=false;return {error:{message:'Load failed'}}}return response};
 const importing=c.bulkImportMeds();assert.equal(f.evaluate('warehouseBusy'),true);assert.equal(c.openMedForm(''),false);await c.saveMedication();assert.equal(calls.length,1);
 reply.resolve();await importing;assert.equal(f.evaluate('bulkBusy'),false);assert.equal(f.evaluate('warehouseBusy'),true);assert.equal(c.openMedForm(''),false);await c.saveMedication();assert.equal(calls.length,1);
 await c.bulkImportMeds();assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(f.evaluate('warehouseBusy'),false);
});
