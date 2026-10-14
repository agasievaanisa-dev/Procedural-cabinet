/* Gradual inventory adoption: server-authoritative deductions and review queue. */
(function(root){
 'use strict';
 const get=id=>document.getElementById(id),requests=new Map();let busy=false,view=0;
 const actor=()=>currentStaff?.id+':'+currentStaff?.role;
 const supported=()=>typeof financeAccountingMode5?.partial_stock==='boolean';
 const partial=prefix=>(financeTreatmentMode5[prefix]||financeAccountingMode5)?.partial_stock===true;
 const reasons={untracked:'Остаток ещё не подключён',not_tracked:'Остаток ещё не подключён',shortage:'Не хватает остатка',insufficient_stock:'Не хватает остатка',unknown_expiry:'Срок не указан',expiry_missing:'Срок не указан',expired:'Срок истёк',insufficient_available:'Не хватает годного остатка'};
 const reason=value=>reasons[value]||'Требуется сверка остатка';
 async function rpc(action,payload={},write=false){
  const who=actor(),key=who+':'+action+':'+JSON.stringify(payload);let requestId=null;
  if(write){requestId=requests.get(key)||crypto.randomUUID();requests.set(key,requestId);}
  let response;try{response=await db.rpc('crm_partial_stock_v28',{p_action:action,p_payload:payload,p_request_id:requestId});}catch(error){throw typeof financeSaveErrorV16==='function'?financeSaveErrorV16(error):error;}
  if(actor()!==who)throw Error('Учётная запись изменилась. Откройте экран заново.');
  if(response?.error){const e=typeof financeSaveErrorV16==='function'?financeSaveErrorV16(response.error,response.status):Error(response.error.message);if(!e.uncertain)requests.delete(key);throw e;}
  if(!response||response.data==null)throw Error('Ответ о сохранении не получен. Повторите действие.');
  requests.delete(key);return response.data;
 }
 root.partialStockReceiptTextV28=function(receipt){
  if(receipt?.stock_mode!=='partial')return '';
  const s=receipt.stock_summary||{};return ` Склад: списано ${qty(s.deducted_quantity||0)} ед.; к сверке ${qty(s.pending_quantity||0)} ед.`;
 };
 root.partialStockMedicationHtmlV28=function(m,target){
  if(!partial(target==='procMeds'?'proc':'sale'))return '';
  return `<small class="partial-stock-label-v28 ${m.stock_tracking_enabled?'connected':'pending'}">${m.stock_tracking_enabled?'Учёт подключён · '+(m.total_available==null?'в работе '+qty(m.work_qty):'доступно '+qty(m.total_available))+' '+esc(unit(m)):'Пока только прайс'}</small>${num(m.unknown_expiry_qty)>0?'<small class="partial-stock-label-v28 pending">Есть остаток без срока</small>':''}`;
 };
 function controls(){
  if(!isManager()||!supported())return;
  const tools=get('admin')?.querySelector('.warehouse-tools');
  if(tools&&!get('partialStockReviewEntryV28')){const button=document.createElement('button');button.type='button';button.id='partialStockReviewEntryV28';button.className='btn secondary';button.textContent='Расход к сверке';button.onclick=root.openPartialStockReviewV28;tools.append(button);}
  const home=get('workspace')?.querySelector('.home-actions');
  if(home&&!get('partialStockReviewHomeV28')){const button=document.createElement('button');button.type='button';button.id='partialStockReviewHomeV28';button.innerHTML='<span>▤</span><strong>Расход к сверке</strong>';button.onclick=root.openPartialStockReviewV28;home.append(button);}
 }
 function warehouseLabels(){
  if(!isManager())return;controls();
  if(financeAccountingMode5?.partial_stock!==true){get('inventoryList')?.querySelectorAll('[data-partial-stock-v28]').forEach(node=>node.remove());return;}
  for(const card of get('inventoryList')?.querySelectorAll('[data-medication-id]')||[]){
   const m=inventory.find(x=>x.id===card.dataset.medicationId);if(!m||typeof m.stock_tracking_enabled!=='boolean'||m.active===false)continue;
   let label=card.querySelector('[data-partial-stock-v28]');
   if(!label){label=document.createElement('div');label.dataset.partialStockV28='';label.className='row partial-stock-controls-v28';card.append(label);}
   label.innerHTML=`<span class="small">${m.stock_tracking_enabled?'Автосписание подключено':'Пока только прайс'}</span>`;
   const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent=m.stock_tracking_enabled?'Приостановить списание':'Подключить списание';button.disabled=busy;button.onclick=()=>root.setMedicationStockTrackingV28(m.id,!m.stock_tracking_enabled);label.append(button);
  }
 }
 root.setMedicationStockTrackingV28=async function(id,enabled){
  if(!isManager()||busy)return;const who=actor();busy=true;warehouseLabels();
  try{await rpc('tracking_set',{id,enabled,reason:'Настройка поэтапного учёта администратором'},true);if(actor()!==who||!isManager())return;const m=inventory.find(x=>x.id===id);if(m)m.stock_tracking_enabled=enabled;message('warehouseMessage',enabled?'Автосписание подключено для новых расходов. Прежние процедуры повторно не списываются.':'Автосписание приостановлено. Новые расходы будут видны в списке для сверки.',true);await Promise.all([loadInventory(),loadMeds()]);}
  catch(error){if(actor()===who&&isManager())message('warehouseMessage',error.message);}
  finally{busy=false;if(actor()===who&&isManager())warehouseLabels();}
 };
 root.openPartialStockReviewV28=async function(){
  if(!isManager())return;const who=actor(),token=++view;let host=get('partialStockReviewV28');
  if(!host){host=document.createElement('section');host.id='partialStockReviewV28';host.className='screen';get('workspace').parentElement.append(host);}
  host.innerHTML='<div class="row between"><h1>Расход к сверке</h1><button type="button" class="btn secondary" id="partialStockReviewBackV28">Назад</button></div><p class="sub">Здесь препараты, которые вошли в процедуры или продажи, но ещё не списаны со склада. После заполнения остатков новые расходы списываются автоматически.</p><div id="partialStockReviewMessageV28" role="status">Загружаем…</div><div id="partialStockReviewBodyV28"></div>';get('partialStockReviewBackV28').onclick=()=>show('workspace');show(host.id);
  try{
   const data=await rpc('review_summary');if(actor()!==who||!isManager()||token!==view)return;
   get('partialStockReviewMessageV28').textContent='';const body=get('partialStockReviewBodyV28');
   body.innerHTML=`<div class="card"><strong>К сверке: ${qty(data.pending_quantity||0)} ед.</strong><p class="small">Количество отмечается в учётных единицах препарата. Внесение остатка не списывает повторно прошлые процедуры.</p></div>`;
   for(const row of data.medications||[]){
    const card=document.createElement('article');card.className='card';card.innerHTML=`<h2>${esc(row.name)}</h2><p><b>${qty(row.pending_quantity)} ${esc(row.unit||'ед.')}</b> · записей: ${qty(row.records_count||0)}</p><p class="small">${[...new Set((row.reasons||[]).map(reason))].map(esc).join(' · ')}</p>`;
    const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='Проверить остаток';button.onclick=()=>openMedForm(row.medication_id,'correct');card.append(button);body.append(card);
   }
   if(!(data.medications||[]).length)body.insertAdjacentHTML('beforeend','<div class="card">Расхода к сверке пока нет.</div>');
  }catch(error){if(actor()===who&&isManager()&&token===view){get('partialStockReviewMessageV28').textContent=error.message;const button=document.createElement('button');button.className='btn secondary';button.textContent='Повторить';button.onclick=root.openPartialStockReviewV28;get('partialStockReviewMessageV28').append(button);}}
 };
 const availabilityBase=renderTreatmentAvailability4;
 renderTreatmentAvailability4=function(){availabilityBase();for(const prefix of ['proc','sale']){
  if(!partial(prefix))continue;const requested=new Map();rows(prefix+'Meds').forEach(x=>requested.set(x.medication_id,(requested.get(x.medication_id)||0)+num(x.quantity)));
  const record=root.getClinicalStockRecordV28?.(prefix);
  for(const row of get(prefix+'Meds')?.querySelectorAll('.medrow')||[]){
   const m=meds.find(x=>x.id===row.dataset.medicationId),hint=row.querySelector('.stock-hint');if(!m||!hint)continue;
   const q=requested.get(m.id)||0,old=record?.items?.find(x=>x.medication_id===m.id),added=Math.max(q-num(old?.quantity),0),deducted=Math.min(q,num(old?.stock_deducted_quantity)+Math.min(added,m.stock_tracking_enabled?num(m.total_available??m.work_qty):0)),pending=Math.max(q-deducted,0);
   hint.textContent=m.total_available==null?`Поэтапный учёт · ${m.stock_tracking_enabled?'автосписание при сохранении; нехватка отмечается к сверке':'пока только прайс · расход к сверке'}${num(m.unknown_expiry_qty)>0?' · есть остаток без срока':''}`:`Поэтапный учёт · к списанию ${qty(deducted)} ${unit(m)}${pending?' · к сверке '+qty(pending)+' '+unit(m):''}${num(m.unknown_expiry_qty)>0?' · есть остаток без срока':''}`;
   row.classList.toggle('partial-stock-pending-v28',m.total_available==null?!m.stock_tracking_enabled:pending>0);
  }
 }};
 const inventoryBase=renderInventory;renderInventory=function(){const result=inventoryBase();warehouseLabels();return result;};
 const homeBase=renderCabinetHomeV5;renderCabinetHomeV5=function(){const result=homeBase();controls();return result;};
 const modeBase=renderAccountingModeV5;renderAccountingModeV5=function(){const result=modeBase();warehouseLabels();return result;};
 const showBase=show;show=function(id){if(id==='partialStockReviewV28'&&!isManager())id='workspace';const result=showBase(id);controls();return result;};
 const signOutBase=signOut;signOut=async function(){++view;requests.clear();for(const id of ['partialStockReviewV28','partialStockReviewEntryV28','partialStockReviewHomeV28'])get(id)?.remove();return signOutBase();};
})(typeof window==='object'?window:globalThis);
