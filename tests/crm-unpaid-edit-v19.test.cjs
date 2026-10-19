const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const clone=value=>JSON.parse(JSON.stringify(value));
const {pendingUnpaidRecord,editWithoutReason,automaticUnpaidCharge}=require('../crm-clinical-v10.js');

function fixture(clinical=false){
 const elements=new Map(),calls=[],messages=[];let behavior=async()=>({data:{id:'saved',paid_total:100,debt_total:0}});
 function el(id){
  if(!elements.has(id)){
   const classes=new Set(),button=/Button|Save$/.test(id);
   elements.set(id,{id,tagName:button?'BUTTON':'INPUT',value:'',checked:false,disabled:false,innerHTML:'',textContent:'',dataset:{},
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),toggle(value,state){if(state)classes.add(value);else classes.delete(value);}},
    getAttribute(name){return name==='onclick'?this.onclickText:null;},setAttribute(){},addEventListener(){},
    querySelector(){return el('closeButton');},querySelectorAll(){return [];},
    insertAdjacentHTML(where,text){this.innerHTML+=text;}});
  }
  return elements.get(id);
 }
 const context={console,Map,Set,Date,JSON,Error,TypeError,Number,Math,String,Promise,crypto:require('node:crypto').webcrypto,setTimeout:fn=>queueMicrotask(fn),
  document:{querySelectorAll(selector){if(selector.startsWith('#procedure'))return [el('procNotes'),el('procPatient'),el('procNurse'),el('procSaveButton')];return [];},querySelector:()=>el('procSaveButton')},$:el,
  currentStaff:{id:'nurse-1',role:'nurse'},currentPatientId:'patient-1',shift:{id:'shift-1',aId:'nurse-1',bId:'nurse-2'},patients:[],nurses:[],inventory:[],
  meds:[],services:[{id:'service-1',work_price:100,consumables_price:0}],rows:()=>[],num:value=>Number(value||0),rub:value=>String(Number(value||0))+' ₽',qty:String,unit:()=> 'амп.',esc:String,
  isManager:()=>['owner','admin'].includes(context.currentStaff?.role),positiveWhole:Number,
  message(id,text,success){messages.push({id,text,success});el(id).textContent=text;},show(id){context.screen=id;for(const screen of ['workspace','procedure','sale','report'])el(screen).classList.toggle('active',screen===id);},
  localDateValue:()=> '2026-10-12',shiftLabel:()=> '',expiryDays:()=>null,
  loadInventory:async()=>{},loadQuickContext:async()=>{},openShiftMenu:async()=>{},loadPatients:async()=>{},loadMeds:async()=>{},loadServices:async()=>{},
  prepareTreatment4:async()=>true,addMedRow(){},chooseMedication(){},calcProcedure(){},calcSale(){},enterApp:async()=>{},signOut:async()=>{context.currentStaff=null;},refreshDashboard:async()=>{},
  quickNavigation4:0,quickNavigationCurrent4:(version,actor)=>version===context.quickNavigation4&&actor===context.currentStaff?.id,beginQuickNavigation4:()=>++context.quickNavigation4,
  treatmentRpc:async()=>{},originalSaveTreatment4:async()=>{},saveTreatment:async()=>{},clinicalBusy:false,
  openPatient:async()=>{},renderCabinetHomeV5(){},db:{rpc:async(name,args)=>{calls.push({name,args:clone(args)});return behavior(name,args);}}};
 context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),context);
 vm.runInContext('financeTreatmentMode5.proc={stock_deducted:false,payment_only:true};financeTreatmentMode5.sale={stock_deducted:false,payment_only:true}',context);
 if(clinical){
  const source=fs.readFileSync(__dirname+'/../crm-clinical-v10.js','utf8').replace("})(typeof window === 'object' ? window : globalThis);","global.__clinicalTest16={clinicalRpc,forms,pendingPayments16,actorKey};})(typeof window === 'object' ? window : globalThis);");
  vm.runInContext(source,context);
  context.__clinicalTest16.forms.proc={chargeEdited:false,previous:0,edit:null,medicationPrices:new Map(),servicePrices:new Map()};
 }
 for(const [id,value] of Object.entries({procPaid:'100',procPatient:'patient-1',procNurse:'nurse-1',procService:'service-1',procPaymentStatusV10:'paid',procPayCash:'100',procPayTerminal:'0',procPayOwnerCard:'0',procPayTender:'100'}))el(id).value=value;
 el('procPayConfirmed').checked=true;el('procSaveButton').tagName='BUTTON';el('procSaveButton').onclickText='saveProcedure()';
 if(clinical)context.show('procedure');
 return {c:context,el,calls,messages,setRpc(fn){behavior=fn;}};
}


const edits=f=>f.calls.filter(call=>call.name==='crm_clinical_v10'&&call.args.p_action==='treatment_edit');
function pendingFixture(overrides={}) {
 const f=fixture(true),record={id:'procedure-1',shift_id:'shift-1',version:3,stock_deducted:false,items:[],list_total:100,charge_total:100,paid_total:0,received_total:0,payment_pending:true,...overrides};
 const s=f.c.__clinicalTest16.forms.proc;s.edit=record;s.previous=Math.round(record.paid_total*100);
 f.el('procPaymentStatusV10').value='pending';f.el('procReceivedV10').value='0';f.el('procPayCash').value='0';f.el('procPayTender').value='0';f.el('procPayConfirmed').checked=false;
 f.setRpc(async()=>({data:{...record,version:4,debt_total:record.charge_total}}));return f;
}

test('only wholly unpaid pending snapshots are eligible for comment-free editing',()=>{
 const record={payment_pending:true,paid_total:0,received_total:0,initial_paid_total:0,list_total:100,charge_total:100};
 const model={status:'pending',previous:0,received:0};assert.equal(editWithoutReason(record,model),true);assert.equal(automaticUnpaidCharge(record),true);
 for (const patch of [{payment_pending:false},{paid_total:0.01},{received_total:0.01},{initial_paid_total:0.01},{paid_total:null},{paid_total:'invalid'}])assert.equal(pendingUnpaidRecord({...record,...patch}),false);
 for (const patch of [{status:'debt'},{status:'paid'},{received:1},{previous:1}])assert.equal(editWithoutReason(record,{...model,...patch}),false);
 assert.equal(automaticUnpaidCharge({...record,charge_total:90}),false);
});

test('a reopened unpaid treatment is saved with zero payment and no manually entered comment',async()=>{
 const f=pendingFixture();await f.c.saveTreatment('procedure');assert.equal(edits(f).length,1);assert.equal(f.c.screen,'workspace');
 assert.equal(edits(f)[0].args.p_action,'treatment_edit');assert.equal(edits(f)[0].args.p_payload.edit_reason,null);
 assert.deepEqual(edits(f)[0].args.p_payload.payments,{cash:0,terminal:0,owner_card:0,cash_received:0});assert.equal(edits(f)[0].args.p_payload.paid_total,0);
});

test('comment-free unpaid editing still refuses a new discount with no discount explanation',async()=>{
 const f=pendingFixture();f.el('procPaid').value='90';await f.c.saveTreatment('procedure');assert.equal(edits(f).length,0);assert.match(f.messages.at(-1).text,/почему стоимость отличается от прайса/);
 f.el('procDiscountComment').value='Постоянная скидка разрешена администратором';await f.c.saveTreatment('procedure');assert.equal(edits(f).length,1);
 assert.equal(edits(f)[0].args.p_payload.edit_reason,null);assert.equal(edits(f)[0].args.p_payload.discount_comment,'Постоянная скидка разрешена администратором');
});

test('a later partial receipt requires an edit reason even when the initial receipt was zero',async()=>{
 const f=pendingFixture({paid_total:20,received_total:20,initial_paid_total:0});await f.c.saveTreatment('procedure');assert.equal(edits(f).length,0);assert.match(f.messages.at(-1).text,/что изменили/);
 f.el('procEditReasonV10').value='Уточнено назначение после оплаты';await f.c.saveTreatment('procedure');assert.equal(edits(f).length,1);assert.equal(edits(f)[0].args.p_payload.edit_reason,'Уточнено назначение после оплаты');
});

test('an ambiguous comment-free edit replays the original payload and UUID after fields change',async()=>{
 const f=pendingFixture();let attempts=0;f.setRpc(async()=>++attempts===1?{error:{code:'08006',message:'Connection lost'},status:503}:{data:{id:'procedure-1',paid_total:0,debt_total:100}});
 await f.c.saveTreatment('procedure');assert.equal(f.el('procNotes').disabled,true);f.el('procPaid').value='80';f.el('procEditReasonV10').value='Changed after transport failure';
 await f.c.saveTreatment('procedure');assert.equal(edits(f).length,2);assert.deepEqual(edits(f)[0].args,edits(f)[1].args);assert.equal(edits(f)[1].args.p_payload.edit_reason,null);
});
