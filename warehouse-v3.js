/* Stock quantities are always consumption units; package counts are display-only. */
const stockRequests=new Map();
let warehouseBusy=false, warehouseLoad=0, medView=0;
const qty=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4}).format(Number(v)||0);
const unit=m=>({ampoule:'амп.',vial:'фл.',tablet:'таб.'}[m?.consumption_unit]||m?.consumption_unit||'ед.');
function packSize(m){const n=Number(m?.units_per_package);return Number.isFinite(n)&&n>=1?n:1}
function packLabel(amount,m){const size=packSize(m),packs=Math.floor(Number(amount)/size),loose=Number(amount)-packs*size;return `${qty(packs)} уп.`+(loose?` + ${qty(loose)} ${unit(m)}`:'')}
function expiryDays(date){if(!date)return null;return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(localDateValue()+'T00:00:00Z'))/86400000)}
function stockFacts(m){const work=num(m.work_qty),reserve=num(m.reserve_qty),total=work+reserve,days=expiryDays(m.nearest_expiry);return {work,reserve,total,days,order:total<num(m.min_total_stock),refill:work<num(m.work_threshold)&&reserve>0}}
function stockCells(m){const f=stockFacts(m);return `<div class="stock-grid"><div class="stock-cell"><span class="small">В запасе</span><strong>${esc(packLabel(f.reserve,m))}</strong><small>${qty(f.reserve)} ${esc(unit(m))} · по ${qty(packSize(m))} в упаковке</small></div><div class="stock-cell work"><span class="small">В работе</span><strong>${qty(f.work)} ${esc(unit(m))}</strong><small>Годно к использованию: ${qty(m.work_available??f.work)} ${esc(unit(m))}</small></div><div class="stock-cell"><span class="small">Всего</span><strong>${qty(f.total)} ${esc(unit(m))}</strong><small>Запас + рабочий шкаф</small></div></div>`}
function isManager(){return ['admin','owner'].includes(currentStaff?.role)}
function message(id,text,success=false){$(id).innerHTML=text?`<div class="notice${success?' success':''}">${esc(text)}</div>`:''}
async function warehouseRpc(action,payload={},write=false){
  if(!isManager())throw new Error('Нет доступа к складу');
  const key=JSON.stringify([action,payload]);
  if(write&&!stockRequests.has(key))stockRequests.set(key,crypto.randomUUID());
  const {data,error}=await db.rpc('warehouse_v5',{p_action:action,p_payload:payload,p_request_id:write?stockRequests.get(key):null});
  if(error){
    // An explicit PostgreSQL error means rollback. Keep IDs on transport errors,
    // where the request may have committed before the response was lost.
    if(write&&/^[0-9A-Z]{5}$/.test(error.code||''))stockRequests.delete(key);
    throw new Error(error.message||'Не удалось выполнить операцию. Проверьте соединение и повторите.');
  }
  if(write)stockRequests.delete(key);
  return data;
}
async function loadInventory(){
  if(!isManager())return false;
  const version=++warehouseLoad;
  message('warehouseMessage','Загружаем остатки…');
  try{
    const data=await warehouseRpc('list');
    if(version!==warehouseLoad||!isManager())return false;
    inventory=data||[];await signMedicationPhotos(inventory);
    if(version!==warehouseLoad||!isManager())return false;
    renderInventory();message('warehouseMessage','');return true;
  }catch(e){if(version===warehouseLoad)message('warehouseMessage','Не удалось обновить остатки: '+e.message);return false}
}
function renderInventory(){
  if(!isManager())return;
  const active=inventory.filter(m=>m.active!==false);
  const archived=inventory.length-active.length;
  $('archiveNotice').innerHTML=archived?`<div class="notice">В архиве: ${archived}. <button class="btn secondary" onclick="inventoryFilter.value='archive';renderInventory()">Показать архив</button></div>`:'';
  const stat=(label,n)=>`<div class="stat"><span class="small">${label}</span><b>${n}</b></div>`;
  inventorySummary.innerHTML=stat('Пополнить рабочий шкаф',active.filter(m=>stockFacts(m).refill).length)+stat('Нужно заказать',active.filter(m=>stockFacts(m).order).length)+stat('Срок до 60 дней / истёк',active.filter(m=>{const d=stockFacts(m).days;return d!==null&&d<=60}).length);
  const q=inventorySearch.value.trim().toLocaleLowerCase('ru'),filter=inventoryFilter.value;
  const visible=inventory.filter(m=>{
    if(filter==='archive'?m.active!==false:m.active===false)return false;
    const f=stockFacts(m);
    if(filter==='refill'&&!f.refill||filter==='order'&&!f.order||filter==='expiry'&&!(f.days!==null&&f.days<=60))return false;
    return !q||[m.name,m.generic_name,m.category,m.search_name,m.dosage,m.manufacturer_country,m.manufacturer].some(v=>String(v||'').toLocaleLowerCase('ru').includes(q));
  });
  inventoryCount.textContent=`Найдено препаратов: ${visible.length}`;
  inventoryList.innerHTML=visible.map(m=>{
    const f=stockFacts(m),bad=m.active===false?'В архиве':f.order?'Нужно заказать':f.refill?'Пополнить шкаф':'Остатки в норме';
    return `<article class="inventory-card"><div class="inventory-heading">${medPhotoHtml(m)}<div style="flex:1;min-width:0"><div class="row between"><h2>${esc(m.name)}</h2><span class="pill ${f.order?'status-bad':f.refill?'status-warn':''}">${bad}</span></div><p class="small">${esc([m.generic_name,m.dosage,m.manufacturer_country,m.category].filter(Boolean).join(' · '))}</p></div></div>${stockCells(m)}<div class="row between"><span class="small">Закупка ${rub(m.purchase_price)}/уп. · Продажа ${rub(m.sale_price)}/${esc(unit(m))}</span>${f.days!==null?`<span class="${f.days<0?'status-bad':f.days<=60?'status-warn':'small'}">${f.days<0?'Срок истёк':'Ближайший срок'}: ${esc(m.nearest_expiry)}</span>`:''}</div><div class="row" style="margin-top:15px"><button class="btn secondary" onclick="openMedForm('${m.id}')">Карточка и история</button>${m.active!==false?`<button class="btn secondary" onclick="openMedForm('${m.id}','receive')">＋ Приход партии</button><button class="btn primary" ${f.reserve<=0?'disabled':''} onclick="openMedForm('${m.id}','transfer')">Перевести в работу</button>`:''}</div></article>`;
  }).join('')||'<div class="notice">Препараты не найдены. Измените поиск или добавьте новую карточку.</div>';
}
function openMedForm(id='',focus=''){
  if(!isManager()||warehouseBusy)return;
  const m=inventory.find(x=>x.id===id);if(id&&!m)return;
  ++medView;medFormTitle.textContent=m?m.name:'Новый препарат';medId.value=m?.id||'';
  const fields={medName:'name',medSearchName:'search_name',medDosage:'dosage',medCountry:'manufacturer_country',medGeneric:'generic_name',medCategory:'category'};
  Object.entries(fields).forEach(([input,key])=>$(input).value=m?.[key]||'');
  medUnit.value=m?.consumption_unit||'амп.';medUnit.disabled=!!m&&stockFacts(m).total>0;medPurchaseUnit.value='упаковка';medPurchaseUnit.readOnly=true;
  medUnitsPerPack.value=m?.units_per_package||1;medUnitsPerPack.disabled=!!m&&stockFacts(m).total>0;
  medUnitsPerPack.title=medUnitsPerPack.disabled?'Размер упаковки нельзя менять при ненулевом остатке':'';
  medPurchasePrice.value=m?.purchase_price??0;medSalePrice.value=m?.sale_price??0;
  medMin.value=m?.min_total_stock??0;medWorkMin.value=m?.work_threshold??0;medLeadDays.value=m?.lead_time_days??3;
  medPhoto.value='';medPhotoMessage.textContent='';
  if(medPhotoObjectUrl){URL.revokeObjectURL(medPhotoObjectUrl);medPhotoObjectUrl=null}
  medPhotoPreview.innerHTML=m&&photoSrc(m.photo_path)?`<img src="${esc(photoSrc(m.photo_path))}" alt="Упаковка">`:'📦';
  medStockSummary.innerHTML=m?stockCells(m):'';
  stockActions.classList.toggle('hidden',!m);stockActiveActions.classList.toggle('hidden',m?.active===false);
  archiveButton.textContent=m?.active===false?'Восстановить из архива':'Архивировать';
  archiveButton.disabled=!!m&&m.active!==false&&stockFacts(m).total!==0;
  message('stockOperationMessage','');receivePackages.value='';receivePrice.value=m?.purchase_price??0;
  openingQty.value='';openingLocation.value='reserve';openingPrice.value=m?.purchase_price??0;openingExpiry.value='';openingExpiry.min=localDateValue();openingComment.value='';
  receiveExpiry.value='';receiveExpiry.min=localDateValue();receiveComment.value='';transferQty.value='';transferMode.value='units';transferComment.value='';
  batchList.innerHTML='';movementList.innerHTML='';show('medForm');updateStockPreview();
  if(m)loadStockDetails(id,medView);
  $('openingPanel').open=!!m&&stockFacts(m).total===0;$('receivePanel').open=focus==='receive';$('transferPanel').open=focus==='transfer';$('returnQty').value='';$('writeoffQty').value='';$('writeoffReason').value='';$('writeoffBatch').innerHTML='';if(focus==='receive')receivePackages.focus();else if(focus==='transfer')transferQty.focus();
}
function positiveWhole(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw new Error(label+': введите целое число больше нуля');return n}
function nonnegative(value,label){const n=Number(value);if(value===''||!Number.isFinite(n)||n<0)throw new Error(label+': введите число от нуля');return n}
function updateStockPreview(){
  const m=inventory.find(x=>x.id===medId.value);if(!m)return;
  const amount=Number(receivePackages.value),t=Number(transferQty.value)*(transferMode.value==='packs'?packSize(m):1);
  receivePreview.textContent=amount>0?`В запас поступит ${qty(amount*packSize(m))} ${unit(m)} Закупка: ${rub(amount*num(receivePrice.value))}.`:`В упаковке ${qty(packSize(m))} ${unit(m)}`;
  transferPreview.textContent=t>0?`Перевод: ${qty(t)} ${unit(m)} В запасе останется ${qty(num(m.reserve_qty)-t)}, в работе будет ${qty(num(m.work_qty)+t)} ${unit(m)}`:`Доступно в запасе: ${packLabel(m.reserve_qty,m)} (${qty(m.reserve_qty)} ${unit(m)}).`;
}
function previewMedPhoto(){
  const file=medPhoto.files?.[0];if(medPhotoObjectUrl){URL.revokeObjectURL(medPhotoObjectUrl);medPhotoObjectUrl=null}
  if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){medPhotoMessage.textContent='Только JPG, PNG или WEBP до 5 МБ.';medPhoto.value='';return}
  medPhotoObjectUrl=URL.createObjectURL(file);medPhotoPreview.innerHTML=`<img src="${medPhotoObjectUrl}" alt="Предпросмотр упаковки">`;
  medPhotoMessage.textContent='Фото загрузится при сохранении карточки.';
}
function setWarehouseBusy(value){warehouseBusy=value;document.querySelectorAll('#medForm button,#medForm input,#medForm select').forEach(el=>el.disabled=value)}
async function saveMedication(){
  if(warehouseBusy||!isManager())return;
  let payload,file;
  try{
    const name=medName.value.trim();if(!name)throw new Error('Введите название препарата');
    payload={id:medId.value||null,name,search_name:medSearchName.value.trim(),dosage:medDosage.value.trim(),country:medCountry.value.trim(),generic_name:medGeneric.value.trim(),category:medCategory.value.trim(),unit:medUnit.value.trim(),
      units_per_package:positiveWhole(medUnitsPerPack.value,'Размер упаковки'),purchase_price:nonnegative(medPurchasePrice.value,'Закупка'),sale_price:nonnegative(medSalePrice.value,'Продажа'),min_total_stock:nonnegative(medMin.value,'Минимальный остаток'),work_threshold:nonnegative(medWorkMin.value,'Минимум в работе'),lead_time_days:nonnegative(medLeadDays.value,'Срок поставки')};
    if(!Number.isSafeInteger(payload.lead_time_days))throw new Error('Срок поставки указывается в целых днях');
    file=medPhoto.files?.[0];if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024))throw new Error('Только JPG, PNG или WEBP до 5 МБ');
  }catch(e){medPhotoMessage.textContent=e.message;return}
  setWarehouseBusy(true);medPhotoMessage.textContent='Сохраняем карточку…';
  try{
    const result=await warehouseRpc('save',payload,true);medId.value=result.id;
    if(file){
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`${result.id}/${crypto.randomUUID()}.${ext}`;
      const upload=await db.storage.from('medication-photos').upload(path,file,{contentType:file.type,upsert:false});
      if(upload.error)throw new Error('Карточка сохранена. Фото не загрузилось: '+upload.error.message);
      const meta=await db.rpc('manager_medication_details_photo_v1',{p_id:result.id,p_search_name:payload.search_name||null,p_dosage:payload.dosage||null,p_photo_path:path});
      if(meta.error)throw new Error('Карточка сохранена. Не удалось прикрепить фото: '+meta.error.message);
    }
    const loaded=await loadInventory();setWarehouseBusy(false);
    if(loaded){inventorySearch.value='';inventoryFilter.value='active';renderInventory();openMedForm(result.id);}
    medPhotoMessage.textContent=loaded?'Карточка сохранена. Теперь внесите имеющийся остаток ниже или вернитесь к списку препаратов.':'Карточка сохранена, но остатки не обновились. Нажмите «Обновить остатки».';
  }catch(e){medPhotoMessage.textContent=e.message}
  finally{setWarehouseBusy(false);restoreFieldLocks()}
}
function restoreFieldLocks(){const m=inventory.find(x=>x.id===medId.value);medUnitsPerPack.disabled=!!m&&stockFacts(m).total>0;medUnit.disabled=medUnitsPerPack.disabled;archiveButton.disabled=!!m&&m.active!==false&&stockFacts(m).total!==0}
async function stockMutation(action,payload,success){
  if(warehouseBusy)return;setWarehouseBusy(true);message('stockOperationMessage','Сохраняем операцию…');
  try{
    await warehouseRpc(action,payload,true);
    // Clear committed input before reloading, so a failed reload cannot repeat it.
    if(action==='return')$('returnQty').value='';if(action==='writeoff')$('writeoffQty').value='';if(action==='opening')openingQty.value='';if(action==='receive')receivePackages.value='';if(action==='transfer')transferQty.value='';
    const loaded=await loadInventory();setWarehouseBusy(false);
    if(loaded)openMedForm(payload.id);
    message('stockOperationMessage',success+(loaded?'':' Остатки не обновились. Обновите список склада.'),true);
  }catch(e){message('stockOperationMessage',e.message)}
  finally{setWarehouseBusy(false);restoreFieldLocks()}
}
async function receiveStock(){
  try{
    const packs=positiveWhole(receivePackages.value,'Упаковки'),price=nonnegative(receivePrice.value,'Цена');
    if(!receiveExpiry.value||receiveExpiry.value<localDateValue())throw new Error('Укажите действующий срок годности партии');
    await stockMutation('receive',{id:medId.value,packages:packs,price,expiry:receiveExpiry.value,comment:receiveComment.value.trim()},'Партия добавлена в запас.');
  }catch(e){message('stockOperationMessage',e.message)}
}
async function transferToWork(){
  try{
    const m=inventory.find(x=>x.id===medId.value);if(!m)throw new Error('Выберите препарат');
    const amount=positiveWhole(transferQty.value,'Количество'),n=amount*(transferMode.value==='packs'?packSize(m):1);
    if(n>num(m.reserve_available??m.reserve_qty))throw new Error('Недостаточно годного препарата в запасе. Проверьте партии и сроки годности.');
    await stockMutation('transfer',{id:m.id,quantity:n,comment:transferComment.value.trim()},'Препарат переведён в рабочий шкаф. Общий остаток не изменился.');
  }catch(e){message('stockOperationMessage',e.message)}
}
async function archiveMedication(){
  const m=inventory.find(x=>x.id===medId.value);if(!m||warehouseBusy)return;
  const action=m.active===false?'restore':'archive';
  if(action==='archive'&&prompt(`Карточка исчезнет из активного списка. Чтобы отправить её в архив, введите название полностью: ${m.name}`)!==m.name)return;
  await stockMutation(action,{id:m.id},action==='archive'?'Карточка в архиве.':'Карточка восстановлена.');
}
async function loadStockDetails(id,view){
  batchList.textContent='Загрузка партий…';movementList.textContent='Загрузка движений…';
  const results=await Promise.allSettled([warehouseRpc('batches',{id}),warehouseRpc('history',{id})]);
  if(view!==medView||medId.value!==id||!isManager())return;
  const m=inventory.find(x=>x.id===id),b=results[0],h=results[1];
  batchList.innerHTML=b.status==='rejected'?`<div class="notice">${esc(b.reason.message)}</div>`:b.value.map(x=>{
    const days=expiryDays(x.expiry_date),warn=num(x.quantity_remaining)>0&&days!==null&&days<=60;
    return `<div class="item ${warn?(days<0?'batch-expired':'batch-soon'):''}"><strong>${x.expiry_date?'Годен до '+esc(x.expiry_date):'Срок не указан'}${warn&&days<0?' · Срок истёк':''}</strong><div class="small">Приход ${esc(x.received_date)} · запас ${qty(num(x.quantity_remaining)-num(x.work_quantity))}, шкаф ${qty(x.work_quantity)} · всего ${qty(x.quantity_remaining)} из ${qty(x.quantity_received)} ${esc(unit(m))} · закупка ${rub(x.purchase_price_per_unit)}/${esc(unit(m))}</div></div>`;
  }).join('')||'<div class="notice">Партий пока нет. Оформите первый приход.</div>';
  $('writeoffBatch').innerHTML=b.status==='fulfilled'?'<option value="">Выберите партию</option>'+b.value.filter(x=>num(x.quantity_remaining)>0).map(x=>`<option value="${esc(x.id)}">Годен до ${esc(x.expiry_date||'не указан')} · запас ${qty(num(x.quantity_remaining)-num(x.work_quantity))}, шкаф ${qty(x.work_quantity)}</option>`).join(''):'';
  const names={purchase:'Приход',reserve_to_work:'Из запаса в работу',transfer_to_work:'Из запаса в работу',work_to_reserve:'Возврат в запас',procedure_use:'Процедура',sale:'Продажа',write_off:'Списание',correction:'Корректировка'};
  movementList.innerHTML=h.status==='rejected'?`<div class="notice">${esc(h.reason.message)}</div>`:h.value.map(x=>`<div class="item"><div class="row between"><strong>${esc(names[x.movement_type]||x.movement_type)}</strong><b>${qty(x.quantity)} ${esc(unit(m))}</b></div><div class="small">${esc(new Date(x.created_at).toLocaleString('ru-RU'))} · ${x.to_location==='work'?'В рабочий шкаф':x.to_location==='reserve'?'В запас':x.from_location==='work'?'Из рабочего шкафа':x.from_location==='reserve'?'Из запаса':''}</div>${x.comment?`<div>${esc(x.comment)}</div>`:''}</div>`).join('')||'<div class="notice">Движений пока нет.</div>';
}

async function saveOpeningStock(){
  try{
    const quantity=positiveWhole(openingQty.value,'Количество'),price=nonnegative(openingPrice.value,'Цена');
    if(!openingExpiry.value||openingExpiry.value<localDateValue())throw new Error('Укажите действующий срок годности');
    await stockMutation('opening',{id:medId.value,quantity,price,location:openingLocation.value,expiry:openingExpiry.value,comment:openingComment.value.trim()},'Имеющийся остаток добавлен. Не вносите эту же партию повторно.');
  }catch(e){message('stockOperationMessage',e.message)}
}

async function returnToReserve(){
 try{await stockMutation('return',{id:medId.value,quantity:positiveWhole($('returnQty').value,'Количество')},'Препарат возвращён в запас. Общий остаток не изменился.')}catch(e){message('stockOperationMessage',e.message)}
}
async function writeOffStock(){
 try{const reason=$('writeoffReason').value.trim(),batch=$('writeoffBatch').value;
 if(!batch||!reason)throw new Error('Выберите партию и укажите причину списания');
 await stockMutation('writeoff',{id:medId.value,quantity:positiveWhole($('writeoffQty').value,'Количество'),batch_id:batch,location:$('writeoffLocation').value,comment:reason},'Списание сохранено в истории. Остаток уменьшен.');
 }catch(e){message('stockOperationMessage',e.message)}
}
