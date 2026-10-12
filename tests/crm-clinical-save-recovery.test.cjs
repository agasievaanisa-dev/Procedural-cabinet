const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const clone=value=>JSON.parse(JSON.stringify(value));
const {mergeServices,paymentModel}=require('../crm-clinical-v10.js');

test('the same procedure selected as primary and additional is saved once with its full quantity',()=>{
 assert.deepEqual(mergeServices([{service_id:'im',quantity:1},{service_id:'iv',quantity:1},{service_id:'im',quantity:2},{service_id:'',quantity:0}]),[{service_id:'im',quantity:3},{service_id:'iv',quantity:1}]);
 assert.throws(()=>mergeServices([{service_id:'im',quantity:0.5}]),/Количество процедур/);
});
test('removing medicines cannot leave a charge above the remaining list price',()=>{
 assert.throws(()=>paymentModel({list:'100',charge:'150',received:'150',status:'paid',patient:'patient',reason:'Changed'}),/превышает.*по прайсу/);
});

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
  message(id,text,success){messages.push({id,text,success});el(id).textContent=text;},show(id){context.screen=id;},
  localDateValue:()=> '2026-10-12',shiftLabel:()=> '',expiryDays:()=>null,
  loadInventory:async()=>{},loadQuickContext:async()=>{},openShiftMenu:async()=>{},loadPatients:async()=>{},loadMeds:async()=>{},loadServices:async()=>{},
  prepareTreatment4:async()=>true,calcProcedure(){},calcSale(){},enterApp:async()=>{},signOut:async()=>{context.currentStaff=null;},refreshDashboard:async()=>{},
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
 return {c:context,el,calls,messages,setRpc(fn){behavior=fn;}};
}

test('a lost new-treatment response freezes the original payment and UUID despite changed input',async()=>{
 const f=fixture();let attempts=0;
 f.setRpc(async()=>++attempts===1?{error:{message:'Load failed',uncertain:true},status:0}:{data:{id:'saved'}});
 const original={patient_id:'patient-1',paid_total:100,payments:{cash:100,terminal:0,owner_card:0,cash_received:100},notes:'Original'};
 await assert.rejects(f.c.treatmentRpc('procedure',original),error=>error.uncertain===true);
 f.el('procPayCash').value='900';f.el('procPayConfirmed').checked=false;
 await f.c.treatmentRpc('procedure',{...original,paid_total:900,notes:'Changed'});
 assert.deepEqual(f.calls[0].args,f.calls[1].args);
 assert.equal(f.calls[1].args.p_payload.paid_total,100);
});

test('a later explicit error cannot discard the UUID of an earlier ambiguous save',async()=>{
 const f=fixture();let attempts=0;
 f.setRpc(async()=>++attempts===1?{error:{code:'08006',message:'Connection lost'},status:503}:attempts===2?{error:{code:'P0001',message:'Record changed'},status:400}:{data:{id:'saved'}});
 const payload={paid_total:100,payments:{cash:100,terminal:0,owner_card:0,cash_received:100}};
 await assert.rejects(f.c.treatmentRpc('procedure',payload),error=>error.code==='08006'&&error.status===503&&error.uncertain===true);
 await assert.rejects(f.c.treatmentRpc('procedure',payload),error=>error.code==='P0001'&&error.uncertain===true);
 await f.c.treatmentRpc('procedure',payload);
 assert.equal(new Set(f.calls.map(call=>call.args.p_request_id)).size,1);
});

test('clinical edits lock the uncertain draft and replay the original snapshot even after DOM changes',async()=>{
 const f=fixture(true);let attempts=0;
 f.c.__clinicalTest16.forms.proc.edit={id:'procedure-1',shift_id:'shift-1',version:3,stock_deducted:false,items:[]};
 f.el('procEditReasonV10').value='Correction';f.el('procNotes').value='Original';
 f.setRpc(async()=>++attempts===1?{error:{message:'Load failed',uncertain:true},status:0}:{data:{id:'procedure-1',paid_total:100,debt_total:0}});
 await f.c.saveTreatment('procedure');assert.equal(f.el('procNotes').disabled,true);assert.equal(f.el('procSaveButton').disabled,false);
 f.el('procNotes').value='Changed';f.el('procPatient').value='another-patient';f.el('procPaid').value='900';
 await f.c.saveTreatment('procedure');assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(f.c.screen,'workspace');
});

test('an uncertain later payment freezes amount, method and comment and reuses the receipt UUID',async()=>{
 const f=fixture(true);let attempts=0;
 Object.assign(f.el('debtPaymentV10').dataset,{kind:'procedure',recordId:'procedure-1',debt:'100',patientId:'patient-1'});
 const fields=[f.el('debtAmountV10'),f.el('debtMethodV10'),f.el('debtTenderV10'),f.el('debtNoteV10'),f.el('debtConfirmV10'),f.el('debtSaveButton')];
 f.el('debtPaymentV10').querySelectorAll=()=>fields;f.el('debtSaveButton').tagName='BUTTON';
 f.el('debtAmountV10').value='50';f.el('debtMethodV10').value='cash';f.el('debtTenderV10').value='50';f.el('debtNoteV10').value='Original';f.el('debtConfirmV10').checked=true;
 f.setRpc(async()=>++attempts===1?{error:{message:'Load failed',uncertain:true},status:0}:{data:{id:'receipt-1',debt_total:50}});
 await f.c.saveDebtPaymentV10();assert.equal(f.el('debtAmountV10').disabled,true);assert.equal(f.el('debtSaveButton').disabled,false);
 f.el('debtAmountV10').value='90';f.el('debtMethodV10').value='terminal';f.el('debtNoteV10').value='Changed';f.el('debtConfirmV10').checked=false;
 await f.c.saveDebtPaymentV10();assert.deepEqual(f.calls[0].args,f.calls[1].args);assert.equal(f.c.__clinicalTest16.pendingPayments16.size,0);
});

test('a confirmed payment whose patient refresh fails reports saved money on an existing screen',async()=>{
 const f=fixture(true);Object.assign(f.el('debtPaymentV10').dataset,{kind:'procedure',recordId:'procedure-1',debt:'100',patientId:'patient-1'});
 f.el('debtAmountV10').value='50';f.el('debtMethodV10').value='cash';f.el('debtTenderV10').value='50';f.el('debtConfirmV10').checked=true;
 f.setRpc(async()=>({data:{id:'receipt-1',debt_total:50}}));f.c.openPatient=async()=>{throw Error('Refresh failed');};
 await f.c.saveDebtPaymentV10();const last=f.messages.at(-1);
 assert.equal(last.id,'homeMessage');assert.match(last.text,/Оплата сохранена.*Не удалось обновить экран/);assert.equal(f.c.screen,'workspace');assert.equal(f.calls.length,1);
});

test('a closed shift remains visibly confirmed if refreshing the shift menu fails',async()=>{
 const f=fixture();vm.runInContext("financeReportId5='shift-1'",f.c);
 f.c.renderShiftReportV5=()=>{};f.c.loadQuickContext=async()=>{throw Error('Refresh failed');};f.setRpc(async()=>({data:{shift:{id:'shift-1',status:'closed'}}}));
 await f.c.closeShift();assert.equal(f.c.shift,null);assert.match(f.el('reportBody').innerHTML,/Смена закрыта.*Не удалось обновить экран/);assert.equal(f.calls.length,1);
});

test('read recovery is not doubled after the shared transport has exhausted its retry',async()=>{
 const f=fixture();f.setRpc(async()=>({error:{message:'Load failed',recoveryAttemptedV16:true},status:0}));
 await assert.rejects(f.c.crmFinanceRpcV5('summary'),error=>error.recoveryAttemptedV16===true);assert.equal(f.calls.length,1);
});
