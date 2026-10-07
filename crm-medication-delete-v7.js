/* Deleting a medication hides its card and clears stock; its history is retained. */
(function(root){
 'use strict';
 function createRequester(rpc,authorize,uuid){
  const requests=new Map();
  const lost='Не получен ответ сервера. Повторите удаление или восстановление — операция не продублируется.';
  const describe=error=>!error?.code&&/fetch|network|timeout|connection|load failed/i.test(error?.message||'')?lost:error?.message||lost;
  const send=async(action,payload={},write=false)=>{
   authorize();const key=JSON.stringify([action,payload]);
   if(write&&!requests.has(key))requests.set(key,uuid());
   const requestId=write?requests.get(key):null;
   const forget=()=>{if(requests.get(key)===requestId)requests.delete(key);};
   let result;try{result=await rpc('crm_medication_delete_v7',{p_action:action,p_payload:payload,p_request_id:requestId});}catch(error){throw Error(describe(error));}
   if(result.error){if(write&&/^[0-9A-Z]{5}$/.test(result.error.code||''))forget();const error=Error(describe(result.error));error.code=result.error.code;throw error;}
   if(write)forget();return result.data;
  };
  send.clear=()=>requests.clear();return send;
 }
 function deletePayload(preview,reason){
  const text=String(reason||'').trim();if(!text)throw Error('Укажите причину удаления');if(text.length>1000)throw Error('Причина: не более 1000 символов');
  if(!preview?.id)throw Error('Дождитесь проверки остатков');
  const reserve=Number(preview.expected_reserve),work=Number(preview.expected_work);
  if(!Number.isSafeInteger(reserve)||reserve<0||!Number.isSafeInteger(work)||work<0)throw Error('Не удалось проверить остатки. Обновите их перед удалением');
  return {id:preview.id,expected_reserve:reserve,expected_work:work,reason:text};
 }
 const helpers={createRequester,deletePayload};
 if(typeof module!=='undefined'&&module.exports)module.exports=helpers;
 root.CrmMedicationDeleteV7=helpers;if(typeof document==='undefined')return;

 const get=id=>document.getElementById(id);
 let generation=0,preview=null,list=[],busyOperation=null,previewLoad=0;
 function requireOwner(){if(!isManager())throw Error('Удаление и восстановление препаратов доступны только владельцу');}
 const request=createRequester((name,args)=>db.rpc(name,args),requireOwner,()=>crypto.randomUUID());
 const capture=(id='')=>({id,view:medView,token:generation,actor:currentStaff?.id});
 const sameOwner=context=>isManager()&&context.token===generation&&context.actor===currentStaff?.id;
 const sameCard=context=>sameOwner(context)&&context.view===medView&&context.id===get('medId')?.value&&get('medForm')?.classList.contains('active');
 const sameDeletedScreen=context=>sameOwner(context)&&get('medicationDeletedV7')?.classList.contains('active');
 const status=(text,success=false)=>get('medicationDeleteMessageV7')&&message('medicationDeleteMessageV7',text,success);
 function finishBusy(operation){
  if(busyOperation!==operation)return;busyOperation=null;setWarehouseBusy(false);restoreFieldLocks();
  if(get('medicationDeleteReasonV7'))get('medicationDeleteReasonV7').disabled=false;
  get('medicationDeletedV7')?.querySelectorAll('button').forEach(button=>button.disabled=false);
  get('medicationDeleteConfirmV7')&&(get('medicationDeleteConfirmV7').disabled=!preview);
  get('medicationDeleteConfirmButtonV7')&&(get('medicationDeleteConfirmButtonV7').disabled=!preview);
 }
 function ensureUi(){
  if(!isManager())return;
  if(!get('medicationDeleteSectionV7')){
   const section=document.createElement('section');section.id='medicationDeleteSectionV7';section.className='card medication-delete-v7 hidden';
   section.innerHTML=`<h2>Удаление препарата</h2><p class="small">Уберите лишнюю карточку. История процедур, покупок и склада сохранится.</p><button id="medicationDeleteEntryV7" type="button" class="btn danger medication-delete-entry-v7 hidden">Удалить препарат</button>
    <div id="medicationDeletePreviewV7" class="hidden"><h3 id="medicationDeleteNameV7"></h3><div id="medicationDeleteBalancesV7" class="medication-delete-balances-v7"></div><p id="medicationDeleteEffectV7" class="medication-delete-effect-v7"></p>
    <label for="medicationDeleteReasonV7">Причина удаления</label><textarea id="medicationDeleteReasonV7" maxlength="1000"></textarea><label class="medication-delete-confirm-v7"><input id="medicationDeleteConfirmV7" type="checkbox"><span>Проверила препарат и количество, которое будет убрано из учёта</span></label>
    <div class="row"><button id="medicationDeleteConfirmButtonV7" type="button" class="btn danger">Удалить препарат</button><button id="medicationDeleteCancelV7" type="button" class="btn secondary">Отмена</button></div></div>
    <div id="medicationDeleteMessageV7" role="status" aria-live="polite"></div><button id="medicationDeleteReloadV7" type="button" class="btn secondary hidden">Обновить остатки перед удалением</button>`;
   get('medForm').append(section);
   get('medPricesEntry').after(get('medicationDeleteEntryV7'));
   get('medicationDeleteEntryV7').onclick=()=>beginDelete();get('medicationDeleteConfirmButtonV7').onclick=confirmDelete;get('medicationDeleteCancelV7').onclick=cancelDelete;
   get('medicationDeleteReloadV7').onclick=()=>beginDelete(true);
   get('medicationDeleteReasonV7').oninput=()=>get('medicationDeleteConfirmV7').checked=false;
  }
  if(!get('medicationDeletedEntryV7')){
   const button=document.createElement('button');button.id='medicationDeletedEntryV7';button.type='button';button.className='btn secondary';button.textContent='Удалённые препараты';button.onclick=openDeleted;
   get('admin').querySelector('.warehouse-tools').append(button);
  }
  if(!get('medicationDeletedV7')){
   const screen=document.createElement('section');screen.id='medicationDeletedV7';screen.className='screen';
   screen.innerHTML=`<button id="medicationDeletedBackV7" type="button" class="btn secondary">← К складу</button><h1>Удалённые препараты</h1><p class="sub">Можно вернуть карточку препарата. Остатки останутся нулевыми — их нужно внести отдельно после пересчёта.</p><button id="medicationDeletedReloadV7" type="button" class="btn secondary">Обновить список</button><div id="medicationDeletedMessageV7" role="status" aria-live="polite"></div><div id="medicationDeletedListV7" class="list"></div>`;
   document.querySelector('.app').append(screen);
   get('medicationDeletedBackV7').onclick=()=>show('admin');get('medicationDeletedReloadV7').onclick=openDeleted;
   get('medicationDeletedListV7').onclick=event=>{const button=event.target.closest('button[data-restore-id]');if(button)restoreMedication(button.dataset.restoreId);};
   if(typeof ownerScreensV5!=='undefined')ownerScreensV5.add('medicationDeletedV7');
  }
 }
 function resetCard(id){
  preview=null;++previewLoad;if(!get('medicationDeleteSectionV7'))return;
  get('medicationDeleteSectionV7').classList.add('hidden');get('medicationDeleteEntryV7').classList.toggle('hidden',!id);get('medicationDeletePreviewV7').classList.add('hidden');
  get('medicationDeleteReasonV7').value='Лишняя карточка / ошибка ввода';get('medicationDeleteConfirmV7').checked=false;get('medicationDeleteConfirmV7').disabled=true;get('medicationDeleteConfirmButtonV7').disabled=true;
  get('medicationDeleteReloadV7').classList.add('hidden');status('');
 }
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){
  if(!isManager()||warehouseBusy)return;const m=inventory.find(item=>item.id===id);if(id&&!m)return;
  ++generation;ensureUi();previousOpen(id,focus);if(get('medId')?.value===id){resetCard(id);if(id&&focus==='delete')beginDelete();}
 };
 const previousRender=renderInventory;
 renderInventory=function(){previousRender();if(isManager())ensureUi();};
 function cancelDelete(){
  if(warehouseBusy)return;++previewLoad;preview=null;get('medicationDeleteSectionV7').classList.add('hidden');get('medicationDeletePreviewV7').classList.add('hidden');get('medicationDeleteEntryV7').classList.toggle('hidden',!get('medId').value);get('medicationDeleteConfirmV7').checked=false;get('medicationDeleteReloadV7').classList.add('hidden');status('');
 }
 async function beginDelete(preserveReason=false){
  if(warehouseBusy)return;let operation;
  try{requireOwner();ensureUi();const id=get('medId').value;if(!id)throw Error('Сначала сохраните карточку препарата');operation=capture(id);}catch(error){if(isManager())status(error.message);else message('homeMessage',error.message);return;}
  const version=++previewLoad;preview=null;get('medicationDeleteSectionV7').classList.remove('hidden');get('medicationDeleteEntryV7').classList.add('hidden');get('medicationDeletePreviewV7').classList.remove('hidden');get('medicationDeleteConfirmV7').checked=false;get('medicationDeleteConfirmV7').disabled=true;get('medicationDeleteConfirmButtonV7').disabled=true;get('medicationDeleteReloadV7').classList.add('hidden');
  if(!preserveReason)get('medicationDeleteReasonV7').value='Лишняя карточка / ошибка ввода';
  get('medicationDeleteNameV7').textContent=get('medFormTitle').textContent;get('medicationDeleteBalancesV7').textContent='Проверяем остатки…';get('medicationDeleteEffectV7').textContent='';status('');
  get('medicationDeleteSectionV7').scrollIntoView({block:'start',behavior:'smooth'});
  try{
   const result=await request('preview',{id:operation.id});if(!sameCard(operation)||version!==previewLoad)return;
   if(!result||result.id!==operation.id)throw Error('Не удалось проверить выбранный препарат');preview=result;
   get('medicationDeleteNameV7').textContent=result.name;const suffix=result.unit||'ед.';
   get('medicationDeleteBalancesV7').innerHTML=`<div><span>В запасе</span><strong>${qty(result.reserve)} ${esc(suffix)}</strong></div><div><span>В работе</span><strong>${qty(result.work)} ${esc(suffix)}</strong></div><div><span>Всего</span><strong>${qty(result.total)} ${esc(suffix)}</strong></div>`;
   get('medicationDeleteEffectV7').textContent=`Будет убрано из учёта: ${qty(result.total)} ${suffix}. Карточка исчезнет из каталогов. История сохранится. Карточку можно вернуть через «Удалённые препараты», остатки при этом не возвращаются.`;
   get('medicationDeleteConfirmV7').checked=false;get('medicationDeleteConfirmV7').disabled=false;get('medicationDeleteConfirmButtonV7').disabled=false;
  }catch(error){if(sameCard(operation)&&version===previewLoad){status(error.message);get('medicationDeleteReloadV7').classList.remove('hidden');}}
 }
 async function refreshInventory(operation){
  const version=++warehouseLoad;try{
   const data=await warehouseRpc('list');if(!sameOwner(operation)||version!==warehouseLoad)return false;
   const rows=Array.isArray(data)?data:[];await signMedicationPhotos(rows);if(!sameOwner(operation)||version!==warehouseLoad)return false;
   inventory=rows;renderInventory();return true;
  }catch{return false;}
 }
 async function confirmDelete(){
  if(warehouseBusy)return;let payload;
  try{requireOwner();payload=deletePayload(preview,get('medicationDeleteReasonV7')?.value);if(payload.id!==get('medId')?.value)throw Error('Откройте выбранный препарат заново');if(!get('medicationDeleteConfirmV7').checked)throw Error('Проверьте количество и отметьте подтверждение');}
  catch(error){if(isManager())status(error.message);else message('homeMessage',error.message);return;}
  const operation=capture(payload.id);busyOperation=operation;setWarehouseBusy(true);get('medicationDeleteReasonV7').disabled=true;status('Удаляем препарат…');
  try{
   const result=await request('delete',payload,true);if(!sameCard(operation))return;
   // Clear committed inputs before refreshing, so failed reads cannot repeat stock removal.
   resetCard('');inventory=inventory.filter(item=>item.id!==payload.id);meds=meds.filter(item=>item.id!==payload.id);get('medId').value='';renderInventory();show('admin');
   const loaded=await refreshInventory(operation);if(!sameOwner(operation))return;
   message('warehouseMessage',`Препарат «${result?.name||get('medFormTitle').textContent}» удалён. История сохранена. Карточку можно вернуть через «Удалённые препараты».`+(loaded?'':' Остатки на сервере не удалось обновить. Нажмите «Обновить остатки».'),true);
  }catch(error){if(sameCard(operation)){status(error.message);if(/уже изменил|изменились|изменился|обновите/i.test(error.message))get('medicationDeleteReloadV7').classList.remove('hidden');}}
  finally{finishBusy(operation);}
 }
 async function openDeleted(){
  if(warehouseBusy)return;let operation;try{requireOwner();ensureUi();++generation;operation=capture();show('medicationDeletedV7');message('medicationDeletedMessageV7','Загружаем удалённые препараты…');}catch(error){message('homeMessage',error.message);return;}
  try{
   const data=await request('list_deleted');if(!sameDeletedScreen(operation))return;list=Array.isArray(data)?data:[];
   get('medicationDeletedListV7').innerHTML=list.map(item=>`<article class="card medication-deleted-card-v7"><h2>${esc(item.name)}</h2><p class="small">${item.deleted_at?'Удалён: '+esc(new Date(item.deleted_at).toLocaleString('ru-RU')):''}</p><p>Причина: ${esc(item.reason||'не указана')}</p><p class="small">Убрано из учёта: ${qty(item.total_removed)} ${esc(item.unit||'ед.')}.</p><p class="small">При восстановлении остаток будет 0.</p><button type="button" class="btn secondary" data-restore-id="${esc(item.id)}">Вернуть карточку</button></article>`).join('')||'<div class="notice">Удалённых препаратов нет.</div>';
   message('medicationDeletedMessageV7','');
  }catch(error){if(sameDeletedScreen(operation))message('medicationDeletedMessageV7',error.message);}
 }
 async function restoreMedication(id){
  if(warehouseBusy)return;try{requireOwner();if(!list.some(item=>item.id===id))throw Error('Обновите список удалённых препаратов');}catch(error){message('homeMessage',error.message);return;}
  const operation=capture(id);busyOperation=operation;setWarehouseBusy(true);get('medicationDeletedV7').querySelectorAll('button').forEach(button=>button.disabled=true);message('medicationDeletedMessageV7','Возвращаем карточку…');
  try{
   const result=await request('restore',{id,reason:'Восстановление удалённой карточки владельцем'},true);if(!sameOwner(operation))return;
   list=list.filter(item=>item.id!==id);get('medicationDeletedListV7').querySelectorAll('[data-restore-id]').forEach(button=>{if(button.dataset.restoreId===id)button.closest('article').remove();});
   const loaded=await refreshInventory(operation);if(!sameOwner(operation))return;finishBusy(operation);if(!sameDeletedScreen(operation))return;
   if(loaded&&inventory.some(item=>item.id===id)){openMedForm(id,'edit');medPhotoMessage.textContent='Карточка восстановлена'+(result?.active===false?' в архив':'')+'. Остаток: 0. Пересчитайте препарат перед внесением остатка.';}
   else message('medicationDeletedMessageV7','Карточка восстановлена. Остаток: 0. Обновите склад, чтобы открыть её.',true);
  }catch(error){if(sameOwner(operation))message('medicationDeletedMessageV7',error.message);}
  finally{finishBusy(operation);}
 }
 root.beginMedicationDeleteV7=beginDelete;root.confirmMedicationDeleteV7=confirmDelete;root.openDeletedMedicationsV7=openDeleted;root.restoreMedicationV7=restoreMedication;
 const previousSignOut=signOut;
 signOut=async function(){++generation;++previewLoad;preview=null;list=[];request.clear();if(busyOperation)finishBusy(busyOperation);for(const id of ['medicationDeleteEntryV7','medicationDeleteSectionV7','medicationDeletedEntryV7','medicationDeletedV7'])get(id)?.remove();return previousSignOut();};
})(typeof window==='undefined'?globalThis:window);
