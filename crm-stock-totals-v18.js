/* Count stock directly from the three summary cards. Every write replaces the
   counted balances; retrying an uncertain result keeps its original receipt. */
(function(root){
 'use strict';
 function whole(value,label){
  if(String(value??'').trim()==='')throw Error(label+': укажите фактическое количество');
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<0)throw Error(label+': введите целое число от нуля');
  return number;
 }
 function expiry(value,today){
  const text=String(value||'').trim();
  let match=text.match(/^(\d{4})-(\d{2})-(\d{2})$/),year,month,day;
  if(match)[,year,month,day]=match;
  else if((match=text.match(/^(\d{2})[./](\d{2})[./](\d{4})$/)))[,day,month,year]=match;
  else throw Error('Срок годности: укажите действительную дату в формате ДД.ММ.ГГГГ');
  const iso=year+'-'+month+'-'+day,date=new Date(iso+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==iso||Number(year)<2000)throw Error('Такой даты нет: '+text+'. Проверьте день, месяц и год.');
  if(today&&iso<today)throw Error('Срок годности уже истёк. Укажите действующий срок добавляемых препаратов.');
  return iso;
 }
 const helpers={whole,expiry};root.CrmStockTotalsV18=helpers;
 if(typeof module!=='undefined'&&module.exports)module.exports=helpers;
 if(typeof document==='undefined')return;
 const get=id=>document.getElementById(id);
 let state=null,epoch=0,generation=0,busyOperation=null;
 function manager(){return typeof isManager==='function'&&isManager()&&!!currentStaff?.id;}
 function actor(){return JSON.stringify([currentStaff?.id,currentStaff?.role,epoch,typeof warehouseSessionV16==='undefined'?null:warehouseSessionV16]);}
 function navigation(){return typeof quickNavigation4==='number'?quickNavigation4:null;}
 function med(id){return inventory.find(row=>row.id===id&&row.active!==false);}
 function sameOwner(value){return manager()&&value?.actor===actor();}
 function current(value){return state===value&&sameOwner(value)&&value.generation===generation&&value.view===medView&&get('medId')?.value===value.id&&get('medForm')?.classList.contains('active')&&(value.navigation===null||value.navigation===navigation());}
 function otherDraft(){return (typeof medicationDraftV16!=='undefined'&&medicationDraftV16)||(typeof stockDraftV16!=='undefined'&&stockDraftV16);}
 function uncertain(){return sameOwner(state)&&!!state?.pending;}
 function packHint(amount,m){return packLabel(amount,m)+' · по '+qty(packSize(m))+' '+unit(m)+' в упаковке';}
 function dateLabel(value){return value?value.split('-').reverse().join('.'):'';}
 function defaultExpiry(m){try{return dateLabel(expiry(m?.nearest_expiry,localDateValue()));}catch{return '';}}
 function tell(text,success=false){
  const box=get('stockTotalsMessageV18');if(!box)return;
  box.textContent=text||'';box.classList.toggle('stock-totals-success-v18',success);
 }
 function ensurePanel(){
  if(get('stockTotalsPanelV18'))return;
  const panel=document.createElement('section');panel.id='stockTotalsPanelV18';panel.className='card stock-totals-panel-v18 hidden';
  panel.innerHTML='<div class="row between"><h2>Фактическое количество</h2><button type="button" id="stockTotalsCloseV18" class="btn secondary">Закрыть</button></div><p id="stockTotalsUnitV18" class="small"></p><div class="grid2"><div><label for="stockTotalsReserveV18">В запасе</label><input id="stockTotalsReserveV18" type="number" min="0" step="1" inputmode="numeric"><p id="stockTotalsPackV18" class="small"></p></div><div><label for="stockTotalsWorkV18">В работе</label><input id="stockTotalsWorkV18" type="number" min="0" step="1" inputmode="numeric"></div></div><p id="stockTotalsTotalV18" class="stock-totals-total-v18" aria-live="polite"></p><div id="stockTotalsExpiryBoxV18"><label for="stockTotalsExpiryV18">Срок годности добавляемого количества</label><input id="stockTotalsExpiryV18" type="text" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" maxlength="10"><p class="small">Если сроки разные, внесите каждую партию отдельно ниже.</p></div><details id="stockTotalsExtraV18"><summary>Дополнительно</summary><label for="stockTotalsReasonV18">Причина изменения</label><input id="stockTotalsReasonV18" maxlength="1000" value="Исправление общего остатка"></details><button id="stockTotalsSaveV18" type="button" class="btn primary wide">Сохранить количество</button><p id="stockTotalsMessageV18" role="status" aria-live="polite"></p><button id="stockTotalsReloadV18" type="button" class="btn secondary wide hidden">Обновить количество</button>';
  get('medStockSummary').after(panel);
  for(const id of ['stockTotalsReserveV18','stockTotalsWorkV18','stockTotalsExpiryV18','stockTotalsReasonV18'])get(id).oninput=()=>{if(!current(state)||state.pending)return;state[id]=get(id).value;state.message='';sync();};
  get('stockTotalsSaveV18').onclick=saveStockTotalsV18;
  get('stockTotalsReloadV18').onclick=reloadStockTotalsV18;
  get('stockTotalsCloseV18').onclick=()=>{if(warehouseBusy||uncertain())return;panel.classList.add('hidden');};
 }
 function sync(){
  if(!current(state)||!get('stockTotalsPanelV18'))return;
  const m=inventory.find(row=>row.id===state.id),frozen=!!state.pending,blocked=warehouseBusy||!!otherDraft()||state.loading;
  let reserve,work,valid=true;
  try{reserve=whole(get('stockTotalsReserveV18').value,'В запасе');work=whole(get('stockTotalsWorkV18').value,'В работе');whole(reserve+work,'Всего');}
  catch(error){valid=false;get('stockTotalsTotalV18').textContent=error.message;}
  if(valid){get('stockTotalsTotalV18').textContent='Всего: '+qty(reserve+work)+' '+unit(m);get('stockTotalsPackV18').textContent=packHint(reserve,m);}
  const adding=valid&&reserve+work>state.reserve+state.work;
  get('stockTotalsExpiryBoxV18').classList.toggle('hidden',!adding);
  get('stockTotalsUnitV18').textContent='Количество указывается в '+unit(m)+'. Введите остаток целиком — сохранение заменит прежние числа.';
  for(const [id,label] of [['stockTotalsReserveV18','В запасе'],['stockTotalsWorkV18','В работе']])document.querySelector('label[for="'+id+'"]').textContent=label+', '+unit(m);
  for(const id of ['stockTotalsReserveV18','stockTotalsWorkV18','stockTotalsExpiryV18','stockTotalsReasonV18','stockTotalsCloseV18'])get(id).disabled=blocked||frozen||state.stale;
  get('stockTotalsSaveV18').disabled=blocked||state.stale||(!frozen&&(!valid||reserve===state.reserve&&work===state.work));
  get('stockTotalsSaveV18').textContent=frozen?'Повторить сохранение':'Сохранить количество';
  get('stockTotalsReloadV18').classList.toggle('hidden',!state.stale&&!state.refresh);
  get('stockTotalsReloadV18').disabled=blocked||frozen;
  tell(state.message,state.success);
  if(frozen&&!warehouseBusy){
   // Do not let a second warehouse write overtake an unconfirmed correction.
   get('medForm').querySelectorAll('input,select,textarea,button').forEach(node=>{const back=/^show\(/.test(node.getAttribute('onclick')||'');if(node.id!=='stockTotalsSaveV18'&&!back)node.disabled=true;});
   get('stockTotalsSaveV18').disabled=!!otherDraft()||state.loading;
  }
 }
 function mount(value){
  ensurePanel();get('stockTotalsPanelV18').classList.remove('hidden');
  for(const id of ['stockTotalsReserveV18','stockTotalsWorkV18','stockTotalsExpiryV18','stockTotalsReasonV18'])get(id).value=value[id];
  tell(value.message,value.success);sync();
 }
 function resume(){
  if(!uncertain()||warehouseBusy)return false;
  show('medForm');state.navigation=navigation();mount(state);return true;
 }
 function snapshot(m){return {id:m.id,actor:actor(),view:medView,generation:++generation,navigation:navigation(),reserve:whole(m.reserve_qty??0,'В запасе'),work:whole(m.work_qty??0,'В работе'),stockTotalsReserveV18:String(m.reserve_qty??0),stockTotalsWorkV18:String(m.work_qty??0),stockTotalsExpiryV18:defaultExpiry(m),stockTotalsReasonV18:'Исправление общего остатка',pending:null,stale:false,refresh:false,message:'',success:false,loading:false};}
 function openStockTotalsV18(id,focus='reserve'){
  if(!manager()||warehouseBusy)return;
  if(otherDraft()){if(typeof warehouseResumeV16==='function')warehouseResumeV16();return;}
  if(resume())return;
  const m=med(id);if(!m)return;
  if(get('medId')?.value!==id||!get('medForm')?.classList.contains('active')){openMedForm(id);if(get('medId')?.value!==id)return;}
  if(!current(state)||state.id!==id)state=snapshot(m);
  mount(state);
  get(focus==='work'?'stockTotalsWorkV18':'stockTotalsReserveV18').focus({preventScroll:true});
  get('stockTotalsPanelV18').scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function payload(){
  const reserve=whole(get('stockTotalsReserveV18').value,'В запасе'),work=whole(get('stockTotalsWorkV18').value,'В работе');
  const adding=whole(reserve+work,'Всего')>state.reserve+state.work;
  return {id:state.id,expected_reserve:state.reserve,expected_work:state.work,reserve,work,expiry_date:adding?expiry(get('stockTotalsExpiryV18').value,localDateValue()):null,reason:get('stockTotalsReasonV18').value.trim()||'Исправление общего остатка'};
 }
 function isRow(row,id){return !!row&&row.id===id&&row.reserve_qty!==null&&row.work_qty!==null&&Number.isSafeInteger(Number(row.reserve_qty))&&Number(row.reserve_qty)>=0&&Number.isSafeInteger(Number(row.work_qty))&&Number(row.work_qty)>=0;}
 function applyRow(row){
  const old=inventory.find(item=>item.id===row.id);if(!old)return;
  Object.assign(old,row);
  if(typeof medicationBatchesExtraV5!=='undefined')medicationBatchesExtraV5.delete(row.id);
  if(typeof meds!=='undefined'){const catalog=meds.find(item=>item.id===row.id);if(catalog)Object.assign(catalog,row);}
 }
 function finish(operation){
  if(busyOperation!==operation)return;busyOperation=null;setWarehouseBusy(false);restoreFieldLocks();sync();
 }
 async function saveStockTotalsV18(){
  if(!manager()||warehouseBusy||otherDraft()||!current(state)||state.stale)return;
  const value=state;
  try{if(!value.pending){const data=payload();if(data.reserve===value.reserve&&data.work===value.work)return;value.pending={payload:Object.freeze({...data}),requestId:crypto.randomUUID()};}}
  catch(error){value.message=error.message;value.success=false;sync();return;}
  const draft=value.pending,operation={value,actor:actor(),navigation:navigation()},replay=!!value.retry;let confirmed=false;
  busyOperation=operation;value.message='Сохраняем количество…';value.success=false;setWarehouseBusy(true);sync();
  try{
   const response=await db.rpc('crm_stock_totals_v18',{p_payload:draft.payload,p_request_id:draft.requestId});
   if(!sameOwner(value))return;
   if(response?.error)throw Object.assign(Error(response.error.message||'Не удалось сохранить количество'),response.error,{status:response.status});
   if(!isRow(response?.data,value.id))throw Object.assign(Error('Ответ о сохранении не получен. Повторите сохранение.'),{uncertain:true});
   // Clear the write receipt only after a confirmed server response. Reads can
   // fail afterwards without turning this confirmed correction into a failure.
   confirmed=true;value.pending=null;value.retry=false;
   let fresh=null;
   try{const rows=await warehouseRpc('list');fresh=Array.isArray(rows)?rows.find(row=>row.id===value.id):null;if(!isRow(fresh,value.id))throw Error('Остаток не найден');}
   catch{value.refresh=true;}
   if(!current(value)||operation.navigation!==navigation())return;
   // The mutation response can be old on an idempotent replay. A successful
   // read confirms the current stock; otherwise retain local counts on replay.
   const cached=med(value.id),untouched=Number(cached?.reserve_qty)===draft.payload.expected_reserve&&Number(cached?.work_qty)===draft.payload.expected_work;
   const row=fresh||(!replay&&untouched?response.data:null);
   if(row){applyRow(row);value.reserve=Number(row.reserve_qty);value.work=Number(row.work_qty);value.stockTotalsReserveV18=String(value.reserve);value.stockTotalsWorkV18=String(value.work);}
   value.stale=!fresh||fresh.active===false;value.message='Количество сохранено.'+(fresh?.active===false?' Препарат теперь в архиве.':value.refresh?' Не удалось обновить текущие остатки. Нажмите «Обновить количество».':'');value.success=true;
   get('medStockSummary').innerHTML=stockCells(inventory.find(row=>row.id===value.id));renderInventory();updateStockPreview();
   finish(operation);mount(value);
  }catch(error){
   if(!sameOwner(value))return;
   if(confirmed){value.pending=null;value.retry=false;value.stale=true;value.refresh=true;value.success=true;value.message='Количество сохранено. Не удалось обновить текущие остатки. Нажмите «Обновить количество».';if(current(value))sync();return;}
   const definitive=globalThis.SaveRecoveryV16?.isDefinitive?SaveRecoveryV16.isDefinitive(error,error.status):!error.uncertain&&/^[0-9A-Z]{5}$/.test(error.code||'');
   if(definitive){value.pending=null;value.retry=false;value.stale=error.code==='40001'||/уже измен|обновите.*остат|пересчитай/i.test(error.message);value.message=error.message;}
   else{value.retry=true;value.message='Ответ о сохранении не получен. Нажмите «Повторить сохранение» — количество не добавится дважды.';}
   value.success=false;if(current(value))sync();
  }finally{finish(operation);}
 }
 async function reloadStockTotalsV18(){
  if(!manager()||warehouseBusy||otherDraft()||uncertain()||!current(state))return;
  const value=state;value.loading=true;sync();
  try{
   const rows=await warehouseRpc('list');if(!current(value))return;
   const row=Array.isArray(rows)?rows.find(item=>item.id===value.id):null;if(!isRow(row,value.id))throw Error('Препарат не найден');
   applyRow(row);state=snapshot(row);state.message='Остатки обновлены. Укажите правильное количество заново.';
   get('medStockSummary').innerHTML=stockCells(row);renderInventory();updateStockPreview();mount(state);
  }catch(error){if(current(value)){value.message='Не удалось обновить количество: '+error.message;value.success=false;}}
  finally{value.loading=false;if(current(value))sync();}
 }
 function collapseOptional(){
  for(const prefix of ['opening','receive']){
   const parent=get(prefix+'Panel');if(!parent||get(prefix+'OptionalV18'))continue;
   const extra=document.createElement('details');extra.id=prefix+'OptionalV18';extra.className='stock-optional-v18';extra.innerHTML='<summary>Дополнительно: закупка, партия, поставщик</summary>';
   const price=get(prefix+'Price'),priceBox=price?.parentElement;
   if(priceBox?.querySelector('label[for="'+prefix+'Price"]'))extra.append(priceBox);
   const batch=get(prefix+'BatchNumberV5')?.closest('.grid3');if(batch)extra.append(batch);
   const comment=get(prefix+'Comment'),label=document.querySelector('label[for="'+prefix+'Comment"]');
   if(label)extra.append(label);if(comment)extra.append(comment);
   const save=[...parent.querySelectorAll('button')].find(button=>/receiveStock|saveOpeningStock/.test(button.getAttribute('onclick')||''));
   if(save)save.before(extra);else parent.append(extra);
  }
 }
 function simplifyMedicationCard(id,focus){
  const details=get('medDetails');if(!details)return;
  if(!get('medOptionalV18')){
   const extra=document.createElement('details');extra.id='medOptionalV18';extra.className='stock-optional-v18';extra.innerHTML='<summary>Дополнительно: фото, закупка и настройки</summary>';
   const main=document.createElement('div');main.className='grid2';main.id='medMainV18';details.querySelector('summary').after(main);
   for(const field of ['medName','medCountry','medDosage','medUnit','medUnitsPerPack']){const input=get(field),box=input?.parentElement;if(box?.querySelector('label[for="'+field+'"]'))main.append(box);}
   const photo=details.querySelector('.photo-editor');if(photo)extra.append(photo);
   const fields=document.createElement('div');fields.className='grid2';extra.append(fields);
   for(const field of ['medGeneric','medCategory','medSearchName','medPurchaseUnit','medPurchasePrice','medManufacturerV5','medReleaseFormV5','medMin','medWorkMin','medLeadDays']){const input=get(field),box=input?.parentElement;if(box?.querySelector('label[for="'+field+'"]'))fields.append(box);}
   const label=document.querySelector('label[for="medCommentV5"]');if(label)extra.append(label);if(get('medCommentV5'))extra.append(get('medCommentV5'));
   get('medSaveButton').before(extra);
   details.querySelector('summary').textContent='Карточка препарата';
   // Remove emptied layout containers, preserving every input and handler.
   details.querySelectorAll('.grid2').forEach(box=>{if(!box.children.length)box.remove();});
  }
  get('medOptionalV18').open=!!id&&['edit','prices'].includes(focus);
  if(!id)details.open=true;
 }
 const previousCells=stockCells;
 stockCells=function(m){
  if(!manager()||!m?.id||m.active===false)return previousCells(m);
  const f=stockFacts(m),suffix=esc(unit(m));
  const button=(location,label,strong,hint,extra='')=>'<button type="button" class="stock-cell stock-total-button-v18 '+extra+'" data-stock-total-v18="'+location+'" data-stock-medication-v18="'+esc(m.id)+'" onclick="openStockTotalsV18(\''+esc(m.id)+'\',\''+location+'\')"><span class="small">'+label+'</span><strong>'+strong+'</strong><small>'+hint+'</small><span class="stock-total-edit-v18">Изменить</span></button>';
  return '<div class="stock-grid">'+button('reserve','В запасе',esc(packLabel(f.reserve,m)),qty(f.reserve)+' '+suffix+' · по '+qty(packSize(m))+' в упаковке')+button('work','В работе',qty(f.work)+' '+suffix,'Годно к использованию: '+qty(m.work_available??f.work)+' '+suffix,'work')+button('total','Всего',qty(f.total)+' '+suffix,'Запас + рабочий шкаф')+'</div>';
 };
 const previousResume=typeof warehouseResumeV16==='function'?warehouseResumeV16:null;
 if(previousResume)warehouseResumeV16=function(){return resume()||previousResume();};
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){
  if(resume())return false;if(!manager()||warehouseBusy)return false;
  const before=medView,result=previousOpen(id,focus);
  if(get('medId')?.value!==id||!get('medForm')?.classList.contains('active')||before===medView)return result;
  ++generation;state=null;get('stockTotalsPanelV18')?.classList.add('hidden');collapseOptional();simplifyMedicationCard(id,focus);
  if(focus===''&&id)get('openingPanel').open=false;
  if(focus==='prices')focusMedicationPrices();
  else if(focus==='edit'||!id)get('medName')?.focus({preventScroll:true});
  return result;
 };
 const previousBusy=setWarehouseBusy;
 setWarehouseBusy=function(value){previousBusy(value);sync();};
 if(typeof focusMedicationPrices==='function'){
  const previousPrices=focusMedicationPrices;
  focusMedicationPrices=function(){if(manager()&&!warehouseBusy&&get('medOptionalV18'))get('medOptionalV18').open=true;return previousPrices();};
 }
 const previousSignOut=signOut;
 signOut=async function(){++epoch;++generation;state=null;if(busyOperation)finish(busyOperation);get('stockTotalsPanelV18')?.remove();return previousSignOut();};
 root.openStockTotalsV18=openStockTotalsV18;root.saveStockTotalsV18=saveStockTotalsV18;root.reloadStockTotalsV18=reloadStockTotalsV18;
})(typeof window==='undefined'?globalThis:window);
