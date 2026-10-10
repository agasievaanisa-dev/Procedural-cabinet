const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();
function el(id){
 if(!elements.has(id)){
  const classes=new Set();
  elements.set(id,{id,value:'',checked:false,readOnly:false,disabled:false,innerHTML:'',textContent:'',
   classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,state){if(state??!classes.has(x))classes.add(x);else classes.delete(x)}},
   querySelectorAll:()=>[],querySelector:()=>el('closeButton'),insertAdjacentHTML(where,s){this.innerHTML=s+this.innerHTML}});
 }
 return elements.get(id);
}
const calls=[],messages=[];let behavior=async()=>({data:{id:'saved'}});
const c={console,Map,Set,Date,JSON,Error,Number,Math,String,Promise,crypto:require('node:crypto').webcrypto,
 document:{querySelectorAll:()=>[]},$:el,window:{},
 currentStaff:{id:'n1',role:'owner'},shift:{id:'s1'},patients:[],nurses:[],inventory:[],
 meds:[{id:'m1',name:'Препарат',sale_price:10,work_qty:20}],services:[{id:'service',name:'Услуга',work_price:100,consumables_price:0}],items:[{medication_id:'m1',quantity:2}],
 rows:()=>c.items,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 num:v=>Number(v||0),qty:v=>String(v||0),rub:v=>String(Number(v||0))+' ₽',unit:()=> 'амп.',isManager:()=>['owner','admin'].includes(c.currentStaff?.role),
 positiveWhole:v=>{if(!Number.isInteger(Number(v))||Number(v)<=0)throw Error('Количество');return Number(v)},
 nonnegative:v=>{if(v===''||Number(v)<0)throw Error('Оплата');return Number(v)},
 message:(...args)=>messages.push(args),show:id=>{for(const s of ['workspace','procedure','sale','report'])el(s).classList.toggle('active',s===id)},
 localDateValue:()=> '2026-10-06',shiftLabel:()=> '08:30–16:00',expiryDays:()=>null,loadInventory:async()=>{},loadQuickContext:async()=>{},openShiftMenu:async()=>{},
 prepareTreatment4:async()=>true,calcProcedure:()=>{el('procPaid').value='120.00'},calcSale:()=>{el('salePaid').value='20.00'},
 enterApp:async()=>{},signOut:async()=>{c.currentStaff=null},refreshDashboard:async()=>{},
 db:{rpc:async(name,args)=>{if(name==='crm_finance_v5'&&args.p_action==='accounting_mode')return {data:{payment_only:false,stock_deducted:true}};calls.push({name,args});if(name==='crm_finance_v5')return {data:{shift:{status:'open'},revenue:{total:120}}};return behavior(args)}},
 saveProcedure:null,saveSale:null,bulkImportMeds:null};
vm.createContext(c);
vm.runInContext(fs.readFileSync(__dirname+'/../workflow-v3.js','utf8'),c);
c.originalSaveTreatment4=c.saveTreatment;
vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
function payment(prefix,total){
 el(prefix+'Paid').value=String(total);el(prefix+'Nurse').value='n1';el(prefix+'Patient').value='p1';el('procService').value='service';
 c.resetPaymentV5(prefix);el(prefix+'PayConfirmed').checked=true;
}
(async()=>{
 await c.prepareTreatment4('procedure');await c.prepareTreatment4('sale');
 assert.equal(c.financeCentsV5('10,02'),1002);assert.equal(c.financeCentsV5('0.30'),30);
 for(const invalid of ['','-1','0.001','NaN','Infinity','1e2'])assert.throws(()=>c.financeCentsV5(invalid));
 payment('proc',120);el('procPayConfirmed').checked=false;
 assert.throws(()=>c.readPaymentsV5('proc'),/подтверждение/);
 el('procPayConfirmed').checked=true;assert.equal(c.readPaymentsV5('proc').cash,120);
 c.selectPaymentMethodV5('proc','mixed');el('procPayCash').value='20.10';el('procPayTerminal').value='39.90';el('procPayOwnerCard').value='60.00';
 c.paymentEditedV5('proc');assert.equal(el('procPayTender').value,'20.10');
 el('procPayTender').value='50.00';c.paymentEditedV5('proc',true);el('procPayConfirmed').checked=true;
 const split=c.readPaymentsV5('proc');assert.equal(split.cash_received-split.cash,29.9);assert.equal(split.cash+split.terminal+split.owner_card,120);
 el('procPayOwnerCard').value='59.99';assert.throws(()=>c.readPaymentsV5('proc'),/ровно/);
 el('procPayOwnerCard').value='60';el('procPayTender').value='20';assert.throws(()=>c.readPaymentsV5('proc'),/меньше/);
 payment('proc',120);behavior=async()=>({error:{message:'Connection lost'}});
 await assert.rejects(c.treatmentRpc('procedure',{paid_total:120}),/Connection lost/);
 behavior=async()=>({data:{id:'saved'}});await c.treatmentRpc('procedure',{paid_total:120});
 assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id,'Response loss must reuse request UUID');
 assert.equal(calls[1].name,'record_treatment_v5');assert.equal(calls[1].args.p_payload.payments.cash,120);
 payment('proc',120);c.show('procedure');let release;behavior=()=>new Promise(resolve=>release=resolve);
 const first=c.saveProcedure();await c.saveProcedure();assert.equal(calls.filter(x=>x.name==='record_treatment_v5').length,3,'Concurrent clicks make one save');
 release({data:{id:'saved'}});await first;assert.equal(el('procPaid').value,'');assert.equal(el('workspace').classList.contains('active'),true);
 payment('sale',20);behavior=async()=>({error:{code:'P0001',message:'Недостаточно'}});c.show('sale');await c.saveSale();
 assert.equal(el('salePaid').value,'20','Server failure preserves payment editor');assert.equal(el('salePayConfirmed').checked,true);
 c.items=[{medication_id:'m1',quantity:12},{medication_id:'m1',quantity:12}];payment('sale',240);const before=calls.length;await c.saveSale();
 assert.equal(calls.length,before,'Repeated medication rows cannot bypass available quantity');
 el('saleReserveV5').checked=true;behavior=async()=>({data:{id:'reserve-sale'}});await c.saveSale();
 const reserve=calls.filter(x=>x.name==='record_treatment_v5').at(-1);assert.equal(reserve.args.p_payload.reserve_sale,true);
 c.currentStaff.role='nurse';c.items=[{medication_id:'m1',quantity:2}];payment('proc',1);c.calcProcedure();
 assert.equal(el('procPaid').value,'120.00');assert.equal(el('procPaid').readOnly,true);
 const report={shift:{date:'2026-10-06',status:'open'},staff:[{id:'n1',full_name:'<script>name',amount:2000}],patients_count:1,procedures_count:1,sales_count:1,
  revenue:{cash:9999,terminal:22,owner_card:33,total:10054},payroll_total:2000,cash_after_salary:8054,
  procedures:[{at:'2026-10-06T10:00:00Z',patient:'<img src=x onerror=alert(1)>',paid_total:777,type:'Укол',items:[{name:'Ампула',quantity:1,line_total:777}]}],
  stock:[{name:'Препарат',work:2,reserve:99999}],used:[]};
 c.renderShiftReportV5(report);const nurseHtml=el('reportBody').innerHTML;
 for(const secret of ['9999','10054','2000','8054','99999','777','Зарплата','выручка'])assert.ok(!nurseHtml.includes(secret),'Nurse report leaks '+secret);
 assert.ok(nurseHtml.includes('&lt;img'));assert.ok(!nurseHtml.includes('<script>'));
 const ownerCallCount=calls.length;await c.openReportsV5();assert.equal(calls.length,ownerCallCount,'Nurse cannot request owner summary');
 c.currentStaff.role='owner';c.renderShiftReportV5(report);assert.ok(el('reportBody').innerHTML.includes('2000'));assert.ok(el('reportBody').innerHTML.includes('Денежный остаток после выплаты зарплаты'));
 const unknown={...report,cash_after_salary:null,payroll_unknown:1,payroll_complete:false,staff:[{id:'n1',full_name:'Наталья',amount:null}]};
 c.renderShiftReportV5(unknown);assert.ok(el('reportBody').innerHTML.includes('Не задана'));assert.ok(el('reportBody').innerHTML.includes('Не рассчитан: укажите зарплату за прошлые смены'));
 assert.ok(c.renderFinanceSummaryV5({...unknown,rows:[],shifts:[]},'reportsV5').includes('Не рассчитан: укажите зарплату за прошлые смены'));
 assert.ok(c.buildFinanceCsvV5(unknown).includes('Не рассчитан: укажите зарплату за прошлые смены'));
 const csv=c.buildFinanceCsvV5({from:'2026-10-01',to:'2026-10-06',revenue:{total:10},rows:[{label:'=IMPORTXML("x")',revenue:{total:10}}]});
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=IMPORTXML(""x"")"'));assert.ok(csv.includes('Денежный остаток после выплаты зарплаты'));
 assert.ok(messages.some(x=>x[1]==='Недостаточно'));
 console.log('PASS: exact payment cents/splits/tender, explicit confirmation, replay and concurrent-save guards, preserved failed editor, duplicate stock checks, owner reserve-sale, nurse report/price separation, escaped names and CSV formula safety');
})().catch(error=>{console.error(error);process.exitCode=1});
