/* Edit the counted balance of one batch directly beside its expiry date. */
(function(root){
 'use strict';
 if(typeof document==='undefined')return;
 const get=id=>document.getElementById(id),helpers=root.CrmStockCorrectionV6;
 const states=new Map();
 let epoch=0,cardGeneration=0,cardState=null,busyOperation=null;
 function owner(){return typeof isManager==='function'&&isManager()&&!!currentStaff?.id;}
 function requireOwner(){if(!owner())throw Error('Изменение количества доступно только владельцу');}
 function medication(id){return inventory.find(item=>item.id===id&&item.active!==false);}
 function requester(){return helpers.createRequester((name,args)=>db.rpc(name,args),requireOwner,()=>crypto.randomUUID());}
 function labelDate(value){return value?value.split('-').reverse().join('.'):'Срок не указан';}
 function batchLabel(batch){return (batch.expiry_date?'Годен до '+labelDate(batch.expiry_date):'Срок не указан')+(batch.batch_number?' · партия № '+batch.batch_number:'')+' · поступление '+labelDate(batch.received_date);}
 function key(batchId,location){return batchId+':'+location;}
 function newState(id,scope,node){return {id,scope,node,actor:currentStaff.id,epoch,view:scope==='card'?medView+1:null,generation:cardGeneration,batches:[],editors:new Map(),request:requester(),selected:'',loaded:false,open:true,load:0,loading:false,message:''};}
 function sameOwner(state){return owner()&&state.epoch===epoch&&state.actor===currentStaff.id&&!!medication(state.id);}
 function belongs(state){
  if(!sameOwner(state))return false;
  return state.scope==='card'?cardState===state&&state.generation===cardGeneration&&state.view===medView&&get('medId')?.value===state.id:states.get(state.id)===state;
 }
 function current(state){
  if(!belongs(state)||!state.node?.isConnected)return false;
  return state.scope==='card'?get('medForm')?.classList.contains('active')&&state.node===get('batchList'):state.open&&get('admin')?.classList.contains('active');
 }
 // Catalogue refreshes replace DOM rows; the owner, state and editor identify the operation.
 function capture(state,editor){return {state,editor,actor:state.actor,epoch:state.epoch,view:state.view,generation:state.generation};}
 function matches(operation,visible=true){return (visible?current(operation.state):belongs(operation.state))&&operation.actor===currentStaff.id&&operation.epoch===epoch&&operation.view===operation.state.view&&operation.generation===operation.state.generation&&(!operation.editor||operation.state.editors.get(key(operation.editor.batchId,operation.editor.location))===operation.editor);}
 function hasRetry(state){return [...state.editors.values()].some(editor=>editor.retryData);}
 function draftChanged(editor){try{return helpers.whole(editor.draft,0,'Количество')!==editor.before;}catch{return true;}}
 function editorFor(state,batch,location){
  const id=key(batch.id,location),before=helpers.balance(batch,location);let editor=state.editors.get(id);
  if(!editor){editor={batchId:batch.id,location,before,draft:String(before),retryData:null,requestSnapshot:null,stale:false,refresh:false,status:'',success:false,node:null};state.editors.set(id,editor);}
  else if(!draftChanged(editor)&&!editor.retryData&&!editor.stale){editor.before=before;editor.draft=String(before);}
  return editor;
 }
 function editorHtml(state,batch){
  const m=medication(state.id),suffix=unit(m);
  return `<div class="inline-stock-editor-v8" data-inline-stock-editor-v8="${esc(batch.id)}"><p class="small inline-stock-count-hint-v8">Введите, сколько фактически осталось в этой партии, в ${esc(suffix)}.</p>${['reserve','work'].map(location=>{
   const editor=editorFor(state,batch,location),field='inline-stock-'+state.scope+'-'+state.id+'-'+batch.id+'-'+location+'-v8';
   return `<div class="inline-stock-row-v8" data-inline-stock-location-v8="${location}"><label for="${esc(field)}">${location==='reserve'?'В запасе':'В работе'}, ${esc(suffix)}</label><div class="inline-stock-input-row-v8"><input id="${esc(field)}" data-inline-stock-quantity-v8 type="number" min="0" step="1" inputmode="numeric" value="${esc(editor.draft)}"><button type="button" class="btn primary" data-inline-stock-save-v8>Сохранить</button></div><div class="inline-stock-preview-v8" data-inline-stock-preview-v8 aria-live="polite"></div><div class="inline-stock-status-v8" data-inline-stock-status-v8 role="status" aria-live="polite"></div><button type="button" class="btn secondary inline-stock-reload-v8 hidden" data-inline-stock-reload-v8>Обновить количество</button></div>`;
  }).join('')}</div>`;
 }
 function syncEditor(state,editor){
  const row=editor.node;if(!row?.isConnected)return;
  const input=row.querySelector('[data-inline-stock-quantity-v8]'),save=row.querySelector('[data-inline-stock-save-v8]'),preview=row.querySelector('[data-inline-stock-preview-v8]'),status=row.querySelector('[data-inline-stock-status-v8]'),reload=row.querySelector('[data-inline-stock-reload-v8]');
  let actual,valid=true;try{actual=helpers.whole(editor.draft,0,'Количество');}catch(error){valid=false;preview.textContent=error.message;}
  if(valid){const delta=actual-editor.before;preview.textContent=delta===0?'Замените число на правильный остаток':`Было ${qty(editor.before)} → останется ${qty(actual)} ${unit(medication(state.id))}. ${delta<0?'Убрать '+qty(-delta):'Добавить '+qty(delta)}.`;}
  const uncertain=hasRetry(state);
  input.disabled=warehouseBusy||state.loading||editor.stale||uncertain;
  save.disabled=warehouseBusy||state.loading||editor.stale||(!editor.retryData&&(!valid||actual===editor.before||uncertain));
  save.textContent=editor.retryData?'Повторить сохранение':'Сохранить';
  status.textContent=editor.status;status.classList.toggle('inline-stock-success-v8',editor.success);
  reload.classList.toggle('hidden',!editor.stale&&!editor.refresh&&!editor.retryData);reload.disabled=warehouseBusy||state.loading;
 }
 function syncControls(){
  for(const state of [...states.values(),cardState].filter(Boolean)){
   if(!state.node?.isConnected)continue;
   for(const editor of state.editors.values())syncEditor(state,editor);
   const select=state.node.querySelector('[data-inline-stock-batch-v8]');if(select)select.disabled=warehouseBusy||state.loading||hasRetry(state);
  }
  document.querySelectorAll('[data-inline-stock-toggle-v8],#inlineStockCardEntryV8').forEach(button=>button.disabled=warehouseBusy);
 }
 function bindEditor(state,batch,container){
  for(const location of ['reserve','work']){
   const editor=editorFor(state,batch,location),row=container.querySelector(`[data-inline-stock-location-v8="${location}"]`);editor.node=row;
   row.querySelector('[data-inline-stock-quantity-v8]').oninput=event=>{editor.draft=event.target.value;editor.status='';editor.success=false;syncEditor(state,editor);};
   row.querySelector('[data-inline-stock-save-v8]').onclick=()=>saveInlineStockV8(state.id,batch.id,location,state.scope);
   row.querySelector('[data-inline-stock-reload-v8]').onclick=()=>reloadInlineStockV8(state.id,state.scope);
   syncEditor(state,editor);
  }
 }
 function renderPanel(state){
  if(!state.node?.isConnected)return;
  const panel=state.node;
  if(!state.loaded){panel.innerHTML=`<p class="small" role="status">${esc(state.message||'Загружаем партии…')}</p>`;if(!state.loading){const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent='Повторить загрузку';retry.onclick=()=>reloadInlineStockV8(state.id,'list');panel.append(retry);}return;}
  if(!state.batches.length){panel.innerHTML='<p class="small">Партий пока нет. Внесите имеющийся остаток или оформите приход.</p>';return;}
  if(state.batches.length===1)state.selected=state.batches[0].id;
  if(!state.batches.some(batch=>batch.id===state.selected))state.selected='';
  panel.innerHTML=`<h3>Количество по сроку годности</h3>${state.batches.length>1?`<label for="inline-stock-batch-${esc(state.id)}-v8">С какого срока годности исправить количество?</label><select id="inline-stock-batch-${esc(state.id)}-v8" data-inline-stock-batch-v8><option value="">Выберите срок годности / партию</option>${state.batches.map(batch=>`<option value="${esc(batch.id)}">${esc(batchLabel(batch))} · запас ${qty(helpers.balance(batch,'reserve'))}, в работе ${qty(helpers.balance(batch,'work'))}</option>`).join('')}</select>`:`<p class="inline-stock-batch-label-v8">${esc(batchLabel(state.batches[0]))}</p>`}<p class="small inline-stock-message-v8" data-inline-stock-message-v8 role="status">${esc(state.message)}</p><div data-inline-stock-selected-v8></div>`;
  const select=panel.querySelector('[data-inline-stock-batch-v8]');if(select){select.value=state.selected;select.onchange=()=>{state.selected=select.value;state.message='';renderPanel(state);};}
  const batch=state.batches.find(item=>item.id===state.selected);
  if(batch){const selected=panel.querySelector('[data-inline-stock-selected-v8]');selected.innerHTML=editorHtml(state,batch);bindEditor(state,batch,selected);}
  syncControls();
 }
 function renderCard(state){
  if(!current(state))return;
  const m=medication(state.id),box=state.node;
  // Own the batch rows so delayed legacy metadata cannot choose a batch by index.
  box.innerHTML=state.batches.map(batch=>{const days=expiryDays(batch.expiry_date),warn=Number(batch.quantity_remaining)>0&&days!==null&&days<=60;
   return `<article class="item inline-stock-batch-v8 ${warn?(days<0?'batch-expired':'batch-soon'):''}" data-inline-stock-batch-row-v8="${esc(batch.id)}"><strong>${esc(batchLabel(batch))}${warn&&days<0?' · Срок истёк':''}</strong>${batch.supplier?`<p class="small">Поставщик: ${esc(batch.supplier)}</p>`:''}<p class="small" data-inline-stock-batch-total-v8>Всего ${qty(batch.quantity_remaining)} из ${qty(batch.quantity_received)} ${esc(unit(m))} · закупка ${rub(batch.purchase_price_per_unit)}/${esc(unit(m))}</p>${editorHtml(state,batch)}</article>`;
  }).join('')||'<p class="notice">Партий пока нет. Внесите имеющийся остаток или оформите приход.</p>';
  for(const batch of state.batches)bindEditor(state,batch,box.querySelector(`[data-inline-stock-batch-row-v8="${batch.id}"]`));
  syncControls();
 }
 async function fetchBatches(state,recount=false){
  if(!belongs(state)||warehouseBusy||state.loading)return;
  const version=++state.load,operation=capture(state);state.loading=true;state.message='';syncControls();
  if(current(state)&&state.scope==='list'&&!state.loaded)renderPanel(state);
  try{
   const batches=await warehouseRpc('batches',{id:state.id});if(!matches(operation,false)||version!==state.load)return;
   state.batches=(Array.isArray(batches)?batches:[]).map(batch=>({...batch}));state.loaded=true;
   if(recount){state.request.clear();state.editors.clear();state.message='Количество обновлено. Проверьте остаток выбранной партии и введите правильное число заново.';}
   state.loading=false;if(current(state)){if(state.scope==='list')renderPanel(state);else renderCard(state);}
  }catch(error){
   if(matches(operation,false)&&version===state.load){state.loading=false;state.message='Не удалось загрузить партии: '+error.message;if(current(state)){if(state.scope==='list')renderPanel(state);else message('stockOperationMessage',state.message);}}
  }finally{if(matches(operation,false)&&version===state.load){state.loading=false;syncControls();}}
 }
 function renderInlineStockV8(){
  if(!owner())return;
  for(const [id,state] of states){if(!sameOwner(state)){state.request.clear();states.delete(id);}}
  for(const article of get('inventoryList')?.querySelectorAll('.inventory-card')||[]){
   const action=article.querySelector('button[onclick*="openMedForm"]'),id=action?.getAttribute('onclick')?.match(/openMedForm\('([^']+)'/)?.[1],m=id&&medication(id);if(!m)continue;
   article.dataset.inlineStockMedicationV8=id;
   let toggle=article.querySelector('[data-inline-stock-toggle-v8]');
   if(!toggle){toggle=[...article.querySelectorAll('button')].find(button=>button.getAttribute('onclick')?.includes("'correct'"))||document.createElement('button');toggle.removeAttribute('onclick');toggle.type='button';toggle.className='btn secondary inline-stock-toggle-v8';toggle.textContent='Изменить количество';toggle.dataset.inlineStockToggleV8=id;article.querySelector('.stock-grid').after(toggle);}
   toggle.onclick=()=>openInlineStockV8(id);
   let panel=article.querySelector('[data-inline-stock-panel-v8]');if(!panel){panel=document.createElement('section');panel.className='inline-stock-panel-v8 hidden';panel.dataset.inlineStockPanelV8=id;toggle.after(panel);}
   const state=states.get(id);if(state&&sameOwner(state)){state.node=panel;panel.classList.toggle('hidden',!state.open);toggle.setAttribute('aria-expanded',String(state.open));if(state.open)renderPanel(state);}else toggle.setAttribute('aria-expanded','false');
  }
  syncControls();
 }
 async function openInlineStockV8(id){
  if(!owner()||warehouseBusy||!medication(id))return;
  renderInlineStockV8();const panel=[...get('inventoryList').querySelectorAll('[data-inline-stock-panel-v8]')].find(node=>node.dataset.inlineStockPanelV8===id);if(!panel)return;
  let state=states.get(id);if(!state||!sameOwner(state)){state=newState(id,'list',panel);states.set(id,state);}else{state.node=panel;state.open=!state.open;}
  panel.classList.toggle('hidden',!state.open);panel.previousElementSibling?.setAttribute('aria-expanded',String(state.open));
  if(state.open){if(state.loaded)renderPanel(state);else await fetchBatches(state);}
 }
 function finishBusy(operation){
  if(busyOperation!==operation)return;busyOperation=null;setWarehouseBusy(false);restoreFieldLocks();syncControls();
 }
 function setBatchBalance(batch,data){
  const before=helpers.balance(batch,data.location),difference=data.actual_quantity-before;
  batch.quantity_remaining=Number(batch.quantity_remaining)+difference;
  if(data.location==='work')batch.work_quantity=data.actual_quantity;
  if(difference>0)batch.quantity_received=Number(batch.quantity_received)+difference;
 }
 function updateSnapshots(data){
  for(const state of [...states.values(),cardState].filter(Boolean)){
   if(!sameOwner(state)||state.id!==data.id)continue;
   const batch=state.batches.find(item=>item.id===data.batch_id);if(batch)setBatchBalance(batch,data);
   const editor=state.editors.get(key(data.batch_id,data.location));if(editor&&!draftChanged(editor)&&!editor.retryData&&!editor.stale){editor.before=data.actual_quantity;editor.draft=String(data.actual_quantity);if(editor.node?.isConnected)editor.node.querySelector('[data-inline-stock-quantity-v8]').value=editor.draft;}
  }
  if(typeof medicationBatchesExtraV5!=='undefined'){
   const batch=medicationBatchesExtraV5.get(data.id)?.find(item=>item.id===data.batch_id);if(batch)setBatchBalance(batch,data);
  }
 }
 async function refreshSnapshots(operation,data,editor){
  try{
   const rows=await warehouseRpc('batches',{id:data.id});if(!matches(operation,false))return false;
   if(!Array.isArray(rows))throw Error('Не удалось проверить партии');
   // Batch totals confirm the current stock even if the separate catalogue refresh fails.
   const med=medication(data.id),today=localDateValue();
   for(const location of ['reserve','work']){
    med[location==='work'?'work_qty':'reserve_qty']=rows.reduce((sum,batch)=>sum+helpers.balance(batch,location),0);
    med[location==='work'?'work_available':'reserve_available']=rows.filter(batch=>batch.expiry_date&&batch.expiry_date>=today).reduce((sum,batch)=>sum+helpers.balance(batch,location),0);
   }
   for(const state of [...states.values(),cardState].filter(Boolean)){
    if(!sameOwner(state)||state.id!==data.id)continue;
    state.batches=rows.map(batch=>({...batch}));state.loaded=true;
    for(const batch of state.batches)for(const location of ['reserve','work'])editorFor(state,batch,location);
   }
   const batch=operation.state.batches.find(item=>item.id===data.batch_id);
   if(batch&&helpers.balance(batch,data.location)!==data.actual_quantity)editor.status=`Сохранение подтверждено. Текущий остаток: ${qty(helpers.balance(batch,data.location))} ${unit(medication(data.id))}.`;
   if(cardState?.id===data.id&&current(cardState))renderCard(cardState);
   renderInventory();
   return true;
  }catch{
   if(matches(operation,false)){editor.refresh=true;editor.stale=true;editor.status+=' Не удалось проверить текущие партии. Обновите количество перед следующим исправлением.';}
   return false;
  }
 }
 async function saveInlineStockV8(id,batchId,location,scope='list'){
  if(warehouseBusy)return;
  let state,editor,data,operation;
  try{
   requireOwner();state=scope==='card'?cardState:states.get(id);if(!state||state.id!==id||!current(state)||!state.loaded||state.loading)throw Error('Откройте строку препарата и дождитесь загрузки партии');
   editor=state.editors.get(key(batchId,location));if(!editor||!editor.node?.isConnected||editor.stale)throw Error('Обновите количество выбранной партии');
   if(hasRetry(state)&&!editor.retryData)throw Error('Сначала повторите сохранение, ответ на которое не был получен');
   data=editor.retryData||helpers.payload('inventory',{id,batch_id:batchId,location,actual:editor.draft,expected:editor.before,reason:'Исправление ошибки ввода'});
   if(data.actual_quantity===data.expected_quantity)return;
   if(!editor.retryData)editor.requestSnapshot={medication:medication(id),quantity:Number(medication(id)[location==='work'?'work_qty':'reserve_qty']||0)};
   operation=capture(state,editor);busyOperation=operation;setWarehouseBusy(true);editor.status='Сохраняем количество…';editor.success=false;syncControls();
   const replay=!!editor.retryData,result=await state.request('inventory',data);if(!matches(operation,false))return;
   const difference=Number(result?.difference??data.actual_quantity-data.expected_quantity),m=medication(id),batch=state.batches.find(item=>item.id===batchId);
   const stockKey=location==='work'?'work_qty':'reserve_qty',availableKey=location==='work'?'work_available':'reserve_available';
   // A catalogue refresh may already include an uncertain earlier commit.
   // Apply a difference only to the exact unchanged snapshot used to save it.
   if(!replay&&m===editor.requestSnapshot?.medication&&Number(m[stockKey]||0)===editor.requestSnapshot.quantity){m[stockKey]=Number(m[stockKey]||0)+difference;if(batch?.expiry_date&&batch.expiry_date>=localDateValue()&&m[availableKey]!==undefined)m[availableKey]=Number(m[availableKey])+difference;}
   if(!replay)updateSnapshots(data);editor.before=data.actual_quantity;editor.draft=String(data.actual_quantity);editor.retryData=null;editor.requestSnapshot=null;editor.stale=false;editor.refresh=false;editor.status=`Сохранено: ${qty(data.actual_quantity)} ${unit(m)}.`;editor.success=true;
   if(editor.node?.isConnected)editor.node.querySelector('[data-inline-stock-quantity-v8]').value=editor.draft;
   if(cardState?.id===id&&current(cardState)){get('medStockSummary').innerHTML=stockCells(m);installCardEntry(id);for(const b of cardState.batches){const total=cardState.node.querySelector(`[data-inline-stock-batch-row-v8="${b.id}"] [data-inline-stock-batch-total-v8]`);if(total)total.textContent=`Всего ${qty(b.quantity_remaining)} из ${qty(b.quantity_received)} ${unit(m)} · закупка ${rub(b.purchase_price_per_unit)}/${unit(m)}`;}updateStockPreview();}
   syncControls();await refreshSnapshots(operation,data,editor);if(!sameOwner(state)||busyOperation!==operation)return;
   // Refresh the catalogue without reopening the card or changing its fields.
   const loaded=await loadInventory();if(!sameOwner(state)||busyOperation!==operation)return;
   if(!loaded){editor.refresh=true;editor.status+=' Не удалось обновить список. Нажмите «Обновить количество».';}
   if(scope==='card'&&current(state)){const fresh=medication(id);get('medStockSummary').innerHTML=stockCells(fresh);installCardEntry(id);updateStockPreview();}
  }catch(error){
   if(state&&editor&&operation&&matches(operation,false)){
    editor.status=error.message;editor.success=false;
    if(/уже изменил|уже изменился|уже изменились|обновите карточку|обновите остатки/i.test(error.message)){editor.stale=true;editor.refresh=true;}
    else if(!error.code){editor.retryData=data;editor.refresh=true;}
    syncControls();
   }else if(owner()&&!operation)message('homeMessage',error.message);
  }finally{if(operation)finishBusy(operation);}
 }
 async function reloadInlineStockV8(id,scope='list'){
  if(!owner()||warehouseBusy)return;const state=scope==='card'?cardState:states.get(id);if(!state||state.id!==id||!current(state))return;
  await fetchBatches(state,true);
 }
 function installCardEntry(id){
  if(!owner())return;const m=medication(id);get('inlineStockCardEntryV8')?.remove();if(!m)return;
  const button=document.createElement('button');button.id='inlineStockCardEntryV8';button.type='button';button.className='btn secondary inline-stock-toggle-v8';button.textContent='Изменить количество по сроку годности';button.onclick=()=>{if(!owner()||warehouseBusy||get('medId')?.value!==id)return;get('batchList').scrollIntoView({behavior:'smooth',block:'start'});get('batchList').querySelector('[data-inline-stock-quantity-v8]')?.focus({preventScroll:true});};get('medStockSummary').append(button);
  const legacy=get('stockCorrectionEntryV6');if(legacy){legacy.textContent='Количество в упаковке';legacy.onclick=()=>{if(!owner()||warehouseBusy||get('medId')?.value!==id)return;const mode=get('stockCorrectionModeV6'),panel=get('stockCorrectionPanelV6');if(!mode||!panel)return;mode.value='package';mode.onchange?.();panel.classList.remove('hidden');legacy.classList.add('hidden');panel.scrollIntoView({behavior:'smooth',block:'start'});get('stockCorrectionActualV6')?.focus({preventScroll:true});};}
 }
 const previousRender=renderInventory;
 renderInventory=function(){previousRender();renderInlineStockV8();};
 const previousBusy=setWarehouseBusy;
 setWarehouseBusy=function(value){previousBusy(value);syncControls();};
 const previousOpen=openMedForm;
 openMedForm=function(id='',focus=''){
  if(!owner()||warehouseBusy)return;++cardGeneration;cardState?.request.clear();cardState=id&&medication(id)?newState(id,'card',get('batchList')):null;
  previousOpen(id,focus);if(get('medId')?.value===id){if(cardState)cardState.view=medView;installCardEntry(id);}
 };
 const previousDetails=loadStockDetails;
 loadStockDetails=async function(id,view){
  const state=cardState,operation=state&&capture(state);await previousDetails(id,view);
  if(!state||!matches(operation)||view!==state.view)return;
  const cached=typeof medicationBatchesExtraV5!=='undefined'?medicationBatchesExtraV5.get(id):null;
  if(cached){state.batches=cached.map(batch=>({...batch}));state.loaded=true;renderCard(state);}
  else await fetchBatches(state);
 };
 const previousSignOut=signOut;
 signOut=async function(){
  ++epoch;++cardGeneration;for(const state of [...states.values(),cardState].filter(Boolean))state.request.clear();states.clear();cardState=null;
  if(busyOperation)finishBusy(busyOperation);
  get('inlineStockCardEntryV8')?.remove();document.querySelectorAll('[data-inline-stock-panel-v8],[data-inline-stock-toggle-v8],[data-inline-stock-editor-v8]').forEach(node=>node.remove());
  return previousSignOut();
 };
 root.renderInlineStockV8=renderInlineStockV8;root.openInlineStockV8=openInlineStockV8;root.saveInlineStockV8=saveInlineStockV8;root.reloadInlineStockV8=reloadInlineStockV8;
 renderInlineStockV8();
})(typeof window==='undefined'?globalThis:window);
