/* Package counts are multiplied once; existing stock stays in consumption units. */
(function(root){
 'use strict';
 const maximum=999999999;
 function whole(value,label){
  const number=Number(value);
  if(String(value??'').trim()===''||!Number.isSafeInteger(number)||number<1)throw Error(label+': введите целое число больше нуля');
  if(number>maximum)throw Error(label+': слишком большое количество');
  return number;
 }
 function packageQuantity(packages,size){
  const count=whole(packages,'Количество упаковок'),each=whole(size,'Количество в одной упаковке'),quantity=count*each;
  if(!Number.isSafeInteger(quantity)||quantity>maximum)throw Error('Слишком большое количество. Проверьте упаковки и количество в одной упаковке');
  return {packages:count,units_per_package:each,quantity};
 }
 const api={packageQuantity};
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(typeof document==='undefined')return;
 root.CrmPackageReceiptsV35=api;
 const get=id=>document.getElementById(id);
 const actor=()=>warehouseActorV16();
 const medication=()=>inventory.find(m=>m.id===get('medId').value);
 function current(saved){return warehouseSameActorV16(saved.actor)&&medView===saved.view&&get('medId').value===saved.id&&get('medForm').classList.contains('active');}
 function sizeField(prefix){
  const box=document.createElement('div');
  box.innerHTML=`<label for="${prefix}UnitsPerPackV35">Количество в одной упаковке *</label><input id="${prefix}UnitsPerPackV35" type="number" inputmode="numeric" min="1" max="${maximum}" step="1" aria-describedby="${prefix==='receive'?'receivePreview':'openingPreviewV35'}">`;
  get(prefix==='receive'?'receivePackages':'openingQty').parentElement.after(box);
  get(prefix+'UnitsPerPackV35').addEventListener('input',()=>updateStockPreview());
 }
 function install(){
  sizeField('receive');sizeField('opening');
  const mode=document.createElement('div');mode.className='grid2';
  mode.innerHTML='<div><label for="openingModeV35">Как внести количество</label><select id="openingModeV35"><option value="units">Отдельными ампулами / флаконами</option><option value="packs">Упаковками</option></select></div>';
  get('openingQty').closest('.grid2').before(mode);
  get('openingModeV35').onchange=()=>updateStockPreview();
  for(const id of ['openingQty','openingLocation'])get(id).addEventListener(id==='openingLocation'?'change':'input',()=>updateStockPreview());
  const preview=document.createElement('p');preview.id='openingPreviewV35';preview.className='stock-preview';preview.setAttribute('aria-live','polite');
  get('openingPanel').querySelector('button[onclick="saveOpeningStock()"]')?.before(preview);
  get('receivePreview').setAttribute('aria-live','polite');
  get('receivePanel').querySelector('p.small').textContent='Укажите число упаковок и количество ампул, флаконов или таблеток в одной упаковке. Общее количество рассчитывается автоматически.';
  get('openingPanel').querySelector('p.small').textContent='Выберите ввод упаковками или отдельными ампулами / флаконами, включая вскрытые коробки. Разные сроки годности вносите отдельно. Количество добавляется к текущему остатку.';
 }
 function values(prefix,m){
  const size=whole(get(prefix+'UnitsPerPackV35').value,'Количество в одной упаковке');
  const packed=prefix==='receive'||get('openingModeV35').value==='packs';
  const raw=get(prefix==='receive'?'receivePackages':'openingQty').value;
  const value=packed?packageQuantity(raw,size):{units_per_package:size,quantity:stockQuantityV31(raw,m,'Количество')};
  if(value.quantity>maximum)throw Error('Слишком большое количество. Проверьте ввод');
  const location=prefix==='receive'?'reserve':get('openingLocation').value;
  if(!['reserve','work'].includes(location))throw Error('Выберите место хранения');
  const after=num(m[location+'_qty'])+value.quantity;
  if(after>maximum+0.999)throw Error('Слишком большой остаток. Проверьте количество');
  return {...value,location,packed};
 }
 function preview(prefix,m){
  const label=document.querySelector('label[for="'+prefix+'UnitsPerPackV35"]');
  label.textContent='В одной упаковке, '+unit(m)+' *';
  const packed=prefix==='receive'||get('openingModeV35').value==='packs';
  if(prefix==='opening'){
   document.querySelector('label[for="openingQty"]').textContent=packed?'Количество упаковок *':'Количество, '+unit(m)+' *';
   get('openingModeV35').options[0].textContent='Отдельными единицами ('+unit(m)+')';
   root.configureMedicationQuantityV31?.(get('openingQty'),packed?null:m);
  }
  const host=get(prefix==='receive'?'receivePreview':'openingPreviewV35');
  if(!get(prefix==='receive'?'receivePackages':'openingQty').value.trim()||!get(prefix+'UnitsPerPackV35').value.trim()){
   host.textContent=packed?'Укажите количество упаковок и количество '+unit(m)+' в каждой упаковке.':'Укажите количество '+unit(m)+' и количество в одной упаковке.';
   host.classList.remove('status-bad');return;
  }
  try{
   const value=values(prefix,m),size=value.units_per_package;
   const reserve=Math.round((num(m.reserve_qty)+(value.location==='reserve'?value.quantity:0))*1000)/1000;
   const work=Math.round((num(m.work_qty)+(value.location==='work'?value.quantity:0))*1000)/1000;
   host.textContent=(value.packed?`${qty(value.packages)} уп. × ${qty(size)} ${unit(m)} = ${qty(value.quantity)} ${unit(m)}.`:`Добавить ${qty(value.quantity)} ${unit(m)}.`)+
    ` После прихода: в запасе ${qty(reserve)} ${unit(m)} (${packLabel(reserve,{...m,units_per_package:size})}), в работе ${qty(work)} ${unit(m)}, всего ${qty(reserve+work)} ${unit(m)}.`+
    (size!==Number(m.units_per_package)?` В карточке будет ${qty(size)} ${unit(m)} в упаковке. Ранее внесённые количества ${unit(m)} не меняются.`:'');
   host.classList.remove('status-bad');
  }catch(error){host.textContent=error.message;host.classList.add('status-bad');}
 }
 const previousPreview=updateStockPreview;
 updateStockPreview=function(){previousPreview();const m=medication();if(m)for(const prefix of ['receive','opening'])preview(prefix,m);};
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){
  const before=medView,result=previousOpen(id,focus);
  if(before===medView||get('medId').value!==id||!get('medForm').classList.contains('active'))return result;
  const m=medication();
  for(const prefix of ['receive','opening'])get(prefix+'UnitsPerPackV35').value=String(m?.units_per_package??1);
  get('openingModeV35').value='units';updateStockPreview();return result;
 };
 const previousRpc=warehouseRpc;
 warehouseRpc=async function(action,payload={},write=false){
  const saved={actor:actor(),id:payload.id,view:medView};
  const data=await previousRpc(action,payload,write);
  if(write&&['receive','opening'].includes(action)&&warehouseSameActorV16(saved.actor)&&payload.units_per_package!=null&&data&&Number(data.quantity)>0){
   const m=inventory.find(m=>m.id===payload.id),before=m?.units_per_package,size=Number(payload.units_per_package);
   if(m&&Number(before)!==Number(payload.expected_units_per_package)&&Number(before)!==size)return data;
   // A confirmed write keeps package metadata usable even if the subsequent
   // list refresh fails. Stock quantities are refreshed by the existing flow.
   inventory=inventory.map(m=>m.id===payload.id?{...m,units_per_package:size}:m);
   if(typeof meds!=='undefined')meds=meds.map(m=>m.id===payload.id?{...m,units_per_package:size}:m);
   if(current(saved)){
    get('medUnitsPerPack').value=String(size);
    for(const prefix of ['receive','opening'])if(Number(get(prefix+'UnitsPerPackV35').value)===Number(before))get(prefix+'UnitsPerPackV35').value=String(size);
    updateMedicationPriceLabels();
   }
  }
  return data;
 };
 async function save(prefix){
  if(!isManager()||currentStaff?.active===false||warehouseBusy)return;
  const action=prefix==='receive'?'receive':'opening';
  if(stockDraftV16?.action===action)return stockMutation(action,stockDraftV16.payload,stockDraftV16.success);
  const saved={actor:actor(),id:get('medId').value,view:medView};
  try{
   const m=medication();if(!m||m.active===false)throw Error('Выберите действующий препарат');
   const value=values(prefix,m),price=nonnegative(get(prefix+'Price').value,'Закупочная цена за упаковку');
   const expiry=get(prefix+'Expiry').value;if(!expiry||expiry<localDateValue())throw Error('Укажите действующий срок годности партии');
   const payload={id:m.id,units_per_package:value.units_per_package,expected_units_per_package:Number(m.units_per_package),price,expiry,comment:get(prefix+'Comment').value.trim()};
   if(action==='receive')payload.packages=value.packages;
   else{payload.quantity=value.quantity;payload.location=value.location;if(value.packed)payload.packages=value.packages;}
   await stockMutation(action,payload,action==='receive'?'Партия добавлена в запас.':'Имеющийся остаток добавлен. Не вносите эту же партию повторно.');
  }catch(error){if(current(saved))message('stockOperationMessage',error.message);}
  finally{if(current(saved)&&!stockDraftV16)updateStockPreview();}
 }
 receiveStock=()=>save('receive');saveOpeningStock=()=>save('opening');
 install();
})(typeof window==='object'?window:globalThis);
