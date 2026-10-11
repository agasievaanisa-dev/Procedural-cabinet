/* Read-only chronological journal of shifts assigned to the signed-in nurse. */
(function(global){
 'use strict';
 let session=0,view=0;
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,session]);
 const nurse=()=>currentStaff?.role==='nurse'&&!!currentStaff?.id;
 const screen=()=>$('shiftJournalV12');
 function status(text){
  const host=$('journalMessageV12');if(!host)return;
  host.textContent=text;host.className=text?'notice':'hidden';
 }
 function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00+03:00');
  return Number.isFinite(+date)&&localDateValue(date)===value;
 }
 function networkError(error,httpStatus){
  if(error?.code||(httpStatus!=null&&httpStatus!==0))return false;
  return /^(?:(?:TypeError|NetworkError):\s*)?(?:Load failed|Failed to fetch|Network request failed|NetworkError when attempting to fetch resource)\.?$/i.test(String(error?.message||'').trim());
 }
 function ensure(){
  if(screen())return;
  const host=document.createElement('section');host.id='shiftJournalV12';host.className='screen shift-journal-v12';
  host.innerHTML='<div class="row between"><h1>Журнал смены</h1><button id="journalBackV12" type="button" class="btn secondary" onclick="show(\'workspace\')">Назад</button></div><p class="sub">Пациенты и выполненные процедуры за выбранный день.</p><div class="card journal-filter-v12"><label for="journalDateV12">Дата</label><input id="journalDateV12" type="date"><button id="journalRefreshV12" type="button" class="btn secondary wide" onclick="refreshShiftJournalV12()">Обновить</button><p class="small">Время Москвы.</p></div><div id="journalMessageV12" class="hidden" role="status" aria-live="polite"></div><div id="journalBodyV12"></div>';
  document.querySelector('.app').appendChild(host);
  $('journalDateV12').addEventListener('input',()=>{
   ++view;$('journalBodyV12').textContent='';status('');$('journalRefreshV12').disabled=false;
  });
  $('journalDateV12').addEventListener('change',()=>global.refreshShiftJournalV12());
 }
 async function read(date,current){
  for(let attempt=0;attempt<2;attempt++){
   if(!current())return null;
   let response;try{response=await db.rpc('crm_shift_journal_v12',{p_date:date})}catch(error){response={error}}
   if(!current())return null;
   if(response&&!response.error)return response.data;
   const error=response?.error||{message:'Load failed'},network=networkError(error,response?.status);
   if(network&&attempt===0){await new Promise(resolve=>setTimeout(resolve,350));continue}
   throw Error(network?'Не удалось загрузить журнал. Проверьте интернет и нажмите «Обновить».':error.message||'Не удалось загрузить журнал. Нажмите «Обновить».');
  }
 }
 function chronology(first,second){
  const a=Date.parse(first.at),b=Date.parse(second.at);
  return (Number.isFinite(a)?a:Infinity)-(Number.isFinite(b)?b:Infinity)||String(first.id||'').localeCompare(String(second.id||''))||String(first.kind||'').localeCompare(String(second.kind||''));
 }
 function shiftTime(shiftData){
  return shiftData.started_at?shiftLabel(shiftData.started_at,shiftData.ended_at||shiftData.planned_end_at):'Время не указано';
 }
 function payment(event){
  if(!['charge_total','charged_total','paid_total','paid','received_total','debt_total','debt_amount'].some(key=>event[key]!=null))return '';
  const amounts=financeEventAmountsV5(event);
  const reason=[event.discount_reason,event.discount_comment].filter(Boolean).join(' · ');
  return '<p class="journal-payment-v12">Стоимость: <b>'+esc(rub(amounts.charge))+'</b>'+(amounts.charge===0?' · Бесплатно':'')+' · '+(event.received_total!=null?'Оплачено всего':'Оплачено')+': '+esc(rub(amounts.received))+(amounts.debt>0?' · <b>В долг: '+esc(rub(amounts.debt))+'</b>':'')+'</p>'+(reason?'<p class="small">Причина изменения стоимости: '+esc(reason)+'</p>':'');
 }
 function render(data){
  const reports=data.reports.slice().sort((a,b)=>chronology({at:a.shift?.started_at,id:a.shift?.id},{at:b.shift?.started_at,id:b.shift?.id}));
  if(!reports.length){
   $('journalBodyV12').innerHTML='<div class="card"><h2>На выбранную дату у вас нет смен</h2><p>Выберите другую дату, чтобы посмотреть журнал.</p></div>';return;
  }
  const shifts=reports.map(report=>{
   const shiftData=report.shift||{},staff=Array.isArray(report.staff)?report.staff:[];
   return '<div class="card journal-shift-v12"><div class="row between"><h2>Смена '+esc(shiftData.date||data.date)+' · '+esc(shiftTime(shiftData))+'</h2><span class="pill">'+(shiftData.status==='closed'?'Закрыта':'Открыта')+'</span></div><p>Медсёстры: '+esc(staff.map(member=>member.full_name).filter(Boolean).join(', ')||'Не указаны')+'</p></div>';
  }).join('');
  const events=reports.flatMap(report=>[
   ...(Array.isArray(report.procedures)?report.procedures:[]).map(event=>({...event,kind:'procedure',journalShift:report.shift||{}})),
   ...(Array.isArray(report.sales)?report.sales:[]).map(event=>({...event,kind:'sale',journalShift:report.shift||{}}))
  ]).sort(chronology);
  const entries=events.map((event,index)=>{
   const label=event.kind==='sale'?'Продажа препарата':event.type||event.procedure_type||event.service_name||'Процедура';
   return '<li class="journal-event-v12" data-event-id="'+esc(event.id||'')+'" data-event-kind="'+esc(event.kind)+'" data-shift-id="'+esc(event.journalShift.id||'')+'"><div class="journal-event-heading-v12"><span class="journal-event-number-v12" aria-hidden="true">'+(index+1)+'.</span><div><h3>'+esc(event.patient||'Без пациента')+'</h3><p class="journal-event-time-v12">'+esc(financeDateTimeV5(event.at))+' · Москва</p></div></div><p class="journal-event-kind-v12"><b>'+esc(label)+'</b>'+(event.nurse?' · Медсестра: '+esc(event.nurse):'')+'</p>'+(reports.length>1?'<p class="small">Смена '+esc(shiftTime(event.journalShift))+'</p>':'')+financeEventDetailsHtmlV5(event)+payment(event)+(event.notes?'<p>Комментарий: '+esc(event.notes)+'</p>':'')+'</li>';
  }).join('');
  $('journalBodyV12').innerHTML=shifts+'<h2>Пациенты по времени</h2><p class="small">Записей: '+events.length+'.</p>'+(entries?'<ol class="journal-events-v12">'+entries+'</ol>':'<div class="card">В этих сменах процедуры и продажи пока не записаны.</div>');
 }
 global.refreshShiftJournalV12=async function(){
  if(!nurse()||!screen()?.classList.contains('active'))return;
  const navigation=beginQuickNavigation4(),identity=actor(),version=++view,date=$('journalDateV12').value;
  const current=()=>identity===actor()&&version===view&&screen()?.classList.contains('active')&&$('journalDateV12').value===date&&quickNavigationCurrent4(navigation,currentStaff?.id);
  $('journalBodyV12').textContent='';status('');
  if(!validDate(date)){status('Выберите дату журнала.');$('journalRefreshV12').disabled=false;return}
  $('journalRefreshV12').disabled=true;status('Загружаем журнал…');
  try{
   const data=await read(date,current);if(!current())return;
   if(data?.date!==date||!Array.isArray(data.reports))throw Error('Не удалось получить журнал за выбранную дату. Нажмите «Обновить».');
   render(data);status('');
  }catch(error){if(current()){$('journalBodyV12').textContent='';status(error.message)}}
  finally{if(current())$('journalRefreshV12').disabled=false}
 };
 global.openShiftJournalV12=async function(date=null){
  if(!nurse()){message('homeMessage','Журнал смены доступен медсестре.');return}
  beginQuickNavigation4();ensure();$('journalDateV12').value=date||localDateValue();show('shiftJournalV12');await global.refreshShiftJournalV12();
 };
 const homeBase=renderCabinetHomeV5;
 renderCabinetHomeV5=function(){
  homeBase();if(!nurse())return;
  const actions=$('workspace').querySelector('.home-actions');if(!actions||$('homeJournalV12'))return;
  const button=document.createElement('button');button.id='homeJournalV12';button.type='button';button.innerHTML='<span>📋</span><strong>Журнал смены</strong>';button.onclick=()=>global.openShiftJournalV12();actions.appendChild(button);
 };
 const signOutBase=signOut;
 signOut=async function(){
  ++session;++view;
  if(screen()){$('journalBodyV12').textContent='';$('journalDateV12').value='';$('journalRefreshV12').disabled=false;status('')}
  await signOutBase();
 };
})(typeof window!=='undefined'?window:globalThis);
