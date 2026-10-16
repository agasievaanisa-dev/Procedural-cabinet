const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../warehouse-v3.js','utf8');
const markup=fs.readFileSync(__dirname+'/../index.html','utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
function fixture(){
 const elements=new Map();
 function get(id){
  if(!elements.has(id)){
   const classes=new Set();
   elements.set(id,{id,value:'',innerHTML:'',textContent:'',files:[],disabled:false,open:false,style:{},attributes:{},classList:{contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n),toggle(n,on){const add=on===undefined?!classes.has(n):on;add?classes.add(n):classes.delete(n)}},focus(){},scrollIntoView(){},getAttribute(n){return this.attributes[n]||''},querySelectorAll(){return [...elements.values()].filter(el=>el.control)}});
  }
  return elements.get(id);
 }
 for(const match of markup.matchAll(/<(input|textarea|select|button|section|details|div|p|span|h\d|fieldset)[^>]*\bid="([^"]+)"[^>]*>/g)){
  const el=get(match[2]);el.control=['input','textarea','select','button'].includes(match[1]);el.attributes.onclick=match[0].match(/onclick="([^"]*)"/)?.[1]||'';
 }
 const context={console:{warn(){},error(){}},Intl,Date,Number,Map,Set,JSON,Error,Promise,crypto:require('node:crypto').webcrypto,URL:{revokeObjectURL(){}},
  document:{querySelectorAll(){return [...elements.values()].filter(el=>el.control)}},localDateValue:()=> '2026-10-12',num:v=>Number(v||0),$:get,
  rub:v=>`${v} ₽`,esc:v=>String(v??''),currentStaff:{id:'manager-a',role:'admin'},inventory:[],meds:[],medPhotoObjectUrl:null,quickNavigation4:0,
  photoSrc:()=>'',signMedicationPhotos:async()=>{},medPhotoHtml:()=>'',prompt:()=>'',
  show(id){for(const el of elements.values())el.classList.remove('active');get(id).classList.add('active')},
  async signOut(){context.currentStaff=null;context.show('login')}
 };
 for(const [id,el] of elements)context[id]=el;
 context.warehouseExtraPayloadV5=(action,p)=>({...p,...(action==='save'?{manufacturer:get('medManufacturerV5').value,release_form:get('medReleaseFormV5').value,comment:get('medCommentV5').value}:['receive','opening'].includes(action)?{batch_number:get(action+'BatchNumberV5').value,supplier:get(action+'SupplierV5').value,received_date:get(action+'ReceivedDateV5').value}:{})});
 const calls=[];context.db={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});if(name==='warehouse_v5'&&['list','batches','history'].includes(args.p_action))return {data:args.p_action==='list'?context.inventory:[]};if(name==='warehouse_v5'&&['receive','opening'].includes(args.p_action)){const p=args.p_payload;return {data:{quantity:Number(p.quantity??p.packages*(p.units_per_package??context.inventory.find(m=>m.id===p.id)?.units_per_package)),batch_id:'incoming-batch',location:p.location}};}return {data:{id:args.p_payload?.id||'saved-med'}}},storage:{from:()=>({upload:async()=>({data:{path:'photo'}})})}};
 vm.createContext(context);vm.runInContext(source,context);context.renderInventory=()=>{};context.loadStockDetails=async()=>{};
 function prepare(id=''){
  context.openMedForm(id);get('medName').value=id?'Existing medicine':'New medicine';get('medManufacturerV5').value='Manufacturer';get('medReleaseFormV5').value='Раствор';get('medCommentV5').value='Snapshot comment';
  get('medUnitsPerPack').value='5';get('medPurchasePrice').value='100';get('medSalePrice').value='200';get('medLeadDays').value='3';get('medMin').value='0';get('medWorkMin').value='0';
 }
 const evaluate=code=>vm.runInContext(code,context);
 return {context,get,calls,prepare,evaluate};
}

test('lost medication response freezes the exact new-card payload and request ID until recovery',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();
 const receipts=new Map();let committed=0,lost=true;
 c.db.rpc=async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(args?.p_action==='save'){
   if(!receipts.has(args.p_request_id)){committed++;receipts.set(args.p_request_id,{id:'new-1'})}
   if(lost){lost=false;return {error:{message:'Load failed'}}}
   return {data:receipts.get(args.p_request_id)};
  }
  if(args?.p_action==='list')return {error:{message:'Load failed'}};return {data:[]};
 };
 await c.saveMedication();assert.equal(get('medName').disabled,true);assert.equal(get('medSaveButton').disabled,false);
 get('medName').value='Changed while uncertain';get('medSalePrice').value='900';get('medManufacturerV5').value='Wrong metadata';
 await c.saveMedication();const writes=calls.filter(x=>x.args?.p_action==='save');
 assert.equal(committed,1);assert.equal(writes.length,2);assert.equal(writes[0].args.p_request_id,writes[1].args.p_request_id);
 assert.deepEqual(writes[0].args.p_payload,writes[1].args.p_payload);assert.equal(writes[1].args.p_payload.manufacturer,'Manufacturer');
 assert.equal(get('medId').value,'new-1');assert.equal(c.inventory[0].sale_price,200);assert.match(get('medPhotoMessage').textContent,/сохранены.*Список не обновился/);
 assert.equal(f.evaluate('medicationDraftV16'),null);
});

test('a missing write result retains the same request ID instead of creating a second medication',async()=>{
 const f=fixture(),{context:c,calls}=f;f.prepare();let first=true;c.loadInventory=async()=>false;
 c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});if(first){first=false;return {data:{}}}return {data:{id:'recorded'}}};
 await c.saveMedication();await c.saveMedication();assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(c.inventory[0].id,'recorded');
});

test('confirmed medication and price save remains successful when the later list refresh throws',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();c.loadInventory=async()=>{throw Error('Load failed')};
 await c.saveMedication();assert.equal(calls.filter(x=>x.args?.p_action==='save').length,1);
 assert.match(get('medPhotoMessage').textContent,/Карточка и цены сохранены/);assert.match(get('medPhotoMessage').textContent,/повторно не нужно/);
 assert.equal(f.evaluate('medicationDraftV16'),null);assert.equal(c.inventory[0].id,'saved-med');assert.equal(c.meds[0].sale_price,200);
});

test('photo upload and attachment retries reuse one path and never repeat the saved card write',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();get('medPhoto').files=[{type:'image/jpeg',size:1000}];c.loadInventory=async()=>false;
 const uploads=[],attachments=[];let uploadLost=true,attachLost=true;
 c.db.storage.from=()=>({upload:async(path,file,options)=>{uploads.push({path,file,options});if(uploadLost){uploadLost=false;throw Error('Load failed')}return {error:{statusCode:'409',message:'The resource already exists'}}}});
 const rpc=c.db.rpc;c.db.rpc=async(name,args)=>{if(name==='manager_medication_details_photo_v1'){attachments.push(structuredClone(args));if(attachLost){attachLost=false;return {error:{message:'Load failed'}}}return {data:null}}return rpc(name,args)};
 await c.saveMedication();assert.match(get('medPhotoMessage').textContent,/Карточка и цены уже сохранены/);assert.match(get('medSaveButton').textContent,/фото/);
 await c.saveMedication();await c.saveMedication();assert.equal(calls.filter(x=>x.args?.p_action==='save').length,1);
 assert.equal(uploads.length,2);assert.equal(uploads[0].path,uploads[1].path);assert.equal(uploads[1].options.upsert,false);
 assert.equal(attachments.length,2);assert.deepEqual(attachments[0],attachments[1]);assert.equal(c.inventory[0].photo_path,uploads[0].path);assert.equal(f.evaluate('medicationDraftV16'),null);
});

test('photo signing failure does not hide the fetched medication list',async()=>{
 const f=fixture(),{context:c}=f;const rows=[{id:'with-photo',name:'Medicine',photo_path:'private/path'}];
 c.db.rpc=async()=>({data:rows});c.signMedicationPhotos=async()=>{throw Error('Load failed')};assert.equal(await c.loadInventory(),true);assert.equal(c.inventory[0].id,'with-photo');
});

test('a late list/signing response cannot replace the new account inventory',async()=>{
 const f=fixture(),{context:c}=f,photo=deferred();c.db.rpc=async()=>({data:[{id:'previous-account'}]});c.signMedicationPhotos=()=>photo.promise;
 const loading=c.loadInventory();await Promise.resolve();await Promise.resolve();await c.signOut();c.currentStaff={id:'manager-b',role:'admin'};c.inventory=[{id:'new-account'}];
 photo.resolve();assert.equal(await loading,false);assert.equal(c.inventory[0].id,'new-account');
});

test('a late save after logout cannot overwrite the next account form or release its active save lock',async()=>{
 const f=fixture(),{context:c,get,calls}=f,old=deferred(),next=deferred();f.prepare();c.loadInventory=async()=>false;
 c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return calls.length===1?old.promise:next.promise};
 const savingOld=c.saveMedication();await c.signOut();c.currentStaff={id:'manager-b',role:'admin'};f.prepare();get('medName').value='Second account medicine';
 const savingNext=c.saveMedication();old.resolve({data:{id:'previous-account-card'}});await savingOld;
 assert.equal(get('medName').value,'Second account medicine');assert.equal(get('medId').value,'');assert.equal(f.evaluate('warehouseBusy'),true);
 next.resolve({data:{id:'next-account-card'}});await savingNext;assert.equal(get('medId').value,'next-account-card');assert.equal(c.inventory[0].name,'Second account medicine');
 assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(f.evaluate('warehouseBusy'),false);
});

test('a save response after navigation never reopens the medication screen',async()=>{
 const f=fixture(),{context:c,get}=f,write=deferred();f.prepare();c.loadInventory=async()=>false;c.db.rpc=()=>write.promise;
 const saving=c.saveMedication();c.quickNavigation4++;c.show('workspace');get('medPhotoMessage').textContent='Other screen state';
 write.resolve({data:{id:'confirmed'}});await saving;assert.equal(get('workspace').classList.contains('active'),true);assert.equal(get('medPhotoMessage').textContent,'Other screen state');assert.equal(get('medId').value,'');assert.equal(c.inventory[0].id,'confirmed');
});

test('pending incoming stock keeps quantity and batch metadata immutable; replay cannot add the party twice',async()=>{
 const f=fixture(),{context:c,get,calls}=f;c.inventory=[{id:'existing',name:'Medicine',units_per_package:5,reserve_qty:0,work_qty:0,active:true}];f.prepare('existing');
 get('receivePackages').value='2';get('receivePrice').value='100';get('receiveExpiry').value='2027-10-12';get('receiveBatchNumberV5').value='B-1';get('receiveSupplierV5').value='Supplier';get('receiveReceivedDateV5').value='2026-10-12';c.loadInventory=async()=>false;
 const receipts=new Map();let parties=0,lost=true;c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});if(!receipts.has(args.p_request_id)){receipts.set(args.p_request_id,{quantity:args.p_payload.packages*5,batch_id:'incoming-batch'});parties++}if(lost){lost=false;return {error:{message:'Load failed'}}}return {data:receipts.get(args.p_request_id)}};
 await c.receiveStock();assert.equal(get('receivePackages').disabled,true);assert.equal(get('receiveButton').disabled,false);
 get('receivePackages').value='9';get('receiveExpiry').value='';get('receiveBatchNumberV5').value='Changed';await c.receiveStock();
 assert.equal(parties,1);assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.deepEqual(calls[0].args.p_payload,calls[1].args.p_payload);assert.equal(calls[1].args.p_payload.batch_number,'B-1');assert.equal(get('receivePackages').value,'');assert.match(get('stockOperationMessage').innerHTML,/Партия добавлена.*повторять операцию не нужно/);
});

test('confirmed stock mutation clears submitted quantity even if list refresh throws',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();get('openingQty').value='10';c.loadInventory=async()=>{throw Error('Load failed')};
 await c.stockMutation('opening',{id:'existing',quantity:10,price:0,expiry:'2027-01-01',location:'reserve'},'Остаток сохранён.');
 assert.equal(get('openingQty').value,'');assert.equal(f.evaluate('stockDraftV16'),null);assert.equal(calls.length,1);assert.match(get('stockOperationMessage').innerHTML,/Остаток сохранён.*повторять операцию не нужно/);
});

test('a rolled-back save unlocks the form and allows a corrected payload with a new request ID',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();c.loadInventory=async()=>false;let first=true;
 c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});if(first){first=false;return {error:{code:'P0001',message:'Исправьте название'}}}return {data:{id:'corrected'}}};
 await c.saveMedication();assert.equal(f.evaluate('medicationDraftV16'),null);assert.equal(get('medName').disabled,false);get('medName').value='Corrected';await c.saveMedication();
 assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(calls[1].args.p_payload.name,'Corrected');
});

test('a definitive optional-photo error does not trap all future medication edits',async()=>{
 const f=fixture(),{context:c,get,calls}=f;f.prepare();get('medPhoto').files=[{type:'image/jpeg',size:100}];c.loadInventory=async()=>false;
 c.db.storage.from=()=>({upload:async()=>({error:{statusCode:'403',message:'Photo denied'}})});
 await c.saveMedication();assert.ok(f.evaluate('medicationDraftV16.result'));c.finishMedicationPhotoV16();
 assert.equal(f.evaluate('medicationDraftV16'),null);assert.match(get('medPhotoMessage').textContent,/Фото можно добавить позже/);
 c.inventory.push({id:'another-med',name:'Other',units_per_package:5,reserve_qty:0,work_qty:0});c.openMedForm('another-med');assert.equal(get('medId').value,'another-med');assert.equal(calls.filter(x=>x.args?.p_action==='save').length,1);
});

test('another medication transfer can never be substituted with an active different-medication draft',async()=>{
 const f=fixture(),{context:c,calls}=f,first=deferred();f.prepare();c.loadInventory=async()=>false;
 c.db.rpc=async(name,args)=>{calls.push({name,args:structuredClone(args)});return calls.length===1?first.promise:{data:{id:args.p_payload.id}}};
 const pending=c.stockMutation('transfer',{id:'first-med',quantity:1},'Сохранено.');
 await c.warehouseRpc('transfer',{id:'second-med',quantity:3},true);assert.equal(calls[1].args.p_payload.id,'second-med');assert.equal(calls[1].args.p_payload.quantity,3);assert.notEqual(calls[0].args.p_request_id,calls[1].args.p_request_id);
 first.resolve({data:{id:'first-med'}});await pending;
});
