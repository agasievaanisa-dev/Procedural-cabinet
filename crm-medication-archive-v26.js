/* Reversible zero-stock archive. Unknown replies retain warehouse_v5's receipt. */
(function(root){
 'use strict';
 if(typeof document==='undefined')return;
 const get=id=>document.getElementById(id);
 let epoch=0,draft=null,operation=null,notice=null,refreshing=false,signingOut=false;
 const manager=()=>!signingOut&&typeof isManager==='function'&&isManager()&&!!currentStaff?.id;
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,epoch,warehouseSessionV16]);
 const sameOwner=value=>manager()&&value?.actor===actor();
 const pending=()=>sameOwner(draft);
 const navigation=()=>typeof quickNavigation4==='number'?quickNavigation4:null;
 const currentCard=value=>sameOwner(value)&&value.view===medView&&value.id===get('medId')?.value&&get('medForm')?.classList.contains('active')&&value.navigation===navigation();
 const medication=id=>inventory.find(row=>row.id===id);
 function ensureUi(){
  if(!manager())return;
  const tools=get('admin')?.querySelector('.warehouse-tools');if(!tools)return;
  if(!get('medicationArchiveEntryV26')){
   const button=document.createElement('button');button.id='medicationArchiveEntryV26';button.type='button';button.className='btn secondary';button.style.marginTop='12px';button.innerHTML='<span id="medicationArchiveOpenV26">Архив</span>';button.onclick=openMedicationArchiveV26;tools.append(button);
  }
  if(!get('medicationArchiveNoticeV26')){
   const box=document.createElement('div');box.id='medicationArchiveNoticeV26';box.className='notice hidden';
   box.innerHTML='<div id="medicationArchiveStatusV26" role="status" aria-live="polite"></div><button id="medicationArchiveRetryV26" type="button" class="btn primary hidden" style="margin-top:10px">Повторить сохранение</button><button id="medicationArchiveReloadV26" type="button" class="btn secondary hidden" style="margin-top:10px">Обновить остатки</button>';
   tools.after(box);get('medicationArchiveRetryV26').onclick=()=>toggleMedicationArchiveV26(draft?.id);get('medicationArchiveReloadV26').onclick=refreshMedicationArchiveV26;
  }
  const button=get('archiveButton');
  if(button){
   const old=button.closest('.archive-action');if(old)old.remove();
   if(button.parentElement!==get('medForm'))get('medFormTitle')?.after(button);
   button.className='btn secondary';button.type='button';button.onclick=()=>toggleMedicationArchiveV26(get('medId')?.value);
  }
 }
 function sync(){
  if(!manager())return;
  ensureUi();const blocked=warehouseBusy||pending(),m=medication(get('medId')?.value),button=get('archiveButton');
  if(button){button.classList.toggle('hidden',!m);button.textContent=m?.active===false?'Разархивировать':'Архивировать';button.title=m?.active!==false&&stockFacts(m||{}).total!==0?'Архивирование доступно только при нулевом остатке':'';button.disabled=blocked||!m||m.active!==false&&stockFacts(m).total!==0;button.dataset.archiveMedicationV26=m?.id||'';}
  const archived=inventory.filter(row=>row.active===false).length,entry=get('medicationArchiveEntryV26');
  if(entry){get('medicationArchiveOpenV26').textContent='Архив'+(archived?' ('+archived+')':'');entry.setAttribute('aria-pressed',String(get('inventoryFilter')?.value==='archive'));}
  document.querySelectorAll('#inventoryList button').forEach(node=>{
   // v8 recomputes these controls from warehouseBusy and its own retry state.
   if(node.matches('[data-inline-stock-toggle-v8],[data-inline-stock-save-v8],[data-inline-stock-reload-v8]'))return;
   if(blocked){if(!node.hasAttribute('data-archive-lock-v26'))node.dataset.archiveLockV26=String(node.disabled);node.disabled=true;}
   else if(node.hasAttribute('data-archive-lock-v26')){node.disabled=node.dataset.archiveLockV26==='true';delete node.dataset.archiveLockV26;}
  });
  if(pending())get('medForm')?.querySelectorAll('input,select,textarea,button').forEach(node=>{if(!/^show\(/.test(node.getAttribute('onclick')||''))node.disabled=true;});
  const box=get('medicationArchiveNoticeV26'),value=pending()?draft:notice;
  if(!box)return;
  const card=get('medForm')?.classList.contains('active')&&value?.id===get('medId')?.value;
  if(card&&button)button.after(box);else get('admin')?.querySelector('.warehouse-tools')?.after(box);
  const visible=sameOwner(value)&&!!value.message;box.classList.toggle('hidden',!visible);box.classList.toggle('success',!!value?.success);
  get('medicationArchiveStatusV26').textContent=visible?value.message:'';
  get('medicationArchiveRetryV26').classList.toggle('hidden',!pending());get('medicationArchiveRetryV26').disabled=!!operation;
  get('medicationArchiveReloadV26').classList.toggle('hidden',!notice?.refresh||pending());get('medicationArchiveReloadV26').disabled=warehouseBusy||refreshing;
 }
 function renderActions(){
  if(!manager())return;
  for(const article of get('inventoryList')?.querySelectorAll('.inventory-card[data-medication-id]')||[]){
   const m=medication(article.dataset.medicationId);if(!m)continue;
   let button=article.querySelector('[data-archive-medication-v26]');
   if(!button){button=document.createElement('button');button.type='button';button.className='btn secondary';button.dataset.archiveMedicationV26=m.id;article.querySelector('.row:last-child')?.append(button);if(!button.isConnected)article.append(button);}
   const stocked=m.active!==false&&stockFacts(m).total!==0;
   button.textContent=m.active===false?'Разархивировать':'Архивировать';button.disabled=stocked;button.title=stocked?'Архивирование доступно только при нулевом остатке':'';button.onclick=()=>toggleMedicationArchiveV26(m.id);
   let hint=article.querySelector('[data-archive-reason-v26]');
   if(stocked&&!hint){hint=document.createElement('span');hint.dataset.archiveReasonV26='';hint.className='small';hint.textContent='В архив — при нулевом остатке';button.after(hint);}
   if(!stocked)hint?.remove();
  }
  sync();
 }
 function resume(){
  if(!pending())return false;
  show('admin');sync();return true;
 }
 function openMedicationArchiveV26(){
  if(!manager())return;
  show('admin');get('inventoryFilter').value='archive';get('inventorySearch').value='';renderInventory();sync();
 }
 function finish(value){
  if(operation!==value)return;operation=null;setWarehouseBusy(false);restoreFieldLocks();sync();
 }
 function applyArchive(value){
  const m=medication(value.id);if(!m)return;
  m.active=value.action==='restore';
  if(typeof meds!=='undefined'){
   const old=meds.find(row=>row.id===m.id);if(old)old.active=m.active;
   if(!m.active)meds=meds.filter(row=>row.id!==m.id);
   // Restored stock enters the clinical catalogue through its normal fresh read.
  }
  // Invalidate reads started before the commit so they cannot undo its local state.
  ++warehouseLoad;renderInventory();
  if(currentCard(value)){get('stockActiveActions')?.classList.toggle('hidden',!m.active);get('medStockSummary').innerHTML=stockCells(m);}
 }
 async function toggleMedicationArchiveV26(id){
  if(!manager()||operation)return;
  if(pending()&&draft.id!==id){resume();return;}
  if(!pending()){
   if(warehouseBusy)return;
   // Existing card, quantity and price drafts keep their own recovery path.
   if(warehouseResumeV16())return;
   const m=medication(id);if(!m)return;
   if(m.active!==false&&stockFacts(m).total!==0){notice={actor:actor(),id,message:'Архивирование доступно только при нулевом остатке.',success:false};sync();return;}
   draft={id,action:m.active===false?'restore':'archive',payload:Object.freeze({id}),actor:actor(),view:medView,navigation:navigation(),message:'',success:false};notice=null;
  }
  const value=draft;operation=value;value.message=value.action==='archive'?'Архивируем препарат…':'Возвращаем препарат из архива…';setWarehouseBusy(true);sync();
  let confirmed=false;
  try{
   const result=await warehouseRpc(value.action,value.payload,true);
   if(result?.active!==(value.action==='restore'))throw Object.assign(Error('Ответ о сохранении не получен.'),{uncertain:true});
   if(!sameOwner(value)||draft!==value)return;
   confirmed=true;draft=null;notice={...value,success:true,message:value.action==='archive'?'Карточка в архиве.':'Карточка разархивирована. Можно оформить приход.',refresh:false};
   applyArchive(value);sync();
   let loaded=false;try{loaded=await loadInventory();}catch(_error){}
   if(!sameOwner(value)||notice?.actor!==value.actor)return;
   if(!loaded){notice.refresh=true;notice.message+=' Не удалось обновить остатки. Обновите список; повторять операцию не нужно.';}
   if(currentCard(value)){const m=medication(value.id);if(m){get('stockActiveActions')?.classList.toggle('hidden',m.active===false);get('medStockSummary').innerHTML=stockCells(m);}}
   sync();
  }catch(error){
   if(!sameOwner(value))return;
   if(confirmed){draft=null;notice={...value,success:true,refresh:true,message:'Изменение сохранено. Не удалось обновить остатки. Обновите список; повторять операцию не нужно.'};}
   else if(error.definitive){draft=null;notice={...value,success:false,message:error.message};}
   else{value.message='Ответ о сохранении не получен. Нажмите «Повторить сохранение» — операция не продублируется.';}
   sync();
  }finally{finish(value);}
 }
 async function refreshMedicationArchiveV26(){
  if(!manager()||warehouseBusy||pending()||refreshing)return;
  const value=notice;refreshing=true;sync();
  try{const loaded=await loadInventory();if(sameOwner(value)&&notice===value&&loaded){value.refresh=false;value.message=value.action==='archive'?'Карточка в архиве.':'Карточка разархивирована. Можно оформить приход.';}}
  finally{refreshing=false;sync();}
 }
 const previousRender=renderInventory;
 renderInventory=function(){previousRender();renderActions();};
 const previousBusy=setWarehouseBusy;
 setWarehouseBusy=function(value){previousBusy(!!value||pending());sync();};
 const previousResume=warehouseResumeV16;
 warehouseResumeV16=function(){return resume()||previousResume();};
 const previousShow=show;
 show=function(id){const result=previousShow(id);if(manager())sync();return result;};
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){if(resume())return false;const result=previousOpen(id,focus);if(manager())sync();return result;};
 archiveMedication=function(){return toggleMedicationArchiveV26(get('medId')?.value);};
 const previousSignOut=signOut;
 signOut=async function(){
  signingOut=true;++epoch;draft=null;notice=null;operation=null;refreshing=false;
  for(const id of ['medicationArchiveEntryV26','medicationArchiveNoticeV26'])get(id)?.remove();
  document.querySelectorAll('[data-archive-medication-v26],[data-archive-reason-v26]').forEach(node=>{if(node.id!=='archiveButton')node.remove();});
  setWarehouseBusy(false);try{return await previousSignOut();}finally{signingOut=false;}
 };
 root.toggleMedicationArchiveV26=toggleMedicationArchiveV26;root.openMedicationArchiveV26=openMedicationArchiveV26;root.refreshMedicationArchiveV26=refreshMedicationArchiveV26;
})(typeof window==='undefined'?globalThis:window);
