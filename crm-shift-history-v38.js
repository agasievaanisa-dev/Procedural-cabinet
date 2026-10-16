/* Read-only manager browser for every shift in a chosen period. */
(function(root){
 'use strict';
 const get=id=>document.getElementById(id),knownNurses=new Map();
 let session=0,request=0,current=null;
 const allowed=()=>!!currentStaff?.id&&currentStaff.active!==false&&isManager();
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,session]);
 const filters=()=>JSON.stringify([get('shiftHistoryFromV38')?.value,get('shiftHistoryToV38')?.value,get('shiftHistoryNurseV38')?.value]);
 function clear(){++request;current=null;knownNurses.clear();get('shiftHistoryV38')?.remove();}
 function deny(){clear();message('homeMessage','Прошлые смены доступны только администратору и владельцу.');}
 function valid(saved){
  return allowed()&&current===saved.current&&saved.actor===actor()&&saved.request===request
   &&quickNavigationCurrent4(saved.navigation,currentStaff.id)&&saved.filters===filters()
   &&get('shiftHistoryV38')?.classList.contains('active');
 }
 function options(shifts=[]){
  const select=get('shiftHistoryNurseV38'),selected=select.value;
  const staff=typeof managementStaffV5==='undefined'?[]:managementStaffV5.filter(person=>person.role==='nurse');
  for(const person of [...nurses,...staff,...shifts.flatMap(row=>row.staff||[])])
   if(person?.id)knownNurses.set(String(person.id),person.full_name||'Медсестра');
  select.innerHTML='<option value="">Все медсёстры</option>'+[...knownNurses]
   .sort((a,b)=>a[1].localeCompare(b[1],'ru'))
   .map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
  select.value=selected;
 }
 function timeLabel(row){
  const started=new Date(row.started_at);
  if(!Number.isFinite(+started))return 'Время не указано';
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',hourCycle:'h23'}).format(started));
  return `${hour<16?'Утренняя':'Вечерняя'} · ${shiftLabel(row.started_at,row.ended_at||row.planned_end_at)}`;
 }
 function renderRows(shifts,saved){
  const list=get('shiftHistoryListV38');list.replaceChildren();
  if(!shifts.length){list.innerHTML='<p class="small">За выбранный период смен нет.</p>';return;}
  const rows=[...shifts].sort((a,b)=>String(b.shift_date).localeCompare(String(a.shift_date))||(Date.parse(b.started_at)-Date.parse(a.started_at)||0));
  for(const row of rows){
   const card=document.createElement('article');card.className='card';card.dataset.shiftId=row.id;
   const status=row.status==='open'?'Открыта':row.status==='closed'?'Закрыта':'Статус не указан';
   card.innerHTML=`<div class="row between"><strong>${esc(row.shift_date||'Дата не указана')}</strong><span class="pill">${status}</span></div><p class="small">${esc(timeLabel(row))} · Москва</p><p>${esc((row.staff||[]).map(person=>person.full_name||'Медсестра').join(', ')||'Медсёстры не указаны')}</p>`;
   const button=document.createElement('button');button.type='button';button.className='btn secondary wide';button.textContent='Открыть отчёт';
   button.onclick=async()=>{
    if(!valid(saved))return;
    get('shiftHistoryMessageV38').textContent='Открываем отчёт…';
    const opening=openReportByIdV5(row.id),navigation=quickNavigation4;await opening;
    if(allowed()&&current===saved.current&&saved.actor===actor()&&saved.request===request&&saved.filters===filters()
     &&quickNavigationCurrent4(navigation,currentStaff.id)&&get('shiftHistoryV38')?.classList.contains('active')){
     saved.navigation=navigation;get('shiftHistoryMessageV38').textContent='Отчёт не загрузился. Попробуйте открыть его ещё раз.';
    }
   };card.append(button);list.append(card);
  }
 }
 root.loadShiftHistoryV38=async function(){
  if(!allowed()){deny();return;}
  if(!current||current.actor!==actor()||!get('shiftHistoryV38')?.classList.contains('active'))return;
  const saved={current,actor:actor(),request:++request,navigation:beginQuickNavigation4(),filters:filters()};
  const from=get('shiftHistoryFromV38').value,to=get('shiftHistoryToV38').value,employee=get('shiftHistoryNurseV38').value;
  const status=get('shiftHistoryMessageV38'),retry=get('shiftHistoryRetryV38');
  get('shiftHistoryListV38').replaceChildren();retry.classList.add('hidden');
  if(!from||!to||from>to){status.textContent='Укажите даты: начало периода не позже окончания.';return;}
  status.textContent='Загружаем смены…';
  try{
   const payload={from,to,group_by:'day'};if(employee)payload.employee_id=employee;
   const data=await crmFinanceRpcV5('summary',payload);
   if(!valid(saved))return;
   if(!Array.isArray(data?.shifts)||data.shifts.some(row=>!row||typeof row.id!=='string'))throw Error('Список смен не загрузился. Повторите загрузку.');
   options(data.shifts);renderRows(data.shifts,saved);status.textContent=`Смен: ${data.shifts.length}`;
  }catch(error){if(valid(saved)){status.textContent=error.message||'Не удалось загрузить смены.';retry.classList.remove('hidden');}}
 };
 root.openShiftHistoryV38=async function(){
  if(!allowed()){deny();return;}
  beginQuickNavigation4();++request;knownNurses.clear();current={actor:actor()};
  let host=get('shiftHistoryV38');
  if(!host){host=document.createElement('section');host.id='shiftHistoryV38';host.className='screen';get('workspace').parentElement.append(host);}
  host.innerHTML='<div class="row between"><h1>Прошлые смены</h1><button type="button" class="btn secondary" id="shiftHistoryBackV38">На главный экран</button></div><p class="sub">Утренние и вечерние смены, включая закрытые. Откройте отчёт нужной смены.</p><div class="card"><div class="grid3"><div><label for="shiftHistoryFromV38">С даты</label><input type="date" id="shiftHistoryFromV38"></div><div><label for="shiftHistoryToV38">По дату</label><input type="date" id="shiftHistoryToV38"></div><div><label for="shiftHistoryNurseV38">Медсестра</label><select id="shiftHistoryNurseV38"></select></div></div></div><p id="shiftHistoryMessageV38" role="status" aria-live="polite"></p><button type="button" class="btn secondary wide hidden" id="shiftHistoryRetryV38">Повторить загрузку</button><div id="shiftHistoryListV38" class="list"></div>';
  get('shiftHistoryFromV38').value=get('shiftHistoryToV38').value=localDateValue();options();
  for(const id of ['shiftHistoryFromV38','shiftHistoryToV38','shiftHistoryNurseV38'])get(id).onchange=()=>root.loadShiftHistoryV38();
  get('shiftHistoryRetryV38').onclick=()=>root.loadShiftHistoryV38();
  get('shiftHistoryBackV38').onclick=()=>{beginQuickNavigation4();show('workspace');};
  show(host.id);return root.loadShiftHistoryV38();
 };
 function buttons(){
  if(current&&current.actor!==actor())clear();
  if(!allowed()){clear();get('shiftHistoryHomeV38')?.remove();get('shiftHistoryMenuV38')?.remove();return;}
  const actions=get('workspace')?.querySelector('.home-actions');
  if(actions&&!get('shiftHistoryHomeV38')){
   const button=document.createElement('button');button.type='button';button.id='shiftHistoryHomeV38';
   button.innerHTML='<span>🗓</span><strong>Прошлые смены</strong>';button.onclick=()=>root.openShiftHistoryV38();actions.append(button);
  }
  const menu=get('accountMenu')?.querySelector('.account-pop');
  if(menu&&!get('shiftHistoryMenuV38')){
   const button=document.createElement('button');button.type='button';button.id='shiftHistoryMenuV38';button.className='btn secondary';
   button.textContent='Прошлые смены';button.onclick=()=>root.openShiftHistoryV38();menu.insertBefore(button,menu.lastElementChild);
  }
 }
 ownerScreensV5.add('shiftHistoryV38');
 const homeBase=renderCabinetHomeV5;
 renderCabinetHomeV5=function(){const result=homeBase.apply(this,arguments);buttons();return result;};
 const signOutBase=signOut;
 signOut=async function(){++session;clear();get('shiftHistoryHomeV38')?.remove();get('shiftHistoryMenuV38')?.remove();return signOutBase.apply(this,arguments);};
})(typeof window==='object'?window:globalThis);
