/* Physical cash: confirmed opening and recorded movements, never bank receipts. */
(function(root){
 'use strict';
 const get=id=>document.getElementById(id),pending=new Map();
 let current=null,busy=false,view=0,operation=0;
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5]);
 const types={salary:'Выплата зарплаты',cash_in:'Внесение наличных',expense:'Расход из кассы',refund:'Возврат наличных',owner_withdrawal:'Выдача администратору'};
 const valid=token=>current&&current.token===token&&current.actor===actor();
 async function rpc(action,payload,requestId=null){
  const who=actor();let response;
  try{response=await db.rpc('crm_cash_drawer_v30',{p_action:action,p_payload:payload,p_request_id:requestId});}
  catch(error){throw financeSaveErrorV16(error);}
  if(who!==actor())throw Error('Учётная запись изменилась. Откройте кассу заново.');
  if(response?.error)throw financeSaveErrorV16(response.error,response.status);
  if(!response?.data||typeof response.data.opening_confirmed!=='boolean')throw Object.assign(Error('Ответ о кассе не получен. Повторите действие.'),{uncertain:true});
  return response.data;
 }
 function formLock(){
  const host=get('cashDrawerV30');if(!host||!current)return;
  const locked=busy||pending.has(current.actor+':'+current.id);
  host.querySelectorAll('form input,form select,form button,button[data-cash-void]').forEach(node=>node.disabled=locked);
  if(get('cashRetryV30'))get('cashRetryV30').disabled=busy;
 }
 function syncReport(drawer,id){
  if(financeShiftSnapshot5?.id===id&&financeShiftSnapshot5.actor===currentStaff?.id){
   financeShiftSnapshot5.data.cash_drawer=JSON.parse(JSON.stringify(drawer));
   financeShiftSnapshot5.data.cash_after_salary=drawer.salary_auto===true?drawer.cash_after_salary_auto:drawer.balance;clearShiftPrintV5();
  }
  for(const id of ['cashV5','reportsV5','analyticsV5'])if(financeSnapshots5.has(id))invalidateFinanceSummaryV5(id,false);
 }
 function salarySelection(){
  const salary=get('cashMovementTypeV30')?.value==='salary';
  get('cashSalaryBoxV30')?.classList.toggle('hidden',!salary);
  if(salary){const person=current.drawer.payroll?.find(p=>p.staff_id===get('cashSalaryStaffV30').value);get('cashMovementAmountV30').value=person?Number(person.outstanding).toFixed(2):'';get('cashMovementReasonV30').value='Выплата зарплаты за смену';}
  else{get('cashMovementAmountV30').value='';get('cashMovementReasonV30').value='';}
 }
 function render(){
  if(!current||current.actor!==actor())return;
  const {drawer:d,id,status}=current,host=get('cashDrawerV30'),manager=isManager(),editable=manager||status==='open',key=current.actor+':'+id,retry=pending.get(key);
  const money=(label,value)=>`<div class="cash-row-v30"><span>${label}</span><b>${esc(rub(value))}</b></div>`;
  const automatic=d.salary_auto===true,balance=automatic?d.cash_after_salary_auto:d.balance;
  const balanceTitle=automatic?(d.opening_confirmed?'Остаток наличных после зарплаты':'Наличные смены после зарплаты'):'Остаток наличных в кассе';
  const salaryDetails=automatic?`<div class="cash-payroll-v36"><h3>Зарплата по сотрудникам</h3>${(d.salary_auto_payroll||d.payroll||[]).map(person=>money(esc(person.staff_name||'Сотрудник'),person.configured)).join('')}${money('Зарплата за смену',d.salary_auto_total)}<p class="small">Зарплата учитывается автоматически; отмеченные выплаты повторно не вычитаются.</p></div><details><summary>Записанные выплаты для сверки</summary>${money('Зарплата отмечена как выданная',d.salary_paid)}${money('Осталось учесть автоматически',d.salary_auto_remaining)}<div class="cash-row-v30"><span>Наличные по началу смены и записанным движениям</span><b>${d.balance==null?'Начальный остаток не указан':esc(rub(d.balance))}</b></div></details>`:'';
  host.innerHTML=`<div class="row between"><h1>Касса смены</h1><button type="button" class="btn secondary" id="cashBackV30">К отчёту</button></div><div class="card"><h2>${balanceTitle}</h2><div class="money" id="cashBalanceV30">${balance==null?'Не рассчитан: подтвердите начальный остаток':esc(rub(balance))}</div><p class="small">Терминал, переводы на карту и отдельные погашения долгов в эту кассу не входят.</p>${d.opening_confirmed?money('На начало смены',d.opening):'<div class="cash-row-v30"><span>На начало смены</span><b>Не указано</b></div>'}${!d.opening_confirmed?(automatic?'<p class="small">Показаны наличные этой смены после зарплаты и других движений. Наличные на начало смены не указаны и в эту сумму не включены.</p>':'<p class="notice">Начальный остаток ещё не указан. Если касса была пустой, подтвердите 0 ₽.</p>'):''}${money('Получено наличными за процедуры и продажи',d.received_cash)}${money('Внесено наличными',d.cash_in)}${money(automatic?'Зарплата учтена из наличных':'Зарплата выплачена из кассы',automatic?d.salary_deduction:d.salary_paid)}${money('Другие выдачи',d.cash_out)}<p class="small">${automatic?'Наличные после зарплаты = '+(d.opening_confirmed?'начало + ':'')+'получено + внесено − зарплата − другие выдачи.':'Остаток = начало + получено + внесено − выплаченная зарплата − другие выдачи.'}</p>${automatic&&balance!=null&&Number(balance)<0?'<p class="notice">Наличных не хватает на зарплату.</p>':!automatic&&d.balance_negative?'<p class="notice">По записям касса отрицательная. Проверьте начальный остаток и выдачи.</p>':''}${salaryDetails}</div><div id="cashMessageV30" role="status"></div>${retry?'<div class="notice">Сохранение ещё не подтверждено. Повтор отправит ту же операцию без дубля.</div><button type="button" class="btn primary wide" id="cashRetryV30">Повторить сохранение</button>':''}${editable&&(!d.opening_confirmed||manager)?`<details class="card" ${!d.opening_confirmed&&!automatic?'open':''}><summary>${d.opening_confirmed?'Исправить начальный остаток':'Указать наличные на начало смены'}</summary><form id="cashOpeningFormV30"><label for="cashOpeningAmountV30">Наличные на начало смены, ₽</label><input id="cashOpeningAmountV30" inputmode="decimal" type="text" value="${d.opening_confirmed?Number(d.opening).toFixed(2):''}" required>${d.opening_confirmed?'<label for="cashOpeningReasonV30">Причина исправления *</label><input id="cashOpeningReasonV30" maxlength="2000" required>':''}<button class="btn primary wide">Подтвердить начальный остаток</button></form></details>`:''}${editable&&d.opening_confirmed?`<div class="card"><h2>${automatic?'Дополнительные записи кассы (необязательно)':'Выплата или движение наличных'}</h2>${automatic?'<p class="small">Зарплата уже учтена в расчёте. Запись фактической выдачи нужна для истории и не вычитает её повторно.</p>':''}<form id="cashMovementFormV30"><label for="cashMovementTypeV30">Что произошло</label><select id="cashMovementTypeV30">${Object.entries(types).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select><div id="cashSalaryBoxV30"><label for="cashSalaryStaffV30">Кому выдана зарплата</label><select id="cashSalaryStaffV30">${(d.payroll||[]).map(p=>`<option value="${esc(p.staff_id)}">${esc(p.staff_name)} · осталось ${esc(rub(p.outstanding))}</option>`).join('')}</select></div><label for="cashMovementAmountV30">Сумма наличными, ₽</label><input id="cashMovementAmountV30" inputmode="decimal" type="text" required><label for="cashMovementReasonV30">За что / причина *</label><input id="cashMovementReasonV30" maxlength="2000" required><button class="btn primary wide">Записать движение наличных</button></form></div>`:''}<div class="card"><h2>Записанные движения</h2><div id="cashMovementsV30"></div></div>`;
  get('cashBackV30').onclick=()=>openReportByIdV5(id);
  if(get('cashRetryV30'))get('cashRetryV30').onclick=()=>submit(retry.action,retry.payload);
  if(get('cashOpeningFormV30'))get('cashOpeningFormV30').onsubmit=event=>{event.preventDefault();try{const amount=financeCentsV5(get('cashOpeningAmountV30').value,'Начальный остаток')/100;const reason=d.opening_confirmed?get('cashOpeningReasonV30').value.trim():'Подтверждённый остаток наличных на начало смены';if(!reason)throw Error('Укажите причину исправления');submit('opening_set',{shift_id:id,amount,reason});}catch(error){message('cashMessageV30',error.message);}};
  if(get('cashMovementFormV30')){
   get('cashMovementTypeV30').onchange=salarySelection;get('cashSalaryStaffV30').onchange=salarySelection;salarySelection();
   get('cashMovementFormV30').onsubmit=event=>{event.preventDefault();try{const type=get('cashMovementTypeV30').value,amount=financeCentsV5(get('cashMovementAmountV30').value)/100,reason=get('cashMovementReasonV30').value.trim();if(amount<=0)throw Error('Укажите сумму больше нуля');if(!reason)throw Error('Укажите, за что выданы или внесены наличные');const payload={shift_id:id,type,amount,reason};if(type==='salary')payload.staff_id=get('cashSalaryStaffV30').value;submit('movement_add',payload);}catch(error){message('cashMessageV30',error.message);}};
  }
  const list=get('cashMovementsV30');
  for(const m of d.movements||[]){
   const card=document.createElement('div');card.className='cash-movement-v30';card.innerHTML=`<strong>${esc(types[m.type]||m.type)} · ${esc(rub(m.amount))}</strong>${m.staff_name?`<div>${esc(m.staff_name)}</div>`:''}<div>${esc(m.reason)}</div><div class="small">${esc(new Date(m.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))}${m.voided_at?' · отменено: '+esc(m.void_reason||''):''}</div>`;
   if(manager&&!m.voided_at){const button=document.createElement('button');button.type='button';button.className='btn secondary';button.dataset.cashVoid='';button.textContent='Отменить ошибочную запись';button.onclick=()=>{let form=card.querySelector('form');if(form)return;form=document.createElement('form');form.innerHTML='<label>Причина отмены *<input maxlength="2000" required></label><button class="btn danger">Подтвердить отмену</button>';form.onsubmit=event=>{event.preventDefault();const reason=form.querySelector('input').value.trim();if(reason)submit('movement_void',{shift_id:id,id:m.id,reason});};card.append(form);form.querySelector('input').focus();};card.append(button);}
   list.append(card);
  }
  if(!(d.movements||[]).length)list.textContent='Выдачи и внесения пока не записаны.';formLock();
 }
 async function submit(action,payload){
  if(!current||current.actor!==actor()||busy)return;
  const token=current.token,who=current.actor,key=current.actor+':'+current.id,ownedOperation=++operation;let request=pending.get(key);
  if(!request){request={action,payload:JSON.parse(JSON.stringify(payload)),id:crypto.randomUUID()};pending.set(key,request);}
  busy=true;formLock();message('cashMessageV30','Сохраняем…');
  try{const drawer=await rpc(request.action,request.payload,request.id);if(who!==actor())return;pending.delete(key);syncReport(drawer,request.payload.shift_id);if(isManager())void refreshOwnerDashboardV5();if(!valid(token))return;current.drawer=drawer;render();message('cashMessageV30','Записано. Остаток наличных обновлён.',true);}
  catch(error){if(!valid(token))return;if(!financeRetryableErrorV16(error,error.status))pending.delete(key);if(pending.has(key)){render();message('cashMessageV30','Ответ о сохранении не получен. Повторите сохранение: сумма и операция сохранены без изменений.');}else message('cashMessageV30',error.message);}
  finally{if(operation===ownedOperation){busy=false;formLock();}}
 }
 root.openCashDrawerV30=async function(id=financeReportId5,status=financeShiftSnapshot5?.data?.shift?.status){
  if(!currentStaff||!id)return;const token=++view,who=actor();
  let host=get('cashDrawerV30');if(!host){host=document.createElement('section');host.id='cashDrawerV30';host.className='screen';get('workspace').parentElement.append(host);}
  current={id,status:status||'closed',actor:who,token,drawer:null};host.innerHTML='<h1>Касса смены</h1><p role="status">Загружаем…</p>';show(host.id);
  try{const drawer=await rpc('status',{shift_id:id});if(valid(token)){current.drawer=drawer;render();}}
  catch(error){if(valid(token)){host.innerHTML='<h1>Касса смены</h1><div id="cashMessageV30" role="status"></div><button class="btn secondary" id="cashBackV30">К отчёту</button>';message('cashMessageV30',error.message);get('cashBackV30').onclick=()=>openReportByIdV5(id);}}
 };
 const reportBase=renderShiftReportV5;renderShiftReportV5=function(data,closed=false){const result=reportBase(data,closed);if(data.cash_drawer&&data.shift?.id){const button=document.createElement('button');button.type='button';button.id='cashDrawerButtonV30';button.className='btn secondary wide no-print';button.textContent='Касса смены: остаток, зарплата и выдачи';button.onclick=()=>root.openCashDrawerV30(data.shift.id,data.shift.status);get('reportBody').querySelector('.shift-financial-summary-v16')?.after(button);}return result;};
 const signOutBase=signOut;signOut=async function(){++view;++operation;pending.clear();current=null;busy=false;get('cashDrawerV30')?.remove();return signOutBase();};
})(typeof window==='object'?window:globalThis);
