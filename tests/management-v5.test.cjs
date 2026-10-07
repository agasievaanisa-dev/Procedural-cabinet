const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');

function setup(){
  const elements=new Map(),notices=[],calls=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',checked:false,classList:{add(){},remove(){},contains(){return false}},querySelectorAll(){return []},scrollIntoView(){}});return elements.get(id)};
  const c={console,Number,String,Date,Intl,Set,Map,JSON,Math,Error,Promise,Blob,setTimeout,$:el,currentStaff:{id:'owner1',role:'owner'},services:[{id:'service1',name:'Капельница',work_price:500,consumables_price:100}],serviceRows:[],serviceSaving:false,meds:[{id:'m1',name:'Самыр',sale_price:20,active:true,consumption_unit:'амп.'}],inventory:[],
    esc:s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),qty:v=>String(v),unit:m=>m.consumption_unit||'ед.',num:v=>Number(v||0),rub:v=>v+' ₽',normalizeSearch:s=>String(s||'').toLowerCase().trim(),matchesMedication:()=>true,
    isManager(){return ['owner','admin'].includes(c.currentStaff?.role)},message(id,value){notices.push({id,value})},loadNurses:async()=>{},signOut:async()=>{c.currentStaff=null},prepareTreatment4:async()=>true,warehouseRpc:async()=>[],loadStockDetails:async()=>{},openMedForm(){},localDateValue:()=>'2026-10-06',calcProcedure(){calls.push({type:'calculate'})},recalc(){calls.push({type:'recalculate'})},addMedRow(target,id,quantity,fallback){calls.push({type:'add',target,id,quantity,fallback})},
    db:{async rpc(name,args){calls.push({name,args});return {data:[],error:null}},functions:{async invoke(name,args){calls.push({name,args});return {data:{staff:{id:'newstaff'}},error:null}}}}};
  vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-management-v5.js','utf8'),c);
  return {c,el,notices,calls};
}

test('management blocks nurse writes and sends create passwords only to secured Edge Function',async()=>{
  const {c,el,calls,notices}=setup();c.currentStaff={id:'nurse1',role:'nurse'};
  await c.saveStaffV5();await c.createStaffAccountV5();assert.equal(calls.length,0);assert.match(notices.at(-1).value,/владельцу/);
  c.currentStaff={id:'owner1',role:'owner'};el('staffCreateNameV5').value='Амина';el('staffCreateEmailV5').value='amina@example.com';el('staffCreatePasswordV5').value='too-short';
  await c.createStaffAccountV5();assert.equal(calls.length,0);assert.match(notices.at(-1).value,/12 до 128/);
  el('staffCreatePasswordV5').value='long-secret-password';await c.createStaffAccountV5();
  assert.equal(calls[0].name,'crm-admin');assert.equal(calls[0].args.body.action,'create_staff');assert.equal(calls[0].args.body.role,'nurse');assert.equal(calls[0].args.body.password,'long-secret-password');
  assert.equal(el('staffCreatePasswordV5').value,'');assert.ok(calls.filter(x=>x.args?.p_payload).every(x=>!('password' in x.args.p_payload)));
});

test('template fills an editable draft with current prices and leaves notes unchanged',()=>{
  const {c,el,calls}=setup();vm.runInContext("managementTemplatesV5=[{name:'Шаблон',service_id:'service1',items:[{medication_id:'m1',quantity:2},{medication_id:'missing',quantity:1}]}]",c);
  el('procTemplateSelectV5').value='0';el('procNotes').value='Назначение врача';c.applyProcedureTemplateV5();
  assert.equal(el('procService').value,'service1');assert.equal(el('procMeds').innerHTML,'');assert.equal(el('procNotes').value,'Назначение врача');
  assert.equal(calls.filter(x=>x.type==='add')[0].quantity,2);assert.equal(calls.filter(x=>x.type==='add')[1].fallback.name,'Препарат из шаблона недоступен');
  assert.equal(calls.filter(x=>x.type==='calculate').length,1);assert.ok(calls.every(x=>!x.name));
});

test('template validation rejects empty medication and nonpositive or inactive doses',()=>{
  const {c,el}=setup();el('templateNameV5').value='Капельница';el('templateIdV5').value='';el('templateServiceV5').value='service1';el('templateNotesV5').value='';el('templateActiveV5').checked=true;
  const selection={value:'m1'},amount={value:'2'};el('templateItemsV5').querySelectorAll=()=>[{querySelector:tag=>tag==='select'?selection:amount}];
  assert.equal(c.templatePayloadV5().items[0].quantity,2);amount.value='0.5';assert.throws(()=>c.templatePayloadV5(),/целым числом/);amount.value='0';assert.throws(()=>c.templatePayloadV5(),/больше нуля/);amount.value='Infinity';assert.throws(()=>c.templatePayloadV5(),/больше нуля/);amount.value='1';selection.value='';assert.throws(()=>c.templatePayloadV5(),/каждой строке/);selection.value='m1';c.meds[0].active=false;assert.throws(()=>c.templatePayloadV5(),/недоступный/);
});

test('audit escapes names, reasons and before/after values, and renders field labels',()=>{
  const {c,el}=setup();vm.runInContext("managementAuditV5=[{actor_name:'<script>',action:'update',entity_type:'service',reason:'<img onerror=alert(1)>',before_data:{name:'<iframe>',work_price:1},after_data:{name:'<svg>'}}]",c);
  c.renderAuditV5();const html=el('auditListV5').innerHTML;assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;iframe&gt;'));assert.ok(html.includes('Работа, ₽'));assert.ok(!/<script>|<img |<iframe>|<svg>/.test(html));
  el('auditSearchV5').value='не найдено';c.renderAuditV5();assert.match(el('auditListV5').innerHTML,/не найдено/);
});

test('money validation and RPC error propagation prevent invalid management writes',async()=>{
  const {c,calls}=setup();assert.equal(c.managementMoneyV5('50000','Фонд'),50000);assert.throws(()=>c.managementMoneyV5('-1','Фонд'),/от нуля/);assert.throws(()=>c.managementMoneyV5('12.345','Фонд'),/копейки/);
  await c.crmManagementRpcV5('audit_list',{limit:200});assert.equal(calls[0].name,'crm_management_v5');assert.equal(calls[0].args.p_action,'audit_list');assert.equal(calls[0].args.p_payload.limit,200);
  c.db.rpc=async()=>({error:{message:'Нет доступа'}});await assert.rejects(c.crmManagementRpcV5('backup_export'),/Нет доступа/);
});

test('warehouse metadata joins the same mutation, validates receipt date, and stays out of bulk import',()=>{
  const {c,el}=setup();el('medForm').classList.contains=()=>true;el('medId').value='m1';el('medManufacturerV5').value=' Производитель ';el('medReleaseFormV5').value='Раствор';el('medCommentV5').value='';
  const medication=c.warehouseExtraPayloadV5('save',{id:'m1',name:'Самыр'},true);assert.equal(medication.manufacturer,'Производитель');assert.equal(medication.release_form,'Раствор');assert.equal(medication.comment,null);
  el('receiveBatchNumberV5').value='N-17';el('receiveSupplierV5').value='Склад';el('receiveReceivedDateV5').value='2026-10-05';
  const batch=c.warehouseExtraPayloadV5('receive',{id:'m1',packages:2},true);assert.equal(batch.batch_number,'N-17');assert.equal(batch.supplier,'Склад');assert.equal(batch.received_date,'2026-10-05');
  el('receiveReceivedDateV5').value='2026-10-07';assert.throws(()=>c.warehouseExtraPayloadV5('receive',{id:'m1'},true),/в будущем/);
  el('medForm').classList.contains=()=>false;const imported=c.warehouseExtraPayloadV5('save',{name:'Другой препарат'},true);assert.ok(!('manufacturer' in imported));
  assert.ok(c.matchesMedication({name:'Самыр',manufacturer:'Производитель',dosage:'400 мг'},'Производитель 400'));assert.ok(!c.matchesMedication({name:'Самыр',manufacturer:'Производитель',dosage:'400 мг'},'500'));
});
