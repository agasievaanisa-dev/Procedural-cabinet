/* Common cabinet time and the two role-specific workspaces. */
const CRM_TIME_ZONE_V5='Europe/Moscow';
localDateValue=function(d=new Date()) {return new Intl.DateTimeFormat('sv-SE',{timeZone:CRM_TIME_ZONE_V5,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
shiftLabel=function(started,end){const f=v=>new Date(v).toLocaleTimeString('ru-RU',{timeZone:CRM_TIME_ZONE_V5,hour:'2-digit',minute:'2-digit'});return end?`${f(started)}–${f(end)}`:`с ${f(started)}`};

const enterCabinetV5=enterApp,showCabinetV5=show,signOutCabinetV5=signOut;
const ownerScreensV5=new Set(['admin','medForm','services','servicesAdmin','bulkImport','bulk','staffV5','settingsV5','templatesV5','auditV5','cashV5','reportsV5','analyticsV5']);
function renderCabinetHomeV5(){
 if(!currentStaff)return;
 const actions=isManager()?[
  ['👤','Пациенты','goPatients()'],['💉','Процедуры','openProcedure()'],['💊','Продажа препаратов','openSale()'],['📦','Склад','openStock()'],
  ['💰','Касса','openCashV5()'],['👩‍⚕️','Сотрудники','openStaffV5()'],['📊','Отчёты','openReportsV5()'],['📈','Аналитика','openAnalyticsV5()'],['⚙️','Настройки','openSettingsV5()']
 ]:[['👤','Пациенты','goPatients()'],['💉','Процедуры','openProcedure()'],['💊','Препараты в работе','openStock()'],['💰','Оплата','openSale()'],['📋','Закрыть смену','openShiftMenu()']];
 $('workspace').querySelector('.home-actions').innerHTML=actions.map(([icon,label,action])=>`<button onclick="${action}"><span>${icon}</span><strong>${label}</strong></button>`).join('');
 $('workspace').querySelector('h1').textContent=isManager()?'Кабинет владельца':'Работа со своей сменой';
 $('status').textContent=`${currentStaff.full_name} · ${isManager()?'Владелец':'Медсестра'}`;
 const sub=$('workspace').querySelector('.sub');sub.textContent=shift?`${shift.a} и ${shift.b} · ${shift.type} · Москва`:'Для процедуры или продажи откройте смену';
 let voice=$('homeVoiceV5');if(!voice){voice=document.createElement('button');voice.id='homeVoiceV5';voice.className='btn secondary wide';voice.textContent='🎙 Голосовой помощник';voice.onclick=()=>openVoiceV5();$('workspace').querySelector('.home-actions').after(voice)}
 const newPatient=$('patients').querySelector('.card');if(!$('patientCreateV5')){const b=document.createElement('button');b.id='patientCreateV5';b.className='btn primary wide';b.textContent='＋ Новый пациент';b.onclick=goNewPatient;newPatient.append(b)}
}
show=function(id){if(ownerScreensV5.has(id)&&!isManager()){message('homeMessage','Раздел доступен только владельцу');id='workspace'}showCabinetV5(id);if(id==='workspace')renderCabinetHomeV5()};
enterApp=async function(user){try{await enterCabinetV5(user);if(currentStaff)renderCabinetHomeV5()}catch(e){$('loginMessage').textContent='Не удалось загрузить кабинет. '+e.message;show('login')}};
signOut=async function(){await signOutCabinetV5();const s=$('backupStatusV5');if(s)s.textContent='';};

// Interpret entered shift times in the cabinet timezone, regardless of the phone.
startShift=async function(){
 if(quickBusy)return;quickBusy=true;$('shiftMessage').textContent='Открываем смену…';
 try{
  const date=$('shiftDate').value||localDateValue(),st=$('shiftStartTime').value||'08:30',et=$('shiftEndTime').value||'16:00';
  const start=new Date(`${date}T${st}:00+03:00`),end=new Date(`${date}T${et}:00+03:00`);
  if(!Number.isFinite(+start)||!Number.isFinite(+end))throw Error('Проверьте дату и время');
  if(end<=start)end.setUTCDate(end.getUTCDate()+1);
  const {data,error}=await db.rpc('start_shift_v82',{p_shift_date:date,p_started_at:start.toISOString(),p_planned_end_at:end.toISOString(),p_nurse1:$('n1').value,p_nurse2:$('n2').value});
  if(error)throw Error(error.message);await loadQuickContext();
  if(!assignShift(quickContext.shifts.find(s=>s.id===data)))throw Error('Смена создана. Выберите её в меню сотрудника');
  const next=pendingAction;pendingAction=null;if(next)await next();else show('workspace');
 }catch(e){$('shiftMessage').textContent=e.message}finally{quickBusy=false}
};

const originalStockDetailsV5=loadStockDetails;
loadStockDetails=async function(id,view){await originalStockDetailsV5(id,view);if(!isManager()||view!==medView||id!==$('medId').value)return;
 try{const batches=await warehouseRpc('batches',{id});let box=$('inventoryCountV5');if(!box){box=document.createElement('details');box.id='inventoryCountV5';box.className='card';box.innerHTML=`<summary>Инвентаризация и корректировка</summary><label for="countBatchV5">Партия</label><select id="countBatchV5"></select><label for="countLocationV5">Место хранения</label><select id="countLocationV5"><option value="reserve">Запас</option><option value="work">В работе</option></select><label for="countActualV5">Фактический остаток в единицах списания</label><input id="countActualV5" type="number" min="0" step="1" inputmode="numeric"><label for="countReasonV5">Причина корректировки *</label><textarea id="countReasonV5"></textarea><button class="btn primary wide" onclick="saveInventoryV5()">Сохранить результат инвентаризации</button>`;$('batchList').after(box)}
 $('countBatchV5').innerHTML=batches.map(b=>`<option value="${b.id}">${esc(b.batch_number||'Без номера')} · до ${esc(b.expiry_date||'не указан')} · запас ${qty(num(b.quantity_remaining)-num(b.work_quantity))}, в работе ${qty(b.work_quantity)}</option>`).join('');
 $('countActualV5').value='';$('countReasonV5').value='';
 }catch(e){message('stockOperationMessage',e.message)}
};
async function saveInventoryV5(){
 if(!isManager()||warehouseBusy)return;
 try{const raw=$('countActualV5').value,n=Number(raw),reason=$('countReasonV5').value.trim();if(raw===''||!Number.isSafeInteger(n)||n<0||!reason)throw Error('Укажите целый фактический остаток от нуля и причину');
 await stockMutation('inventory',{id:$('medId').value,batch_id:$('countBatchV5').value,location:$('countLocationV5').value,actual_quantity:n,reason},'Результат инвентаризации сохранён в журнале');
 }catch(e){message('stockOperationMessage',e.message)}
}

const originalSettingsOpenV5=openSettingsV5;
openSettingsV5=async function(){await originalSettingsOpenV5();if(!isManager())return;
 const screen=$('settingsV5');if(!screen)return;let box=$('backupPanelV5');if(!box){box=document.createElement('div');box.id='backupPanelV5';box.className='card';box.innerHTML='<h2>Автоматические резервные копии</h2><p class="small">Данные и прикреплённые документы сохраняются ежедневно в закрытом хранилище. Хранятся копии за последние 7 дней.</p><div id="backupStatusV5"></div><button class="btn secondary wide" onclick="refreshBackupStatusV5()">Проверить последнюю копию</button><button class="btn primary wide" onclick="requestBackupV5()">Создать полную копию сейчас</button><button id="backupDownloadV5" class="btn secondary wide hidden" onclick="downloadBackupV5()">Скачать данные последней копии</button>';screen.append(box)}await refreshBackupStatusV5();
};
let backupLastPathV5=null;
async function refreshBackupStatusV5(){if(!isManager())return;const {data,error}=await db.rpc('crm_backup_status_v5');if(!isManager())return;
 if(error){message('backupStatusV5',error.message);return}backupLastPathV5=data?.last_success?.path||null;
 const last=data?.last_run;$('backupStatusV5').textContent=last?`${last.status==='completed'?'Копия завершена':last.status==='running'?'Копирование выполняется':'Копирование не завершено'} · ${new Date(last.completed_at||last.started_at).toLocaleString('ru-RU',{timeZone:CRM_TIME_ZONE_V5})} · документов: ${last.files_count}`:'Первая резервная копия ещё не создана';
 $('backupDownloadV5').classList.toggle('hidden',!backupLastPathV5);
}
async function requestBackupV5(){if(!isManager())return;const {error}=await db.rpc('crm_request_backup_v5');if(error){message('backupStatusV5',error.message);return}message('backupStatusV5','Резервное копирование запущено. Проверьте результат через минуту',true)}
async function downloadBackupV5(){if(!isManager()||!backupLastPathV5)return;const {data,error}=await db.storage.from('crm-backups').createSignedUrl(backupLastPathV5+'/snapshot.json',60,{download:'crm-backup.json'});if(error){message('backupStatusV5',error.message);return}window.open(data.signedUrl,'_blank','noopener')}

// Pick up published releases when no clinical draft is being edited.
const currentReleaseV5=document.querySelector('meta[name="crm-release"]')?.content;
setInterval(async()=>{if(document.hidden)return;try{const response=await fetch('/index.html',{cache:'no-store'});if(!response.ok)return;const html=await response.text(),release=html.match(/name="crm-release" content="([^"]+)"/)?.[1];if(!release||release===currentReleaseV5)return;
 const active=document.querySelector('.screen.active')?.id;if(['login','workspace','patients','workStock'].includes(active)&&!clinicalBusy&&!warehouseBusy)location.reload();
 else{let banner=$('releaseNoticeV5');if(!banner){banner=document.createElement('div');banner.id='releaseNoticeV5';banner.className='notice';banner.innerHTML='Доступно обновление. Сохраните текущую работу, затем <button class="btn secondary" onclick="location.reload()">обновите программу</button>';document.querySelector('.top').after(banner)}}
 }catch{}},120000);
