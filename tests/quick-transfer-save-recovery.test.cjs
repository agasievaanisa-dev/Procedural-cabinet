const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function fixture(){
 const nodes=new Map(),notices=[],calls=[],receipts=new Map();let writes=0,refreshes=0;
 const get=id=>{
  if(!nodes.has(id)){
   const classes=new Set();nodes.set(id,{id,value:'',innerHTML:'',textContent:'',disabled:false,open:false,
    classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,on){(on===undefined?!classes.has(name):on)?classes.add(name):classes.delete(name)}},
    querySelectorAll:()=>[],insertAdjacentHTML(_position,html){this.innerHTML+=html},getAttribute:()=>'',scrollIntoView(){},focus(){}});
  }
  return nodes.get(id);
 };
 const c={console:{warn(){}},Intl,Date,Number,String,Map,Set,JSON,Math,Error,Promise,crypto:require('node:crypto').webcrypto,
  SaveRecoveryV16:require('../crm-save-recovery-v16.js'),document:{querySelectorAll:()=>[],addEventListener(){}},window:{scrollTo(){}},$:get,
  currentStaff:{id:'owner-a',role:'owner'},inventory:[{id:'m1',name:'Первый',consumption_unit:'ampoule',units_per_package:5,reserve_qty:20,work_qty:0},{id:'m2',name:'Второй',consumption_unit:'vial',units_per_package:2,reserve_qty:12,work_qty:0}],meds:[],patients:[],localDateValue:()=> '2026-10-12',num:value=>Number(value||0),esc:String,rub:String,
  signMedicationPhotos:async()=>{},medPhotoUrls:new Map(),medPhotoHtml:()=>'',photoSrc:()=>'',medPhotoObjectUrl:null,
  show(id){for(const node of nodes.values())node.classList.remove('active');get(id).classList.add('active')},
  async signOut(){c.currentStaff=null;c.show('login')}
 };
 for(const match of fs.readFileSync(__dirname+'/../index.html','utf8').matchAll(/\bid="([^"]+)"/g))c[match[1]]=get(match[1]);
 for(const name of ['enterApp','addPatient','recalc','saveTreatment','openPatient','filterMedicationRows','renderMedVisualCatalog','addMedRow','chooseMedication','startShift','openProcedure','openSale','openReport','closeShift','renderPatients','staffOptions','calcProcedure','calcSale'])c[name]=()=>{};
 c.db={rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(!receipts.has(args.p_request_id)){
   writes++;const med=c.inventory.find(item=>item.id===args.p_payload.id);med.reserve_qty-=args.p_payload.quantity;med.work_qty+=args.p_payload.quantity;
   receipts.set(args.p_request_id,{quantity:args.p_payload.quantity});
  }
  return {data:receipts.get(args.p_request_id)};
 }};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../warehouse-v3.js','utf8'),c);
 c.renderInventory=()=>{};c.loadInventory=async()=>{refreshes++;return true};c.loadMeds=async()=>{refreshes++;return true};
 vm.runInContext(fs.readFileSync(__dirname+'/../quick-v4.js','utf8'),c);
 c.message=(id,text,success)=>{notices.push({id,text,success});get(id).innerHTML=text};c.show('procedure');
 return {c,get,calls,notices,receipts,writes:()=>writes,refreshes:()=>refreshes,value:code=>vm.runInContext(code,c)};
}
test('ambiguous quick transfer freezes the original item and quantity, holds stock writes, and retries one receipt',async()=>{
 const f=fixture(),{c,calls,get,notices}=f,rpc=c.db.rpc;let lost=true;
 c.db.rpc=async(name,args)=>{const result=await rpc(name,args);if(lost){lost=false;return {error:{message:'Load failed'}}}return result};
 await c.quickTransfer4('m1',5);assert.equal(f.writes(),1);assert.equal(f.value('warehouseBusy'),true);assert.equal(f.value('quickBusy'),false);assert.match(notices.at(-1).text,/Первый.*5 амп\..*Другое пополнение/);assert.match(get('procedureMessage').innerHTML,/Повторить исходный перевод/);
 await c.quickTransfer4('m2',2);await c.quickTransfer4('m1',10);assert.equal(calls.length,1);assert.match(notices.at(-1).text,/Первый/);
 c.inventory[0].name='Изменённое название';c.renderInventory();assert.match(get('inventoryNudges').innerHTML,/Первый.*retryQuickTransferV16/);
 await c.retryQuickTransferV16();assert.equal(f.writes(),1);assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);assert.equal(f.value('warehouseBusy'),false);assert.equal(f.value('quickTransferDraftV16'),null);assert.equal(f.refreshes(),2);assert.equal(notices.at(-1).success,true);
 assert.equal(c.inventory[0].work_qty,5);assert.equal(c.inventory[1].work_qty,0);
});
test('a definitive rejected quick transfer releases its draft and permits a corrected operation with a new UUID',async()=>{
 const f=fixture(),{c,calls}=f,rpc=c.db.rpc;let rejected=true;
 c.db.rpc=async(name,args)=>{if(rejected){rejected=false;calls.push({name,args:structuredClone(args)});return {error:{code:'P0001',message:'Недостаточно годного препарата'}}}return rpc(name,args)};
 await c.quickTransfer4('m1',5);assert.equal(f.value('quickTransferDraftV16'),null);assert.equal(f.value('warehouseBusy'),false);assert.equal(f.writes(),0);
 await c.quickTransfer4('m2',2);assert.equal(f.writes(),1);assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(calls[1].args.p_payload.id,'m2');
});
test('database connection shutdown keeps the original quick-transfer receipt',async()=>{
 const f=fixture(),{c,calls}=f,rpc=c.db.rpc;let lost=true;
 c.db.rpc=async(name,args)=>{const result=await rpc(name,args);if(lost){lost=false;return {error:{code:'57P01',message:'Server shutting down'}}}return result};
 await c.quickTransfer4('m1',5);assert.equal(f.value('warehouseBusy'),true);await c.retryQuickTransferV16();assert.equal(f.writes(),1);assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);
});
test('malformed transfer acknowledgement retains its explicit receipt and never transfers the stock twice',async()=>{
 const f=fixture(),{c,calls}=f,rpc=c.db.rpc;let invalid=true;
 c.db.rpc=async(name,args)=>{const response=await rpc(name,args);if(invalid){invalid=false;return {data:{}}}return response};
 await c.quickTransfer4('m1',5);assert.equal(f.value('warehouseBusy'),true);assert.equal(f.writes(),1);
 await c.retryQuickTransferV16();assert.equal(f.writes(),1);assert.deepEqual(calls[0].args,calls[1].args);assert.equal(f.value('warehouseBusy'),false);
});
test('confirmed transfer with a failed refresh stays successful and blocks another transfer until inventory reload succeeds',async()=>{
 const f=fixture(),{c,notices,calls}=f;c.loadMeds=async()=>{throw Error('Load failed')};
 await c.quickTransfer4('m1',5);assert.equal(f.writes(),1);assert.equal(f.value('quickTransferDraftV16'),null);assert.equal(f.value('warehouseBusy'),false);assert.equal(f.value('quickTransferStaleV16'),true);assert.equal(notices.at(-1).success,true);assert.match(notices.at(-1).text,/Перевод сохранён/);
 await c.quickTransfer4('m2',2);assert.equal(calls.length,1);await c.loadInventory();assert.equal(f.value('quickTransferStaleV16'),false);c.loadMeds=async()=>true;await c.quickTransfer4('m2',2);assert.equal(calls.length,2);
});
test('navigation during transfer prevents both dashboard refresh and an old success message',async()=>{
 const f=fixture(),{c,notices,calls}=f,reply=deferred(),rpc=c.db.rpc;c.db.rpc=async(name,args)=>{const result=await rpc(name,args);await reply.promise;return result};
 const pending=c.quickTransfer4('m1',5);await Promise.resolve();c.beginQuickNavigation4();c.show('workspace');const count=notices.length;reply.resolve();await pending;
 assert.equal(calls.length,1);assert.equal(f.refreshes(),0);assert.equal(notices.length,count);assert.equal(f.value('quickTransferStaleV16'),true);assert.equal(f.value('warehouseBusy'),false);
});
test('logout invalidates the frozen transfer, and its late reply cannot unlock or overwrite the next owner transfer',async()=>{
 const f=fixture(),{c,calls,notices}=f,old=deferred(),next=deferred();
 c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return calls.length===1?old.promise:next.promise};
 const previous=c.quickTransfer4('m1',5);await c.signOut();assert.equal(f.value('quickTransferDraftV16'),null);assert.equal(f.value('warehouseBusy'),false);
 c.currentStaff={id:'owner-b',role:'owner'};c.show('procedure');const current=c.quickTransfer4('m2',2),count=notices.length;
 old.resolve({data:{quantity:5}});await previous;assert.equal(f.value('quickBusy'),true);assert.equal(f.value('warehouseBusy'),true);assert.equal(notices.length,count);assert.equal(f.refreshes(),0);
 next.resolve({data:{quantity:2}});await current;assert.equal(f.value('quickBusy'),false);assert.equal(f.value('warehouseBusy'),false);assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(notices.at(-1).success,true);
});
test('nurses cannot transfer and double clicks during an active transfer send only one write',async()=>{
 const f=fixture(),{c,calls}=f,reply=deferred();c.currentStaff={id:'nurse',role:'nurse'};await c.quickTransfer4('m1',5);assert.equal(calls.length,0);
 c.currentStaff={id:'owner-a',role:'owner'};c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return reply.promise};const first=c.quickTransfer4('m1',5);await c.quickTransfer4('m2',2);assert.equal(calls.length,1);reply.resolve({data:{quantity:5}});await first;
});
