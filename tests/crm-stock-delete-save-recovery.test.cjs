const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(file){
 const elements=new Map(),notices=[],calls=[];
 const get=id=>{
  if(!elements.has(id)){
   const classes=new Set(['medForm','medicationDeletedV7'].includes(id)?['active']:['hidden']);
   elements.set(id,{id,value:'',checked:false,disabled:false,textContent:'',innerHTML:'',
    classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),toggle(name,value){value?classes.add(name):classes.delete(name)}},
    querySelectorAll(){return []},setAttribute(){},removeAttribute(){},scrollIntoView(){},focus(){},remove(){},closest(){return {open:false}}});
  }
  return elements.get(id);
 };
 const c={console,Map,Set,JSON,Number,Date,Intl,Error,Promise,crypto:require('node:crypto').webcrypto,
  document:{getElementById:get},currentStaff:{id:'owner-1',role:'owner'},inventory:[{id:'m1',name:'Препарат',units_per_package:10}],meds:[{id:'m1'}],medView:1,warehouseBusy:false,warehouseLoad:0,
  isManager:()=>c.currentStaff?.role==='owner',setWarehouseBusy(value){c.warehouseBusy=value},restoreFieldLocks(){},message(id,text,success){notices.push({id,text,success})},
  openMedForm(){},loadStockDetails:async()=>{},renderInventory(){},loadInventory:async()=>false,signOut:async()=>{},stockCells:()=>'',updateStockPreview(){},localDateValue:()=> '2026-10-12',qty:String,unit:()=> 'амп.',esc:String,
  show(){},signMedicationPhotos:async()=>{},medPhotoMessage:get('medPhotoMessage'),
  db:{rpc:async(name,args)=>{calls.push({name,args});if(args.p_action==='preview')return {data:{id:'m1',name:'Препарат',expected_reserve:10,expected_work:0,reserve:10,work:0,total:10}};return {data:{id:'m1',units_per_package:5,quantity:3,deleted:true,restored:true}}}}
 };
 get('medId').value='m1';get('stockCorrectionModeV6').value='package';get('stockCorrectionActualV6').value='5';get('stockCorrectionReasonV6').value='Исправление';get('stockCorrectionConfirmV6').checked=true;
 get('medicationDeleteReasonV7').value='Лишняя карточка';
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),c);
 return {c,get,notices,calls};
}
test('confirmed package correction clears the draft and reports success when its later inventory refresh throws',async()=>{
 const {c,get,notices,calls}=fixture('crm-stock-correction-v6.js');c.loadInventory=async()=>{throw Error('Load failed')};
 await c.saveStockCorrectionV6();assert.equal(calls.length,1);assert.equal(c.inventory[0].units_per_package,5);assert.equal(get('stockCorrectionActualV6').value,'');assert.equal(get('stockCorrectionConfirmV6').checked,false);
 assert.match(notices.at(-1).text,/Исправление сохранено.*Обновить остатки/);assert.equal(notices.at(-1).success,true);assert.equal(c.warehouseBusy,false);assert.equal(get('stockCorrectionReloadV6').classList.contains('hidden'),false);
 await c.saveStockCorrectionV6();assert.equal(calls.length,1);
});
test('correction refresh failure is handled and cannot overwrite a different owner screen',async()=>{
 const {c,notices}=fixture('crm-stock-correction-v6.js');c.loadInventory=async()=>{throw Error('Load failed')};
 await c.reloadStockCorrectionV6();assert.match(notices.at(-1).text,/Не удалось обновить остатки/);assert.equal(c.warehouseBusy,false);
 const before=notices.length;c.loadInventory=async()=>{c.currentStaff={id:'owner-2',role:'owner'};throw Error('Load failed')};
 await c.reloadStockCorrectionV6();assert.equal(notices.length,before);assert.equal(c.warehouseBusy,false);
});
test('confirmed medication deletion remains successful if local rendering fails and cannot be repeated',async()=>{
 const {c,get,notices,calls}=fixture('crm-medication-delete-v7.js');await c.beginMedicationDeleteV7();get('medicationDeleteConfirmV7').checked=true;c.renderInventory=()=>{throw Error('Render failed')};
 await c.confirmMedicationDeleteV7();assert.equal(calls.filter(call=>call.args.p_action==='delete').length,1);assert.equal(get('medId').value,'');assert.match(notices.at(-1).text,/Препарат удалён.*обновите остатки/);assert.equal(notices.at(-1).success,true);assert.equal(c.warehouseBusy,false);
 await c.confirmMedicationDeleteV7();assert.equal(calls.filter(call=>call.args.p_action==='delete').length,1);
});
