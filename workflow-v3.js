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
  await treatmentRpc(kind,payload);
  // Clear the saved form before refreshing, including on refresh failure.
  $(prefix+'Meds').innerHTML='';$(prefix+'Paid').value='';
  message(screen+'Message','Сохранено. Препараты списаны из рабочего шкафа.',true);
  show('workspace');await refreshDashboard();
 }catch(e){message(screen+'Message',e.message)}
 finally{clinicalBusy=false;document.querySelectorAll('#'+screen+' button,#'+screen+' input,#'+screen+' select,#'+screen+' textarea').forEach(e=>e.disabled=false)}
}
saveProcedure=()=>saveTreatment('procedure');
saveSale=()=>saveTreatment('sale');
bulkImportMeds=async function(){
 if(bulkBusy)return;bulkBusy=true;let ok=0;
 const lines=bulkText.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 bulkText.disabled=true;
 try{
  while(lines.length){const a=lines[0].split(';').map(x=>x.trim());
   if(!a[0])throw new Error('Введите название');
   await warehouseRpc('save',{id:null,name:a[0],country:a[1]||'',unit:a[2]||'ед.',units_per_package:positiveWhole(a[4]||1,'Размер упаковки'),purchase_price:nonnegative(a[5]||0,'Закупка'),sale_price:nonnegative(a[6]||0,'Продажа'),min_total_stock:nonnegative(a[7]||0,'Минимум'),work_threshold:nonnegative(a[8]||0,'Минимум в работе'),lead_time_days:nonnegative(a[9]||3,'Срок поставки')},true);
   lines.shift();ok++;bulkText.value=lines.join('\n');
  }
  bulkMessage.textContent=`Карточек добавлено: ${ok}. Откройте каждую карточку и внесите фактические остатки.`;
 }catch(e){bulkMessage.textContent=`Добавлено: ${ok}. Следующая строка не сохранена: ${e.message}`}
 finally{bulkText.disabled=false;bulkBusy=false;await loadInventory()}
};
