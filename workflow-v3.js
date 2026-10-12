/* A lost response may already have committed: reuse the ID until confirmed. */
const clinicalRequests=new Map();
let clinicalBusy=false,bulkBusy=false;
async function treatmentRpc(kind,payload){
 const key=JSON.stringify([kind,payload]);
 if(!clinicalRequests.has(key))clinicalRequests.set(key,crypto.randomUUID());
 const {data,error}=await db.rpc('record_treatment_v3',{p_kind:kind,p_payload:payload,p_request_id:clinicalRequests.get(key)});
 if(error){if(/^[0-9A-Z]{5}$/.test(error.code||''))clinicalRequests.delete(key);throw new Error(error.message||'Нет ответа от сервера. Повторите сохранение.')}
 clinicalRequests.delete(key);return data;
}
async function saveTreatment(kind){
 if(clinicalBusy)return;
 const prefix=kind==='procedure'?'proc':'sale',screen=kind;
 try{
  if(!shift?.id)throw new Error('Сначала откройте смену');
  const items=rows(prefix+'Meds');
  for(const item of items)positiveWhole(item.quantity,'Количество препарата');
  const payload={shift_id:shift.id,nurse_id:$(prefix+'Nurse').value,patient_id:$(prefix+'Patient').value||null,
   paid_total:nonnegative($(prefix+'Paid').value,'Оплата'),discount_reason:$(prefix+'DiscountReason').value||null,
   discount_comment:$(prefix+'DiscountComment').value.trim()||null,notes:$(prefix+'Notes').value.trim()||null,items};
  if(kind==='procedure')payload.service_id=$('procService').value;
  clinicalBusy=true;document.querySelectorAll('#'+screen+' button,#'+screen+' input,#'+screen+' select,#'+screen+' textarea').forEach(e=>e.disabled=true);
  message(screen+'Message','Сохраняем…');
  const receipt=await treatmentRpc(kind,payload);
  // Clear the saved form before refreshing, including on refresh failure.
  $(prefix+'Meds').innerHTML='';$(prefix+'Paid').value='';
  message(screen+'Message',receipt?.stock_deducted===false?'Сохранено. Оплата учтена, остатки склада не изменены.':'Сохранено. Препараты списаны из рабочего шкафа.',true);
  show('workspace');await refreshDashboard();
 }catch(e){message(screen+'Message',e.message)}
 finally{clinicalBusy=false;document.querySelectorAll('#'+screen+' button,#'+screen+' input,#'+screen+' select,#'+screen+' textarea').forEach(e=>e.disabled=false)}
}
saveProcedure=()=>saveTreatment('procedure');
saveSale=()=>saveTreatment('sale');
/* Bulk rows have independent warehouse receipts. Freeze the unconfirmed row
   and remaining batch until its response is known; committed rows never replay. */
let bulkSessionV16=0,bulkDraftV16=null,bulkOperationV16=null,bulkWarehouseLockV16=null;
const bulkActorV16=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,bulkSessionV16]);
function bulkSameActorV16(actor){return typeof isManager==='function'&&isManager()&&actor===bulkActorV16()}
function bulkCurrentV16(operation){return bulkSameActorV16(operation.actor)&&$('bulkImport')?.classList.contains('active')&&(operation.navigation===null||operation.navigation===quickNavigation4)}
function bulkAcquireWarehouseV16(draft){bulkWarehouseLockV16=draft;if(typeof setWarehouseBusy==='function')setWarehouseBusy(true)}
function bulkReleaseWarehouseV16(draft){if(bulkWarehouseLockV16!==draft)return;bulkWarehouseLockV16=null;if(typeof setWarehouseBusy==='function'){setWarehouseBusy(false);if(typeof restoreFieldLocks==='function')restoreFieldLocks()}}
function bulkControlsV16(){
 const draft=bulkDraftV16,button=$('bulkImport')?.querySelector('button[onclick="bulkImportMeds()"]');
 bulkText.disabled=bulkBusy||!!draft;
 if(button){button.disabled=bulkBusy;button.textContent=draft?.finished?'Показать результат импорта':draft?.editable?'Показать оставшиеся строки':draft?'Повторить импорт':'Добавить список'}
}
function bulkPayloadV16(line){
 const a=line.split(';').map(value=>value.trim());if(!a[0])throw Error('Введите название');
 const payload={id:null,name:a[0],country:a[1]||'',unit:a[2]||'ед.',units_per_package:positiveWhole(a[4]||1,'Размер упаковки'),purchase_price:nonnegative(a[5]||0,'Закупка'),sale_price:nonnegative(a[6]||0,'Продажа'),min_total_stock:nonnegative(a[7]||0,'Минимум'),work_threshold:nonnegative(a[8]||0,'Минимум в работе'),lead_time_days:nonnegative(a[9]||3,'Срок поставки')};
 if(!Number.isSafeInteger(payload.lead_time_days))throw Error('Срок поставки указывается в целых днях');
 return payload;
}
bulkImportMeds=async function(){
 if(bulkBusy||typeof isManager!=='function'||!isManager())return;
 if(typeof warehouseBusy!=='undefined'&&warehouseBusy&&!bulkWarehouseLockV16||typeof medicationDraftV16!=='undefined'&&medicationDraftV16||typeof stockDraftV16!=='undefined'&&stockDraftV16){bulkMessage.textContent='Сначала завершите сохранение карточки или складской операции.';return}
 const actor=bulkActorV16();
 if(bulkDraftV16&&!bulkSameActorV16(bulkDraftV16.actor))bulkDraftV16=null;
 if(bulkDraftV16?.finished||bulkDraftV16?.editable){
  const draft=bulkDraftV16;bulkText.value=draft.lines.join('\n');bulkMessage.textContent=draft.resultMessage;bulkDraftV16=null;bulkControlsV16();return;
 }
 if(!bulkDraftV16){
  const lines=bulkText.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length){bulkMessage.textContent='Введите список препаратов.';return}
  bulkDraftV16={actor,lines,current:null,confirmed:0,finished:false,editable:false,resultMessage:''};
 }
 const draft=bulkDraftV16,operation={actor, draft,navigation:typeof quickNavigation4==='undefined'?null:quickNavigation4};
 bulkOperationV16=operation;bulkBusy=true;bulkAcquireWarehouseV16(draft);bulkControlsV16();
 if(bulkCurrentV16(operation)){bulkText.value=draft.lines.join('\n');bulkMessage.textContent='Добавляем препараты…'}
 let refreshNeeded=false;
 try{
  while(draft.lines.length){
   if(!bulkSameActorV16(actor))return;
   if(!draft.current)draft.current={payload:bulkPayloadV16(draft.lines[0]),started:false};
   draft.current.started=true;
   const result=await warehouseRpc('save',draft.current.payload,true);
   if(!bulkSameActorV16(actor))return;
   if(!result?.id){const failure=Error('Ответ о сохранении не получен.');failure.uncertain=true;throw failure}
   draft.lines.shift();draft.confirmed++;draft.current=null;refreshNeeded=true;
   if(bulkCurrentV16(operation))bulkText.value=draft.lines.join('\n');
  }
  draft.finished=true;draft.resultMessage=`Карточек добавлено: ${draft.confirmed}. Откройте каждую карточку и внесите фактические остатки.`;
  if(bulkCurrentV16(operation)){bulkMessage.textContent=draft.resultMessage;bulkDraftV16=null}
 }catch(error){
  if(!bulkSameActorV16(actor))return;
  const definitive=!draft.current?.started||error.definitive===true||typeof SaveRecoveryV16!=='undefined'&&SaveRecoveryV16.isDefinitive(error,error.status);
  if(definitive){
   draft.current=null;draft.editable=true;draft.resultMessage=`Добавлено: ${draft.confirmed}. Следующая строка не сохранена: ${error.message} Исправьте оставшиеся строки и продолжите импорт.`;
   if(bulkCurrentV16(operation)){bulkText.value=draft.lines.join('\n');bulkDraftV16=null}
  }else draft.resultMessage=`Добавлено: ${draft.confirmed}. По следующей строке ответ сервера не получен. Нажмите «Повторить импорт» — карточка и ранее добавленные строки не продублируются.`;
  if(bulkCurrentV16(operation))bulkMessage.textContent=draft.resultMessage;
 }finally{
  // A successful import and its later display refresh are separate outcomes.
  if(refreshNeeded&&bulkSameActorV16(actor)){
   let loaded=false;try{loaded=await loadInventory()}catch(_error){}
   if(!loaded){draft.resultMessage+=' Добавленные карточки сохранены. Список не обновился; нажмите «Обновить остатки».';if(bulkCurrentV16(operation))bulkMessage.textContent=draft.resultMessage}
  }
  if(bulkOperationV16===operation){bulkOperationV16=null;bulkBusy=false;if(draft.finished||draft.editable||!bulkSameActorV16(actor))bulkReleaseWarehouseV16(draft);if(bulkSameActorV16(actor))bulkControlsV16()}
 }
};
if(typeof signOut==='function'){
 const bulkSignOutV16=signOut;
 signOut=async function(){++bulkSessionV16;if(bulkWarehouseLockV16)bulkReleaseWarehouseV16(bulkWarehouseLockV16);bulkDraftV16=null;bulkOperationV16=null;bulkBusy=false;bulkText.value='';bulkMessage.textContent='';bulkControlsV16();return bulkSignOutV16()};
}
