/* A complete patient card is read separately from the shift and printed without internal records. */
(function (global) {
 'use strict';
 const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
 const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
 const money = value => number(value).toLocaleString('ru-RU',{maximumFractionDigits:2}) + ' ₽';
 const quantity = value => number(value).toLocaleString('ru-RU',{maximumFractionDigits:6});
 const string = value => value == null ? '' : String(value);
 function date(value, time = false) {
  if (!value) return time ? 'Время не указано' : 'Не указана';
  const parsed = new Date(time ? value : String(value) + 'T12:00:00Z');
  if (!Number.isFinite(+parsed)) return time ? 'Время не указано' : escape(value);
  return parsed.toLocaleString('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',...(time ? {hour:'2-digit',minute:'2-digit'} : {})});
 }
 function patientSnapshot(patient) {
  if (!patient?.id || !patient.full_name) throw Error('Сначала откройте карточку пациента');
  return Object.fromEntries(['id','full_name','birth_date','sex','phone','complaints','request','prescriptions','notes','first_visit_at'].map(key => [key,string(patient[key])]));
 }
 function itemSnapshot(item, own = false) {
  const result = {name:string(item.name || item.service_name),dosage:string(item.dosage),dose:typeof item.dose === 'string' ? item.dose : null,quantity:number(item.quantity ?? 1),unit:string(item.unit)};
  if (own) result.source = item.source === 'previously_purchased' ? 'previously_purchased' : 'patient';
  else {
   result.unit_price = item.unit_price == null ? (item.line_total != null && result.quantity ? number(item.line_total) / result.quantity : number(item.work_price) + number(item.consumables_price)) : number(item.unit_price);
   result.line_total = item.line_total == null ? Math.round(result.unit_price * result.quantity * 100) / 100 : number(item.line_total);
  }
  return result;
 }
 function paymentSnapshot(event) {
  const cents = value => {
   if (!['number','string'].includes(typeof value) || String(value).trim() === '') return 0;
   const parsed = Number(value), rounded = Math.round(parsed * 100);
   return Number.isFinite(parsed) && parsed >= 0 && Number.isSafeInteger(rounded) ? rounded : 0;
  };
  const received = cents(event.lifetime_received_total ?? event.received_total ?? event.paid_total ?? event.paid);
  const candidate = cents(event.debt_repayments_total), repayment = candidate <= received ? candidate : 0;
  const ordinary = received - repayment, source = event.payments || {};
  let cash = cents(source.cash), terminal = cents(source.terminal), owner_card = cents(source.owner_card);
  // A missing or inconsistent legacy split must never turn into presumed cash.
  if (cash + terminal + owner_card > ordinary) cash = terminal = owner_card = 0;
  return {cash:cash / 100,terminal:terminal / 100,owner_card:owner_card / 100,unclassified:(ordinary - cash - terminal - owner_card) / 100,debt_repayments_total:repayment / 100};
 }
 function eventSnapshot(event, kind) {
  const received = number(event.received_total ?? event.paid_total ?? event.paid), debt = number(event.debt_total ?? event.debt_amount);
  const charge = number(event.charge_total ?? event.charged_total ?? received + debt), list = number(event.list_total ?? charge + number(event.discount_amount));
  const serviceRows = Array.isArray(event.services) && event.services.length ? event.services : kind === 'procedure' && (event.procedure_type || event.type || event.service_name) ? [{name:event.procedure_type || event.type || event.service_name,quantity:1,line_total:number(event.work_price) + number(event.consumables_price)}] : [];
  return {id:string(event.id),kind,at:string(event.at || event.visit_at || event.sold_at),nurse:string(event.nurse),type:string(event.procedure_type || event.type || event.service_name),
   services:serviceRows.map(item => itemSnapshot(item)),items:(Array.isArray(event.items) ? event.items : Array.isArray(event.medications) ? event.medications : []).map(item => itemSnapshot(item)),
   own_medications:(Array.isArray(event.own_medications) ? event.own_medications : []).map(item => itemSnapshot(item,true)),
   patient_owned:event.own_medications === true || event.own_meds === true,list,charge,received,debt,discount:Math.max(0,Math.round((list - charge) * 100) / 100),surcharge:Math.max(0,Math.round((charge - list) * 100) / 100),
   payments:paymentSnapshot(event),pending:event.payment_pending === true,editable:event.editable === true,discount_reason:string(event.discount_reason),discount_comment:string(event.discount_comment),notes:string(event.notes)};
 }
 function historySnapshot(data) {
  if (!data || !Array.isArray(data.procedures) || !Array.isArray(data.sales)) throw Error('Полная история пока не получена. Повторите загрузку карты.');
  // The existing patient_treatments RPC returns every patient record without a LIMIT.
  return [...data.procedures.map(event => eventSnapshot(event,'procedure')),...data.sales.map(event => eventSnapshot(event,'sale'))].sort((a,b) => {
   const first = Date.parse(a.at), second = Date.parse(b.at);
   return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity) || a.id.localeCompare(b.id);
  });
 }
 function profileHtml(patient) {
  const sex = {female:'Женский',male:'Мужской',unknown:'Не указан'}[patient.sex] || 'Не указан';
  const fields = [['Дата рождения',date(patient.birth_date)],['Пол',sex],['Телефон',patient.phone || 'Не указан'],['Первое посещение · Москва',patient.first_visit_at ? date(patient.first_visit_at,true) : ''],['Жалобы',patient.complaints],['Запрос',patient.request],['Назначения врача',patient.prescriptions],['Заметки',patient.notes]];
  return `<dl class="patient-card-fields-v20">${fields.filter(([,value],index) => index < 3 || value).map(([label,value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
 }
 function itemListHtml(items, label, own = false) {
  if (!items.length) return '';
  return `<h3>${label}</h3><ul>${items.map(item => `<li>${escape(item.name || 'Без названия')}${item.dosage ? ' · ' + escape(item.dosage) : ''} × ${escape(quantity(item.quantity))}${item.unit ? ' ' + escape(item.unit) : ''}${item.dose ? ' · Доза: ' + escape(item.dose) : ''}${own ? ' · ' + (item.source === 'previously_purchased' ? 'Ранее куплен в кабинете' : 'Препарат пациента') : ` · ${escape(money(item.unit_price))} за единицу · ${escape(money(item.line_total))}`}</li>`).join('')}</ul>`;
 }
 function actionsHtml(event) {
  return (event.editable || event.debt > 0 || event.kind === 'procedure') ? `<div class="row patient-card-actions-v20">${event.kind === 'procedure' ? `<button type="button" class="btn secondary" data-card-repeat-v33="${escape(event.id)}" data-kind="procedure">Повторить</button>` : ''}${event.editable ? `<button type="button" class="btn secondary" data-card-edit-v20="${escape(event.id)}" data-kind="${event.kind}">Редактировать</button>` : ''}${event.debt > 0 ? `<button type="button" class="btn primary" data-card-payment-v20="${escape(event.id)}" data-kind="${event.kind}">${event.pending ? 'Принять оплату' : 'Принять оплату долга'}</button>` : ''}</div>` : '';
 }
 function paymentMethodsHtml(payments) {
  const rows = [['cash','Наличные'],['terminal','Терминал'],['owner_card','Перевод на карту начальника'],['unclassified','Способ оплаты не указан']];
  return `<div class="patient-payment-methods-v34">${rows.filter(([key]) => payments[key] > 0).map(([key,label]) => `<div data-payment-method="${key}">${label}: <b>${escape(money(payments[key]))}</b></div>`).join('')}${payments.debt_repayments_total > 0 ? `<div data-payment-method="debt_repayment" title="Погашение долга хранится отдельно и не входит в сумму и наличные смены">Погашено долга отдельно: <b>${escape(money(payments.debt_repayments_total))}</b></div>` : ''}</div>`;
 }
 function eventsHtml(events, interactive = false) {
  return `<ol class="patient-card-events-v20">${events.map((event,index) => `<li class="patient-card-event-v20" data-card-event="${escape(event.id)}"><h2>${index + 1}. ${escape(event.kind === 'sale' ? 'Продажа препарата' : event.type || 'Процедура')}</h2><p>${escape(date(event.at,true))} · Москва${event.nurse ? ' · Медсестра: ' + escape(event.nurse) : ''}</p>${itemListHtml(event.services,'Услуги')}${itemListHtml(event.items,'Препараты кабинета')}${itemListHtml(event.own_medications,'Препараты пациента',true)}${event.patient_owned && !event.own_medications.length ? '<p>Пациент со своими препаратами</p>' : ''}<div class="patient-card-payment-v20"><div>По прайсу: <b>${escape(money(event.list))}</b></div><div>Скидка: <b>${escape(money(event.discount))}</b></div>${event.surcharge > 0 ? `<div>Надбавка: <b>${escape(money(event.surcharge))}</b></div>` : ''}<div>К оплате: <b>${escape(money(event.charge))}</b>${event.charge === 0 ? ' · Бесплатно' : ''}</div><div>Оплачено всего: <b>${escape(money(event.received))}</b></div>${paymentMethodsHtml(event.payments)}<div>${event.pending && event.debt > 0 ? 'Ожидает оплаты' : 'В долг'}: <b>${escape(money(event.debt))}</b></div></div>${event.discount_reason || event.discount_comment ? `<p>Причина изменения стоимости: ${escape([event.discount_reason,event.discount_comment].filter(Boolean).join(' · '))}</p>` : ''}${event.notes ? `<p class="patient-card-note-v20">Комментарий: ${escape(event.notes)}</p>` : ''}${interactive ? actionsHtml(event) : ''}</li>`).join('') || '<li class="patient-card-empty-v20">История процедур и продаж пока пустая.</li>'}</ol>`;
 }
 function totalsHtml(events) {
  const total = key => events.reduce((sum,event) => sum + Math.round(number(event[key]) * 100),0) / 100;
  return `<section class="patient-card-totals-v20"><h2>Итого по карте пациента</h2><div>Процедур: ${events.filter(event => event.kind === 'procedure').length} · продаж: ${events.filter(event => event.kind === 'sale').length}</div><div>Итоговая стоимость: <b>${escape(money(total('charge')))}</b></div><div>Оплачено всего: <b>${escape(money(total('received')))}</b></div><div>В долг: <b>${escape(money(events.filter(event => !event.pending).reduce((sum,event) => sum + Math.round(event.debt * 100),0) / 100))}</b></div><div>Ожидает оплаты: <b>${escape(money(events.filter(event => event.pending).reduce((sum,event) => sum + Math.round(event.debt * 100),0) / 100))}</b></div><p>Оплата и остаток долга показаны на момент загрузки карты.</p></section>`;
 }
 function buildPatientCardHtml(patient, events, interactive = false) {
  return `<header><p>Процедурный кабинет</p><h1>Карта пациента</h1><h2>${escape(patient.full_name)}</h2>${profileHtml(patient)}</header><section aria-label="История процедур и продаж"><h2>История процедур и продаж · ${events.length}</h2>${eventsHtml(events,interactive)}</section>${totalsHtml(events)}`;
 }
 const pure = {patientSnapshot,eventSnapshot,historySnapshot,buildPatientCardHtml,paymentSnapshot};
 if (typeof module === 'object' && module.exports) module.exports = pure;
 if (typeof document === 'undefined') return;
 global.CrmPatientCardV20 = pure;
 let session = 0, version = 0, snapshot = null, operation = null;
 const actor = () => JSON.stringify([currentStaff?.id,currentStaff?.role,session]);
 const navigation = () => typeof quickNavigation4 === 'undefined' ? null : quickNavigation4;
 const allowed = () => !!currentStaff?.id && ['owner','admin','nurse'].includes(currentStaff.role);
 const contextActive = () => $('patientCard')?.classList.contains('active') || $('patientMedicalCardV20')?.classList.contains('active');
 function clearPrint() { document.body.classList.remove('crm-patient-printing-v20'); $('patientCardPrintV20')?.remove(); }
 function current(saved) { return allowed() && saved.actor === actor() && saved.version === version && saved.navigation === navigation() && saved.patient.id === currentPatientId && contextActive(); }
 function status(text, success = false) { message($('patientMedicalCardV20')?.classList.contains('active') ? 'patientMedicalCardMessageV20' : 'patientCardMessageV5',text,success); }
 function buttonsBusy(busy) { for (const id of ['patientCardOpenV20','patientCardPrintButtonV20','patientMedicalCardPrintV20','patientMedicalCardRefreshV20']) if ($(id)) $(id).disabled = busy; }
 async function readCard(id, token) {
  if (!allowed() || id !== currentPatientId || !contextActive()) throw Error('Сначала откройте карточку пациента');
  const saved = {actor:actor(),version:token,navigation:navigation(),patient:patientSnapshot(global.patientCardRecordV20(id))};
  const response = await db.rpc('crm_clinical_v10',{p_action:'patient_treatments',p_payload:{patient_id:id},p_request_id:null});
  if (!current(saved)) return null;
  if (response?.error) throw Error(response.error.message || 'Не удалось загрузить карту пациента');
  saved.events = historySnapshot(response?.data); return saved;
 }
 function showCompleteCard(saved) { $('patientMedicalCardBodyV20').innerHTML = buildPatientCardHtml(saved.patient,saved.events,true); }
 global.openPatientMedicalCardV20 = async function (id = currentPatientId) {
  if (operation || !allowed() || !id) return;
  if (typeof beginQuickNavigation4 === 'function') beginQuickNavigation4();
  clearPrint(); snapshot = null; const token = ++version, op = {actor:actor(),navigation:navigation()}; operation = op;
  $('patientMedicalCardBodyV20').innerHTML = '<div class="notice">Загрузка полной карты пациента…</div>'; show('patientMedicalCardV20'); status(''); buttonsBusy(true);
  try {
   const saved = await readCard(id,token); if (!saved) return;
   snapshot = saved; showCompleteCard(saved);
  } catch (error) { if (token === version && op.actor === actor() && op.navigation === navigation() && contextActive()) status('Не удалось загрузить полную карту: ' + error.message); }
  finally { if (operation === op) { operation = null; if (op.actor === actor()) buttonsBusy(false); } }
 };
 global.printPatientCardV20 = async function () {
  if (operation || !allowed() || !contextActive()) return;
  clearPrint(); snapshot = null; const token = ++version, op = {actor:actor(),navigation:navigation()}; operation = op; buttonsBusy(true); status('Загрузка полной карты для печати…');
  try {
   const saved = await readCard(currentPatientId,token); if (!saved) return;
   if (document.fonts?.ready) await document.fonts.ready;
   if (!current(saved)) return;
   snapshot = saved;
   if ($('patientMedicalCardV20').classList.contains('active')) showCompleteCard(saved);
   const prepare = () => {
    if (!current(saved)) throw Error('Откройте карту пациента заново.');
    clearPrint();const printable = document.createElement('article');printable.id = 'patientCardPrintV20';printable.innerHTML = buildPatientCardHtml(saved.patient,saved.events);
    document.body.appendChild(printable);document.body.classList.add('crm-patient-printing-v20');return printable;
   };
   const printable = prepare();status('Карта готова к печати. В окне печати можно сохранить PDF.',true);
   if (typeof global.crmOpenPrintPreviewV40 === 'function') global.crmOpenPrintPreviewV40({source:printable,title:'Карта пациента ' + saved.patient.full_name,validate:() => current(saved),print:() => {prepare();global.print();},cleanup:clearPrint}).print();
   else global.print();
  } catch (error) { clearPrint(); if (token === version && op.actor === actor() && op.navigation === navigation() && contextActive()) status('Не удалось подготовить полную карту: ' + error.message + ' Повторите печать.'); }
  finally { if (operation === op) { operation = null; if (op.actor === actor()) buttonsBusy(false); } }
 };
 function install() {
  const controls = $('patientCard').querySelector('.patient-controls-v5');
  const printControls = document.createElement('div'); printControls.className = 'row patient-card-toolbar-v20'; printControls.innerHTML = '<button id="patientCardOpenV20" type="button" class="btn secondary">История процедур</button><button id="patientCardPrintButtonV20" type="button" class="btn secondary">Печать карты пациента / PDF</button>';
  controls.after(printControls); $('patientCardOpenV20').onclick = () => global.openPatientMedicalCardV20(); $('patientCardPrintButtonV20').onclick = global.printPatientCardV20;
  const screen = document.createElement('section'); screen.id = 'patientMedicalCardV20'; screen.className = 'screen'; screen.innerHTML = '<div class="row patient-card-toolbar-v20"><button id="patientMedicalCardBackV20" type="button" class="btn secondary">Назад к пациенту</button><button id="patientMedicalCardRefreshV20" type="button" class="btn secondary">Обновить карту</button><button id="patientMedicalCardPrintV20" type="button" class="btn primary">Печать / PDF</button></div><div id="patientMedicalCardMessageV20" role="status"></div><article id="patientMedicalCardBodyV20" class="card"></article>';
  $('patientCard').after(screen); $('patientMedicalCardBackV20').onclick = () => openPatient(currentPatientId); $('patientMedicalCardRefreshV20').onclick = () => global.openPatientMedicalCardV20(); $('patientMedicalCardPrintV20').onclick = global.printPatientCardV20;
  screen.addEventListener('click',event => {
   const button = event.target.closest('[data-card-edit-v20],[data-card-payment-v20],[data-card-repeat-v33]'); if (!button || !snapshot || !current(snapshot)) return;
   const kind = button.dataset.kind, id = button.dataset.cardEditV20 || button.dataset.cardPaymentV20 || button.dataset.cardRepeatV33, record = snapshot.events.find(item => item.id === id && item.kind === kind);
   if (!record) return;
   if (button.dataset.cardRepeatV33 && kind === 'procedure') global.repeatPatientProcedureV33(snapshot.patient.id,id);
   else if (button.dataset.cardEditV20 && record.editable) global.editTreatmentV10(kind,id);
   else if (button.dataset.cardPaymentV20 && record.debt > 0) global.openSavedPaymentV14(kind,id,record.debt,snapshot.patient.id,record.pending);
  });
  const originalOpen = openPatient;
  openPatient = async function (...args) { ++version; snapshot = null; operation = null; clearPrint(); buttonsBusy(false); await originalOpen(...args); };
  const originalSignOut = signOut;
  signOut = async function (...args) { ++session; ++version; snapshot = null; operation = null; clearPrint(); buttonsBusy(false); $('patientMedicalCardBodyV20').textContent = ''; $('patientMedicalCardMessageV20').textContent = ''; return originalSignOut(...args); };
  if (typeof global.addEventListener === 'function') {
   global.addEventListener('afterprint',clearPrint);
   global.addEventListener('beforeprint',() => { if (document.body.classList.contains('crm-patient-printing-v20') && (!snapshot || !current(snapshot))) clearPrint(); });
  }
 }
 install();
})(typeof window !== 'undefined' ? window : globalThis);
