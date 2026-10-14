/* Agreed charges, receipts and patient-owned medicines are separate values. */
(function (global) {
 'use strict';
 function cents(value, label = 'Сумма') {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error(`${label}: укажите сумму от нуля с точностью до копеек`);
  const [whole, fraction = ''] = raw.split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw Error(`${label}: слишком большая сумма`);
  return result;
 }
 function paymentModel(input) {
  const list = cents(input.list, 'Стоимость по прайсу'), charge = cents(input.charge, 'Стоимость для пациента');
  const previous = cents(input.previous ?? 0, 'Ранее оплачено'), received = cents(input.received, 'Оплата сейчас');
  const reason = String(input.reason || '').trim(), status = input.status || 'paid';
  if (!['paid','pending','debt','free'].includes(status)) throw Error('Выберите вариант оплаты');
  if (charge !== list && !reason) throw Error('Укажите комментарий, почему стоимость отличается от прайса');
  if (charge === 0 && status !== 'free') throw Error('Для нулевой стоимости выберите «Бесплатно» и укажите комментарий');
  if (status === 'free' && (charge !== 0 || received !== 0 || previous !== 0 || !reason)) throw Error('Для бесплатной процедуры укажите нулевую стоимость и обязательный комментарий');
  if (previous + received > charge) throw Error('Стоимость не может быть меньше уже полученной оплаты. Для возврата обратитесь к владельцу');
  const debt = charge - previous - received;
  if (status === 'paid' && debt !== 0) throw Error('Для полной оплаты получите всю стоимость или выберите «Оплатит после процедуры» / «В долг»');
  if ((status === 'debt' || status === 'pending') && input.kind !== 'sale' && !input.patient) throw Error('Для записи без полной оплаты выберите пациента');
  return {list,charge,previous,received,debt,status:debt > 0 ? (status === 'pending' ? 'pending' : 'debt') : charge === 0 ? 'free' : 'paid',reason};
 }
 function ownedItems(items) {
  return items.map(item => {
   const name = String(item.name || '').trim(), unit = String(item.unit || 'амп.').trim(), quantity = Number(item.quantity);
   if (!name || name.length > 200) throw Error('Укажите название своего препарата длиной до 200 символов');
   if (!Number.isSafeInteger(quantity) || quantity < 1) throw Error('Количество своего препарата должно быть целым и больше нуля');
   if (!['patient','previously_purchased'].includes(item.source)) throw Error('Укажите, откуда препарат пациента');
   if (!unit || unit.length > 30) throw Error('Укажите единицу своего препарата');
   return {name,quantity,unit,source:item.source,...(Object.hasOwn(item,'dose') ? {dose:doseValue(item.dose)} : {})};
  });
 }
 function doseValue(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length > 200) throw Error('Доза для пациента: укажите текст длиной до 200 символов');
  return value.trim() || null;
 }
 function protocolItems(items) {
  if (!Array.isArray(items)) throw Error('Неверный состав шаблона');
  const combined = new Map();
  for (const item of items) {
   if (!item || typeof item.medication_id !== 'string' || !item.medication_id) throw Error('Выберите препарат шаблона');
   const quantity = Number(item.quantity), dose = doseValue(item.dose);
   if (!Number.isSafeInteger(quantity) || quantity < 1) throw Error('Количество препарата должно быть целым и больше нуля');
   const previous = combined.get(item.medication_id);
   if (previous && previous.dose !== dose) throw Error('У одного препарата указаны разные дозы. Скорректируйте дозу в процедуре или замените состав шаблоном');
   const total = quantity + (previous?.quantity || 0);
   if (!Number.isSafeInteger(total)) throw Error('Слишком большое количество препарата');
   combined.set(item.medication_id,{...item,medication_id:item.medication_id,quantity:total,dose});
  }
  return [...combined.values()];
 }
 function mergeServices(items) {
  const quantities = new Map();
  for (const item of items) {
   if (!item.service_id) continue;
   const quantity = Number(item.quantity), total = (quantities.get(item.service_id) || 0) + quantity;
   if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(total)) throw Error('Количество процедур должно быть целым и больше нуля');
   quantities.set(item.service_id,total);
  }
  return [...quantities].map(([service_id,quantity]) => ({service_id,quantity}));
 }
 function pendingUnpaidRecord(record) {
  if (record?.payment_pending !== true || record.paid_total == null) return false;
  return ['paid_total','received_total','initial_paid_total'].every(key => {
   try { return cents(record[key] ?? 0) === 0; } catch { return false; }
  });
 }
 function editWithoutReason(record, model) {
  return pendingUnpaidRecord(record) && model?.status === 'pending' && model.previous === 0 && model.received === 0;
 }
 function automaticUnpaidCharge(record) {
  if (!pendingUnpaidRecord(record)) return false;
  try { return cents(record.charge_total) === cents(record.list_total); } catch { return false; }
 }
 function paymentCorrectionAllowed(record, manager) {
  if (!manager || !record?.id || record.editable !== true) return false;
  try { return cents(record.paid_total ?? 0) > 0; } catch { return false; }
 }
 const correctionReasonV22 = 'Оплата отмечена ошибочно: деньги не получены';
 const helpers = {cents,paymentModel,ownedItems,doseValue,protocolItems,mergeServices,pendingUnpaidRecord,editWithoutReason,automaticUnpaidCharge,paymentCorrectionAllowed};
 if (typeof module === 'object' && module.exports) module.exports = helpers;
 if (typeof document === 'undefined') return;
 global.CrmClinicalV10 = helpers;
 const forms = {proc:null,sale:null}, requests = new Map(), ambiguousRequests16 = new Set(), pendingPayments16 = new Map();
 let session = 0, patientView = 0, editorView = 0, debtBusy = false;
 const amount = value => (value / 100).toFixed(2);
 const state = prefix => forms[prefix];
 function actorKey() { return JSON.stringify([currentStaff?.id,currentStaff?.role,session]); }
 function assertActor(actor) { if (!currentStaff?.id || actorKey() !== actor) throw Error('Учётная запись изменилась. Откройте форму заново'); }
 function saveError(error, status, write = true) {
  const result = financeSaveErrorV16(error,status,'Не удалось выполнить действие');
  if (write && result.uncertain) result.message = 'Не удалось получить ответ. Черновик сохранён; повторите сохранение. Будут отправлены первоначальные данные, без повторного начисления.';
  return result;
 }
 async function clinicalRpc(action, payload = {}, mutate = false) {
  const actor = actorKey(), key = JSON.stringify([actor,action,payload]);
  if (mutate && !requests.has(key)) requests.set(key, crypto.randomUUID());
  let response;
  try { response = action === 'payment_correction'
   ? await db.rpc('crm_payment_correction_v22', {p_payload:payload,p_request_id:mutate ? requests.get(key) : null})
   : await db.rpc('crm_clinical_v10', {p_action:action,p_payload:payload,p_request_id:mutate ? requests.get(key) : null}); }
  catch (error) { assertActor(actor); const failure = saveError(error,undefined,mutate); if (mutate && (failure.uncertain || ambiguousRequests16.has(key))) { failure.uncertain = true; ambiguousRequests16.add(key); } throw failure; }
  assertActor(actor);
  if (response?.error) {
   const error = saveError(response.error,response.status,mutate);
   if (mutate && (error.uncertain || ambiguousRequests16.has(key))) { error.uncertain = true; ambiguousRequests16.add(key); }
   if (mutate && !error.uncertain && /^[0-9A-Z]{5}$/.test(response.error.code || '')) requests.delete(key);
   throw error;
  }
  if (!response || (mutate && response.data == null) || (action === 'payment_correction' && !response.data?.id)) { if (mutate) ambiguousRequests16.add(key); throw saveError({uncertain:true,message:'Не удалось получить ответ. Повторите действие'},undefined,mutate); }
  if (mutate) { requests.delete(key); ambiguousRequests16.delete(key); }
  return response.data;
 }
 function lockRetryForm(prefix) {
  const kind = prefix === 'proc' ? 'procedure' : 'sale', retry = !!state(prefix)?.retry;
  document.querySelectorAll('#' + kind + ' button,#' + kind + ' input,#' + kind + ' select,#' + kind + ' textarea').forEach(element => {
   const mainSave = element.getAttribute?.('onclick') === (prefix === 'proc' ? 'saveProcedure()' : 'saveSale()');
   element.disabled = retry && !mainSave;
   if (mainSave && retry) element.textContent = 'Повторить сохранение';
   else if (mainSave && element.textContent === 'Повторить сохранение') element.textContent = prefix === 'proc' ? 'Сохранить процедуру' : 'Сохранить продажу';
  });
  if (state(prefix)?.edit) { $(prefix + 'Patient').disabled = true; $(prefix + 'Nurse').disabled = true; }
  correctionControls(prefix);
 }
 function correctionSelected(prefix) { return state(prefix)?.correctionV22 === true; }
 function correctionControls(prefix) {
  const s = state(prefix), box = $(prefix + 'PaymentCorrectionBoxV22'); if (!box) return;
  const allowed = paymentCorrectionAllowed(s?.edit,isManager()), selected = correctionSelected(prefix);
  box.classList.toggle('hidden',!allowed);
  $(prefix + 'PaymentCorrectionV22').checked = selected;
  $(prefix + 'PaymentCorrectionAmountV22').textContent = allowed ? 'Ранее отмечено как полученное: ' + rub(cents(s.edit.paid_total) / 100) + '. Исправление уберёт эту сумму из выручки и сохранит стоимость процедуры в долг. Исходная запись об оплате останется в истории исправлений.' : '';
  if (!s) return;
  $(prefix + 'PaymentStatusV10').disabled = selected || !!s.retry;
  $(prefix + 'ReceivedV10').disabled = selected || !!s.retry;
  $(prefix + 'PaymentV5').classList.toggle('payment-correction-active-v22',selected);
  $(prefix + 'PaymentV5').querySelectorAll('[data-pay-method]').forEach(button => button.disabled = selected || !!s.retry);
  for (const suffix of ['Cash','Terminal','OwnerCard','Tender']) $(prefix + 'Pay' + suffix).disabled = selected || !!s.retry;
 }
 function correctionChanged(prefix) {
  const s = state(prefix), checkbox = $(prefix + 'PaymentCorrectionV22');
  if (!s || clinicalBusy || s.retry) { if (checkbox) checkbox.checked = correctionSelected(prefix); return; }
  if (!paymentCorrectionAllowed(s.edit,isManager())) { checkbox.checked = false; return; }
  const selected = checkbox.checked, pay = financePaymentState5[prefix];
  if (selected && !s.correctionV22) {
   s.paymentBeforeCorrectionV22 = {status:$(prefix + 'PaymentStatusV10').value,received:$(prefix + 'ReceivedV10').value,method:pay.method,tenderEdited:pay.tenderEdited,values:Object.fromEntries(['Cash','Terminal','OwnerCard','Tender'].map(suffix => [suffix,$(prefix + 'Pay' + suffix).value]))};
   s.correctionV22 = true; s.correctionActorV22 = actorKey(); s.previous = 0;
   $(prefix + 'PaymentStatusV10').value = 'debt'; $(prefix + 'ReceivedV10').value = '0.00'; pay.tenderEdited = false;
   syncPaymentV5(prefix,true); $(prefix + 'PayConfirmed').checked = true;
  } else if (!selected && s.correctionV22) {
   const previous = s.paymentBeforeCorrectionV22;
   s.correctionV22 = false; delete s.correctionActorV22; s.previous = cents(s.edit.paid_total ?? 0);
   $(prefix + 'PaymentStatusV10').value = previous?.status || 'paid'; $(prefix + 'ReceivedV10').value = previous?.received || '0.00';
   if (previous) { pay.method = previous.method; pay.tenderEdited = previous.tenderEdited; }
   syncPaymentV5(prefix,true);
   if (previous) for (const [suffix,value] of Object.entries(previous.values)) $(prefix + 'Pay' + suffix).value = value;
   clearConfirmation(prefix); syncPaymentV5(prefix);
  }
  correctionControls(prefix);
 }
 function servicePrice(prefix, id) {
  const snapshot = state(prefix)?.servicePrices?.get(id), service = services.find(s => s.id === id);
  return snapshot ?? Math.round((num(service?.work_price) + num(service?.consumables_price)) * 100);
 }
 function selectedServices() {
  const primary = $('procService')?.value;
  return mergeServices((primary ? [{service_id:primary,quantity:1}] : []).concat([...$('procAdditionalServicesV10').querySelectorAll('.clinical-service-v10')].map(row => ({service_id:row.querySelector('select').value,quantity:Number(row.querySelector('input').value)}))));
 }
 function listCents(prefix) {
  const medicines = rows(prefix + 'Meds').reduce((sum,item) => {
   const price = state(prefix)?.medicationPrices?.get(item.medication_id) ?? Math.round(num(meds.find(m => m.id === item.medication_id)?.sale_price) * 100);
   return sum + price * Number(item.quantity);
  },0);
  return medicines + (prefix === 'proc' ? selectedServices().reduce((sum,item) => sum + servicePrice(prefix,item.service_id) * item.quantity,0) : 0);
 }
 function clearConfirmation(prefix) { if ($(prefix + 'PayConfirmed')) $(prefix + 'PayConfirmed').checked = false; }
 function installVisitTime(prefix) {
  if ($(prefix + 'VisitDateV23')) return;
  const host = document.createElement('div'); host.className = 'clinical-visit-time-v23';
  host.innerHTML = `<h2>Время посещения</h2><p class="small">Дата и время прихода пациента · Москва (UTC+3)</p><div class="grid2"><div><label for="${prefix}VisitDateV23">Дата посещения *</label><input id="${prefix}VisitDateV23" type="date" required></div><div><label for="${prefix}VisitTimeV23">Точное время посещения *</label><input id="${prefix}VisitTimeV23" type="time" step="60" required></div></div>`;
  $(prefix + 'Patient').closest('.grid2').after(host);
  for (const suffix of ['Date','Time']) {
   const input = $(prefix + 'Visit' + suffix + 'V23');
   for (const event of ['input','change']) input.addEventListener(event,() => {
    const s = state(prefix); if (!s) return;
    if (s.visitTimeV23) s.visitTimeV23.manual = true;
    clearConfirmation(prefix);
   });
  }
  $(prefix + 'Patient').addEventListener('change',() => {
   const s = state(prefix); if (!s || s.edit || s.retry || s.visitTimeV23?.manual) return;
   resetVisitTime(prefix,null,$(prefix + 'Patient').value);
  });
 }
 function resetVisitTime(prefix,record,patientId) {
  const s = state(prefix); if (!s) return;
  const original = record?.arrival_at || record?.display_visit_at || record?.at || record?.visit_at || record?.sold_at || null;
  const seed = !record && typeof global.patientVisitSeedV23 === 'function' ? global.patientVisitSeedV23(patientId) : null;
  const value = original || seed, defaults = value ? global.CrmVisitTimeV23.parts(value) : global.CrmVisitTimeV23.nowParts();
  $(prefix + 'VisitDateV23').value = defaults.date; $(prefix + 'VisitTimeV23').value = defaults.time;
  s.visitTimeV23 = {original,date:defaults.date,time:defaults.time,manual:false};
 }
 function visitPayload(prefix) {
  const s = state(prefix), initial = s?.visitTimeV23;
  // Older non-UI integrations do not install visit controls; their server default remains valid.
  if (!initial) return {};
  const date = $(prefix + 'VisitDateV23').value, time = $(prefix + 'VisitTimeV23').value;
  if (s.edit && date === initial.date && time === initial.time) return {};
  return {arrival_at:global.CrmVisitTimeV23.toIso(date,time)};
 }
 function chargeChanged(prefix) {
  if (!state(prefix)) return;
  state(prefix).chargeEdited = true; clearConfirmation(prefix); calculate(prefix,false);
 }
 function paymentStatusChanged(prefix) {
  const s = state(prefix); if (!s) return;
  if (correctionSelected(prefix)) { $(prefix + 'PaymentStatusV10').value = 'debt'; syncPaymentV5(prefix,true); return; }
  const status = $(prefix + 'PaymentStatusV10').value;
  if (status === 'free') { $(prefix + 'Paid').value = '0.00'; s.chargeEdited = true; $(prefix + 'ReceivedV10').value = '0.00'; }
  else if ($(prefix + 'Paid').value === '0.00' && !s.edit) { s.chargeEdited = false; $(prefix + 'Paid').value = amount(listCents(prefix)); }
  if (status === 'debt' || status === 'pending') $(prefix + 'ReceivedV10').value = '0.00';
  clearConfirmation(prefix); discountVisibility(prefix); syncPaymentV5(prefix,true);
 }
 function install(prefix) {
  installPaymentControlsV5(prefix);
  installVisitTime(prefix);
  if ($(prefix + 'ClinicalV10')) return;
  if (prefix === 'sale') {
   const patientHint = document.createElement('p'); patientHint.id = 'salePatientHintV27'; patientHint.className = 'small';
   patientHint.textContent = 'Пациент необязателен, в том числе при продаже в долг. Продажа без пациента сохранится в журнале смены и списке долгов.';
   $('salePatient').after(patientHint);
  }
  const paid = $(prefix + 'Paid'), host = document.createElement('div');
  host.id = prefix + 'ClinicalV10'; host.className = 'clinical-payment-v10';
  host.innerHTML = `<label for="${prefix}PaymentStatusV10">Вариант оплаты</label><select id="${prefix}PaymentStatusV10"><option value="paid">Полностью оплачено</option><option value="debt">В долг / частично оплачено</option><option value="free">Бесплатно</option></select><div id="${prefix}ReceivedBoxV10" class="hidden"><label for="${prefix}ReceivedV10">Оплачено сейчас, ₽</label><input id="${prefix}ReceivedV10" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"></div><div id="${prefix}DebtSummaryV10" class="small" role="status" aria-live="polite"></div><div id="${prefix}EditReasonBoxV10" class="hidden"><label for="${prefix}EditReasonV10">Что изменили и почему *</label><textarea id="${prefix}EditReasonV10"></textarea></div>`;
  const correction = document.createElement('div'); correction.id = prefix + 'PaymentCorrectionBoxV22'; correction.className = 'clinical-payment-correction-v22 hidden';
  correction.innerHTML = `<label class="payment-confirm-v5"><input id="${prefix}PaymentCorrectionV22" type="checkbox"><span><strong>Исправить ошибочную оплату</strong><br>Подтверждаю: деньги по этой записи не получены.</span></label><p id="${prefix}PaymentCorrectionAmountV22" class="small"></p>`;
  host.prepend(correction);
  paid.after(host); paid.previousElementSibling.textContent = 'Индивидуальная стоимость, ₽'; paid.removeAttribute('oninput');
  $(prefix + 'PaymentCorrectionV22').addEventListener('change',() => correctionChanged(prefix));
  $(prefix + 'PaymentStatusV10').add(new Option(prefix === 'sale' ? 'Оплатит позже' : 'Оплатит после процедуры','pending'),1);
  const debtHint = document.createElement('p'); debtHint.id = prefix + 'DebtHintV13'; debtHint.className = 'notice hidden';
  debtHint.textContent = 'Индивидуальную стоимость можно сохранить и без оплаты. Укажите сумму для пациента и причину изменения. Если деньги не получены, оставьте «Оплачено сейчас» равным 0: вся стоимость сохранится в долг.';
  $(prefix + 'PaymentStatusV10').after(debtHint);
  paid.addEventListener('input',() => chargeChanged(prefix));
  $(prefix + 'PaymentStatusV10').addEventListener('change',() => paymentStatusChanged(prefix));
  $(prefix + 'ReceivedV10').addEventListener('input',() => { clearConfirmation(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountComment').addEventListener('input',() => { clearConfirmation(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountReason').removeAttribute('onchange');
  $(prefix + 'DiscountReason').previousElementSibling.textContent = 'Причина изменения стоимости *';
  $(prefix + 'DiscountReason').addEventListener('change',() => { clearConfirmation(prefix); discountVisibility(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountComment').previousElementSibling.textContent = 'Почему стоимость отличается от прайса / бесплатно *';
  const inline = document.createElement('div'); inline.className = 'clinical-discount-inline-v11';
  inline.innerHTML = `<label for="${prefix}ChargeInPaymentV11">Индивидуальная стоимость (включая долг), ₽</label><input id="${prefix}ChargeInPaymentV11" type="number" inputmode="decimal" min="0" step="0.01"><div id="${prefix}DiscountInPaymentBoxV11" class="hidden"><label for="${prefix}DiscountInPaymentV11">Причина изменения стоимости / бесплатно *</label><textarea id="${prefix}DiscountInPaymentV11" placeholder="Например: индивидуальная цена согласована"></textarea></div>`;
  $(prefix + 'PaymentV5').querySelector('h2').after(inline);
  const shortCash = document.createElement('div'); shortCash.id = prefix + 'ShortCashBoxV11'; shortCash.className = 'clinical-short-cash-v11 hidden';
  shortCash.innerHTML = `<p id="${prefix}ShortCashHintV11" class="small"></p><button id="${prefix}ApplyDiscountV11" type="button" class="btn secondary wide">Учесть разницу как скидку</button><div id="${prefix}ApplyDiscountMessageV11" role="alert"></div>`;
  $(prefix + 'PayTenderBox').after(shortCash);
  $(prefix + 'PayTender').previousElementSibling.textContent = 'Получено наличными (для расчёта сдачи), ₽';
  $(prefix + 'ChargeInPaymentV11').addEventListener('input',() => { $(prefix + 'Paid').value = $(prefix + 'ChargeInPaymentV11').value; chargeChanged(prefix); });
  $(prefix + 'DiscountInPaymentV11').addEventListener('input',() => { $(prefix + 'DiscountComment').value = $(prefix + 'DiscountInPaymentV11').value; clearConfirmation(prefix); syncPaymentV5(prefix); });
  $(prefix + 'ApplyDiscountV11').onclick = () => applyCashDiscount(prefix);
  const savePending = document.createElement('button'); savePending.id = prefix + 'SavePendingV14'; savePending.type = 'button'; savePending.className = 'btn secondary wide';
  savePending.textContent = 'Сохранить без оплаты'; savePending.setAttribute('onclick',prefix === 'proc' ? 'saveProcedureWithoutPaymentV14()' : 'saveSaleWithoutPaymentV14()');
  document.querySelector('#' + (prefix === 'proc' ? 'procedure' : 'sale') + ' button[onclick="' + (prefix === 'proc' ? 'saveProcedure()' : 'saveSale()') + '"]').after(savePending);
  if (prefix === 'proc') {
   const extra = document.createElement('div'); extra.className = 'clinical-extra-v10';
   extra.innerHTML = '<h2>Дополнительные процедуры</h2><div id="procAdditionalServicesV10"></div><button type="button" id="procAddServiceV10" class="btn secondary wide">＋ Добавить укол или другую процедуру</button><h2>Препараты пациента</h2><p class="small">Укажите свои препараты или ранее купленные у нас. Здесь они не добавляются к стоимости.</p><div id="procOwnMedsV10"></div><button type="button" id="procAddOwnV10" class="btn secondary wide">＋ Свой / ранее купленный препарат</button>';
   $('procMeds').after(extra);
   $('procAddServiceV10').onclick = () => addService(); $('procAddOwnV10').onclick = () => addOwn();
   const notice = $('procMeds').parentElement.querySelector('.notice');
   if (notice) notice.textContent = 'Стоимость по прайсу рассчитана автоматически. Можно уменьшить или увеличить сумму для пациента. При изменении стоимости укажите комментарий.';
  }
 }
 function addService(item = {}) {
  const row = document.createElement('div'); row.className = 'clinical-service-v10';
  const options = services.map(service => `<option value="${esc(service.id)}">${esc(service.name)}</option>`).join('');
  row.innerHTML = `<label>Дополнительная процедура<select aria-label="Дополнительная процедура"><option value="">Выберите услугу</option>${options}</select></label><label>Количество<input aria-label="Количество процедур" type="number" min="1" step="1" inputmode="numeric" value="${Number(item.quantity || 1)}"></label><button type="button" class="btn danger" aria-label="Убрать дополнительную процедуру">×</button>`;
  if (item.service_id && !services.some(service => service.id === item.service_id)) row.querySelector('select').add(new Option(item.name || 'Ранее выбранная услуга',item.service_id));
  row.querySelector('select').value = item.service_id || '';
  row.addEventListener('change',() => { clearConfirmation('proc'); calculate('proc'); });
  row.querySelector('input').addEventListener('input',() => { clearConfirmation('proc'); calculate('proc'); });
  row.querySelector('button').onclick = () => { row.remove(); clearConfirmation('proc'); calculate('proc'); };
  $('procAdditionalServicesV10').appendChild(row); clearConfirmation('proc'); calculate('proc');
 }
 function addOwn(item = {}) {
  const row = document.createElement('div'); row.className = 'clinical-own-v10';
  row.innerHTML = `<label>Название препарата<input class="own-name-v10" aria-label="Название своего препарата" maxlength="200" placeholder="Название препарата" value="${esc(item.name || '')}"></label><label>Откуда препарат<select class="own-source-v10" aria-label="Откуда препарат"><option value="patient">Принёс пациент</option><option value="previously_purchased">Ранее куплен у нас</option></select></label><div class="grid2"><label>Количество<input class="own-quantity-v10" aria-label="Количество своего препарата" type="number" min="1" step="1" inputmode="numeric" value="${Number(item.quantity || 1)}"></label><label>Единица<input class="own-unit-v10" aria-label="Единица своего препарата" maxlength="30" value="${esc(item.unit || 'амп.')}"></label></div><label>Доза для пациента<input class="own-dose-v24" aria-label="Доза своего препарата для пациента" maxlength="200" placeholder="По назначению, например 500 мг" value="${esc(item.dose || '')}"></label><button type="button" class="btn danger" aria-label="Убрать свой препарат">Убрать</button>`;
  row.querySelector('select').value = item.source || 'patient';
  row.addEventListener('input',() => clearConfirmation('proc')); row.addEventListener('change',() => clearConfirmation('proc'));
  row.querySelector('button').onclick = () => { row.remove(); clearConfirmation('proc'); };
  $('procOwnMedsV10').appendChild(row); clearConfirmation('proc');
 }
 function readOwn() { return ownedItems([...$('procOwnMedsV10').querySelectorAll('.clinical-own-v10')].map(row => ({name:row.querySelector('.own-name-v10').value,quantity:row.querySelector('.own-quantity-v10').value,unit:row.querySelector('.own-unit-v10').value,source:row.querySelector('.own-source-v10').value,dose:row.querySelector('.own-dose-v24').value}))); }
 function calculate(prefix, update = true) {
  const s = state(prefix); if (!s) return;
  let total;
  try { total = listCents(prefix); }
  catch (error) { message(prefix === 'proc' ? 'procedureMessage' : 'saleMessage',error.message); return; }
  $(prefix + 'List').textContent = rub(total / 100);
  if ((!s.chargeEdited && update) || $(prefix + 'Paid').value === '') $(prefix + 'Paid').value = amount(total);
  if (prefix === 'proc') $('servicePriceInfo').textContent = 'Работа и расходники выбранных процедур: ' + rub(selectedServices().reduce((sum,item) => sum + servicePrice(prefix,item.service_id) * item.quantity,0) / 100);
  discountVisibility(prefix); syncPaymentV5(prefix);
 }
 helpers.templateState = function() {
  const s = state('proc');
  return {ready:!!s,locked:!s || !!s.retry || clinicalBusy || !!s.correctionSavingV22,editing:!!s?.edit,hasSelection:!!$('procMeds')?.querySelector('.medrow') || !!$('procAdditionalServicesV10')?.querySelector('.clinical-service-v10')};
 };
 helpers.applyTemplate = function(template, mode = 'replace') {
  const s = state('proc');
  if (!s || !currentStaff?.id || currentStaff.active === false) throw Error('Сначала откройте процедуру пациента');
  if (s.retry || clinicalBusy || s.correctionSavingV22) throw Error('Дождитесь подтверждения сохранения процедуры перед применением шаблона');
  if (!['replace','append'].includes(mode)) throw Error('Выберите, как применить шаблон');
  if (!template || template.active === false) throw Error('Шаблон недоступен');
  const additions = protocolItems(template.items || []);
  additions.forEach(item => {
   const medication = meds.find(med => med.id === item.medication_id);
   if (!medication || medication.active === false) throw Error('В шаблоне есть недоступный препарат. Обновите шаблон перед применением');
   if (num(medication.sale_price) <= 0) throw Error('У препарата шаблона не указана цена продажи. Добавьте цену перед применением шаблона');
  });
  const templateServices = mergeServices(template.services || (template.service_id ? [{service_id:template.service_id,quantity:1}] : []));
  templateServices.forEach(item => {
   const service = services.find(service => service.id === item.service_id);
   if (!service || service.active === false) throw Error('Услуга шаблона недоступна. Обновите шаблон перед применением');
  });
  const medications = protocolItems((mode === 'append' ? rows('procMeds') : []).concat(additions));
  const existingServices = selectedServices();
  const allServices = mode === 'append'
   ? existingServices.concat(templateServices.filter(item => !existingServices.some(previous => previous.service_id === item.service_id)))
   : templateServices.length ? templateServices : existingServices;
  // The patient draft is independent of the shared protocol. Keep the form's
  // captured prices, manual charge, receipts, visit time and patient medicines.
  $('procMeds').innerHTML = ''; $('procAdditionalServicesV10').innerHTML = '';
  $('procService').value = allServices[0]?.service_id || '';
  if (allServices[0]?.quantity > 1) addService({...allServices[0],quantity:allServices[0].quantity - 1});
  allServices.slice(1).forEach(item => addService(item));
  medications.forEach(item => {
   const original = s.edit?.items?.find(previous => previous.medication_id === item.medication_id);
   addMedRow('procMeds',item.medication_id,item.quantity,{id:item.medication_id,name:item.name || original?.name,consumption_unit:item.unit || original?.unit,dose:item.dose});
  });
  clearConfirmation('proc'); calculate('proc'); recalc();
  return {items:rows('procMeds'),services:selectedServices()};
 };
 function receivedCents(prefix) {
  const s = state(prefix), status = $(prefix + 'PaymentStatusV10').value, charge = cents($(prefix + 'Paid').value || '0');
  if (correctionSelected(prefix)) return 0;
  return status === 'free' ? 0 : status === 'debt' || status === 'pending' ? cents($(prefix + 'ReceivedV10').value,'Оплата сейчас') : Math.max(0,charge - (s?.previous || 0));
 }
 function currentModel(prefix) {
  const s = state(prefix); if (!s) throw Error('Откройте форму заново');
  if (correctionSelected(prefix)) {
   if (!paymentCorrectionAllowed(s.edit,isManager()) || s.correctionActorV22 !== actorKey() || !$(prefix + 'PaymentCorrectionV22').checked) throw Error('Исправить ошибочную оплату может только администратор после подтверждения, что деньги не получены');
   if (cents($(prefix + 'Paid').value || '0') === 0) throw Error('Для сохранения в долг укажите стоимость больше нуля');
  }
  return paymentModel({kind:prefix === 'sale' ? 'sale' : 'procedure',list:amount(listCents(prefix)),charge:$(prefix + 'Paid').value,previous:amount(s.previous || 0),received:amount(receivedCents(prefix)),status:$(prefix + 'PaymentStatusV10').value,reason:$(prefix + 'DiscountComment').value,patient:$(prefix + 'Patient').value});
 }
 function shortCashDiscount(prefix) {
  if (!state(prefix) || $(prefix + 'PaymentStatusV10').value !== 'paid') return null;
  try {
   const charge = cents($(prefix + 'Paid').value), cash = cents($(prefix + 'PayCash').value), terminal = cents($(prefix + 'PayTerminal').value), card = cents($(prefix + 'PayOwnerCard').value), tender = cents($(prefix + 'PayTender').value);
   if (tender >= cash || cash + terminal + card !== receivedCents(prefix)) return null;
   return {charge:charge - cash + tender,cash:tender,discount:cash - tender};
  } catch { return null; }
 }
 function inlinePayment(prefix) {
  if (!$(prefix + 'ChargeInPaymentV11')) return;
  const charge = $(prefix + 'ChargeInPaymentV11'), reason = $(prefix + 'DiscountInPaymentV11'), correction = shortCashDiscount(prefix);
  if (document.activeElement !== charge) charge.value = $(prefix + 'Paid').value;
  if (document.activeElement !== reason) reason.value = $(prefix + 'DiscountComment').value;
  $(prefix + 'DiscountInPaymentBoxV11').classList.toggle('hidden',$(prefix + 'DiscountBox').classList.contains('hidden') && !correction);
  $(prefix + 'ShortCashBoxV11').classList.toggle('hidden',!correction);
  $(prefix + 'ApplyDiscountMessageV11').textContent = '';
  if (correction) $(prefix + 'ShortCashHintV11').textContent = `Наличными введено на ${rub(correction.discount / 100)} меньше. Если это скидка, укажите причину и примените её. К оплате станет ${rub(correction.charge / 100)}. Если это долг, выберите «В долг / частично оплачено».`;
 }
 function applyCashDiscount(prefix) {
  const correction = shortCashDiscount(prefix); if (!correction) return;
  const reason = $(prefix + 'DiscountComment').value.trim();
  if (!reason || correction.charge === 0) {
   $(prefix + 'ApplyDiscountMessageV11').textContent = !reason ? 'Укажите причину скидки в поле выше' : 'Для нулевой стоимости выберите «Бесплатно» и укажите причину';
   (!reason ? $(prefix + 'DiscountInPaymentV11') : $(prefix + 'PaymentStatusV10')).focus();
   clearConfirmation(prefix); return;
  }
  $(prefix + 'Paid').value = amount(correction.charge); $(prefix + 'PayCash').value = amount(correction.cash);
  state(prefix).chargeEdited = true; clearConfirmation(prefix); calculate(prefix,false);
  message(prefix === 'proc' ? 'procedureMessage' : 'saleMessage','Скидка учтена. Подтвердите сумму оплаты и сохраните запись.',true);
 }
 discountVisibility = function(prefix) {
  if (!state(prefix) || !$(prefix + 'ClinicalV10')) return;
  let modified = true; try { modified = cents($(prefix + 'Paid').value) !== listCents(prefix) || $(prefix + 'PaymentStatusV10').value === 'free'; } catch {}
  $(prefix + 'DiscountBox').classList.toggle('hidden',!modified); $(prefix + 'OtherBox').classList.remove('hidden');
  $(prefix + 'Paid').readOnly = false;
 };
 const oldPaymentEdited = paymentEditedV5;
 paymentEditedV5 = function(prefix, tender = false) { oldPaymentEdited(prefix,tender); inlinePayment(prefix); };
 const oldInstall = installPaymentControlsV5;
 installPaymentControlsV5 = function(prefix) { oldInstall(prefix); };
 resetPaymentV5 = function(prefix) {
  install(prefix); const s = state(prefix); if (!s) return;
  financePaymentState5[prefix] = {method:'cash',total:null,tenderEdited:false};
  for (const suffix of ['Cash','Terminal','OwnerCard']) $(prefix + 'Pay' + suffix).value = '0.00';
  $(prefix + 'PaymentStatusV10').value = 'paid'; $(prefix + 'ReceivedV10').value = '0.00'; $(prefix + 'EditReasonV10').value = '';
  s.correctionV22 = false; delete s.correctionActorV22; delete s.paymentBeforeCorrectionV22;
  $(prefix + 'EditReasonBoxV10').classList.add('hidden'); clearConfirmation(prefix); $(prefix + 'Paid').readOnly = false;
  if (prefix === 'sale') { $('saleReserveV5').checked = false; $('reserveSaleOptionV5').classList.toggle('hidden',!isManager() || isPaymentOnlyV5('sale')); }
  calculate(prefix);
 };
 syncPaymentV5 = function(prefix, force = false) {
  const s = state(prefix), pay = financePaymentState5[prefix]; if (!s || !pay || !$(prefix + 'ClinicalV10')) return;
  let total = null; try { total = receivedCents(prefix); } catch {}
  const correcting = correctionSelected(prefix);
  if (correcting) {
   $(prefix + 'PaymentStatusV10').value = 'debt'; $(prefix + 'ReceivedV10').value = '0.00'; total = 0;
   for (const suffix of ['Cash','Terminal','OwnerCard','Tender']) $(prefix + 'Pay' + suffix).value = '0.00';
  }
  if (pay.total !== total || force) {
   clearConfirmation(prefix);
   if (pay.method !== 'mixed' || force) for (const [suffix,method] of [['Cash','cash'],['Terminal','terminal'],['OwnerCard','owner_card']]) $(prefix + 'Pay' + suffix).value = amount(pay.method === method || (pay.method === 'mixed' && method === 'cash') ? total || 0 : 0);
   pay.total = total;
  }
  $(prefix + 'PayAllocation').classList.toggle('hidden',correcting || pay.method !== 'mixed');
  $(prefix + 'PaymentV5').querySelectorAll('[data-pay-method]').forEach(button => { const selected = button.dataset.payMethod === pay.method; button.setAttribute('aria-pressed',String(selected)); button.classList.toggle('primary',selected); button.classList.toggle('secondary',!selected); });
  let cash = 0; try { cash = cents($(prefix + 'PayCash').value); } catch {}
  if (!pay.tenderEdited) $(prefix + 'PayTender').value = amount(cash);
  $(prefix + 'PayTenderBox').classList.toggle('hidden',total === 0 || (cash === 0 && pay.method !== 'cash' && pay.method !== 'mixed'));
  const paymentStatus = $(prefix + 'PaymentStatusV10').value,pendingSelected = paymentStatus === 'pending';
  $(prefix + 'EditReasonBoxV10').classList.toggle('hidden',correcting || !s.edit || editWithoutReason(s.edit,{status:paymentStatus,previous:s.previous || 0,received:total}));
  $(prefix + 'ReceivedBoxV10').classList.toggle('hidden',correcting || (paymentStatus !== 'debt' && !pendingSelected));
  const debtSelected = $(prefix + 'PaymentStatusV10').value === 'debt';
  $(prefix + 'DebtHintV13').classList.toggle('hidden',!debtSelected && !pendingSelected);
  $(prefix + 'DebtHintV13').textContent = prefix === 'sale' && pendingSelected ? 'Сохраните продажу с оплатой сейчас 0 ₽. Для оплаты позже откройте продажу в журнале смены и нажмите «Принять оплату». Пациента выбирать необязательно.' : pendingSelected ? 'Сохраните процедуру с оплатой сейчас 0 ₽ и переходите к следующему пациенту. Когда пациент оплатит, откройте журнал смены или его карточку и нажмите «Принять оплату».' : 'Индивидуальную стоимость можно сохранить и без оплаты. Укажите сумму для пациента и причину изменения. Если деньги не получены, оставьте «Оплачено сейчас» равным 0: вся стоимость сохранится в долг.';
  $(prefix + 'PaymentV5').querySelector('h2').textContent = 'Стоимость и оплата';
  $(prefix + 'PayConfirmed').nextElementSibling.textContent = 'Подтверждаю стоимость, оплату и остаток долга';
  const kind = prefix === 'proc' ? 'procedure' : 'sale';
  const saveButton = document.querySelector('#' + kind + ' button[onclick="' + (prefix === 'proc' ? 'saveProcedure()' : 'saveSale()') + '"]');
  if (saveButton) saveButton.textContent = correcting ? 'Исправить оплату и сохранить в долг' : pendingSelected && total === 0 ? 'Сохранить без оплаты' : prefix === 'proc' ? (debtSelected ? 'Сохранить процедуру в долг' : 'Сохранить процедуру') : (debtSelected ? 'Сохранить продажу в долг' : 'Сохранить продажу');
  let unpaidBalance = 0; try { unpaidBalance = cents($(prefix + 'Paid').value || '0') - (s.previous || 0); } catch {}
  $(prefix + 'SavePendingV14').classList.toggle('hidden',correcting || pendingSelected || paymentStatus === 'free' || unpaidBalance <= 0);
  $(prefix + 'ReceivedV10').previousElementSibling.textContent = s.edit ? 'Доплата сейчас, ₽' : 'Оплачено сейчас, ₽';
  try { const m = currentModel(prefix), increase = m.charge > m.list; $(prefix + 'DebtSummaryV10').textContent = `По прайсу: ${rub(m.list / 100)}. ${increase ? 'Надбавка' : 'Скидка'}: ${rub(Math.abs(m.list - m.charge) / 100)}. К оплате с учётом ${increase ? 'надбавки' : 'скидки'}: ${rub(m.charge / 100)}. ${s.edit ? 'Ранее оплачено: ' + rub(m.previous / 100) + '. ' : ''}Оплата сейчас: ${rub(m.received / 100)}. ${m.status === 'pending' ? 'Ожидает оплаты' : 'Долг'}: ${rub(m.debt / 100)}${m.status === 'free' ? '. Бесплатно' : ''}`; }
  catch (error) { $(prefix + 'DebtSummaryV10').textContent = error.message; }
  correctionControls(prefix); inlinePayment(prefix); renderPaymentSummaryV5(prefix);
 };
 readPaymentsV5 = function(prefix, confirmation = true) {
  const model = currentModel(prefix), cash = cents($(prefix + 'PayCash').value,'Наличные'), terminal = cents($(prefix + 'PayTerminal').value,'Терминал'), ownerCard = cents($(prefix + 'PayOwnerCard').value,'Перевод');
  if (cash + terminal + ownerCard !== model.received) throw Error(`Распределите ровно ${rub(model.received / 100)} между способами оплаты`);
  const tender = cash ? cents($(prefix + 'PayTender').value,'Получено наличными') : 0;
  if (tender < cash) throw Error('Получено наличными меньше наличной части оплаты');
  if (confirmation && !$(prefix + 'PayConfirmed').checked) throw Error('Проверьте оплату и отметьте подтверждение');
  return {cash:cash / 100,terminal:terminal / 100,owner_card:ownerCard / 100,cash_received:tender / 100};
 };
 calcProcedure = function(update = true) { calculate('proc',update); };
 calcSale = function(update = true) { calculate('sale',update); };
 financeListCentsV5 = function(prefix) { return listCents(prefix); };
 const prepareBase = prepareTreatment4;
 prepareTreatment4 = async function(kind,patientId,navigation = quickNavigation4) {
  const actor = currentStaff?.id;
  if (!quickNavigationCurrent4(navigation,actor)) return false;
  const prefix = kind === 'procedure' ? 'proc' : 'sale';
  if (forms[prefix]?.correctionSavingV22) { message('homeMessage','Исправление оплаты ещё сохраняется. Дождитесь ответа перед открытием новой записи.'); return false; }
  if (forms[prefix]?.retry) { show(kind); lockRetryForm(prefix); message(kind + 'Message','Предыдущее сохранение ещё не подтверждено. Нажмите «Повторить сохранение» — отправим первоначальные данные без дубля.'); return false; }
  forms[prefix] = {chargeEdited:false,previous:0,edit:null,medicationPrices:new Map(),servicePrices:new Map()};
  install(prefix);
  if (prefix === 'proc') { $('procAdditionalServicesV10').innerHTML = ''; $('procOwnMedsV10').innerHTML = ''; }
  const ready = await prepareBase(kind,patientId,navigation);
  if (!quickNavigationCurrent4(navigation,actor)) return false;
  if (ready) { resetVisitTime(prefix,null,$(prefix + 'Patient').value); $(kind).querySelector('h1').textContent = kind === 'procedure' ? 'Новая процедура' : 'Продажа препаратов'; $('repeatHint')?.classList.remove('hidden'); $(prefix + 'Patient').disabled = false; $(prefix + 'Nurse').disabled = false; }
  return ready;
 };
 saveTreatment = async function(kind) {
  if (clinicalBusy) return;
  const prefix = kind === 'procedure' ? 'proc' : 'sale', actor = actorKey(), navigation = quickNavigation4;
  if (state(prefix)?.correctionActorV22 && state(prefix).correctionActorV22 !== actor) { message(kind + 'Message','Учётная запись изменилась. Выйдите и откройте процедуру заново перед исправлением оплаты.'); return; }
  let saved = false, s, model, payload;
  try {
   s = state(prefix); if (!s) throw Error('Откройте форму заново');
   if (s.retry) { model = s.retry.model; payload = s.retry.payload; }
   else {
   if (!s.edit && !shift?.id) throw Error('Сначала откройте смену');
   if (kind === 'procedure' && (!$('procPatient').value || !$('procService').value)) throw Error('Выберите пациента и услугу');
   const selected = rows(prefix + 'Meds').map(item => kind === 'procedure' ? {...item,dose:doseValue(item.dose)} : item);
   if (kind === 'sale' && !selected.length) throw Error('Добавьте препарат для продажи');
   const totals = new Map(); selected.forEach(item => { positiveWhole(item.quantity,'Количество препарата'); totals.set(item.medication_id,(totals.get(item.medication_id) || 0) + item.quantity); });
   const paymentOnly = s.edit ? s.edit.stock_deducted === false : isPaymentOnlyV5(prefix);
   for (const [id,quantity] of totals) {
    const med = meds.find(item => item.id === id), previous = s.edit?.items?.find(item => item.medication_id === id)?.quantity || 0;
    if ((!med || med.active === false) && !(s.edit && previous >= quantity)) throw Error('Препарат недоступен. Замените его или уберите из записи');
    if (paymentOnly && !(s.medicationPrices.has(id) || num(med?.sale_price) > 0)) throw Error('У препарата не указана цена продажи. Владелец может добавить её в карточке препарата');
    const reserve = kind === 'sale' && isManager() && $('saleReserveV5')?.checked;
    if (!paymentOnly && !reserve && quantity > num(med?.work_qty) + previous) throw Error('Недостаточно препарата в рабочем шкафу. Пополните шкаф или исправьте количество');
   }
   model = currentModel(prefix); const payments = readPaymentsV5(prefix,!(model.status === 'pending' && model.received === 0));
   if (model.status === 'pending' && model.received === 0) $(prefix + 'PayConfirmed').checked = true;
   const allServices = kind === 'procedure' ? selectedServices() : [];
   allServices.forEach(item => positiveWhole(item.quantity,'Количество процедур'));
   payload = {shift_id:s.edit?.shift_id || shift.id,nurse_id:$(prefix + 'Nurse').value,patient_id:$(prefix + 'Patient').value || null,service_id:kind === 'procedure' ? $('procService').value : null,services:allServices,own_medications:kind === 'procedure' ? readOwn() : [],items:selected,charge_total:model.charge / 100,paid_total:model.received / 100,payment_status:model.status,payments,discount_reason:$(prefix + 'DiscountReason').value || (model.charge !== model.list ? 'Корректировка стоимости' : null),discount_comment:model.reason || null,notes:$(prefix + 'Notes').value.trim() || null,expected_stock_deducted:!paymentOnly,...visitPayload(prefix)};
   if (!paymentOnly && kind === 'sale' && isManager() && $('saleReserveV5')?.checked) payload.reserve_sale = true;
   if (s.edit && model.received > 0 && shift?.id && shift.id !== s.edit.shift_id) { payload.payment_shift_id=shift.id; payload.payment_nurse_id=[shift.aId,shift.bId].includes(currentStaff.id)?currentStaff.id:shift.aId; }
   if (s.edit) {
    payload.kind = kind; payload.id = s.edit.id; payload.expected_version = s.edit.version;
    payload.edit_reason = correctionSelected(prefix) ? correctionReasonV22 : $(prefix + 'EditReasonV10').value.trim() || null;
    if (!payload.edit_reason && !editWithoutReason(s.edit,model)) throw Error('Укажите, что изменили в процедуре и почему');
    if (correctionSelected(prefix)) Object.assign(payload,{confirm_no_money_received:true,correction_reason:correctionReasonV22,expected_received_total:cents(s.edit.paid_total ?? 0) / 100});
   }
   payload = JSON.parse(JSON.stringify(payload));
   }
   clinicalBusy = true;
   document.querySelectorAll('#' + kind + ' button,#' + kind + ' input,#' + kind + ' select,#' + kind + ' textarea').forEach(element => element.disabled = true);
   message(kind + 'Message','Сохраняем…');
   const correcting = payload.confirm_no_money_received === true;
   s.correctionSavingV22 = correcting;
   const receipt = s.edit ? await clinicalRpc(correcting ? 'payment_correction' : 'treatment_edit',payload,true) : await treatmentRpc(kind,payload);
   assertActor(actor); saved = true;
   if (!s.edit && kind === 'procedure' && typeof global.consumePatientVisitSeedV23 === 'function') global.consumePatientVisitSeedV23(payload.patient_id);
   if (!correcting || state(prefix) === s) { forms[prefix] = null; $(prefix + 'Meds').innerHTML = ''; $(prefix + 'Paid').value = ''; }
   if (!correcting || quickNavigationCurrent4(navigation,currentStaff?.id)) show('workspace');
   const success = correcting ? `Оплата исправлена. В долг: ${rub(receipt?.debt_total ?? model.debt / 100)}. Ошибочно отмеченная оплата убрана из выручки.` : `${s.edit ? 'Изменения сохранены' : kind === 'procedure' ? 'Процедура сохранена' : 'Продажа сохранена'}. Оплачено: ${rub(receipt?.paid_total ?? (model.previous + model.received) / 100)}. ${model.status === 'pending' ? 'Ожидает оплаты' : 'Долг'}: ${rub(receipt?.debt_total ?? model.debt / 100)}.`;
   message('homeMessage',success,true);
   try { await refreshDashboard(); } catch (error) { if (actorKey() === actor) message('homeMessage',success + ' Не удалось обновить экран: ' + error.message,true); }
  } catch (error) {
   if (actorKey() === actor) {
    if (!saved && s && payload && (s.retry || financeRetryableErrorV16(error,error.status))) { s.retry = {payload,model}; error = saveError({...error,uncertain:true,message:error.message},error.status); }
    message(saved ? 'homeMessage' : kind + 'Message',error.message);
   }
  }
  finally { if (s) delete s.correctionSavingV22; clinicalBusy = false; if (actorKey() === actor) lockRetryForm(prefix); }
 };
 const treatmentBase = treatmentRpc;
 async function saveWithoutPayment(kind) {
  const prefix = kind === 'procedure' ? 'proc' : 'sale';
  if (clinicalBusy || !state(prefix)) return;
  if (state(prefix).retry) { await saveTreatment(kind); return; }
  if (correctionSelected(prefix)) { await saveTreatment(kind); return; }
  $(prefix + 'PaymentStatusV10').value = 'pending'; $(prefix + 'ReceivedV10').value = '0.00';
  syncPaymentV5(prefix,true); $(prefix + 'PayConfirmed').checked = true;
  await saveTreatment(kind);
 }
 global.saveProcedureWithoutPaymentV14 = () => saveWithoutPayment('procedure');
 global.saveSaleWithoutPaymentV14 = () => saveWithoutPayment('sale');
 treatmentRpc = async function(kind,payload) { try { return await treatmentBase(kind,payload); } catch (error) { throw saveError(error,error.status); } };
 global.editTreatmentV10 = async function(kind,id) {
  if (clinicalBusy) return;
  const prefix = kind === 'procedure' ? 'proc' : 'sale';
  if (state(prefix)?.retry) { show(kind); lockRetryForm(prefix); message(kind + 'Message','Сначала повторите предыдущее сохранение. Его результат ещё не подтверждён.'); return; }
  const navigation=beginQuickNavigation4(), actor = actorKey(), version = ++editorView;
  try {
   const record = await clinicalRpc('treatment_get',{kind,id});
   if (version !== editorView || !quickNavigationCurrent4(navigation,currentStaff?.id)) return; assertActor(actor);
   if (!record?.editable) throw Error('Эту запись нельзя изменить. Медсестра редактирует записи своей открытой смены; для остальных обратитесь к владельцу');
   const patientId = record.patient_id, prefix = kind === 'procedure' ? 'proc' : 'sale';
   // Editing keeps the original shift rather than silently moving a visit to today.
   forms[prefix] = {chargeEdited:true,previous:cents(record.paid_total ?? 0),edit:record,medicationPrices:new Map((record.items || []).map(item => [item.medication_id,Math.round(num(item.unit_price ?? num(item.line_total) / num(item.quantity)) * 100)])),servicePrices:new Map((record.services || []).map(item => [item.service_id,Math.round(num(item.unit_price ?? (num(item.work_price) + num(item.consumables_price))) * 100)]))};
   install(prefix); await Promise.all([loadMeds(),loadPatients(),loadServices()]); assertActor(actor); if (version !== editorView || !quickNavigationCurrent4(navigation,currentStaff?.id)) return;
   financeTreatmentMode5[prefix] = {payment_only:record.stock_deducted === false,stock_deducted:record.stock_deducted !== false};
   $(prefix + 'Patient').innerHTML = patientOptions(true); if (patientId && !patients.some(patient => patient.id === patientId)) $(prefix + 'Patient').add(new Option(record.patient || 'Пациент записи',patientId)); $(prefix + 'Patient').value = patientId || ''; $(prefix + 'Patient').disabled = true;
   resetVisitTime(prefix,record,patientId);
   $(prefix + 'Nurse').innerHTML = `<option value="${esc(record.nurse_id)}">${esc(record.nurse || 'Медсестра записи')}</option>`; $(prefix + 'Nurse').disabled = true;
   $(prefix + 'Meds').innerHTML = '';
   if (prefix === 'proc') {
    $('procAdditionalServicesV10').innerHTML = ''; $('procOwnMedsV10').innerHTML = '';
    $('procService').innerHTML = '<option value="">Выберите услугу</option>' + services.map(service => `<option value="${esc(service.id)}">${esc(service.name)}</option>`).join('');
    const main = (record.services || [])[0] || {service_id:record.service_id,name:record.procedure_type};
    if (main.service_id && !services.some(service => service.id === main.service_id)) $('procService').add(new Option(main.name || 'Ранее выбранная услуга',main.service_id)); $('procService').value = main.service_id || '';
    if (num(main.quantity) > 1) addService({...main,quantity:num(main.quantity) - 1});
    (record.services || []).slice(1).forEach(item => addService(item)); (record.own_medications || []).forEach(item => addOwn(item)); $('repeatHint').classList.add('hidden');
   }
   (record.items || []).forEach(item => addMedRow(prefix + 'Meds',item.medication_id,item.quantity,{id:item.medication_id,name:item.name,consumption_unit:item.unit,dose:item.dose}));
   $(prefix + 'Notes').value = record.notes || ''; $(prefix + 'DiscountReason').value = record.discount_reason || ''; $(prefix + 'DiscountComment').value = record.discount_comment || '';
   $(prefix + 'Paid').value = amount(cents(record.charge_total ?? record.paid_total ?? 0)); resetPaymentV5(prefix); $(prefix + 'Paid').value = amount(cents(record.charge_total ?? record.paid_total ?? 0));
   forms[prefix].chargeEdited = !automaticUnpaidCharge(record);
   $(prefix + 'PaymentStatusV10').value = num(record.debt_total) > 0 ? (record.payment_pending ? 'pending' : 'debt') : num(record.charge_total ?? record.paid_total) === 0 ? 'free' : 'paid'; $(prefix + 'ReceivedV10').value = '0.00';
   $(kind).querySelector('h1').textContent = kind === 'procedure' ? 'Редактирование процедуры' : 'Редактирование продажи'; show(kind); calculate(prefix,false); renderAccountingModeV5();
   message(kind + 'Message',pendingUnpaidRecord(record) ? 'Добавьте или измените процедуру и препараты. До оплаты можно сохранять изменения без комментария. При изменении стоимости укажите её причину.' : 'Сохранённые цены и полученная оплата сохранены. Добавьте нужную процедуру или препарат. Укажите причину изменения.');
   if (prefix === 'proc' && typeof global.loadProcedureTemplatesV5 === 'function') await global.loadProcedureTemplatesV5();
  } catch (error) { if (actorKey() === actor) message('patientCardMessageV5',error.message); }
 };
 function dateText(at) { return esc(new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})); }
 global.treatmentActionsHtmlV14 = function(event,fromJournal=false) {
  if (!event.id) return '';
  const kind = event.kind === 'sale' ? 'sale' : 'procedure',remaining = financeEventAmountsV5(event).debt,patientId = event.patient_id || (kind === 'procedure' && !fromJournal ? currentPatientId : null);
  const edit = event.editable ? `<button type="button" class="btn secondary" onclick="editTreatmentV10('${esc(kind)}','${esc(event.id)}')">Редактировать</button>` : '';
  const pay = remaining > 0 && (patientId || kind === 'sale') ? `<button type="button" class="btn primary" onclick="${fromJournal ? 'openJournalPaymentV14' : 'openSavedPaymentV14'}('${esc(kind)}','${esc(event.id)}',${remaining},'${esc(patientId || '')}',${event.payment_pending === true})">${event.payment_pending ? 'Принять оплату' : 'Принять оплату долга'}</button>` : '';
  return edit || pay ? `<div class="treatment-actions-v14">${edit}${pay}</div>` : '';
 };
 global.loadPatientClinicalV10 = async function(id = currentPatientId) {
  const actor = actorKey(), version = ++patientView;
  let host = $('patientClinicalV10'); if (!host) { host = document.createElement('div'); host.id = 'patientClinicalV10'; $('patientHistory').before(host); }
  host.innerHTML = '<div class="notice">Загружаем оплату и доступные изменения…</div>';
  try {
   const data = await clinicalRpc('patient_treatments',{patient_id:id});
   if (version !== patientView || id !== currentPatientId || actor !== actorKey()) return;
   const events = treatmentEvents(data);
   host.innerHTML = `<h2>Оплата и изменения</h2>${events.map(event => `<div class="card clinical-history-v10"><strong>${esc(event.kind === 'sale' ? 'Продажа' : event.procedure_type || 'Процедура')}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)}</div>${financeEventPaymentHtmlV5(event)}${(event.own_medications || []).map(item => `<div class="small">${esc(item.name)} × ${qty(item.quantity)} ${esc(item.unit)}${item.dose ? ' · Доза: ' + esc(item.dose) : ''} · ${item.source === 'previously_purchased' ? 'Ранее куплен у нас' : 'Препарат пациента'}</div>`).join('')}${global.treatmentActionsHtmlV14(event)}</div>`).join('') || '<p class="small">Записей пока нет.</p>'}`;
  } catch (error) { if (version === patientView && id === currentPatientId && actor === actorKey()) host.innerHTML = `<div class="notice">${esc(error.message)}<button type="button" class="btn secondary wide" onclick="loadPatientClinicalV10()">Повторить</button></div>`; }
 };
 const openPatientBase = openPatient;
 openPatient = async function(id) { const actor = actorKey(); await openPatientBase(id); if (actor === actorKey() && currentPatientId === id && $('patientCard').classList.contains('active')) await global.loadPatientClinicalV10(id); };
 global.openDebtPaymentV10 = function(kind,id,debt,patientId=currentPatientId,returnToDebts=false) {
  if (debtBusy) return;
  beginQuickNavigation4();
  let host = $('debtPaymentV10'); if (!host) { host = document.createElement('section'); host.id = 'debtPaymentV10'; host.className = 'screen'; $('workspace').parentElement.appendChild(host); }
  host.dataset.kind = kind; host.dataset.recordId = id; host.dataset.debt = String(debt); host.dataset.patientId = patientId || ''; host.dataset.returnToDebts=String(returnToDebts);
  delete host.dataset.returnToJournal;
  host.innerHTML = `<h1>Оплата долга</h1><div class="card"><p>Осталось оплатить: <b>${rub(debt)}</b></p><label for="debtAmountV10">Получено сейчас, ₽</label><input id="debtAmountV10" type="number" inputmode="decimal" min="0.01" step="0.01" value="${Number(debt).toFixed(2)}"><label for="debtMethodV10">Способ оплаты</label><select id="debtMethodV10"><option value="cash">Наличные</option><option value="terminal">Терминал</option><option value="owner_card">Перевод владельцу</option></select><label for="debtTenderV10">Получено наличными для расчёта сдачи, ₽</label><input id="debtTenderV10" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(debt).toFixed(2)}"><label for="debtNoteV10">Комментарий</label><input id="debtNoteV10"><label class="payment-confirm-v5"><input id="debtConfirmV10" type="checkbox"><span>Подтверждаю полученную оплату</span></label><button type="button" class="btn primary wide" onclick="saveDebtPaymentV10()">Сохранить оплату долга</button><div id="debtMessageV10" role="status" aria-live="polite"></div></div><button type="button" class="btn secondary" onclick="${returnToDebts?'openDebtsV10()':patientId?`openPatient('${esc(patientId)}')`:"show('workspace')"}">${returnToDebts?'Назад к долгам':patientId?'Назад к пациенту':'Назад'}</button>`;
  host.querySelectorAll('input,select').forEach(input => input.addEventListener('input',() => { if (input.id !== 'debtConfirmV10') $('debtConfirmV10').checked = false; }));
  let tenderEdited = false;
  $('debtTenderV10').addEventListener('input',() => { tenderEdited = true; });
  $('debtAmountV10').addEventListener('input',() => { if (!tenderEdited) $('debtTenderV10').value = $('debtAmountV10').value; });
  $('debtMethodV10').addEventListener('change',() => { const cash = $('debtMethodV10').value === 'cash'; $('debtTenderV10').classList.toggle('hidden',!cash); $('debtTenderV10').previousElementSibling.classList.toggle('hidden',!cash); $('debtConfirmV10').checked = false; });
  const retry = pendingPayments16.get(JSON.stringify([actorKey(),kind,id]));
  if (retry) {
   const payments = retry.payload.payments;
   $('debtAmountV10').value = amount(retry.paid); $('debtTenderV10').value = String(payments.cash_received);
   $('debtMethodV10').value = payments.cash > 0 ? 'cash' : payments.terminal > 0 ? 'terminal' : 'owner_card';
   $('debtNoteV10').value = retry.payload.comment || ''; $('debtConfirmV10').checked = true;
   host.querySelectorAll('input,select').forEach(input => input.disabled = true);
   message('debtMessageV10','Предыдущее сохранение оплаты ещё не подтверждено. Повторите сохранение — отправим первоначальную оплату без дубля.');
  }
  show('debtPaymentV10');
 };
 global.openSavedPaymentV14 = function(kind,id,amount,patientId,pending=false) {
  global.openDebtPaymentV10(kind,id,amount,patientId);
  if (pending) $('debtPaymentV10').querySelector('h1').textContent = kind === 'sale' ? 'Оплата продажи' : 'Оплата процедуры';
 };
 global.openJournalPaymentV14 = function(kind,id,amount,patientId,pending=false) {
  const date = $('journalDateV12')?.value;
  global.openSavedPaymentV14(kind,id,amount,patientId,pending);
  const host = $('debtPaymentV10'); host.dataset.returnToJournal = date || '';
  host.querySelector('.btn.secondary').onclick = () => global.openShiftJournalV12(date);
 };
 global.saveDebtPaymentV10 = async function() {
  if (debtBusy) return; const navigation=quickNavigation4, actor = actorKey(), host = $('debtPaymentV10');
  const key = JSON.stringify([actor,host.dataset.kind,host.dataset.recordId]);
  let committed = false, snapshot;
  try {
   snapshot = pendingPayments16.get(key);
   if (!snapshot) {
    if (!shift?.id) throw Error('Для приёма оплаты откройте свою смену');
    const paid = cents($('debtAmountV10').value), remaining = cents(host.dataset.debt), method = $('debtMethodV10').value;
    if (!paid || paid > remaining) throw Error('Укажите оплату больше нуля и не больше оставшегося долга');
    if (!$('debtConfirmV10').checked) throw Error('Проверьте оплату и отметьте подтверждение');
    const tender = method === 'cash' ? cents($('debtTenderV10').value,'Получено наличными') : 0;
    if (method === 'cash' && tender < paid) throw Error('Получено наличными меньше суммы оплаты');
    const nurseId = [shift.aId,shift.bId].includes(currentStaff.id) ? currentStaff.id : shift.aId;
    snapshot = {paid,remaining,payload:{kind:host.dataset.kind,id:host.dataset.recordId,shift_id:shift.id,nurse_id:nurseId,payments:{cash:method === 'cash' ? paid / 100 : 0,terminal:method === 'terminal' ? paid / 100 : 0,owner_card:method === 'owner_card' ? paid / 100 : 0,cash_received:tender / 100},comment:$('debtNoteV10').value.trim() || null}};
   }
   debtBusy = true; host.querySelectorAll('button,input,select').forEach(input => input.disabled = true);
   const receipt = await clinicalRpc('debt_payment',snapshot.payload,true);
   assertActor(actor); committed = true; pendingPayments16.delete(key); $('debtConfirmV10').checked = false;
   const patient = host.dataset.patientId, returnToDebts=host.dataset.returnToDebts==='true',returnToJournal=host.dataset.returnToJournal; host.innerHTML = '';
   if(!quickNavigationCurrent4(navigation,currentStaff?.id))return;
   const success = 'Оплата сохранена. Осталось: ' + rub(receipt?.debt_total ?? (snapshot.remaining - snapshot.paid) / 100);
   try {
    if(returnToJournal)await global.openShiftJournalV12(returnToJournal);else if(returnToDebts)await global.openDebtsV10();else if(patient)await openPatient(patient);else{show('workspace');await refreshDashboard();}
    if (actor === actorKey()) message(returnToJournal?'journalMessageV12':returnToDebts?'debtsMessageV10':patient?'patientCardMessageV5':'homeMessage',success,true);
   } catch (error) { if (actor === actorKey()) { show('workspace'); message('homeMessage',success + '. Не удалось обновить экран: ' + error.message,true); } }
  } catch (error) {
   if (actor === actorKey()) {
    if (!committed && snapshot && (pendingPayments16.has(key) || financeRetryableErrorV16(error,error.status))) { pendingPayments16.set(key,snapshot); error = saveError({...error,uncertain:true,message:error.message},error.status); }
    message(committed ? 'homeMessage' : 'debtMessageV10',committed ? 'Оплата сохранена. Не удалось обновить экран: ' + error.message : error.message);
   }
  }
  finally { debtBusy = false; if (actor === actorKey()) host.querySelectorAll('button,input,select').forEach(input => input.disabled = pendingPayments16.has(key) && input.tagName !== 'BUTTON'); }
 };
 function treatmentEvents(data) { return Array.isArray(data) ? data : data?.events || [...(data?.procedures || []).map(event => ({...event,kind:'procedure'})),...(data?.sales || []).map(event => ({...event,kind:'sale'}))].sort((a,b) => new Date(b.at || b.visit_at || b.sold_at) - new Date(a.at || a.visit_at || a.sold_at)); }
 let debtView = 0;
 global.openDebtsV10 = async function() {
  if (!isManager()) { message('homeMessage','Список всех долгов доступен только владельцу'); return; }
  beginQuickNavigation4(); const actor = actorKey(), view = ++debtView;
  let host = $('debtsV10'); if (!host) { host = document.createElement('section'); host.id = 'debtsV10'; host.className = 'screen'; $('workspace').parentElement.appendChild(host); }
  host.innerHTML = '<div class="row between"><h1>Долги пациентов</h1><button type="button" class="btn secondary" onclick="show(\'workspace\')">Назад</button></div><div id="debtsMessageV10" role="status">Загружаем…</div><div id="debtsBodyV10"></div>';
  show('debtsV10');
  try {
   const data = await clinicalRpc('debts');
   if (!isManager() || actor !== actorKey() || view !== debtView) return;
   const events = Array.isArray(data) ? data : data?.debts || data?.events || treatmentEvents(data), total = events.reduce((sum,event) => sum + Math.round(num(event.debt_total) * 100),0);
   $('debtsBodyV10').innerHTML = `<div class="card">Всего к оплате: <b>${rub(total / 100)}</b></div>${events.map(event => `<div class="item clinical-history-v10"><strong>${esc(event.patient || event.patient_name || (event.kind === 'sale' ? 'Продажа без пациента' : 'Пациент'))}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)} · ${esc(event.procedure_type || (event.kind === 'sale' ? 'Продажа' : 'Процедура'))}</div><div>Долг: <b>${rub(event.debt_total)}</b></div><button type="button" class="btn primary wide" onclick="openDebtPaymentV10('${esc(event.kind)}','${esc(event.id)}',${Number(event.debt_total)},'${esc(event.patient_id || '')}',true)">Принять оплату долга</button></div>`).join('') || '<p>Долгов нет.</p>'}`;
   $('debtsMessageV10').textContent = '';
  } catch (error) { if (isManager() && actor === actorKey() && view === debtView) $('debtsMessageV10').innerHTML = `${esc(error.message)}<button type="button" class="btn secondary wide" onclick="openDebtsV10()">Повторить</button>`; }
 };
 const homeBase = renderCabinetHomeV5;
 renderCabinetHomeV5 = function() { homeBase(); if (!isManager()) return; const actions = $('workspace').querySelector('.home-actions'); if (actions && !$('homeDebtsV10')) { const button = document.createElement('button'); button.id = 'homeDebtsV10'; button.innerHTML = '<span>🧾</span><strong>Долги пациентов</strong>'; button.onclick = global.openDebtsV10; actions.appendChild(button); } };
 const showBase = show;
 show = function(id) { if (id === 'debtsV10' && !isManager()) { message('homeMessage','Список всех долгов доступен только владельцу'); id = 'workspace'; } showBase(id); };
 const signOutBase = signOut;
 signOut = async function() { session++; patientView++; editorView++; debtView++; forms.proc = null; forms.sale = null; requests.clear(); ambiguousRequests16.clear(); pendingPayments16.clear(); for (const id of ['patientClinicalV10','debtPaymentV10','debtsV10']) if ($(id)) $(id).innerHTML = ''; await signOutBase(); };
})(typeof window === 'object' ? window : globalThis);
