const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const {webcrypto}=require('node:crypto');
function harness(role='nurse'){
 const nodes=new Map(),writes=[],notices=[],installed=[];
 const el=id=>{if(!nodes.has(id)){const classes=new Set(id==='templatesV5'?['active']:['hidden']);nodes.set(id,{id,value:'',checked:false,innerHTML:'',disabled:false,textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x)}},querySelector:()=>null,querySelectorAll:()=>[],setAttribute(){},scrollIntoView(){},remove(){}})}return nodes.get(id)};
 const c={console,crypto:webcrypto,Number,String,Date,Intl,Set,Map,JSON,Math,Error,Promise,Blob,setTimeout,$:el,quickNavigation4:1,currentStaff:{id:'actor1',role,active:true},services:[{id:'service1',active:true,name:'Капельница',work_price:500,consumables_price:100}],serviceRows:[],serviceSaving:false,meds:[{id:'med1',active:true,name:'Самыр',consumption_unit:'амп.',sale_price:2500}],inventory:[],warehouseBusy:false,
 esc:s=>String(s??''),qty:s=>String(s),unit:m=>m.consumption_unit||'ед.',num:v=>Number(v||0),rub:v=>v+' ₽',normalizeSearch:s=>String(s||'').toLowerCase(),matchesMedication:()=>true,
 isManager:()=>['owner','admin'].includes(c.currentStaff?.role),message:(id,value,success)=>notices.push({id,value,success}),show(){},loadNurses:async()=>{},loadServices:async()=>{},loadMeds:async()=>{},loadInventory:async()=>{},signOut:async()=>{c.currentStaff=null},prepareTreatment4:async()=>true,warehouseRpc:async()=>[],loadStockDetails:async()=>{},openMedForm(){},localDateValue:()=>'2026-10-13',calcProcedure(){},recalc(){},addMedRow(){},
 CrmClinicalV10:{templateState:()=>({ready:true,locked:false}),applyTemplate:(template,mode)=>installed.push({template,mode})},
 db:{rpc:async(name,args,options)=>{writes.push({name,args:JSON.parse(JSON.stringify(args)),options});return {data:args.p_action==='template_save'?{...args.p_payload,id:'template1'}:[]}},functions:{invoke:async()=>({data:{}})}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../crm-management-v5.js','utf8'),c);
 const value=code=>vm.runInContext(code,c);
 function form(dose='400 мг'){
  el('templateNameV5').value='Общий образец';el('templateServiceV5').value='service1';el('templateActiveV5').checked=true;
  const medication={value:'med1'},quantity={value:'2'},doseInput={value:dose};el('templateItemsV5').querySelectorAll=()=>[{querySelector:s=>s==='select'?medication:s==='.template-dose-input-v24'?doseInput:quantity}];return {medication,quantity,doseInput};
 }
 function picker(items=[{medication_id:'med1',quantity:2,dose:'400 мг'}]){value(`procedureTemplatesV24.set('template1',${JSON.stringify({id:'template1',name:'Образец',service_id:'service1',items})});procedureTemplateActorV24=managementActorV16();procedureTemplateNavigationV24=quickNavigation4`);el('procTemplateSelectV5').value='template1'}
 return {c,el,value,form,picker,writes,notices,installed};
}
test('nurse saves shared template dose and archive without receiving staff or settings write access',async()=>{
 const h=harness(),row=h.form();await h.c.saveTemplateV5();assert.equal(h.writes[0].args.p_action,'template_save');assert.deepEqual(h.writes[0].args.p_payload.items,[{medication_id:'med1',quantity:2,dose:'400 мг'}]);
 const before=h.writes.length;await h.c.saveStaffV5();await h.c.saveSettingsV5();assert.equal(h.writes.length,before);assert.equal(h.value('managementDraftsV16.template'),null);
 h.el('templateIdV5').value='template1';h.el('templateActiveV5').checked=false;row.doseInput.value='200 мг';await h.c.saveTemplateV5();assert.equal(h.writes.findLast(w=>w.args.p_action==='template_save').args.p_payload.active,false);
});
test('nurse template replay freezes dose and keeps original receipt UUID after ambiguous save',async()=>{
 const h=harness(),row=h.form();let lost=true;h.c.db.rpc=async(name,args,options)=>{h.writes.push({name,args:JSON.parse(JSON.stringify(args)),options});if(args.p_action==='templates_list')return {data:[]};if(lost){lost=false;return {error:{message:'Ответ потерян',uncertain:true}}}return {data:{...args.p_payload,id:'template1'}}};
 await h.c.saveTemplateV5();assert.equal(h.value('managementDraftsV16.template.uncertain'),true);row.doseInput.value='Новая доза';await h.c.saveTemplateV5();const writes=h.writes.filter(w=>w.args.p_action==='template_save');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[1].args.p_payload.items[0].dose,'400 мг');
});
test('disabled or mentor actor cannot create shared templates',async()=>{
 for(const role of ['mentor','other']){const h=harness(role);h.form();await h.c.saveTemplateV5();assert.equal(h.writes.length,0)}const h=harness();h.c.currentStaff.active=false;h.form();await h.c.saveTemplateV5();assert.equal(h.writes.length,0);
});
test('selected stable ID survives management list reorder and patient copy cannot mutate shared template',()=>{
 const h=harness();h.picker();h.value("managementTemplatesV5=[{id:'different',name:'Другой',items:[]},{id:'template1',active:true,name:'Образец',items:[]}]");h.c.applyProcedureTemplateV5();assert.equal(h.installed[0].template.id,'template1');h.installed[0].template.items[0].dose='Изменение пациента';assert.equal(h.value("procedureTemplatesV24.get('template1').items[0].dose"),'400 мг');
});
test('existing composition requires concrete choice and appends only after confirmation',()=>{
 const h=harness();h.picker();h.el('procMeds').querySelectorAll=()=>[{}];h.c.applyProcedureTemplateV5();assert.equal(h.installed.length,0);assert.match(h.el('procTemplateConfirmTextV24').textContent,/Добавить.*заменить/);h.c.confirmProcedureTemplateV24('append');assert.equal(h.installed[0].mode,'append');assert.equal(h.value('procedureTemplatePendingV24'),null);
});
test('inactive medication or missing price or locked retry prevents all template application',()=>{
 for(const price of [null,undefined,0,-1,'bad']){const h=harness();h.picker();h.c.meds[0].sale_price=price;h.c.applyProcedureTemplateV5();assert.equal(h.installed.length,0);assert.match(h.notices.at(-1).value,/цена/)}
 const h=harness();h.picker();h.c.meds[0].active=false;h.c.applyProcedureTemplateV5();assert.equal(h.installed.length,0);h.c.meds[0].active=true;h.c.CrmClinicalV10.templateState=()=>({locked:true});h.c.applyProcedureTemplateV5();assert.equal(h.installed.length,0);assert.match(h.notices.at(-1).value,/завершите сохранение/);
});
test('template save validates dose independently from positive whole quantity',()=>{
 const h=harness(),row=h.form(' '.repeat(5)+'400 мг ');assert.equal(h.c.templatePayloadV5().items[0].dose,'400 мг');row.doseInput.value='';assert.equal(h.c.templatePayloadV5().items[0].dose,null);row.doseInput.value='x'.repeat(201);assert.throws(()=>h.c.templatePayloadV5(),/200 символов/);row.doseInput.value='1 мл';row.quantity.value='0.5';assert.throws(()=>h.c.templatePayloadV5(),/целым числом/);
});
test('late template list cannot overwrite a newer procedure form or another login',async()=>{
 const h=harness();let resolve;h.c.db.rpc=()=>new Promise(r=>resolve=r);const request=h.c.loadProcedureTemplatesV5();h.c.quickNavigation4=2;resolve({data:[{id:'old',name:'Старый',items:[]}]});await request;assert.equal(h.value('procedureTemplatesV24.size'),0);assert.equal(h.value('procedureTemplateActorV24'),null);
 h.picker();h.c.currentStaff={id:'other-nurse',role:'nurse'};h.c.applyProcedureTemplateV5();assert.equal(h.installed.length,0);assert.match(h.notices.at(-1).value,/изменилась/);
});
