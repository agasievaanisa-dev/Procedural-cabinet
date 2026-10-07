/* Owner management and editable procedure templates. Authorization is enforced by RPCs. */
let managementStaffV5=[],managementTemplatesV5=[],managementAuditV5=[],managementBusyV5=false,managementLoadV5=0;

async function crmManagementRpcV5(action,payload={}){
  const {data,error}=await db.rpc('crm_management_v5',{p_action:action,p_payload:payload});
  if(error)throw new Error(error.message||'Не удалось выполнить действие. Проверьте соединение.');
  return data;
}
function ownerManagementV5(){
  if(isManager())return true;
  message('homeMessage','Раздел доступен владельцу.');return false;
}
function managementScreenV5(id,title,body){
  let screen=$(id);
  if(!screen){screen=document.createElement('section');screen.id=id;screen.className='screen management-v5';document.querySelector('.app').appendChild(screen)}
  screen.innerHTML=`<div class="row between"><h1>${esc(title)}</h1><button class="btn secondary" onclick="show('workspace')">На главный экран</button></div>${body}`;
  return screen;
}
function managementMoneyV5(value,label){
  const amount=Number(value);
  if(value===''||!Number.isFinite(amount)||amount<0||Math.round(amount*100)/100!==amount)throw Error(label+': введите сумму от нуля с точностью до копейки');
  return amount;
}
function roleLabelV5(role){return ({owner:'Владелец',admin:'Администратор',nurse:'Медсестра'})[role]||role||'Не указана'}
function managementSetBusyV5(id,value){
  managementBusyV5=value;$(id)?.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=value);
}

async function openStaffV5(){
  if(!ownerManagementV5())return;
  managementScreenV5('staffV5','Сотрудники',`<p class="sub">Каждая медсестра входит по своему email и паролю.</p><div class="card"><h2>Новая учётная запись</h2><label for="staffCreateNameV5">Имя *</label><input id="staffCreateNameV5" autocomplete="off"><label for="staffCreateEmailV5">Email для входа *</label><input id="staffCreateEmailV5" type="email" autocomplete="off"><label for="staffCreatePasswordV5">Первый пароль *</label><input id="staffCreatePasswordV5" type="password" minlength="12" maxlength="128" autocomplete="new-password"><div class="small">От 12 до 128 символов.</div><button class="btn primary wide" onclick="createStaffAccountV5()">Создать доступ медсестре</button></div><div id="staffMessageV5" role="status" aria-live="polite"></div><div id="staffListV5" class="list"></div><div id="staffEditV5" class="card hidden"><h2>Данные сотрудника</h2><input id="staffEditIdV5" type="hidden"><label for="staffEditNameV5">Имя *</label><input id="staffEditNameV5"><label for="staffEditRoleV5">Доступ</label><select id="staffEditRoleV5"><option value="nurse">Медсестра</option><option value="owner">Владелец</option><option value="admin">Администратор</option></select><label class="management-check"><input id="staffEditActiveV5" type="checkbox"> Доступ активен</label><button class="btn primary wide" onclick="saveStaffV5()">Сохранить сотрудника</button><button class="btn secondary wide" onclick="$('staffEditV5').classList.add('hidden')">Отмена</button></div><div class="card"><h2>Оплата смены</h2><p>Стандартная зарплата: <strong>2 000 ₽ каждому сотруднику за смену.</strong></p><p class="small">Владелец может изменить сумму в отчёте смены с указанием причины.</p><button class="btn secondary wide" onclick="openReportsV5()">Открыть отчёты смен</button></div>`);
  show('staffV5');await loadStaffV5();
}
async function loadStaffV5(){
  if(!isManager())return;
  const version=++managementLoadV5;message('staffMessageV5','Загружаем сотрудников…');
  try{const data=await crmManagementRpcV5('staff_list');if(version!==managementLoadV5||!isManager())return;managementStaffV5=data||[];
    $('staffListV5').innerHTML=managementStaffV5.map((s,index)=>`<button class="item management-list-button" onclick="editStaffV5(${index})"><div class="row between"><strong>${esc(s.full_name)}</strong><span class="pill">${esc(roleLabelV5(s.role))}</span></div><div class="small">${esc(s.email||'Email не привязан')} · ${s.active!==false?'Доступ активен':'Доступ отключён'}</div><div class="small">${s.auth_user_id?'Есть личная учётная запись':'Учётная запись для входа не привязана'}</div></button>`).join('')||'<p>Сотрудников пока нет.</p>';message('staffMessageV5','');
  }catch(e){message('staffMessageV5',e.message)}
}
function editStaffV5(index){
  if(!ownerManagementV5())return;const s=managementStaffV5[index];if(!s)return;
  $('staffEditIdV5').value=s.id;$('staffEditNameV5').value=s.full_name||'';$('staffEditRoleV5').value=s.role;$('staffEditActiveV5').checked=s.active!==false;
  $('staffEditV5').classList.remove('hidden');$('staffEditV5').scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveStaffV5(){
  if(!ownerManagementV5()||managementBusyV5)return;
  try{const full_name=$('staffEditNameV5').value.trim();if(!full_name)throw Error('Укажите имя сотрудника');
    const payload={id:$('staffEditIdV5').value,full_name,role:$('staffEditRoleV5').value,active:$('staffEditActiveV5').checked};
    if(payload.id===currentStaff.id&&(!payload.active||payload.role!==currentStaff.role))throw Error('Для изменения своего доступа используйте другую учётную запись владельца');
    managementSetBusyV5('staffV5',true);await crmManagementRpcV5('staff_save',payload);$('staffEditV5').classList.add('hidden');await Promise.all([loadStaffV5(),loadNurses()]);message('staffMessageV5','Данные сотрудника сохранены.',true);
  }catch(e){message('staffMessageV5',e.message)}finally{managementSetBusyV5('staffV5',false)}
}
async function createStaffAccountV5(){
  if(!ownerManagementV5()||managementBusyV5)return;
  try{const full_name=$('staffCreateNameV5').value.trim(),email=$('staffCreateEmailV5').value.trim(),password=$('staffCreatePasswordV5').value;
    if(!full_name)throw Error('Укажите имя сотрудника');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Укажите email для входа');
    if(password.length<12||password.length>128)throw Error('Первый пароль должен содержать от 12 до 128 символов');
    managementSetBusyV5('staffV5',true);message('staffMessageV5','Создаём личный доступ…');
    const {data,error}=await db.functions.invoke('crm-admin',{body:{action:'create_staff',full_name,email,password,role:'nurse'}});
    if(error){let explanation=error.message;try{const detail=await error.context?.json();explanation=detail?.error||detail?.message||explanation}catch(_e){}throw Error(explanation||'Не удалось создать учётную запись')}
    if(data?.error)throw Error(data.error);
    $('staffCreatePasswordV5').value='';$('staffCreateNameV5').value='';$('staffCreateEmailV5').value='';await Promise.all([loadStaffV5(),loadNurses()]);message('staffMessageV5','Учётная запись создана. Медсестра может войти со своим email и паролем.',true);
  }catch(e){message('staffMessageV5',e.message)}finally{managementSetBusyV5('staffV5',false)}
}

async function openSettingsV5(){
  if(!ownerManagementV5())return;
  managementScreenV5('settingsV5','Настройки',`<div class="card"><h2>Касса и время</h2><label for="settingsFloatV5">Разменный фонд, ₽</label><input id="settingsFloatV5" type="number" inputmode="decimal" min="0" step="0.01"><p class="small">Разменный фонд используется для сдачи и не входит в выручку.</p><p>Время кабинета: <strong>Москва (UTC+3)</strong></p><p class="small">Смены, дневные отчёты и сроки годности рассчитываются по времени кабинета на всех устройствах.</p><button class="btn primary wide" onclick="saveSettingsV5()">Сохранить настройки</button><div id="settingsMessageV5" role="status" aria-live="polite"></div></div><div class="card"><h2>Услуги и назначения</h2><button class="btn secondary wide" onclick="goServicesV5()">Прайс услуг</button><button class="btn secondary wide" onclick="openTemplatesV5()">Шаблоны процедур</button></div><div class="card"><h2>История и резервная копия</h2><button class="btn secondary wide" onclick="openAuditV5()">Журнал действий</button><button class="btn secondary wide" onclick="downloadDataExportV5()">Скачать данные учёта</button><p class="small">JSON содержит данные учёта и ссылки на документы. Файлы документов и фотографии хранятся отдельно.</p><div id="backupMessageV5" role="status" aria-live="polite"></div></div>`);
  show('settingsV5');message('settingsMessageV5','Загружаем настройки…');
  try{const s=await crmFinanceRpcV5('settings_get');if(!isManager())return;$('settingsFloatV5').value=s.float_amount??0;message('settingsMessageV5','')}
  catch(e){message('settingsMessageV5',e.message)}
}
async function saveSettingsV5(){
  if(!ownerManagementV5()||managementBusyV5)return;
  try{const float_amount=managementMoneyV5($('settingsFloatV5').value,'Разменный фонд'),time_zone='Europe/Moscow';
    managementSetBusyV5('settingsV5',true);await crmFinanceRpcV5('settings_save',{float_amount,time_zone});message('settingsMessageV5','Настройки сохранены.',true);
    if(typeof refreshOwnerDashboardV5==='function')await refreshOwnerDashboardV5();
  }catch(e){message('settingsMessageV5',e.message)}finally{managementSetBusyV5('settingsV5',false)}
}

function ensureServicesV5(){
  if(!$('serviceCommentV5'))$('serviceActive').closest('label').insertAdjacentHTML('beforebegin','<label for="serviceCommentV5">Комментарий</label><textarea id="serviceCommentV5"></textarea>');
  if(!$('serviceNewV5')){$('services').querySelector('.row').insertAdjacentHTML('beforeend','<button id="serviceNewV5" class="btn secondary" onclick="newServiceV5()">＋ Новая услуга</button>');$('services').querySelector('button[onclick="show(\'admin\')"]')?.setAttribute('onclick',"show('workspace')")}
}
async function goServicesV5(){if(!ownerManagementV5())return;ensureServicesV5();newServiceV5();show('services');await loadServicesAdmin()}
function newServiceV5(){if(!isManager())return;ensureServicesV5();$('serviceId').value='';$('serviceName').value='';$('serviceWork').value='0';$('serviceConsumables').value='0';$('serviceActive').checked=true;$('serviceCommentV5').value=''}
loadServicesAdmin=async function(){
  if(!ownerManagementV5())return;ensureServicesV5();message('serviceMessage','Загружаем услуги…');
  try{serviceRows=await crmManagementRpcV5('services_list')||[];if(!isManager())return;$('serviceList').innerHTML=serviceRows.map((s,i)=>`<button class="item management-list-button" onclick="editService(serviceRows[${i}])"><div class="row between"><strong>${esc(s.name)}</strong><span class="pill">${s.active!==false?'Активна':'В архиве'}</span></div><div>Стоимость: ${rub(num(s.work_price)+num(s.consumables_price))}</div><div class="small">Работа ${rub(s.work_price)} · расходники ${rub(s.consumables_price)}</div>${s.comment?`<div class="small">${esc(s.comment)}</div>`:''}</button>`).join('')||'<p>Добавьте первую услугу.</p>';message('serviceMessage','')}
  catch(e){message('serviceMessage',e.message)}
};
editService=function(s){if(!ownerManagementV5()||!s)return;ensureServicesV5();$('serviceId').value=s.id;$('serviceName').value=s.name;$('serviceWork').value=s.work_price??0;$('serviceConsumables').value=s.consumables_price??0;$('serviceActive').checked=s.active!==false;$('serviceCommentV5').value=s.comment||'';$('serviceName').scrollIntoView({behavior:'smooth',block:'center'})};
saveService=async function(){
  if(!ownerManagementV5()||serviceSaving)return;
  try{const name=$('serviceName').value.trim();if(!name)throw Error('Укажите название услуги');
    const payload={id:$('serviceId').value||null,name,work_price:managementMoneyV5($('serviceWork').value,'Стоимость работы'),consumables_price:managementMoneyV5($('serviceConsumables').value,'Стоимость расходников'),comment:$('serviceCommentV5')?.value.trim()||null,active:$('serviceActive').checked};
    serviceSaving=true;managementSetBusyV5('services',true);await crmManagementRpcV5('service_save',payload);newServiceV5();await Promise.all([loadServicesAdmin(),loadServices()]);message('serviceMessage','Услуга сохранена. Изменение записано в журнал.',true);
  }catch(e){message('serviceMessage',e.message)}finally{serviceSaving=false;managementSetBusyV5('services',false)}
};

function templateMedicationV5(id){return meds.find(m=>m.id===id)||(isManager()?inventory.find(m=>m.id===id):null)}
function templateItemsTextV5(t){return (t.items||[]).map(x=>{const m=templateMedicationV5(x.medication_id)||x;return `${esc(m.name||'Препарат недоступен')} × ${qty(x.quantity)} ${esc(unit(m))}`}).join('<br>')||'Без препаратов'}
async function openTemplatesV5(){
  if(!ownerManagementV5())return;
  managementScreenV5('templatesV5','Шаблоны процедур',`<p class="sub">Шаблон заполняет черновик процедуры. Перед сохранением можно изменить препараты и дозировку.</p><button class="btn primary wide" onclick="editTemplateV5(-1)">＋ Новый шаблон</button><div id="templatesMessageV5" role="status" aria-live="polite"></div><div id="templatesListV5" class="list" style="margin-top:14px"></div><div id="templateEditV5" class="card hidden"><h2>Состав шаблона</h2><input id="templateIdV5" type="hidden"><label for="templateNameV5">Название *</label><input id="templateNameV5" placeholder="Капельница №1"><label for="templateServiceV5">Услуга</label><select id="templateServiceV5"></select><h3>Препараты</h3><div id="templateItemsV5"></div><button class="btn secondary wide" onclick="addTemplateItemV5()">＋ Добавить препарат</button><label for="templateNotesV5">Комментарий</label><textarea id="templateNotesV5"></textarea><label class="management-check"><input id="templateActiveV5" type="checkbox" checked> Использовать шаблон</label><button class="btn primary wide" onclick="saveTemplateV5()">Сохранить шаблон</button><button class="btn secondary wide" onclick="$('templateEditV5').classList.add('hidden')">Отмена</button></div>`);
  show('templatesV5');message('templatesMessageV5','Загружаем шаблоны…');
  try{const results=await Promise.all([crmManagementRpcV5('templates_list'),loadServices(),loadMeds(),loadInventory()]);if(!isManager())return;managementTemplatesV5=results[0]||[];renderTemplatesV5();message('templatesMessageV5','')}
  catch(e){message('templatesMessageV5',e.message)}
}
function renderTemplatesV5(){
  $('templatesListV5').innerHTML=managementTemplatesV5.map((t,i)=>`<button class="item management-list-button" onclick="editTemplateV5(${i})"><div class="row between"><strong>${esc(t.name)}</strong><span class="pill">${t.active!==false?'Активен':'В архиве'}</span></div><p class="small">${templateItemsTextV5(t)}</p>${t.notes?`<div class="small">${esc(t.notes)}</div>`:''}</button>`).join('')||'<p>Шаблонов пока нет.</p>';
}
function editTemplateV5(index){
  if(!ownerManagementV5())return;const t=managementTemplatesV5[index]||{};
  $('templateIdV5').value=t.id||'';$('templateNameV5').value=t.name||'';$('templateNotesV5').value=t.notes||'';$('templateActiveV5').checked=t.active!==false;
  $('templateServiceV5').innerHTML='<option value="">Выбрать при процедуре</option>'+services.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if(t.service_id&&!services.some(s=>s.id===t.service_id))$('templateServiceV5').insertAdjacentHTML('beforeend',`<option value="${esc(t.service_id)}">Прежняя услуга недоступна — выберите другую</option>`);
  $('templateServiceV5').value=t.service_id||'';$('templateItemsV5').innerHTML='';(t.items||[]).forEach(x=>addTemplateItemV5(x.medication_id,x.quantity));
  $('templateEditV5').classList.remove('hidden');$('templateEditV5').scrollIntoView({behavior:'smooth',block:'start'});
}
function addTemplateItemV5(id='',quantity=1){
  if(!isManager())return;const all=(inventory.length?inventory:meds).filter(m=>m.active!==false),row=document.createElement('div');row.className='template-item-v5';
  const options=all.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.dosage?' · '+esc(m.dosage):''} · ${esc(unit(m))}</option>`).join('');
  row.innerHTML=`<div><label>Препарат</label><select class="template-med-v5" aria-label="Препарат шаблона"><option value="">Выберите препарат</option>${options}${id&&!all.some(m=>m.id===id)?`<option value="${esc(id)}">Препарат недоступен — замените или уберите</option>`:''}</select></div><div><label>Количество</label><input class="template-quantity-v5" aria-label="Количество препарата" type="number" inputmode="numeric" min="1" step="1" value="${esc(quantity)}"></div><button class="btn danger" aria-label="Убрать препарат" onclick="this.parentElement.remove()">×</button>`;
  row.querySelector('select').value=id;$('templateItemsV5').appendChild(row);
}
function templatePayloadV5(){
  const name=$('templateNameV5').value.trim();if(!name)throw Error('Укажите название шаблона');
  const items=[...$('templateItemsV5').querySelectorAll('.template-item-v5')].map(row=>{
    const medication_id=row.querySelector('select').value,quantity=Number(row.querySelector('input').value);
    if(!medication_id)throw Error('Выберите препарат в каждой строке или уберите пустую строку');
    if(!Number.isSafeInteger(quantity)||quantity<=0)throw Error('Количество препарата должно быть целым числом больше нуля в единицах списания');
    const m=templateMedicationV5(medication_id);if(!m||m.active===false)throw Error('В шаблоне есть недоступный препарат. Замените его или уберите.');
    return {medication_id,quantity};
  });
  return {id:$('templateIdV5').value||null,name,service_id:$('templateServiceV5').value||null,items,notes:$('templateNotesV5').value.trim()||null,active:$('templateActiveV5').checked};
}
async function saveTemplateV5(){
  if(!ownerManagementV5()||managementBusyV5)return;
  try{const payload=templatePayloadV5();managementSetBusyV5('templatesV5',true);await crmManagementRpcV5('template_save',payload);managementTemplatesV5=await crmManagementRpcV5('templates_list')||[];renderTemplatesV5();$('templateEditV5').classList.add('hidden');message('templatesMessageV5','Шаблон сохранён.',true)}
  catch(e){message('templatesMessageV5',e.message)}finally{managementSetBusyV5('templatesV5',false)}
}

function ensureTemplatePickerV5(){
  if($('procedureTemplateV5'))return;
  $('servicePriceInfo').insertAdjacentHTML('afterend',`<div id="procedureTemplateV5" class="template-picker-v5"><label for="procTemplateSelectV5">Готовый шаблон</label><div class="row"><select id="procTemplateSelectV5"><option value="">Без шаблона</option></select><button class="btn secondary" onclick="applyProcedureTemplateV5()">Применить</button></div><div id="procTemplateMessageV5" role="status"></div></div>`);
}
async function loadProcedureTemplatesV5(){
  ensureTemplatePickerV5();$('procTemplateSelectV5').innerHTML='<option value="">Без шаблона</option>';message('procTemplateMessageV5','');
  try{const templates=await crmManagementRpcV5('templates_list');managementTemplatesV5=(templates||[]).filter(t=>t.active!==false);$('procTemplateSelectV5').innerHTML='<option value="">Без шаблона</option>'+managementTemplatesV5.map((t,i)=>`<option value="${i}">${esc(t.name)}</option>`).join('')}
  catch(e){message('procTemplateMessageV5','Шаблоны не загрузились: '+e.message)}
}
function applyProcedureTemplateV5(){
  const selected=$('procTemplateSelectV5').value;if(selected==='')return;const t=managementTemplatesV5[Number(selected)];if(!t)return;
  $('procMeds').innerHTML='';
  if(t.service_id)$('procService').value=services.some(s=>s.id===t.service_id)?t.service_id:'';
  (t.items||[]).forEach(x=>addMedRow('procMeds',x.medication_id,x.quantity,{id:x.medication_id,name:x.name||'Препарат из шаблона недоступен',consumption_unit:x.unit||'ед.'}));
  calcProcedure();recalc();message('procTemplateMessageV5','Шаблон применён. Можно добавить, убрать препараты или изменить количество. Проверьте назначение перед сохранением.',true);
  if(t.service_id&&!$('procService').value)message('procedureMessage','Услуга из шаблона недоступна. Выберите действующую услугу.');
}
const managementPrepareTreatmentV5=prepareTreatment4;
prepareTreatment4=async function(kind,patientId){const ready=await managementPrepareTreatmentV5(kind,patientId);if(ready&&kind==='procedure')await loadProcedureTemplatesV5();return ready};

/* Extra medication/batch metadata travels with the existing atomic warehouse operation. */
const medicationBatchesExtraV5=new Map();
matchesMedication=function(m,q){const hay=normalizeSearch([m.name,m.search_name,m.generic_name,m.dosage,m.category,m.manufacturer,m.manufacturer_country,m.release_form].join(' '));return normalizeSearch(q).split(/\s+/).every(term=>hay.includes(term))};
function ensureMedicationExtrasV5(){
  if(!$('medManufacturerV5'))$('medSaveButton').insertAdjacentHTML('beforebegin','<div class="grid2"><div><label for="medManufacturerV5">Производитель</label><input id="medManufacturerV5"></div><div><label for="medReleaseFormV5">Форма выпуска</label><input id="medReleaseFormV5" placeholder="Раствор, таблетки, порошок"></div></div><label for="medCommentV5">Комментарий к препарату</label><textarea id="medCommentV5"></textarea>');
  for(const prefix of ['receive','opening']){
    if($(prefix+'BatchNumberV5'))continue;
    const fields=`<div class="grid3"><div><label for="${prefix}BatchNumberV5">Номер партии</label><input id="${prefix}BatchNumberV5"></div><div><label for="${prefix}SupplierV5">Поставщик</label><input id="${prefix}SupplierV5"></div><div><label for="${prefix}ReceivedDateV5">Дата поступления</label><input id="${prefix}ReceivedDateV5" type="date"></div></div>`;
    if(prefix==='receive')$('receivePreview').insertAdjacentHTML('beforebegin',fields);
    else $('openingComment').previousElementSibling.insertAdjacentHTML('beforebegin',fields);
  }
  document.querySelector('label[for="medCountry"]').textContent='Страна';document.querySelector('label[for="medDosage"]').textContent='Дозировка';document.querySelector('label[for="receiveComment"]').textContent='Комментарий / накладная';
}
const managementOpenMedFormV5=openMedForm;
openMedForm=function(id='',focus=''){
  if(!isManager()||warehouseBusy)return;ensureMedicationExtrasV5();managementOpenMedFormV5(id,focus);
  if($('medId').value!==id)return;const m=inventory.find(x=>x.id===id);
  $('medManufacturerV5').value=m?.manufacturer||'';$('medReleaseFormV5').value=m?.release_form||'';$('medCommentV5').value=m?.comment||'';
  for(const prefix of ['receive','opening']){$(prefix+'BatchNumberV5').value='';$(prefix+'SupplierV5').value='';$(prefix+'ReceivedDateV5').value=localDateValue();$(prefix+'ReceivedDateV5').max=localDateValue()}
};
function warehouseExtraPayloadV5(action,payload,write){
  const result={...payload};
  if(!write||!isManager()||!$('medForm')?.classList.contains('active'))return result;
  if(action==='save'&&$('medManufacturerV5')){
    result.manufacturer=$('medManufacturerV5').value.trim()||null;result.release_form=$('medReleaseFormV5').value.trim()||null;result.comment=$('medCommentV5').value.trim()||null;
  }else if(['receive','opening'].includes(action)&&payload.id===$('medId')?.value&&$(action+'BatchNumberV5')){
    result.batch_number=$(action+'BatchNumberV5').value.trim()||null;result.supplier=$(action+'SupplierV5').value.trim()||null;
    const date=$(action+'ReceivedDateV5').value;if(date&&date>localDateValue())throw Error('Дата поступления не может быть в будущем');
    result.received_date=date||null;
  }
  return result;
}
const managementWarehouseRpcV5=warehouseRpc;
warehouseRpc=async function(action,payload={},write=false){
  const data=await managementWarehouseRpcV5(action,warehouseExtraPayloadV5(action,payload,write),write);
  if(action==='batches'&&payload.id)medicationBatchesExtraV5.set(payload.id,data||[]);
  return data;
};
const managementLoadStockDetailsV5=loadStockDetails;
loadStockDetails=async function(id,view){
  medicationBatchesExtraV5.delete(id);await managementLoadStockDetailsV5(id,view);if(!isManager()||view!==medView||$('medId').value!==id)return;
  const batches=medicationBatchesExtraV5.get(id)||[];
  [...$('batchList').children].forEach((row,index)=>{
    const b=batches[index];if(!b||(!b.batch_number&&!b.supplier))return;
    row.insertAdjacentHTML('afterbegin',`<div class="small">${b.batch_number?'Партия № '+esc(b.batch_number):''}${b.supplier?(b.batch_number?' · ':'')+'Поставщик: '+esc(b.supplier):''}</div>`);
  });
};

const auditNamesV5={staff:'Сотрудник',patient:'Пациент',patients:'Пациент',medication:'Препарат',medications:'Препарат',service:'Услуга',service_catalog:'Услуга',procedure_services:'Услуга',procedure_template:'Шаблон',procedure_templates:'Шаблон',template:'Шаблон',salary:'Зарплата',shift_payroll:'Зарплата',settings:'Настройки',stock:'Склад',medication_batches:'Партия',stock_movements:'Движение склада',patient_files:'Документ',backup:'Резервная копия',procedure:'Процедура',sale:'Продажа'};
const auditActionNamesV5={package_corrected:'Исправление количества в упаковке',create:'Создание',insert:'Создание',restore:'Восстановление',update:'Изменение',delete:'Удаление',save:'Сохранение',staff_save:'Изменение сотрудника',template_save:'Изменение шаблона',service_save:'Изменение услуги',settings_save:'Изменение настроек',salary:'Изменение зарплаты',backup_export:'Экспорт резервной копии',receive:'Поступление партии',transfer:'Перевод в работу',adjust:'Корректировка остатка',archive:'Архивирование',write_off:'Списание',return:'Возврат в запас'};
function auditValueV5(value){return typeof value==='object'&&value!==null?JSON.stringify(value,null,2):String(value??'—')}
const auditFieldsV5={full_name:'Имя',name:'Название',role:'Доступ',active:'Активен',email:'Email',quantity:'Количество',quantity_received:'Поступило',quantity_remaining:'Остаток',work_quantity:'В работе',work_price:'Работа, ₽',consumables_price:'Расходники, ₽',sale_price:'Цена продажи, ₽',purchase_price:'Закупочная цена, ₽',purchase_price_per_unit:'Закупочная цена за единицу, ₽',min_total_stock:'Минимальный остаток',work_threshold:'Минимум в работе',amount:'Сумма, ₽',float_amount:'Разменный фонд, ₽',time_zone:'Часовой пояс',reason:'Причина',comment:'Комментарий',notes:'Комментарий',expiry_date:'Срок годности',batch_number:'Номер партии',supplier:'Поставщик',status:'Статус',before:'До',after:'После',location:'Место хранения',from_location:'Откуда',to_location:'Куда',movement_type:'Операция',items:'Препараты',unit:'Единица',dosage:'Дозировка',category:'Категория',generic_name:'Международное название',manufacturer:'Производитель',manufacturer_country:'Страна',release_form:'Форма выпуска',consumption_unit:'Единица списания',units_per_package:'Количество в упаковке',lead_time_days:'Срок поставки, дни',is_archived:'В архиве'};
function auditDetailsV5(value){
  if(!value||typeof value!=='object')return `<p>${esc(auditValueV5(value))}</p>`;
  const entries=Object.entries(value).filter(([key])=>auditFieldsV5[key]);
  return entries.length?`<dl class="audit-values-v5">${entries.map(([key,v])=>`<dt>${esc(auditFieldsV5[key])}</dt><dd>${key==='role'?esc(roleLabelV5(v)):typeof v==='boolean'?(v?'Да':'Нет'):key==='items'&&Array.isArray(v)?v.map(item=>`${esc(templateMedicationV5(item.medication_id)?.name||item.name||'Препарат')} × ${qty(item.quantity)}`).join('<br>'):esc(({reserve:'Запас',work:'В работе',open:'Открыта',closed:'Закрыта'})[v]||auditValueV5(v))}</dd>`).join('')}</dl>`:'<p class="small">Событие зарегистрировано.</p>';
}
async function openAuditV5(){
  if(!ownerManagementV5())return;
  managementScreenV5('auditV5','Журнал действий',`<p class="sub">Кто и когда изменил цены, остатки, услуги, зарплату и настройки.</p><div class="card"><label for="auditSearchV5">Поиск в журнале</label><input id="auditSearchV5" type="search" placeholder="Сотрудник, действие или причина" oninput="renderAuditV5()"><button class="btn secondary wide" onclick="loadAuditV5()">Обновить журнал</button></div><div id="auditMessageV5" role="status" aria-live="polite"></div><div id="auditListV5" class="list"></div>`);show('auditV5');await loadAuditV5();
}
async function loadAuditV5(){
  if(!isManager())return;message('auditMessageV5','Загружаем журнал…');
  try{managementAuditV5=await crmManagementRpcV5('audit_list',{limit:200})||[];if(!isManager())return;renderAuditV5();message('auditMessageV5','Показаны последние 200 действий.')}
  catch(e){message('auditMessageV5',e.message)}
}
function renderAuditV5(){
  if(!isManager())return;const q=normalizeSearch($('auditSearchV5').value);
  const visible=managementAuditV5.filter(a=>normalizeSearch([a.actor_name,a.action,a.entity_type,a.reason,auditActionNamesV5[a.action],auditNamesV5[a.entity_type],auditValueV5(a.before_data),auditValueV5(a.after_data)].join(' ')).includes(q));
  $('auditListV5').innerHTML=visible.map(a=>`<div class="item"><div class="row between"><strong>${esc(auditActionNamesV5[a.action]||'Изменение')}</strong><span class="small">${esc(a.created_at?new Date(a.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'')}</span></div><p>${esc(a.actor_name||'Система')} · ${esc(auditNamesV5[a.entity_type]||'Учёт')}</p>${a.reason?`<p>Причина: ${esc(a.reason)}</p>`:''}<details><summary>Что изменилось</summary><div class="grid2"><div><h3>До изменения</h3>${auditDetailsV5(a.before_data)}</div><div><h3>После изменения</h3>${auditDetailsV5(a.after_data)}</div></div></details></div>`).join('')||'<p>Действий не найдено.</p>';
}
async function downloadDataExportV5(){
  if(!ownerManagementV5()||managementBusyV5)return;
  try{managementSetBusyV5('settingsV5',true);message('backupMessageV5','Подготавливаем резервную копию…');const data=await crmManagementRpcV5('backup_export');if(!isManager())return;
    const file=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='procedural-cabinet-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);message('backupMessageV5','Резервная копия подготовлена для скачивания.',true);
  }catch(e){message('backupMessageV5',e.message)}finally{managementSetBusyV5('settingsV5',false)}
}

const managementSignOutV5=signOut;
signOut=async function(){
  ++managementLoadV5;managementStaffV5=[];managementTemplatesV5=[];managementAuditV5=[];medicationBatchesExtraV5.clear();
  if($('staffCreatePasswordV5'))$('staffCreatePasswordV5').value='';
  for(const id of ['staffV5','settingsV5','templatesV5','auditV5'])$(id)?.remove();
  $('procTemplateSelectV5')&&($('procTemplateSelectV5').innerHTML='<option value="">Без шаблона</option>');
  await managementSignOutV5();
};
