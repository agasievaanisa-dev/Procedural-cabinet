/* A counted cash balance is separate from the calculated salary deduction. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cash=value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
 const date=value=>{const parsed=new Date(value);return Number.isFinite(+parsed)?parsed.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'Время не указано';};
 function countHtml(count){
  if(!count)return '<p class="small">Сверка наличных ещё не выполнена.</p>';
  return `<dl class="cash-count-values-v37"><div><dt>По учёту на момент сверки</dt><dd>${escape(cash(count.expected_cash))}</dd></div><div><dt>Пересчитано наличными</dt><dd>${escape(cash(count.counted_cash))}</dd></div><div><dt>Расхождение</dt><dd>${escape(cash(count.difference))}</dd></div></dl><p class="small">${escape(date(count.created_at))} · Москва${count.staff_name?' · '+escape(count.staff_name):''}</p><p>${count.salary_confirmed===true?'Зарплата выдана полностью':'Зарплата не выдана или выдана не полностью'}</p>${count.reason?`<p>Комментарий: ${escape(count.reason)}</p>`:''}`;
 }
 function cashCountSummaryHtmlV37(drawer){
  const reconciliation=drawer?.reconciliation_v37;if(reconciliation?.required!==true)return '';
  return `<section class="cash-count-summary-v37"><h3>Сверка наличных${drawer.scope==='latest_shift'?' последней смены':''}</h3>${reconciliation.stale?'<p class="notice">Сверка устарела: после неё были изменения.</p>':''}${countHtml(reconciliation.count)}</section>`;
 }
 const api={cashCountSummaryHtmlV37};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.cashCountSummaryHtmlV37=cashCountSummaryHtmlV37;
 if(typeof document==='undefined')return;
 const get=id=>document.getElementById(id),pending=new Map();
 let session=0,view=0,operation=0,current=null,busy=false;
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5,session]);
 const navigation=()=>typeof quickNavigation4==='undefined'?null:quickNavigation4;
 const allowed=()=>!!currentStaff?.id&&currentStaff.active!==false&&['owner','admin','nurse'].includes(currentStaff.role);
 const same=saved=>allowed()&&saved.actor===actor();
 const valid=(saved,visible=true)=>current===saved&&same(saved)&&saved.navigation===navigation()&&(!visible||get('cashReconciliationV37')?.classList.contains('active'));
 const key=saved=>saved.actor+':'+saved.id;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const amount=value=>financeCentsV5(value,'Сумма')/100;
 function captureDraft(saved){
  if(!valid(saved)||!get('cashCountFormV37'))return;
  saved.draft={amount:get('cashCountAmountV37').value,salary:get('cashCountSalaryV37').value,reason:get('cashCountReasonV37').value,opening:get('cashCountOpeningV37')?.value};
 }
 function editable(saved){return saved.drawer?.reconciliation_v37?.editable??(isManager()||(saved.drawer?.shift_status||saved.status)==='open');}
 function messageFor(saved,text,success=false){if(valid(saved))message('cashCountMessageV37',text,success);}
 function lock(){
  if(!current||!same(current))return;
  const retry=pending.has(key(current)),host=get('cashReconciliationV37');
  host?.querySelectorAll('form input,form select,form textarea,form button').forEach(node=>node.disabled=busy||retry);
  if(get('cashCountRetryV37'))get('cashCountRetryV37').disabled=busy;
  if(get('cashCountReloadV37'))get('cashCountReloadV37').disabled=busy||retry;
 }
 async function rpc(action,payload,requestId=null){
  const who=actor();let response;
  try{response=await db.rpc('crm_cash_reconciliation_v37',{p_action:action,p_payload:payload,p_request_id:requestId});}
  catch(error){throw financeSaveErrorV16(error);}
  if(who!==actor())throw Error('Учётная запись изменилась. Откройте сверку заново.');
  if(response?.error)throw financeSaveErrorV16(response.error,response.status);
  const drawer=response?.data,reconciliation=drawer?.reconciliation_v37;
  let verified=typeof drawer?.opening_confirmed==='boolean'&&reconciliation?.required===true&&typeof reconciliation.token==='string'&&!!reconciliation.token&&typeof reconciliation.can_close==='boolean';
  if(action==='save'){
   const count=reconciliation?.count;
   try{verified=verified&&count?.id===requestId&&amount(count.counted_cash)===payload.counted_cash&&count.salary_confirmed===payload.salary_confirmed&&count.reason===payload.reason&&Number.isFinite(Number(count.expected_cash))&&Number.isFinite(Number(count.difference))&&Math.round(Number(count.difference)*100)===Math.round(Number(count.counted_cash)*100)-Math.round(Number(count.expected_cash)*100);}catch{verified=false;}
  }
  if(!verified)throw Object.assign(Error('Ответ о сверке не подтверждён. Повторите сохранение — запись не продублируется.'),{uncertain:true});
  return drawer;
 }
 function preview(saved){
  if(!valid(saved)||!get('cashCountPreviewV37'))return;
  const d=saved.drawer,host=get('cashCountPreviewV37');
  try{
   const opening=financeCentsV5(d.opening_confirmed?d.opening:get('cashCountOpeningV37').value,'Наличные на начало смены');
   const selected=get('cashCountSalaryV37').value;if(!['true','false'].includes(selected))throw Error('Укажите, выдана ли зарплата полностью.');
   const expected=opening+financeCentsV5(d.received_cash??0)-financeCentsV5(d.cash_out??0)+financeCentsV5(d.cash_in??0)-financeCentsV5(d.salary_paid??0)-(selected==='true'?financeCentsV5(d.salary_auto_remaining??0):0);
   const raw=get('cashCountAmountV37').value,counted=financeCentsV5(raw,'Пересчитанные наличные'),difference=counted-expected;
   get('cashCountReasonV37').required=difference!==0;
   host.innerHTML=`<p>По учёту после выбранной выдачи зарплаты: <b>${escape(cash(expected/100))}</b></p><p>Пересчитано: <b>${escape(cash(counted/100))}</b> · расхождение: <b>${escape(cash(difference/100))}</b></p>${difference!==0?'<p class="small">Укажите причину расхождения.</p>':''}`;
   return {counted_cash:counted/100,salary_confirmed:selected==='true',...(d.opening_confirmed?{}:{opening_amount:opening/100}),difference:difference/100};
  }catch(error){host.textContent=error.message;return null;}
 }
 function historyHtml(drawer){
  const r=drawer.reconciliation_v37,rows=(r.history||[]).filter(item=>item.id!==r.count?.id);
  return rows.length?`<details class="card no-print"><summary>Предыдущие сверки (${rows.length})</summary>${rows.map(item=>`<article class="cash-count-history-v37">${countHtml(item)}</article>`).join('')}</details>`:'';
 }
 function render(saved){
  if(!valid(saved))return;
  const host=get('cashReconciliationV37'),d=saved.drawer,retry=pending.get(key(saved)),canEdit=editable(saved);
  host.innerHTML=`<div class="row between"><h1>Сверка наличных</h1><button type="button" class="btn secondary" id="cashCountBackV37">К отчёту</button></div><div class="card"><p>Пересчитайте наличные в кассе. Терминал, переводы на карту и отдельные погашения долгов сюда не входят.</p>${cashCountSummaryHtmlV37(d)}</div><div id="cashCountMessageV37" role="status"></div>${retry?'<div class="notice">Сохранение ещё не подтверждено. Повтор отправит исходную сумму и тот же номер операции без дубля.</div><button type="button" class="btn primary wide" id="cashCountRetryV37">Повторить сохранение сверки</button>':''}${canEdit?`<form class="card" id="cashCountFormV37">${!d.opening_confirmed?'<label for="cashCountOpeningV37">Наличные на начало смены, ₽ *</label><input id="cashCountOpeningV37" type="text" inputmode="decimal" required><p class="small">Начальные наличные не указаны. Введите реальную сумму; если касса была пустой — 0.</p>':''}<label for="cashCountSalaryV37">Зарплата выдана полностью? *</label><select id="cashCountSalaryV37" required><option value="">Выберите ответ</option><option value="true">Да, выдана полностью</option><option value="false">Нет / выдана не полностью</option></select><p class="small">Если выбрано «Да», программа отметит оставшиеся выплаты за эту смену. Уже записанные выплаты повторно не добавляются.</p><label for="cashCountAmountV37">Пересчитано наличными в кассе, ₽ *</label><input id="cashCountAmountV37" type="text" inputmode="decimal" required><div id="cashCountPreviewV37" class="cash-count-preview-v37" aria-live="polite"></div><label for="cashCountReasonV37">Комментарий / причина расхождения</label><textarea id="cashCountReasonV37" maxlength="2000"></textarea><button type="submit" class="btn primary wide" id="cashCountSaveV37">${saved.closeAfter?'Сохранить сверку и закрыть смену':'Сохранить сверку'}</button></form><button type="button" class="btn secondary wide" id="cashCountReloadV37">Обновить расчёт</button>`:'<p class="notice">Смена закрыта. Медсестра может просмотреть сверку; исправление доступно администратору.</p>'}${historyHtml(d)}`;
  get('cashCountBackV37').onclick=()=>openReportByIdV5(saved.id);
  if(get('cashCountReloadV37'))get('cashCountReloadV37').onclick=()=>root.openCashReconciliationV37(saved.id,{closeAfter:saved.closeAfter,status:saved.status});
  if(get('cashCountRetryV37'))get('cashCountRetryV37').onclick=()=>save(saved);
  if(canEdit){
   if(retry){get('cashCountAmountV37').value=String(retry.payload.counted_cash);get('cashCountSalaryV37').value=String(retry.payload.salary_confirmed);get('cashCountReasonV37').value=retry.payload.reason;if(get('cashCountOpeningV37'))get('cashCountOpeningV37').value=retry.payload.opening_amount==null?'':String(retry.payload.opening_amount);}
   else if(saved.draft){get('cashCountAmountV37').value=saved.draft.amount;get('cashCountSalaryV37').value=saved.draft.salary;get('cashCountReasonV37').value=saved.draft.reason;if(get('cashCountOpeningV37'))get('cashCountOpeningV37').value=saved.draft.opening??'';}
   for(const id of ['cashCountAmountV37','cashCountSalaryV37','cashCountOpeningV37'])if(get(id))for(const event of ['input','change'])get(id).addEventListener(event,()=>preview(saved));
   get('cashCountFormV37').onsubmit=event=>{event.preventDefault();save(saved);};preview(saved);
  }
  lock();
 }
 function updateSnapshot(saved,drawer){
  if(financeShiftSnapshot5?.id===saved.id&&financeShiftSnapshot5.actor===currentStaff?.id&&financeShiftSnapshot5.role===currentStaff?.role&&financeShiftSnapshot5.session===financeSession5){financeShiftSnapshot5.data.cash_drawer=clone(drawer);clearShiftPrintV5();}
  for(const id of ['cashV5','reportsV5','analyticsV5'])if(financeSnapshots5.has(id))invalidateFinanceSummaryV5(id,false);
 }
 const closeBase=closeShift;
 async function finishClose(saved){
  const report=await crmFinanceRpcV5('shift_report',{shift_id:saved.id});
  if(!valid(saved))return;
  if(report?.shift?.id!==saved.id)throw Error('Не удалось подтвердить смену. Откройте её отчёт заново.');
  if(report.shift.status==='closed'){if(shift?.id===saved.id)shift=null;renderShiftReportV5(report,true);return;}
  if(report.cash_drawer?.reconciliation_v37?.can_close!==true){saved.drawer=report.cash_drawer;render(saved);messageFor(saved,'После сверки появились изменения. Проверьте наличные и выполните сверку ещё раз.');return;}
  renderShiftReportV5(report,false);
  if(!same(saved)||saved.navigation!==navigation()||financeReportId5!==saved.id)return;
  await closeBase();
  if(!same(saved)||saved.navigation!==navigation()||financeReportId5!==saved.id)return;
  if(financeShiftSnapshot5?.data?.shift?.status!=='closed'){
   const error=get('reportBody')?.querySelector('.notice')?.textContent||'Смена не закрыта. Обновите сверку и повторите закрытие.';
   busy=false;await root.openCashReconciliationV37(saved.id,{closeAfter:true,status:'open'});
   if(current?.id===saved.id&&same(current))messageFor(current,error);
  }
 }
 async function save(saved){
  if(!valid(saved)||busy||!editable(saved))return;
  const requestKey=key(saved);let request=pending.get(requestKey);
  try{
   if(!request){
    const value=preview(saved);if(!value)throw Error(get('cashCountPreviewV37').textContent||'Проверьте данные сверки.');
    const reason=get('cashCountReasonV37').value.trim();if(reason.length>2000)throw Error('Комментарий: не более 2000 символов.');if(value.difference!==0&&!reason)throw Error('Укажите причину расхождения наличных.');
    const {difference,...payload}=value;
    request={id:crypto.randomUUID(),payload:{shift_id:saved.id,expected_token:saved.drawer.reconciliation_v37.token,...payload,reason},drawer:clone(saved.drawer),closeAfter:saved.closeAfter};pending.set(requestKey,request);
   }
  }catch(error){messageFor(saved,error.message);return;}
  const owned=++operation;busy=true;lock();messageFor(saved,'Сохраняем сверку…');let committed=false;
  try{
   const drawer=await rpc('save',request.payload,request.id);
   if(!same(saved))return;
   if(pending.get(requestKey)===request)pending.delete(requestKey);committed=true;updateSnapshot(saved,drawer);
   if(!valid(saved))return;
   saved.drawer=drawer;saved.draft=null;render(saved);messageFor(saved,'Сверка сохранена.',true);
   if(request.closeAfter){if(drawer.reconciliation_v37.can_close===true)await finishClose(saved);else messageFor(saved,'Сверка сохранена, но после неё появились изменения. Повторите сверку перед закрытием смены.');}
  }catch(error){
   if(!same(saved))return;
   if(committed){messageFor(saved,'Сверка сохранена. Не удалось подтвердить закрытие смены: '+error.message);return;}
   if(!financeRetryableErrorV16(error,error.status)&&pending.get(requestKey)===request){
    captureDraft(saved);pending.delete(requestKey);
    if(valid(saved)&&(error.code==='40001'||/касса изменилась/i.test(error.message))){
     try{const fresh=await rpc('status',{shift_id:saved.id});if(valid(saved))saved.drawer=fresh;}catch(refreshError){if(valid(saved))error.message+=' Не удалось обновить расчёт: '+refreshError.message;}
    }
   }
   if(valid(saved)){render(saved);messageFor(saved,pending.has(requestKey)?'Ответ о сохранении не получен. Повторите сохранение: исходные данные и номер операции сохранены.':error.message);}
  }finally{if(operation===owned){busy=false;lock();}}
 }
 root.openCashReconciliationV37=async function(id=financeReportId5,options={}){
  if(!allowed()||!id||busy)return;
  const previous=current,preserve=previous?.id===id&&valid(previous);if(preserve)captureDraft(previous);
  const nextNavigation=typeof beginQuickNavigation4==='function'?beginQuickNavigation4():navigation();
  const saved={id,actor:actor(),token:++view,navigation:nextNavigation,closeAfter:options.closeAfter===true,status:options.status||financeShiftSnapshot5?.data?.shift?.status||'closed',drawer:null};
  if(preserve&&previous.draft)saved.draft=previous.draft;
  const retry=pending.get(key(saved));if(retry)saved.closeAfter=retry.closeAfter;
  current=saved;let host=get('cashReconciliationV37');if(!host){host=document.createElement('section');host.id='cashReconciliationV37';host.className='screen';get('workspace').parentElement.append(host);}
  host.innerHTML='<h1>Сверка наличных</h1><p role="status">Загружаем кассу…</p>';show(host.id);
  try{const drawer=await rpc('status',{shift_id:id});if(!valid(saved))return;saved.drawer=retry?retry.drawer:drawer;render(saved);}
  catch(error){if(valid(saved)){host.innerHTML='<h1>Сверка наличных</h1><div id="cashCountMessageV37" role="status"></div><button type="button" class="btn secondary" id="cashCountBackV37">К отчёту</button>';messageFor(saved,error.message);get('cashCountBackV37').onclick=()=>openReportByIdV5(id);}}
 };
 const summaryBase=financeSimpleSummaryHtmlV29;
 financeSimpleSummaryHtmlV29=function(data={},...args){return summaryBase(data,...args)+cashCountSummaryHtmlV37(data.cash_drawer);};
 const reportBase=renderShiftReportV5;
 renderShiftReportV5=function(data,closed=false){
  const result=reportBase(data,closed);
  if(data.cash_drawer?.reconciliation_v37?.required===true&&data.shift?.id){const button=document.createElement('button');button.id='cashReconcileButtonV37';button.type='button';button.className='btn secondary wide no-print';button.textContent='Сверить наличные';button.onclick=()=>root.openCashReconciliationV37(data.shift.id,{status:data.shift.status});get('reportBody').querySelector('.cash-count-summary-v37')?.after(button);}
  return result;
 };
 closeShift=async function(){
  if(busy||financeBusy5||!financeReportId5)return;
  const data=financeShiftSnapshot5?.data,r=data?.cash_drawer?.reconciliation_v37;
  if(r?.required===true&&r.can_close!==true)return root.openCashReconciliationV37(financeReportId5,{closeAfter:true,status:data.shift?.status});
  return closeBase();
 };
 const signOutBase=signOut;
 signOut=async function(){++session;++view;++operation;pending.clear();current=null;busy=false;get('cashReconciliationV37')?.remove();return signOutBase();};
})(typeof window==='object'?window:globalThis);
