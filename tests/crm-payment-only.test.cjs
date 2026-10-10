const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test');

function harness(paymentOnly=true){
 const elements=new Map(),calls=[],messages=[];
 function el(id){if(!elements.has(id)){const classes=new Set();elements.set(id,{id,value:'',checked:false,readOnly:false,disabled:false,innerHTML:'',textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,state){if(state??!classes.has(x))classes.add(x);else classes.delete(x)}},querySelectorAll:()=>[],querySelector:()=>el('closeButton')});}return elements.get(id);}
 const c={console,Map,Set,Date,JSON,Error,Number,Math,String,Promise,crypto:require('node:crypto').webcrypto,document:{querySelectorAll:()=>[]},$:el,window:{},
  currentStaff:{id:'n1',role:'nurse'},shift:{id:'s1'},patients:[],nurses:[],inventory:[],items:[{medication_id:'m1',quantity:2}],
  meds:[{id:'m1',name:'Препарат из прайса',sale_price:20,work_qty:0,active:true}],services:[{id:'service',name:'Услуга',work_price:100,consumables_price:50}],
  mode:paymentOnly,modeError:null,saveBehavior:null,rows:()=>c.items,
  esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),num:v=>Number(v||0),qty:v=>String(v||0),rub:v=>String(Number(v||0))+' ₽',unit:()=> 'амп.',isManager:()=>['owner','admin'].includes(c.currentStaff?.role),
  positiveWhole:v=>{if(!Number.isInteger(Number(v))||Number(v)<=0)throw Error('Количество');return Number(v)},nonnegative:v=>{if(v===''||Number(v)<0)throw Error('Оплата');return Number(v)},
  message:(...args)=>messages.push(args),show:id=>{for(const s of ['workspace','procedure','sale','report'])el(s).classList.toggle('active',s===id)},localDateValue:()=> '2026-10-09',shiftLabel:()=> '08:30–16:00',expiryDays:()=>null,
  loadInventory:async()=>{},loadQuickContext:async()=>{},openShiftMenu:async()=>{},prepareTreatment4:async()=>true,calcProcedure:()=>{el('procPaid').value='190.00'},calcSale:()=>{el('salePaid').value='40.00'},enterApp:async()=>{},signOut:async()=>{c.currentStaff=null},refreshDashboard:async()=>{},
  db:{rpc:async(name,args)=>{calls.push({name,args});if(name==='crm_finance_v5'&&args.p_action==='accounting_mode')return c.modeError?{error:c.modeError}:{data:{payment_only:c.mode,stock_deducted:!c.mode}};if(name==='record_treatment_v5')return c.saveBehavior?c.saveBehavior(args):{data:{id:'saved',stock_deducted:args.p_payload.expected_stock_deducted,paid_total:args.p_payload.paid_total,payments:args.p_payload.payments}};return {data:{}};}},saveProcedure:null,saveSale:null,bulkImportMeds:null};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../workflow-v3.js','utf8'),c);c.originalSaveTreatment4=c.saveTreatment;vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),c);
 async function form(kind='procedure',total=190){const prefix=kind==='procedure'?'proc':'sale';await c.prepareTreatment4(kind,'p1');el(prefix+'Paid').value=String(total);el(prefix+'Nurse').value='n1';el(prefix+'Patient').value='p1';el('procService').value='service';c.resetPaymentV5(prefix);el(prefix+'PayConfirmed').checked=true;c.show(kind);}
 return {c,el,calls,messages,form};
}

test('zero-stock price catalogue procedure is billed with explicit mode and exact payment allocation',async()=>{
 const {c,el,calls,messages,form}=harness();await form();
 c.selectPaymentMethodV5('proc','mixed');el('procPayCash').value='40';el('procPayTerminal').value='50';el('procPayOwnerCard').value='100';el('procPayTender').value='200';el('procPayConfirmed').checked=true;
 await c.saveProcedure();const saved=calls.filter(x=>x.name==='record_treatment_v5');assert.equal(saved.length,1);
 assert.equal(saved[0].args.p_payload.expected_stock_deducted,false);assert.deepEqual(JSON.parse(JSON.stringify(saved[0].args.p_payload.payments)),{cash:40,terminal:50,owner_card:100,cash_received:200});
 assert.equal(c.meds[0].work_qty,0);assert.equal(el('workspace').classList.contains('active'),true);assert.ok(messages.some(x=>/Остатки склада не изменены/.test(x[1])));
});

test('duplicate rows cannot bypass tracked stock, and unknown price or archived card cannot enter payment-only billing',async()=>{
 const {c,calls,messages,form}=harness(false);c.meds[0].work_qty=3;c.items=[{medication_id:'m1',quantity:2},{medication_id:'m1',quantity:2}];await form('sale',80);await c.saveSale();assert.equal(calls.filter(x=>x.name==='record_treatment_v5').length,0);assert.ok(messages.some(x=>/Недостаточно/.test(x[1])));
 c.mode=true;c.items=[{medication_id:'m1',quantity:1}];c.meds[0].sale_price=0;await form('sale',0);await c.saveSale();assert.equal(calls.filter(x=>x.name==='record_treatment_v5').length,0);assert.ok(messages.some(x=>/не указана цена/.test(x[1])));
 c.meds[0].sale_price=20;c.meds[0].active=false;await form('sale',20);await c.saveSale();assert.equal(calls.filter(x=>x.name==='record_treatment_v5').length,0);assert.ok(messages.some(x=>/недоступен/.test(x[1])));
});

test('open form retains mode on server switch; transport retry keeps identity and authoritative receipt mode',async()=>{
 const {c,el,calls,messages,form}=harness();await form('sale',40);c.currentStaff.role='owner';el('saleReserveV5').checked=true;
 c.saveBehavior=async()=>({error:{message:'Ответ сервера потерян'}});await c.saveSale();assert.equal(Number(el('salePaid').value),40);assert.equal(el('salePayConfirmed').checked,true);
 c.mode=false;c.setAccountingModeV5({payment_only:false});
 c.saveBehavior=async args=>({data:{id:'committed-before-switch',stock_deducted:false,paid_total:40,payments:args.p_payload.payments}});await c.saveSale();
 const saves=calls.filter(x=>x.name==='record_treatment_v5');assert.equal(saves.length,2);assert.equal(saves[0].args.p_request_id,saves[1].args.p_request_id);assert.equal(saves[1].args.p_payload.expected_stock_deducted,false);assert.equal(saves[1].args.p_payload.reserve_sale,undefined);assert.ok(messages.some(x=>/Остатки склада не изменены/.test(x[1])));
});

test('stale mode rejection and mode lookup failure preserve form and block unsafe writes',async()=>{
 const {c,el,calls,messages,form}=harness();await form('sale',40);
 c.saveBehavior=async()=>({error:{code:'P0001',message:'Режим учёта изменился. Откройте форму заново.'}});await c.saveSale();assert.equal(Number(el('salePaid').value),40);assert.equal(el('salePayConfirmed').checked,true);assert.ok(messages.some(x=>/Режим учёта изменился/.test(x[1])));
 c.modeError={message:'Нет ответа при проверке режима'};await assert.rejects(c.prepareTreatment4('sale','p1'),/проверке режима/);assert.equal(calls.filter(x=>x.name==='record_treatment_v5').length,1);
});

test('report marker is escaped and never grants nurse finance visibility',()=>{
 const {c,el}=harness();const r={shift:{date:'2026-10-09',status:'open'},staff:[{id:'n1',full_name:'Медсестра',amount:2000}],patients_count:1,procedures_count:1,sales_count:0,revenue:{total:7777,cash:7777},payroll_total:2000,cash_after_salary:5777,
  used:[],untracked:[{id:'m1',name:'<script>Препарат',quantity:2,procedure_qty:2,sale_qty:0,unit:'амп.'}],warnings:[{type:'payment_only',count:1}],payment_only_procedures_count:1,payment_only_sales_count:0,stock:[{name:'Препарат',work:0,reserve:9999}],
  procedures:[{id:'p1',at:'2026-10-09T10:00:00Z',patient:'Пациент',type:'Услуга',stock_deducted:false,paid_total:7777,items:[{name:'Препарат',quantity:2,line_total:7777}]}],sales:[]};
 c.renderShiftReportV5(r);const html=el('reportBody').innerHTML;assert.ok(html.includes('Без списания со склада'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 for(const secret of ['7777','2000','5777','9999'])assert.ok(!html.includes(secret),'Nurse report leaked '+secret);
});
