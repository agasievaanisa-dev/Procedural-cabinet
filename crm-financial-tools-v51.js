/* Correct existing collections separately from accepting new money. */
(function(global){
 'use strict';
 const channels=['cash','terminal','owner_card','other_card'];
 const labels={cash:'Наличные',terminal:'Терминал',owner_card:'Перевод на карту начальника',other_card:'Другая карта',unclassified:'Способ не указан'};
 const pending=new Map();let serial=0,active=null;
 const context=()=>global.CrmClinicalFinancialContextV51;
 const actor=()=>context().actor();
 const manager=()=>!!currentStaff?.id&&isManager();
 const money=value=>global.CrmClinicalV10.cents(value??0);
 const optional=value=>String(value??'').trim()===''?0:money(value);
 const rubles=value=>(value/100).toFixed(2);
 const methods=value=>[...channels,'unclassified'].filter(key=>money(value?.[key]??0)>0).map(key=>labels[key]+': '+rub(Number(value[key]))).join(' · ')||'Нет полученной оплаты';
 const date=value=>{const at=new Date(value);return Number.isFinite(+at)?at.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'Дата не указана'};
 const keyFor=(mode,kind,id)=>JSON.stringify([actor(),mode,kind,id]);
 const cancelLabel=view=>view.kind==='sale'?'Удалить ошибочную продажу':'Удалить ошибочную процедуру';
 function current(view){return active===view&&manager()&&view.actor===actor()&&quickNavigationCurrent4(view.navigation,currentStaff?.id)&&$(view.host.id)===view.host&&view.host.classList.contains('active')}
 function actions(event){
  if(!manager()||!event?.id)return '';
  const kind=event.kind==='sale'?'sale':'procedure';
  const paid=Number(event.received_total??event.paid_total??event.paid??0);
  return (paid>0?`<button type="button" class="btn secondary no-print" onclick="openPaymentMethodsV51('${esc(kind)}','${esc(event.id)}')">Исправить способ оплаты</button>`:'')
   +`<button type="button" class="btn secondary no-print" onclick="${kind==='sale'?'openSaleCancelV52':'openProcedureCancelV51'}('${esc(event.id)}')">${kind==='sale'?'Удалить ошибочную продажу':'Удалить ошибочную процедуру'}</button>`;
 }
 global.financialActionsHtmlV51=actions;
 function messageView(view,text,success=false){const box=view.host.querySelector('[data-financial-message]');box.textContent=text;box.className=success?'notice success':'notice';}
 function lock(view,busy){
  view.busy=busy;
  view.host.querySelectorAll('input,select,textarea,button').forEach(node=>{node.disabled=busy||!!view.retry});
  const save=view.host.querySelector('[data-financial-save]');if(save){save.disabled=busy;save.textContent=view.retry?'Повторить первоначальное сохранение':view.mode==='methods'?'Сохранить способ оплаты':cancelLabel(view);}
 }
 function restoreRetry(view){
  const p=view.retry.payload,body=view.host.querySelector('[data-financial-body]');
  if(view.mode==='methods'){
   body.querySelector('[data-financial-event]').value=String(p.event_id);
   const positive=channels.filter(key=>Number(p.payments[key])>0);
   body.querySelector('[data-financial-method]').value=positive.length>1?'mixed':positive[0]||'';
   channels.forEach(key=>{body.querySelector('[data-channel="'+key+'"]').value=String(p.payments[key]||0)});
   refreshMethods(view);body.querySelector('[data-financial-tender]').value=String(p.payments.cash_received||0);
  }
  body.querySelector('[data-financial-reason]').value=p.reason;body.querySelector('[data-financial-confirm]').checked=true;
 }
 async function request(name,args,write=false){
  let response;try{response=await db.rpc(name,args)}catch(error){throw financeSaveErrorV16(error,undefined,'Не удалось получить ответ')}
  if(response?.error)throw financeSaveErrorV16(response.error,response.status);
  if(!response||response.data==null)throw financeSaveErrorV16({message:'Не удалось получить ответ',uncertain:write},response?.status);
  return response.data;
 }
 async function back(view){
  if(!current(view)||view.busy||view.retry)return;
  if(view.editor){await global.editTreatmentV10(view.kind,view.id,view.editor.returnTo);return}
  await finish(view,'');
 }
 async function finish(view,success){
  if(!current(view))return;
  const target=view.target;
  if(target){await context().restore(target,success);return}
  if(view.patientId){await openPatient(view.patientId);if(view.actor===actor()&&$('patientCard')?.classList.contains('active'))message('patientCardMessageV5',success,true);return}
  show('workspace');if(success)message('homeMessage',success,true);
 }
 function shell(mode,kind,id,editor){
  const target=editor?.returnTo||context().capture(),navigation=beginQuickNavigation4();
  let host=$('financialToolsV51');if(!host){host=document.createElement('section');host.id='financialToolsV51';host.className='screen financial-tools-v51';$('workspace').parentElement.appendChild(host)}
  const view={mode,kind,id,editor,target,actor:actor(),navigation,host,serial:++serial,busy:false,key:keyFor(mode,kind,id)};active=view;
  host.innerHTML=`<div class="row between"><h1>${mode==='methods'?'Исправить способ оплаты':cancelLabel(view)}</h1><button type="button" class="btn secondary" data-financial-back>Назад</button></div><div data-financial-message role="status" aria-live="polite">Загружаем сохранённую запись…</div><div data-financial-body></div>`;
  host.querySelector('[data-financial-back]').onclick=()=>back(view);show(host.id);return view;
 }
 function metadata(record){return `<p><strong>${esc(record.patient||'Продажа без пациента')}</strong></p><p class="small">${esc(date(record.visit_at||record.at||record.sold_at))}</p>`}
 function expected(event){return Object.fromEntries([...channels,'unclassified'].map(key=>[key,Number(event[key]??0)]))}
 function selectedEvent(view){return view.data.events.find(item=>String(item.id)===view.host.querySelector('[data-financial-event]')?.value)}
 function refreshMethods(view){
  const event=selectedEvent(view),body=view.host.querySelector('[data-financial-body]');if(!event)return;
  body.querySelector('[data-financial-before]').textContent=methods(event);
  body.querySelector('[data-financial-amount]').value=rubles(money(event.amount));
  const method=body.querySelector('[data-financial-method]').value,mixed=method==='mixed';
  body.querySelector('[data-financial-allocation]').classList.toggle('hidden',!mixed);
  body.querySelector('[data-financial-confirm]').checked=false;
  let cash=0;try{cash=method==='cash'?money(event.amount):mixed?optional(body.querySelector('[data-channel="cash"]').value):0}catch{}
  body.querySelector('[data-financial-tender-box]').classList.toggle('hidden',cash<=0);
  if(!view.tenderEdited)body.querySelector('[data-financial-tender]').value=rubles(cash);
  try{const allocation=mixed?channels.map(key=>[key,optional(body.querySelector('[data-channel="'+key+'"]').value)]):channels.map(key=>[key,key===method?money(event.amount):0]);body.querySelector('[data-financial-summary]').textContent=method?allocation.filter(([,amount])=>amount>0).map(([key,amount])=>labels[key]+': '+rub(amount/100)).join(' · '):'Выберите правильный способ уже полученной оплаты.'}catch(error){body.querySelector('[data-financial-summary]').textContent=error.message}
 }
 function renderMethods(view){
  const data=view.data,body=view.host.querySelector('[data-financial-body]');view.patientId=data.treatment?.patient_id;
  body.innerHTML=metadata(data.treatment||{})+'<p>Исправляется только способ уже полученной оплаты. Сумма, дата и смена остаются прежними. Новые деньги не начисляются. Погашения настоящего долга учитываются отдельно.</p>';
  if(!data.events?.length){messageView(view,'Нет обычной оплаты, которую можно исправить. Погашения долга здесь не изменяются.');return}
  body.insertAdjacentHTML('beforeend',`<div class="card"><label>Сохранённая оплата<select data-financial-event>${data.events.map(event=>`<option value="${esc(String(event.id))}">${esc(date(event.created_at))} · ${esc(rub(Number(event.amount)))}</option>`).join('')}</select></label><p class="small" data-financial-before></p><label>Полученная сумма, ₽<input data-financial-amount readonly inputmode="decimal"></label><label>Правильный способ оплаты<select data-financial-method><option value="">Выберите способ оплаты</option>${channels.map(key=>`<option value="${key}">${labels[key]}</option>`).join('')}<option value="mixed">Смешанная оплата</option></select></label><div class="grid2 hidden" data-financial-allocation>${channels.map(key=>`<label>${labels[key]}, ₽<input data-channel="${key}" inputmode="decimal" value="0.00"></label>`).join('')}</div><label data-financial-tender-box class="hidden">Получено наличными, ₽<input data-financial-tender inputmode="decimal" value="0.00"></label><p class="small" data-financial-summary role="status"></p><label>Причина исправления *<textarea data-financial-reason maxlength="1000"></textarea></label><label class="check"><input type="checkbox" data-financial-confirm><span>Подтверждаю правильный способ уже полученной оплаты</span></label><button type="button" class="btn primary wide" data-financial-save>Сохранить способ оплаты</button></div>`);
  body.querySelector('[data-financial-event]').onchange=()=>{view.tenderEdited=false;body.querySelector('[data-financial-method]').value='';refreshMethods(view)};
  body.querySelector('[data-financial-method]').onchange=()=>refreshMethods(view);
  body.querySelectorAll('[data-channel]').forEach(input=>{input.oninput=()=>refreshMethods(view)});
  body.querySelector('[data-financial-tender]').oninput=()=>{view.tenderEdited=true;body.querySelector('[data-financial-confirm]').checked=false};
  body.querySelector('[data-financial-reason]').oninput=()=>{body.querySelector('[data-financial-confirm]').checked=false};
  body.querySelector('[data-financial-save]').onclick=()=>save(view);refreshMethods(view);messageView(view,'Выберите сохранённую оплату и укажите правильный способ.');
 }
 function renderCancel(view){
  const record=view.data,body=view.host.querySelector('[data-financial-body]');view.patientId=record.patient_id;
  const paid=money(record.received_total??record.paid_total??0),sale=view.kind==='sale';
  body.innerHTML=metadata(record)+`<p>Стоимость: <strong>${esc(rub(Number(record.charge_total??0)))}</strong>. Получено: <strong>${esc(rub(paid/100))}</strong>.</p>`;
  if(sale){
   const items=record.items||record.medications||[];
   if(items.length)body.insertAdjacentHTML('beforeend',`<ul>${items.map(item=>`<li>${esc(item.name||'Препарат')} × ${esc(String(item.quantity??''))} ${esc(item.unit||'')}</li>`).join('')}</ul>`);
   if(paid>0)body.insertAdjacentHTML('beforeend',`<p>Записанный способ оплаты: <strong>${esc(methods(record.payments))}</strong>.</p>`);
  }
  if(paid>0){messageView(view,'По записи уже есть оплата. Удаление заблокировано. Если деньги фактически не получены, сначала отдельно исправьте ошибочно отмеченную оплату в редакторе. Если деньги получены, удаление и возврат этим действием не проводятся.');const edit=document.createElement('button');edit.type='button';edit.className='btn secondary';edit.textContent='Открыть запись для проверки оплаты';edit.onclick=()=>{if(current(view))return global.editTreatmentV10(view.kind,view.id,view.target)};body.appendChild(edit);return}
  body.insertAdjacentHTML('beforeend',`<div class="card"><p>Удаление уберёт ошибочный дубль из журнала, отчётов и суммы к оплате. История отмены сохранится; фактически списанные препараты вернутся в исходные партии.</p><label>Причина удаления *<textarea data-financial-reason maxlength="1000"></textarea></label><label class="check"><input type="checkbox" data-financial-confirm><span>Подтверждаю: это ошибочно сохранённая или повторная ${sale?'продажа':'процедура'}</span></label><button type="button" class="btn primary wide" data-financial-save>${cancelLabel(view)}</button></div>`);
  body.querySelector('[data-financial-reason]').oninput=()=>{body.querySelector('[data-financial-confirm]').checked=false};body.querySelector('[data-financial-save]').onclick=()=>save(view);messageView(view,sale?'Проверьте препараты, дату и сумму перед удалением.':'Проверьте пациента, дату и сумму перед удалением.');
 }
 function payload(view){
  const body=view.host.querySelector('[data-financial-body]'),reason=body.querySelector('[data-financial-reason]').value.trim();
  if(!reason)throw Error('Укажите причину исправления');
  if(!body.querySelector('[data-financial-confirm]').checked)throw Error('Проверьте данные и отметьте подтверждение');
  if(view.mode==='cancel')return {id:view.id,expected_version:view.data.version,expected_received_total:Number(view.data.received_total??view.data.paid_total??0),reason,confirmed_duplicate:true};
  const event=selectedEvent(view),method=body.querySelector('[data-financial-method]').value;
  if(!event||!channels.concat('mixed').includes(method))throw Error('Выберите правильный способ оплаты');
  const payments=Object.fromEntries(channels.map(key=>[key,(method==='mixed'?optional(body.querySelector('[data-channel="'+key+'"]').value):method===key?money(event.amount):0)/100]));
  if(channels.reduce((sum,key)=>sum+money(payments[key]),0)!==money(event.amount))throw Error('Распределите ровно '+rub(Number(event.amount))+' между способами оплаты');
  const cashReceived=payments.cash>0?optional(body.querySelector('[data-financial-tender]').value):0;
  if(cashReceived<money(payments.cash))throw Error('Получено наличными меньше наличной части оплаты');
  return {kind:view.kind,id:view.id,event_type:event.event_type,event_id:event.id,expected_version:view.data.version,expected_payments:expected(event),payments:{...payments,cash_received:cashReceived/100},reason,confirmed:true};
 }
 async function save(view){
  if(!current(view)||view.busy)return;
  let snapshot=view.retry,committed=false;
  try{
   if(!snapshot)snapshot={payload:payload(view),requestId:crypto.randomUUID()};
   lock(view,true);
   const rpc=view.mode==='methods'?'crm_payment_methods_v51':view.kind==='sale'?'crm_sale_cancel_v52':'crm_procedure_cancel_v51';
   const result=await request(rpc,view.mode==='methods'?{p_action:'save',p_payload:snapshot.payload,p_request_id:snapshot.requestId}:{p_payload:snapshot.payload,p_request_id:snapshot.requestId},true);
   if(!result?.id||view.mode==='cancel'&&(result.id!==view.id||result.kind!==view.kind||result.cancelled!==true||view.kind==='sale'&&result.request_id!==snapshot.requestId))throw financeSaveErrorV16({message:'Не удалось подтвердить результат сохранения',uncertain:true});
   committed=true;pending.delete(view.key);view.retry=null;
   if(!current(view))return;
   view.host.querySelector('[data-financial-body]').replaceChildren();
   messageView(view,'Изменение сохранено. Обновляем исходную страницу…',true);
   await finish(view,view.mode==='methods'?'Способ оплаты исправлен. Сумма полученных денег не изменилась.':view.kind==='sale'?'Ошибочная продажа удалена.':'Ошибочная процедура удалена.');
  }catch(error){
   if(view.actor!==actor()||!manager())return;
   if(!committed&&snapshot&&(view.retry||financeRetryableErrorV16(error,error.status))){view.retry=snapshot;pending.set(view.key,{snapshot,data:view.data});}
   if(!current(view))return;
   if(committed){messageView(view,'Изменение уже сохранено. Не удалось обновить исходную страницу: '+error.message,true);const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent='Обновить исходную страницу';retry.onclick=()=>finish(view,'Изменение сохранено.');view.host.querySelector('[data-financial-message]').appendChild(retry);}
   else if(view.retry)messageView(view,'Не удалось подтвердить результат. Повторите первоначальное сохранение: сумма и способы оплаты будут отправлены без изменений, без дубля.');
   else messageView(view,error.message);
  }finally{view.busy=false;if(current(view))lock(view,false)}
 }
 async function open(mode,kind,id,editor=null){
  if(!manager()){message('homeMessage','Исправление оплаты и удаление ошибочных процедур и продаж доступны только администратору и владельцу.');return}
  if(!['procedure','sale'].includes(kind)||!id)return;
  if(active?.busy){messageView(active,'Дождитесь ответа на сохранение.');return}
  const existing=pending.get(keyFor(mode,kind,id)),view=shell(mode,kind,id,editor);
  if(existing){view.data=existing.data;view.retry=existing.snapshot;view.mode==='methods'?renderMethods(view):renderCancel(view);restoreRetry(view);lock(view,false);messageView(view,'Результат предыдущего сохранения ещё не подтверждён. Повторно отправим первоначальные данные.');return}
  await load(view);
 }
 async function load(view){
  const {mode,kind,id}=view;
  try{
   const data=mode==='methods'?await request('crm_payment_methods_v51',{p_action:'get',p_payload:{kind,id},p_request_id:null}):await request('crm_clinical_v10',{p_action:'treatment_get',p_payload:{kind,id},p_request_id:null});
   if(!current(view))return;
   if(!data||data.id!==id||(data.kind&&data.kind!==kind))throw Error('Сохранённая запись не найдена. Обновите журнал.');
   view.data=data;mode==='methods'?renderMethods(view):renderCancel(view);
  }catch(error){if(!current(view))return;messageView(view,error.message);const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent='Обновить запись';retry.onclick=()=>load(view);view.host.querySelector('[data-financial-message]').appendChild(retry)}
 }
 global.openPaymentMethodsV51=(kind,id)=>open('methods',kind,id);
 global.openProcedureCancelV51=id=>open('cancel','procedure',id);
 global.openSaleCancelV52=id=>open('cancel','sale',id);
 global.renderExistingPaymentToolsV51=function(prefix,record){
  $(prefix+'ExistingPaymentV51')?.remove();if(!record?.id||money(record.received_total??record.paid_total??0)<=0)return;
  const host=document.createElement('div');host.id=prefix+'ExistingPaymentV51';host.className='existing-payment-v51';
  host.innerHTML=`<h3>Ранее полученная оплата: ${esc(rub(Number(record.received_total??record.paid_total)))}</h3><p class="small" data-existing-summary>${esc(methods(record.payments))}</p><p>Кнопки ниже относятся только к новой доплате. Они не меняют способ ранее полученной оплаты.</p>${manager()?'<button type="button" class="btn secondary wide">Исправить способ сохранённой оплаты</button>':''}`;
  $(prefix+'PaymentV5').before(host);
  const button=host.querySelector('button');if(button)button.onclick=()=>{const editor=context().leaveEditor(prefix);if(editor)return open('methods',editor.kind,editor.id,editor)};
  if(!manager())return;
  const capturedActor=actor();request('crm_payment_methods_v51',{p_action:'get',p_payload:{kind:prefix==='proc'?'procedure':'sale',id:record.id},p_request_id:null}).then(data=>{
   if(capturedActor!==actor()||$(host.id)!==host||!manager())return;
   const totals=Object.fromEntries([...channels,'unclassified'].map(key=>[key,(data.events||[]).reduce((sum,event)=>sum+money(event[key]??0),0)/100]));host.querySelector('[data-existing-summary]').textContent=methods(totals);
  }).catch(()=>{if(capturedActor===actor()&&$(host.id)===host)host.querySelector('[data-existing-summary]').textContent='Подробности сохранённой оплаты можно проверить отдельной кнопкой.'});
 };
 const signOutBase=signOut;
 signOut=async function(){serial++;active=null;pending.clear();$('financialToolsV51')?.replaceChildren();for(const prefix of ['proc','sale'])$(prefix+'ExistingPaymentV51')?.remove();return signOutBase()};
})(typeof window==='object'?window:globalThis);
