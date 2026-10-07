/* Owner corrections use a counted balance, optimistic checks and retry-safe IDs. */
(function(root){
 'use strict';
 function whole(value,min,label){
  const number=Number(value);
  if(String(value??'').trim()===''||!Number.isSafeInteger(number)||number<min)throw Error(label+': введите целое число от '+min);
  return number;
 }
 function balance(batch,location){
  if(!batch||!['reserve','work'].includes(location))throw Error('Выберите партию и место хранения');
  return whole(location==='work'?batch.work_quantity:Number(batch.quantity_remaining)-Number(batch.work_quantity),0,'Текущий остаток');
 }
 function inventoryResult(operation,before,value){
  before=whole(before,0,'Текущий остаток');
  if(!['remove','add','set'].includes(operation))throw Error('Выберите: убрать, добавить или указать остаток');
  const amount=whole(value,operation==='set'?0:1,operation==='remove'?'Сколько убрать':operation==='add'?'Сколько добавить':'Правильный остаток');
  if(operation==='remove'&&amount>before)throw Error('Нельзя убрать больше, чем осталось: '+before);
  const after=operation==='set'?amount:operation==='remove'?before-amount:before+amount;
  if(!Number.isSafeInteger(after))throw Error('Количество слишком большое');
  return {before,amount,after,difference:after-before};
 }
 function payload(mode,values){
  const reason=String(values.reason||'').trim();
  if(!reason)throw Error('Укажите причину исправления');
  if(reason.length>1000)throw Error('Причина: не более 1000 символов');
  if(!values.id)throw Error('Выберите препарат');
  if(mode==='package')return {id:values.id,units_per_package:whole(values.actual,1,'Количество в упаковке'),expected_units_per_package:whole(values.expected,1,'Текущее количество в упаковке'),reason};
  if(mode!=='inventory'||!values.batch_id||!['reserve','work'].includes(values.location))throw Error('Выберите партию и место хранения');
  return {id:values.id,batch_id:values.batch_id,location:values.location,actual_quantity:whole(values.actual,0,'Фактический остаток'),expected_quantity:whole(values.expected,0,'Текущий остаток'),reason};
 }
 function createRequester(rpc,authorize,uuid){
  const requests=new Map();
  const connectionMessage='Не получен ответ сервера. Значения сохранены в форме. Повторите сохранение — операция не продублируется.';
  const errorText=error=>!error?.code&&/fetch|network|timeout|connection|load failed/i.test(error?.message||'')?connectionMessage:error?.message||connectionMessage;
  const send=async(action,data)=>{
   authorize();const key=JSON.stringify([action,data]);
   if(!requests.has(key))requests.set(key,uuid());
   const requestId=requests.get(key),forget=()=>{if(requests.get(key)===requestId)requests.delete(key);};
   let result;try{result=await rpc('crm_stock_correction_v6',{p_action:action,p_payload:data,p_request_id:requestId});}catch(error){throw Error(errorText(error));}
   if(result.error){
    if(/^[0-9A-Z]{5}$/.test(result.error.code||''))forget();
    const error=Error(errorText(result.error));error.code=result.error.code;throw error;
   }
   forget();return result.data;
  };
  send.clear=()=>requests.clear();return send;
 }
 const helpers={whole,balance,inventoryResult,payload,createRequester};
 if(typeof module!=='undefined'&&module.exports)module.exports=helpers;
 root.CrmStockCorrectionV6=helpers;
 if(typeof document==='undefined')return;

 const get=id=>document.getElementById(id);
 let generation=0,state=null,busyOperation=null,inventoryAction='remove';
 function requireOwner(){if(!isManager())throw Error('Исправление препаратов доступно только владельцу');}
 const request=createRequester((name,args)=>db.rpc(name,args),requireOwner,()=>crypto.randomUUID());
 function currentMedication(){return inventory.find(m=>m.id===get('medId')?.value);}
 function currentView(id,view,token,actor){return isManager()&&(!actor||currentStaff?.id===actor)&&token===generation&&view===medView&&get('medId')?.value===id&&get('medForm')?.classList.contains('active');}
 function capture(id){return {id,view:medView,token:generation,actor:currentStaff?.id};}
 function matches(context){return currentView(context.id,context.view,context.token,context.actor);}
 function status(text,success=false){if(get('stockCorrectionMessageV6'))message('stockCorrectionMessageV6',text,success);}
 function finishBusy(operation){
  if(busyOperation!==operation)return;busyOperation=null;setWarehouseBusy(false);
  if(get('stockCorrectionReasonV6'))get('stockCorrectionReasonV6').disabled=false;
  restoreFieldLocks();update(false);
 }
 function ensurePanel(){
  get('inventoryCountV5')?.remove();
  if(get('stockCorrectionPanelV6'))return;
  const entry=document.createElement('button');entry.id='stockCorrectionEntryV6';entry.type='button';entry.className='btn secondary stock-correction-entry-v6 hidden';entry.textContent='Исправить количество';entry.onclick=()=>openMedForm(get('medId').value,'correct');
  const panel=document.createElement('section');panel.id='stockCorrectionPanelV6';panel.className='card stock-correction-v6 hidden';
  panel.innerHTML=`<h2>Исправить количество</h2><p class="small">Лишние флаконы? Выберите «Убрать лишнее» и укажите, сколько убрать.</p>
   <label for="stockCorrectionModeV6">Что исправить</label><select id="stockCorrectionModeV6"><option value="inventory">Остаток ампул / флаконов</option><option value="package">Количество в упаковке</option></select>
   <div id="stockCorrectionInventoryV6"><div class="stock-correction-actions-v6" role="group" aria-label="Как изменить количество"><button id="stockCorrectionRemoveV6" type="button" data-stock-action="remove" class="btn secondary" aria-pressed="true">− Убрать лишнее</button><button id="stockCorrectionAddV6" type="button" data-stock-action="add" class="btn secondary" aria-pressed="false">＋ Добавить</button><button id="stockCorrectionSetV6" type="button" data-stock-action="set" class="btn secondary" aria-pressed="false">Указать остаток</button></div><label for="stockCorrectionLocationV6">Где исправляем количество</label><select id="stockCorrectionLocationV6"><option value="reserve">В запасе</option><option value="work">В работе</option></select><label for="stockCorrectionBatchV6">Какая партия</label><select id="stockCorrectionBatchV6"></select><p class="small">Меняется только выбранная партия в указанном месте.</p></div>
   <p id="stockCorrectionPackageNoteV6" class="small hidden">Меняется только число единиц в упаковке для следующих поступлений. Реальные остатки и закупочные цены старых партий не пересчитываются.</p>
   <p id="stockCorrectionCurrentV6" class="stock-correction-current-v6"></p><label id="stockCorrectionActualLabelV6" for="stockCorrectionActualV6">Фактически осталось</label><input id="stockCorrectionActualV6" type="number" min="0" step="1" inputmode="numeric">
   <label for="stockCorrectionReasonV6">Причина — можно изменить</label><input id="stockCorrectionReasonV6" type="text" maxlength="1000" value="Исправление ошибки ввода">
   <div id="stockCorrectionPreviewV6" class="stock-correction-preview-v6" aria-live="polite"></div><label class="stock-correction-confirm-v6"><input id="stockCorrectionConfirmV6" type="checkbox"><span id="stockCorrectionConfirmLabelV6">Проверила партию, место хранения и новое число</span></label>
   <button id="stockCorrectionSaveV6" class="btn primary wide" type="button">Сохранить исправление</button><div id="stockCorrectionMessageV6" role="status" aria-live="polite"></div><button id="stockCorrectionReloadV6" class="btn secondary wide hidden" type="button">Обновить остатки и пересчитать</button>`;
  get('medStockSummary').after(entry,panel);
  for(const id of ['stockCorrectionModeV6','stockCorrectionBatchV6','stockCorrectionLocationV6'])get(id).onchange=()=>{if(id==='stockCorrectionLocationV6')renderBatches(get('stockCorrectionBatchV6').value);get('stockCorrectionActualV6').value='';get('stockCorrectionReloadV6').classList.add('hidden');status('');update(true);};
  for(const button of panel.querySelectorAll('[data-stock-action]'))button.onclick=()=>{inventoryAction=button.dataset.stockAction;get('stockCorrectionActualV6').value='';status('');update(true);get('stockCorrectionActualV6').focus({preventScroll:true});};
  for(const id of ['stockCorrectionActualV6','stockCorrectionReasonV6'])get(id).oninput=()=>update(true);
  get('stockCorrectionSaveV6').onclick=saveCorrection;
  get('stockCorrectionReloadV6').onclick=reloadCorrection;
 }
 function reset(m,focus){
  ensurePanel();const available=!!m&&m.active!==false;
  get('stockCorrectionPanelV6').classList.toggle('hidden',!available||focus!=='correct');get('stockCorrectionEntryV6').classList.toggle('hidden',!available||focus==='correct');
  inventoryAction='remove';get('stockCorrectionModeV6').value='inventory';get('stockCorrectionLocationV6').value='reserve';get('stockCorrectionBatchV6').innerHTML='<option value="">Загрузка партий…</option>';
  get('stockCorrectionActualV6').value='';get('stockCorrectionReasonV6').value='Исправление ошибки ввода';get('stockCorrectionConfirmV6').checked=false;get('stockCorrectionReloadV6').classList.add('hidden');status('');update(false);
 }
 function expected(){
  const m=currentMedication();if(!m||m.active===false)throw Error('Препарат недоступен');
  if(get('stockCorrectionModeV6').value==='package')return whole(m.units_per_package,1,'Количество в упаковке');
  if(!state?.loaded||state.id!==m.id||state.view!==medView)throw Error('Дождитесь загрузки партий');
  return balance(state.batches.find(b=>b.id===get('stockCorrectionBatchV6').value),get('stockCorrectionLocationV6').value);
 }
 function countedUnit(m){return {ampoule:'ампул','амп.':'ампул',ампула:'ампул',vial:'флаконов','фл.':'флаконов',флакон:'флаконов',tablet:'таблеток','таб.':'таблеток',таблетка:'таблеток'}[m?.consumption_unit]||unit(m);}
 function renderBatches(preferred='',keepZero=false){
  if(!state?.loaded)return;
  const location=get('stockCorrectionLocationV6').value,batches=state.batches,suffix=unit(currentMedication());
  const label=b=>`${b.batch_number?'№ '+b.batch_number:'Без номера'} · ${qty(balance(b,location))} ${suffix}${b.expiry_date?' · срок '+b.expiry_date.split('-').reverse().join('.'):''}`;
  get('stockCorrectionBatchV6').innerHTML=batches.map(b=>`<option value="${esc(b.id)}">${esc(label(b))}</option>`).join('')||'<option value="">Партий пока нет — внесите имеющийся остаток</option>';
  const prior=batches.find(b=>b.id===preferred),available=batches.find(b=>balance(b,location)>0);
  const selected=prior&&(keepZero||balance(prior,location)>0)?prior:available||prior||batches[0];
  if(selected)get('stockCorrectionBatchV6').value=selected.id;
 }
 function update(resetConfirmation){
  if(!get('stockCorrectionPanelV6'))return;
  if(resetConfirmation)get('stockCorrectionConfirmV6').checked=false;
  const mode=get('stockCorrectionModeV6').value,m=currentMedication(),packageMode=mode==='package';
  get('stockCorrectionInventoryV6').classList.toggle('hidden',packageMode);get('stockCorrectionPackageNoteV6').classList.toggle('hidden',!packageMode);
  for(const button of get('stockCorrectionPanelV6').querySelectorAll('[data-stock-action]'))button.setAttribute('aria-pressed',String(button.dataset.stockAction===inventoryAction));
  get('stockCorrectionConfirmLabelV6').textContent=packageMode?'Правильное количество в упаковке — подтверждаю':'Проверила: столько должно остаться';
  get('stockCorrectionActualV6').min=packageMode||inventoryAction!=='set'?'1':'0';get('stockCorrectionActualLabelV6').textContent=packageMode?'Правильное количество в упаковке':(inventoryAction==='remove'?'Сколько убрать':inventoryAction==='add'?'Сколько добавить':'Сколько должно остаться')+', '+countedUnit(m);
  get('stockCorrectionSaveV6').textContent=packageMode?'Сохранить количество в упаковке':inventoryAction==='remove'?'Убрать лишнее':inventoryAction==='add'?'Добавить':'Сохранить остаток';
  let before;try{before=expected();}catch(error){get('stockCorrectionActualV6').removeAttribute('max');get('stockCorrectionCurrentV6').textContent=error.message;get('stockCorrectionPreviewV6').textContent='';get('stockCorrectionSaveV6').disabled=true;return;}
  if(!packageMode&&inventoryAction==='remove')get('stockCorrectionActualV6').max=String(before);else get('stockCorrectionActualV6').removeAttribute('max');
  const suffix=unit(m),where=packageMode?'В упаковке':get('stockCorrectionLocationV6').value==='work'?'В работе':'В запасе';
  get('stockCorrectionCurrentV6').textContent=`${where} сейчас: ${qty(before)} ${suffix}`;
  let after,amount;try{
   if(packageMode)after=whole(get('stockCorrectionActualV6').value,1,'Количество в упаковке');
   else({after,amount}=inventoryResult(inventoryAction,before,get('stockCorrectionActualV6').value));
  }catch(error){get('stockCorrectionPreviewV6').textContent=error.message;get('stockCorrectionSaveV6').disabled=true;return;}
  get('stockCorrectionPreviewV6').textContent=packageMode?`В упаковке было: ${qty(before)} ${suffix}\nПравильное количество: ${qty(after)} ${suffix}`:`Было: ${qty(before)} ${suffix}\n${inventoryAction==='remove'?'Убираем':inventoryAction==='add'?'Добавляем':'Указываем остаток'}: ${qty(amount)} ${suffix}\nОстанется: ${qty(after)} ${suffix}`;
  if(!packageMode)get('stockCorrectionSaveV6').textContent=inventoryAction==='set'?'Сохранить остаток '+qty(after)+' '+suffix:(inventoryAction==='remove'?'Убрать ':'Добавить ')+qty(amount)+' '+suffix;
  get('stockCorrectionSaveV6').disabled=warehouseBusy;
 }
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){
  if(!isManager()||warehouseBusy)return;
  const m=inventory.find(x=>x.id===id);if(id&&!m)return;
  ++generation;state={id,view:medView+1,batches:[],loaded:false};ensurePanel();previousOpen(id,focus);reset(m,focus);
  if(get('medId').value!==id)return;
  if(focus==='edit'){get('medSaveButton').closest('details').open=true;get('medName').scrollIntoView({block:'center',behavior:'smooth'});get('medName').focus({preventScroll:true});}
  if(focus==='correct'&&m?.active!==false){get('stockCorrectionPanelV6').scrollIntoView({block:'start',behavior:'smooth'});get('stockCorrectionActualV6').focus({preventScroll:true});}
 };
 // Preserve the metadata renderer, bypassing the superseded v5 inventory form.
 const previousDetails=typeof originalStockDetailsV5==='function'?originalStockDetailsV5:loadStockDetails;
 loadStockDetails=async function(id,view){
  const token=++generation,actor=currentStaff?.id;
  try{
   await previousDetails(id,view);if(!currentView(id,view,token,actor))return;
   const batches=await warehouseRpc('batches',{id});if(!currentView(id,view,token,actor))return;
   ensurePanel();const preferred=state?.preferredBatchId,location=state?.preferredLocation;state={id,view,batches:Array.isArray(batches)?batches:[],loaded:true};
   if(location)get('stockCorrectionLocationV6').value=location;
   else if(!state.batches.some(b=>balance(b,'reserve')>0)&&state.batches.some(b=>balance(b,'work')>0))get('stockCorrectionLocationV6').value='work';
   renderBatches(preferred,!!preferred);
   update(false);
  }catch(error){if(currentView(id,view,token,actor)){state={id,view,batches:[],loaded:false};status('Не удалось загрузить партии: '+error.message);get('stockCorrectionReloadV6').classList.remove('hidden');update(false);}}
 };
 function applyCommitted(m,mode,data,result){
  if(mode==='package'){m.units_per_package=Number(result?.units_per_package??data.units_per_package);get('medUnitsPerPack').value=m.units_per_package;}
  else{
   const b=state?.batches.find(item=>item.id===data.batch_id),difference=Number(result?.difference??data.actual_quantity-data.expected_quantity);
   if(b){b.quantity_remaining=Number(b.quantity_remaining)+difference;if(data.location==='work')b.work_quantity=Number(b.work_quantity)+difference;}
   const key=data.location==='work'?'work_qty':'reserve_qty';m[key]=Number(m[key]||0)+difference;
   const available=data.location==='work'?'work_available':'reserve_available';if(b?.expiry_date&&b.expiry_date>=localDateValue()&&m[available]!==undefined)m[available]=Number(m[available])+difference;
  }
  if(mode==='inventory')renderBatches(data.batch_id,true);
  get('medStockSummary').innerHTML=stockCells(m);updateStockPreview();
 }
 function choices(){return {mode:get('stockCorrectionModeV6').value,action:inventoryAction,location:get('stockCorrectionLocationV6').value,batch:get('stockCorrectionBatchV6').value};}
 function reopenCorrection(operation,choice){
  if(!matches(operation)||!inventory.some(m=>m.id===operation.id&&m.active!==false))return false;
  openMedForm(operation.id,'correct');inventoryAction=choice.action;get('stockCorrectionModeV6').value=choice.mode;get('stockCorrectionLocationV6').value=choice.location;
  state.preferredLocation=choice.location;state.preferredBatchId=choice.batch;update(false);return true;
 }
 async function saveCorrection(){
  if(warehouseBusy)return;
  let mode,data,m;
  try{
   requireOwner();m=currentMedication();mode=get('stockCorrectionModeV6').value;
   const before=expected(),actual=mode==='package'?get('stockCorrectionActualV6').value:inventoryResult(inventoryAction,before,get('stockCorrectionActualV6').value).after;
   data=payload(mode,{id:m?.id,batch_id:get('stockCorrectionBatchV6').value,location:get('stockCorrectionLocationV6').value,actual,expected:before,reason:get('stockCorrectionReasonV6').value});
   if(!get('stockCorrectionConfirmV6').checked)throw Error('Проверьте числа и отметьте подтверждение перед сохранением');
  }catch(error){if(isManager())status(error.message);else message('homeMessage',error.message);return;}
  const operation=capture(data.id),choice=choices();busyOperation=operation;setWarehouseBusy(true);get('stockCorrectionReasonV6').disabled=true;status('Сохраняем исправление…');get('stockCorrectionReloadV6').classList.add('hidden');
  try{
   const result=await request(mode,data);if(!matches(operation))return;
   applyCommitted(m,mode,data,result);
   // Clear only committed drafts BEFORE refreshing, even if the refresh fails.
   get('stockCorrectionActualV6').value='';get('stockCorrectionReasonV6').value='';get('stockCorrectionConfirmV6').checked=false;
   const loaded=await loadInventory();if(!matches(operation))return;finishBusy(operation);
   if(loaded)reopenCorrection(operation,choice);
   status('Исправление сохранено.'+(loaded?'':' Остатки на сервере не удалось обновить. Нажмите «Обновить остатки». '),true);
   if(!loaded)get('stockCorrectionReloadV6').classList.remove('hidden');
  }catch(error){
   if(matches(operation)){status(error.message);if(/уже изменил|уже изменился|уже изменились|обновите карточку|обновите остатки/i.test(error.message))get('stockCorrectionReloadV6').classList.remove('hidden');}
  }finally{finishBusy(operation);}
 }
 async function reloadCorrection(){
  if(warehouseBusy||!isManager())return;
  const id=get('medId').value,reason=get('stockCorrectionReasonV6').value,operation=capture(id),choice=choices();busyOperation=operation;setWarehouseBusy(true);
  try{
   const loaded=await loadInventory();if(!matches(operation))return;finishBusy(operation);
   if(!loaded){status('Не удалось обновить остатки. Попробуйте ещё раз.');return;}
   if(!reopenCorrection(operation,choice)){status('Препарат больше недоступен для исправления.');return;}
   get('stockCorrectionReasonV6').value=reason||'Исправление ошибки ввода';status('Остатки обновлены. Проверьте новое количество и повторите исправление.');
  }finally{finishBusy(operation);}
 }
 root.saveStockCorrectionV6=saveCorrection;root.reloadStockCorrectionV6=reloadCorrection;
 saveInventoryV5=function(){if(!isManager()){message('homeMessage','Корректировка доступна только владельцу');return;}if(!warehouseBusy)openMedForm(get('medId').value,'correct');};
 const previousSignOut=signOut;
 signOut=async function(){++generation;state=null;request.clear();if(busyOperation)finishBusy(busyOperation);get('stockCorrectionPanelV6')?.remove();get('stockCorrectionEntryV6')?.remove();return previousSignOut();};
})(typeof window==='undefined'?globalThis:window);
