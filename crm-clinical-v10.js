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
 function allocationCents(value, label = 'Сумма') {
  return String(value ?? '').trim() === '' ? 0 : cents(value,label);
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
 function protocolItems(items, medications = typeof meds === 'undefined' ? [] : meds) {
  if (!Array.isArray(items)) throw Error('Неверный состав шаблона');
  const combined = new Map();
  for (const item of items) {
   if (!item || typeof item.medication_id !== 'string' || !item.medication_id) throw Error('Выберите препарат шаблона');
   const medicine = medications.find(m => m.id === item.medication_id);
   const quantity = typeof global.medicationQuantityV31 === 'function' ? global.medicationQuantityV31(item.quantity,medicine) : Number(item.quantity), dose = doseValue(item.dose);
   if (typeof global.medicationQuantityV31 !== 'function' && (!Number.isSafeInteger(quantity) || quantity < 1)) throw Error('Количество препарата должно быть целым и больше нуля');
   const previous = combined.get(item.medication_id);
   if (previous && previous.dose !== dose) throw Error('У одного препарата указаны разные дозы. Скорректируйте дозу в процедуре или замените состав шаблоном');
   const total = Math.round((quantity + (previous?.quantity || 0))*1000)/1000;
   if (typeof global.medicationQuantityV31 === 'function') global.medicationQuantityV31(total,medicine);
   else if (!Number.isSafeInteger(total)) throw Error('Слишком большое количество препарата');
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
 const helpers = {cents,allocationCents,paymentModel,ownedItems,doseValue,protocolItems,mergeServices,pendingUnpaidRecord,editWithoutReason,automaticUnpaidCharge,paymentCorrectionAllowed};
 if (typeof module === 'object' && module.exports) module.exports = helpers;
 if (typeof document === 'undefined') return;
 global.CrmClinicalV10 = helpers;
 const forms = {proc:null,sale:null}, requests = new Map(), ambiguousRequests16 = new Set(), pendingPayments16 = new Map(), debtPurposes29 = new Map();
 let session = 0, patientView = 0, editorView = 0, repeatView = 0, repeatPreparationV33 = null, debtBusy = false;
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
 function medicationPriceCents(prefix, id) {
  return state(prefix)?.medicationPrices?.get(id) ?? Math.round(num(meds.find(m => m.id === id)?.sale_price) * 100);
 }
 function renderMedicationPrices(prefix) {
  for (const row of $(prefix + 'Meds')?.querySelectorAll('.medrow') || []) {
   const id = row.dataset.medicationId, name = row.querySelector('.chosen-name');
   if (!name) continue;
   let price = name.querySelector('.medication-price-v31');
   if (!price) {
    price = document.createElement('small'); price.className = 'medication-price-v31';
    const hint = name.querySelector('.stock-hint'); if (hint) hint.before(price); else name.appendChild(price);
   }
   const saved = state(prefix)?.medicationPrices?.has(id), medicine = meds.find(m => m.id === id);
   if (!saved && !(num(medicine?.sale_price) > 0)) { price.textContent = 'Цена не задана'; continue; }
   const each = medicationPriceCents(prefix,id), original = state(prefix)?.edit?.items?.find(item => item.medication_id === id);
   const label = original?.unit || unit(medicine || {}); let total = '—';
   try {
    const raw = row.querySelector('.medqty')?.value || '', quantity = typeof global.medicationQuantityV31 === 'function' ? global.medicationQuantityV31(raw,medicine || original) : Number(raw);
    if (Number.isFinite(quantity) && quantity > 0) total = rub((typeof global.medicationLineCentsV31 === 'function' ? global.medicationLineCentsV31(each,quantity) : Math.round(each * quantity)) / 100);
   } catch {}
   price.textContent = `Цена: ${rub(each / 100)} / ${label} · Сумма: ${total}`;
  }
 }
 function listCents(prefix) {
  const medicines = rows(prefix + 'Meds').reduce((sum,item) => {
   const price = medicationPriceCents(prefix,item.medication_id);
   return sum + (typeof global.medicationLineCentsV31 === 'function' ? global.medicationLineCentsV31(price,item.quantity) : Math.round(price * Number(item.quantity)));
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
  inline.innerHTML = `<label for="${prefix}ChargeInPaymentV11">Индивидуальная стоимость, ₽</label><input id="${prefix}ChargeInPaymentV11" type="number" inputmode="decimal" min="0" step="0.01"><div id="${prefix}DiscountInPaymentBoxV11" class="hidden"><label for="${prefix}DiscountInPaymentV11">Причина изменения стоимости / бесплатно *</label><textarea id="${prefix}DiscountInPaymentV11" placeholder="Например: индивидуальная цена согласована"></textarea></div>`;
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
  renderMedicationPrices(prefix);
  let total;
  try { total = listCents(prefix); }
  catch (error) { message(prefix === 'proc' ? 'procedureMessage' : 'saleMessage',error.message); return; }
  $(prefix + 'List').textContent = rub(total / 100);
  if (!s.chargeEdited && (update || $(prefix + 'Paid').value === '')) $(prefix + 'Paid').value = amount(total);
  if (prefix === 'proc') $('servicePriceInfo').textContent = 'Работа и расходники выбранных процедур: ' + rub(selectedServices().reduce((sum,item) => sum + servicePrice(prefix,item.service_id) * item.quantity,0) / 100);
  discountVisibility(prefix); syncPaymentV5(prefix);
 }
 helpers.templateState = function() {
  const s = state('proc');
  return {ready:!!s,locked:!s || !!s.retry || clinicalBusy || !!repeatPreparationV33 || !!s.correctionSavingV22,editing:!!s?.edit,hasSelection:!!$('procMeds')?.querySelector('.medrow') || !!$('procAdditionalServicesV10')?.querySelector('.clinical-service-v10')};
 };
 helpers.applyTemplate = function(template, mode = 'replace') {
  const s = state('proc');
  if (!s || !currentStaff?.id || currentStaff.active === false) throw Error('Сначала откройте процедуру пациента');
  if (s.retry || clinicalBusy || repeatPreparationV33 || s.correctionSavingV22) throw Error('Дождитесь загрузки или подтверждения сохранения процедуры перед применением шаблона');
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
  financePaymentState5[prefix] = {method:null,total:null,tenderEdited:false};
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
  $(prefix + 'DebtHintV13').textContent = prefix === 'sale' && pendingSelected ? 'Продажа ожидает расчёта — это не долг. Сохраните с оплатой сейчас 0 ₽. Для расчёта откройте её в журнале смены и нажмите «Принять оплату». Пациента выбирать необязательно.' : pendingSelected ? 'Пациент ожидает расчёта после процедуры — это не долг. Сохраните с оплатой сейчас 0 ₽ и переходите к следующему пациенту. Когда он оплатит, откройте журнал или его карточку и нажмите «Принять оплату».' : 'Индивидуальную стоимость можно сохранить и без оплаты. Укажите сумму для пациента и причину изменения. Если деньги не получены, оставьте «Оплачено сейчас» равным 0: вся стоимость сохранится в долг.';
  $(prefix + 'PaymentV5').querySelector('h2').textContent = 'Стоимость и оплата';
  $(prefix + 'PayConfirmed').nextElementSibling.textContent = pendingSelected ? 'Подтверждаю стоимость. Пациент ожидает расчёта после процедуры' : 'Подтверждаю стоимость, оплату и остаток долга';
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
  const model = currentModel(prefix), method = financePaymentState5[prefix]?.method;
  if (model.received > 0 && !['cash','terminal','owner_card','mixed'].includes(method)) throw Error('Выберите способ оплаты: наличные, терминал, перевод на карту начальника или смешанная оплата');
  const cash = allocationCents($(prefix + 'PayCash').value,'Наличные'), terminal = allocationCents($(prefix + 'PayTerminal').value,'Терминал'), ownerCard = allocationCents($(prefix + 'PayOwnerCard').value,'Перевод');
  if (model.received > 0 && method !== 'mixed' && ((method !== 'cash' && cash > 0) || (method !== 'terminal' && terminal > 0) || (method !== 'owner_card' && ownerCard > 0))) throw Error('Суммы не соответствуют выбранному способу оплаты. Выберите способ оплаты заново');
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
  resetVisitTime(prefix,null,patientId);
  if (prefix === 'proc') { $('procAdditionalServicesV10').innerHTML = ''; $('procOwnMedsV10').innerHTML = ''; }
  const ready = await prepareBase(kind,patientId,navigation);
  if (!quickNavigationCurrent4(navigation,actor)) return false;
  if (ready) { if (!state(prefix)?.visitTimeV23?.manual) resetVisitTime(prefix,null,$(prefix + 'Patient').value); $(kind).querySelector('h1').textContent = kind === 'procedure' ? 'Новая процедура' : 'Продажа препаратов'; $('repeatHint')?.classList.remove('hidden'); $(prefix + 'Patient').disabled = false; $(prefix + 'Nurse').disabled = false; }
  return ready;
 };
 saveTreatment = async function(kind) {
  if (clinicalBusy || repeatPreparationV33) return;
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
   const totals = new Map(); selected.forEach(item => {
    const medicine = meds.find(m => m.id === item.medication_id) || s.edit?.items?.find(m => m.medication_id === item.medication_id);
    const input = [...$(prefix + 'Meds').querySelectorAll('.medrow')].find(row => row.dataset.medicationId === item.medication_id)?.querySelector('.medqty');
    if (typeof global.medicationQuantityV31 === 'function') global.medicationQuantityV31(input?.value ?? item.quantity,medicine); else positiveWhole(item.quantity,'Количество препарата');
    const total = Math.round(((totals.get(item.medication_id) || 0) + item.quantity)*1000)/1000;
    if (typeof global.medicationQuantityV31 === 'function') global.medicationQuantityV31(total,medicine);
    totals.set(item.medication_id,total);
   });
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
   if (!s.edit && allServices.some(item => !services.some(service => service.id === item.service_id && service.active !== false))) throw Error('Услуга недоступна. Замените её или уберите из записи');
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
   const stockText = typeof global.partialStockReceiptTextV28 === 'function' ? global.partialStockReceiptTextV28(receipt) : '';
   message('homeMessage',success + stockText,true);
   try { await refreshDashboard(); } catch (error) { if (actorKey() === actor) message('homeMessage',success + stockText + ' Не удалось обновить экран: ' + error.message,true); }
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
  if (clinicalBusy || repeatPreparationV33 || !state(prefix)) return;
  if (state(prefix).retry) { await saveTreatment(kind); return; }
  if (correctionSelected(prefix)) { await saveTreatment(kind); return; }
  $(prefix + 'PaymentStatusV10').value = 'pending'; $(prefix + 'ReceivedV10').value = '0.00';
  syncPaymentV5(prefix,true); $(prefix + 'PayConfirmed').checked = true;
  await saveTreatment(kind);
 }
 global.saveProcedureWithoutPaymentV14 = () => saveWithoutPayment('procedure');
 global.saveSaleWithoutPaymentV14 = () => saveWithoutPayment('sale');
 treatmentRpc = async function(kind,payload) { try { return await treatmentBase(kind,payload); } catch (error) { throw saveError(error,error.status); } };
 global.repeatPatientProcedureV33 = async function(patientId,id,navigation = null) {
  if (!currentStaff?.id || currentStaff.active === false || !['owner','admin','nurse'].includes(currentStaff.role) || !id || clinicalBusy || repeatPreparationV33) return false;
  const activeCard = $('patientCard')?.classList.contains('active') || $('patientMedicalCardV20')?.classList.contains('active');
  const activeProcedure = $('procedure').classList.contains('active') && $('procPatient').value === patientId;
  if (navigation === null && !(activeCard && currentPatientId === patientId) && !activeProcedure) return false;
  if (state('proc')?.correctionSavingV22) return false;
  if (state('proc')?.retry) { show('procedure'); lockRetryForm('proc'); message('procedureMessage','Сначала повторите предыдущее сохранение. Его результат ещё не подтверждён.'); return false; }
  navigation ??= beginQuickNavigation4();
  const actor = actorKey(), staffId = currentStaff.id, openedPatient = currentPatientId, version = ++repeatView;
  let preparation = null;
  const current = () => actor === actorKey() && version === repeatView && openedPatient === currentPatientId && quickNavigationCurrent4(navigation,staffId) && (!$('procedure').classList.contains('active') || $('procPatient').value === patientId);
  const notice = () => $('patientMedicalCardV20')?.classList.contains('active') ? 'patientMedicalCardMessageV20' : $('procedure').classList.contains('active') ? 'procedureMessage' : 'patientCardMessageV5';
  try {
   if (!await requireShift4(() => global.repeatPatientProcedureV33(patientId,id,navigation),navigation) || !current()) return false;
   // Read the selected saved procedure, even when it belongs to a closed shift.
   // Editing permission is deliberately independent of creating a new draft.
   const record = await clinicalRpc('treatment_get',{kind:'procedure',id});
   if (!current() || clinicalBusy || state('proc')?.correctionSavingV22 || state('proc')?.retry) return false;
   if (!record || record.id !== id || record.patient_id !== patientId) throw Error('Процедура не относится к выбранному пациенту. Обновите его историю');
   preparation = {actor,navigation,version}; repeatPreparationV33 = preparation;
   $('procedure').inert = true; $('procedure').setAttribute('aria-busy','true');
   if (!await prepareTreatment4('procedure',patientId,navigation) || !current() || clinicalBusy || state('proc')?.retry || state('proc')?.correctionSavingV22 || $('procPatient').value !== patientId) return false;
   $('procMeds').innerHTML = ''; $('procAdditionalServicesV10').innerHTML = ''; $('procOwnMedsV10').innerHTML = '';
   const selected = Array.isArray(record.services) && record.services.length ? record.services : record.service_id ? [{service_id:record.service_id,name:record.procedure_type,quantity:1}] : [];
   const main = selected[0];
   if (main?.service_id && !services.some(service => service.id === main.service_id)) $('procService').add(new Option(main.name || 'Прежняя услуга недоступна',main.service_id));
   $('procService').value = main?.service_id || '';
   if (num(main?.quantity) > 1) addService({...main,quantity:num(main.quantity) - 1});
   selected.slice(1).forEach(item => addService(item));
   (Array.isArray(record.items) ? record.items : []).forEach(item => addMedRow('procMeds',item.medication_id,item.quantity,{id:item.medication_id,name:item.name,dosage:item.dosage,consumption_unit:item.unit,dose:item.dose}));
   (Array.isArray(record.own_medications) ? record.own_medications : []).forEach(item => addOwn(item));
   // A repeat has today's visit time, current prices and a fresh payment state.
   // Historical discounts, debt, notes, record version and shift are not copied.
   const now = global.CrmVisitTimeV23.nowParts();
   $('procVisitDateV23').value = now.date; $('procVisitTimeV23').value = now.time;
   state('proc').visitTimeV23 = {original:null,date:now.date,time:now.time,manual:false};
   resetPaymentV5('proc'); recalc(); clearConfirmation('proc');
   const unavailable = !main?.service_id || selected.some(item => !services.some(service => service.id === item.service_id && service.active !== false)) || (record.items || []).some(item => !meds.some(medicine => medicine.id === item.medication_id && medicine.active !== false));
   message('procedureMessage','Новая процедура заполнена по выбранной записи. Проверьте препараты, дозы, количество и стоимость. При необходимости измените состав перед сохранением.' + (unavailable ? ' Есть недоступные препараты или услуги: замените или удалите их перед сохранением.' : ''),!unavailable);
   return true;
  } catch (error) { if (current()) message(notice(),error.message); return false; }
  finally { if (preparation && repeatPreparationV33 === preparation) { repeatPreparationV33 = null; $('procedure').inert = false; $('procedure').removeAttribute('aria-busy'); } }
 };
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
   financeTreatmentMode5[prefix] = {payment_only:record.stock_deducted === false,stock_deducted:record.stock_deducted !== false,...(record.stock_mode ? {partial_stock:record.stock_mode === 'partial',stock_mode:record.stock_mode} : {})};
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
  rememberDebtPurposeV29(event);
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
   host.innerHTML = `<h2>История процедур и продаж</h2>${events.map(event => `<div class="card clinical-history-v10"><strong>${esc(event.kind === 'sale' ? 'Продажа' : event.procedure_type || 'Процедура')}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)}${event.nurse ? ' · Медсестра: ' + esc(event.nurse) : ''}</div>${financeEventDetailsHtmlV5(event)}${financeEventPaymentHtmlV5(event)}${global.treatmentActionsHtmlV14(event)}${event.kind === 'procedure' && event.id ? `<button type="button" class="btn secondary no-print" data-repeat-procedure-v33="${esc(event.id)}">Повторить</button>` : ''}</div>`).join('') || '<p class="small">Записей пока нет.</p>'}`;
   host.querySelectorAll('[data-repeat-procedure-v33]').forEach(button => { button.onclick = () => global.repeatPatientProcedureV33(id,button.dataset.repeatProcedureV33); });
   const historyButton = document.createElement('button'); historyButton.type = 'button'; historyButton.className = 'btn secondary wide no-print'; historyButton.id = 'patientDebtHistoryV29'; historyButton.textContent = 'Погашения долгов пациента'; historyButton.onclick = () => global.openDebtHistoryV29(id); host.appendChild(historyButton);
  } catch (error) { if (version === patientView && id === currentPatientId && actor === actorKey()) host.innerHTML = `<div class="notice">${esc(error.message)}<button type="button" class="btn secondary wide" onclick="loadPatientClinicalV10()">Повторить</button></div>`; }
 };
 const openPatientBase = openPatient;
 openPatient = async function(id) { const actor = actorKey(); await openPatientBase(id); if (actor === actorKey() && currentPatientId === id && $('patientCard').classList.contains('active')) await global.loadPatientClinicalV10(id); };
 function rememberDebtPurposeV29(event) {
  if (!event?.id) return;
  const kind = event.kind === 'sale' ? 'sale' : 'procedure';
  const description = [kind === 'sale' ? 'Продажа препарата' : event.procedure_type || event.type || event.service_name || 'Процедура',...(event.items || []).map(item => [item.name,item.dosage,item.quantity != null ? '× ' + qty(item.quantity) + ' ' + (item.unit || '') : ''].filter(Boolean).join(' '))].filter(Boolean).join(' · ');
  debtPurposes29.set(kind + ':' + event.id,description.slice(0,1000));
 }
 global.openDebtPaymentV10 = function(kind,id,debt,patientId=currentPatientId,returnToDebts=false,paymentPending=false) {
  if (debtBusy) return;
  beginQuickNavigation4();
  const retry = pendingPayments16.get(JSON.stringify([actorKey(),kind,id]));
  const pending = retry ? retry.pending === true : paymentPending === true;
  let host = $('debtPaymentV10'); if (!host) { host = document.createElement('section'); host.id = 'debtPaymentV10'; host.className = 'screen'; $('workspace').parentElement.appendChild(host); }
  host.dataset.kind = kind; host.dataset.recordId = id; host.dataset.debt = String(debt); host.dataset.patientId = patientId || ''; host.dataset.returnToDebts=String(returnToDebts); host.dataset.pending = String(pending);
  delete host.dataset.returnToJournal;
  const title = pending ? kind === 'sale' ? 'Оплата продажи' : 'Оплата процедуры' : 'Погашение долга';
  const purpose = debtPurposes29.get(kind + ':' + id) || (kind === 'sale' ? 'Продажа препарата' : 'Процедура');
  host.innerHTML = `<h1>${title}</h1><div class="card"><p>${pending ? 'Ожидает оплаты' : 'Остаток долга'}: <b>${rub(debt)}</b></p><p class="small">${pending ? 'Это обычная оплата после процедуры. Она войдёт в полученную сумму смены. Наличные войдут в кассу.' : 'Погашение хранится отдельно: не входит в сумму смены и её кассу.'}</p><label for="debtAmountV10">Получено сейчас, ₽</label><input id="debtAmountV10" type="number" inputmode="decimal" min="0.01" step="0.01" value="${Number(debt).toFixed(2)}">${pending ? `<label for="debtMethodV10">Способ оплаты</label><select id="debtMethodV10"><option value="cash">Наличные</option><option value="terminal">Терминал</option><option value="owner_card">Перевод на карту начальника</option><option value="mixed">Смешанная оплата</option></select><div id="debtAllocationV43" class="pay-allocation-v5 hidden"><div><label for="debtCashV43">Наличные, ₽</label><input id="debtCashV43" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(debt).toFixed(2)}"></div><div><label for="debtTerminalV43">Терминал, ₽</label><input id="debtTerminalV43" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"></div><div><label for="debtOwnerCardV43">Перевод на карту начальника, ₽</label><input id="debtOwnerCardV43" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"></div></div><p id="debtAllocationStatusV43" class="small hidden" role="status" aria-live="polite"></p><label for="debtTenderV10">Получено наличными для расчёта сдачи, ₽</label><input id="debtTenderV10" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(debt).toFixed(2)}"><label for="debtNoteV10">Комментарий</label><input id="debtNoteV10">` : `<label for="debtDateV29">Дата погашения</label><input id="debtDateV29" type="date" value="${esc(localDateValue())}"><label for="debtPurposeV29">За что получена оплата *</label><textarea id="debtPurposeV29" class="debt-purpose-v29" maxlength="1000">${esc(purpose)}</textarea>`}<label class="payment-confirm-v5"><input id="debtConfirmV10" type="checkbox"><span>Подтверждаю полученную оплату</span></label><button type="button" class="btn primary wide" onclick="saveDebtPaymentV10()">${pending ? 'Сохранить оплату' : 'Сохранить погашение долга'}</button><div id="debtMessageV10" role="status" aria-live="polite"></div></div><button type="button" class="btn secondary" onclick="${returnToDebts?'openDebtsV10()':patientId?`openPatient('${esc(patientId)}')`:"show('workspace')"}">${returnToDebts?'Назад к долгам':patientId?'Назад к пациенту':'Назад'}</button>`;
  host.querySelectorAll('input,select,textarea').forEach(input => input.addEventListener('input',() => { if (input.id !== 'debtConfirmV10') $('debtConfirmV10').checked = false; }));
  let refreshPaymentMethodV43;
  if (pending) {
   const choice = new Option('Выберите способ оплаты','',true,true); choice.disabled = true;
   $('debtMethodV10').prepend(choice);
   $('debtMethodV10').value = '';
   const summary = document.createElement('p'); summary.id = 'debtMethodSummaryV44'; summary.className = 'small'; summary.setAttribute('role','status'); summary.setAttribute('aria-live','polite');
   $('debtMethodV10').after(summary);
   let tenderEdited = false;
   refreshPaymentMethodV43 = (syncTender = true) => {
    const method = $('debtMethodV10').value, mixed = method === 'mixed';
    const label = {cash:'Наличные',terminal:'Терминал',owner_card:'Перевод на карту начальника',mixed:'Смешанная оплата'}[method];
    try {
     summary.textContent = label ? (mixed ? ['Наличные','Терминал','Перевод на карту начальника'].map((name,index) => {
      const value = allocationCents($(['debtCashV43','debtTerminalV43','debtOwnerCardV43'][index]).value,name);
      return value ? `${name}: ${rub(value / 100)}` : '';
     }).filter(Boolean).join(' · ') : `${label}: ${rub(allocationCents($('debtAmountV10').value,'Получено сейчас') / 100)}`) : 'Выберите способ оплаты перед сохранением.';
    } catch (error) { summary.textContent = error.message; }
    $('debtAllocationV43').classList.toggle('hidden',!mixed);
    $('debtAllocationStatusV43').classList.toggle('hidden',!mixed);
    const cashValue = method === 'cash' ? $('debtAmountV10').value : mixed ? $('debtCashV43').value : '0';
    const hasCash = method === 'cash' || (mixed && Number(String(cashValue).replace(',','.')) > 0);
    $('debtTenderV10').classList.toggle('hidden',!hasCash);
    $('debtTenderV10').previousElementSibling.classList.toggle('hidden',!hasCash);
    if (syncTender && !tenderEdited) $('debtTenderV10').value = hasCash ? cashValue : '0.00';
    if (mixed) {
     try {
      const total = allocationCents($('debtCashV43').value,'Наличные') + allocationCents($('debtTerminalV43').value,'Терминал') + allocationCents($('debtOwnerCardV43').value,'Перевод на карту начальника');
      const paid = allocationCents($('debtAmountV10').value,'Получено сейчас');
      $('debtAllocationStatusV43').textContent = `Распределено: ${rub(total / 100)} из ${rub(paid / 100)}${total === paid ? '' : '. Суммы по способам оплаты должны совпадать с полученной оплатой'}`;
     } catch (error) { $('debtAllocationStatusV43').textContent = error.message; }
    }
   };
   $('debtTenderV10').addEventListener('input',() => { tenderEdited = true; });
   ['debtAmountV10','debtCashV43','debtTerminalV43','debtOwnerCardV43'].forEach(id => $(id).addEventListener('input',() => refreshPaymentMethodV43()));
   $('debtMethodV10').addEventListener('change',() => { refreshPaymentMethodV43(); $('debtConfirmV10').checked = false; });
  }
  if (retry) {
   $('debtAmountV10').value = amount(retry.paid);
   if (pending) {
    const payments = retry.payload.payments;
    $('debtTenderV10').value = String(payments.cash_received);
    $('debtCashV43').value = String(payments.cash || 0); $('debtTerminalV43').value = String(payments.terminal || 0); $('debtOwnerCardV43').value = String(payments.owner_card || 0);
    $('debtMethodV10').value = [payments.cash,payments.terminal,payments.owner_card].filter(value => Number(value) > 0).length > 1 ? 'mixed' : payments.cash > 0 ? 'cash' : payments.terminal > 0 ? 'terminal' : 'owner_card';
    $('debtNoteV10').value = retry.payload.comment || '';
   } else { $('debtDateV29').value = retry.payload.paid_on; $('debtPurposeV29').value = retry.payload.purpose; }
   $('debtConfirmV10').checked = true;
   host.querySelectorAll('input,select,textarea').forEach(input => input.disabled = true);
   message('debtMessageV10','Предыдущее сохранение оплаты ещё не подтверждено. Повторите сохранение — отправим первоначальную оплату без дубля.');
  }
  if (pending) refreshPaymentMethodV43(!retry);
  show('debtPaymentV10');
 };
 global.openSavedPaymentV14 = function(kind,id,amount,patientId,pending=false) {
  global.openDebtPaymentV10(kind,id,amount,patientId,false,pending);
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
    const pending = host.dataset.pending === 'true';
    const paid = cents($('debtAmountV10').value), remaining = cents(host.dataset.debt);
    if (!paid || paid > remaining) throw Error('Укажите оплату больше нуля и не больше оставшейся суммы');
    if (!$('debtConfirmV10').checked) throw Error('Проверьте оплату и отметьте подтверждение');
    let payload = {kind:host.dataset.kind,id:host.dataset.recordId};
    if (pending) {
     if (!shift?.id) throw Error('Для обычной оплаты после процедуры откройте свою смену');
     const method = $('debtMethodV10').value;
     if (!['cash','terminal','owner_card','mixed'].includes(method)) throw Error('Выберите способ оплаты');
     const cash = method === 'mixed' ? allocationCents($('debtCashV43').value,'Наличные') : method === 'cash' ? paid : 0;
     const terminal = method === 'mixed' ? allocationCents($('debtTerminalV43').value,'Терминал') : method === 'terminal' ? paid : 0;
     const ownerCard = method === 'mixed' ? allocationCents($('debtOwnerCardV43').value,'Перевод на карту начальника') : method === 'owner_card' ? paid : 0;
     if (cash + terminal + ownerCard !== paid) throw Error('Суммы по способам оплаты должны совпадать с полученной оплатой');
     const tender = cash > 0 ? cents($('debtTenderV10').value,'Получено наличными') : 0;
     if (tender < cash) throw Error('Получено наличными меньше наличной части оплаты');
     const nurseId = [shift.aId,shift.bId].includes(currentStaff.id) ? currentStaff.id : shift.aId;
     payload = {...payload,shift_id:shift.id,nurse_id:nurseId,payments:{cash:cash / 100,terminal:terminal / 100,owner_card:ownerCard / 100,cash_received:tender / 100},comment:$('debtNoteV10').value.trim() || null};
    } else {
     const paidOn = $('debtDateV29').value, purpose = $('debtPurposeV29').value.trim();
     const parsedDate = new Date(paidOn + 'T12:00:00Z');
     const validDate = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && Number.isFinite(+parsedDate) && parsedDate.toISOString().slice(0,10) === paidOn;
     if (!validDate) throw Error('Укажите корректную дату погашения');
     if (!purpose || purpose.length > 1000) throw Error('Укажите, за что получена оплата (до 1000 символов)');
     payload = {...payload,amount:paid / 100,paid_on:paidOn,purpose};
    }
    snapshot = {paid,remaining,pending,payload};
   }
   debtBusy = true; host.querySelectorAll('button,input,select,textarea').forEach(input => input.disabled = true);
   const receipt = await clinicalRpc('debt_payment',snapshot.payload,true);
   assertActor(actor); committed = true; pendingPayments16.delete(key); $('debtConfirmV10').checked = false;
   const patient = host.dataset.patientId, returnToDebts=host.dataset.returnToDebts==='true',returnToJournal=host.dataset.returnToJournal; host.innerHTML = '';
   if(!quickNavigationCurrent4(navigation,currentStaff?.id))return;
   const success = (snapshot.pending ? 'Оплата сохранена в смене.' : 'Погашение долга сохранено отдельно от смены.') + ' Осталось: ' + rub(receipt?.debt_total ?? (snapshot.remaining - snapshot.paid) / 100);
   try {
    let journalRefreshed = null, journalNavigation = null;
    if(returnToJournal){const journalRefresh=global.openShiftJournalV12(returnToJournal);journalNavigation=quickNavigation4;journalRefreshed=await journalRefresh;}else if(returnToDebts)await global.openDebtsV10();else if(patient)await openPatient(patient);else{show('workspace');await refreshDashboard();}
    if (actor === actorKey()) {
     if(returnToJournal&&(!quickNavigationCurrent4(journalNavigation,currentStaff?.id)||!$('shiftJournalV12')?.classList.contains('active')||$('journalDateV12')?.value!==returnToJournal))return;
     const refreshWarning = journalRefreshed === false ? ($('journalMessageV12')?.textContent || 'Нажмите «Обновить».') : '';
     message(returnToJournal?'journalMessageV12':returnToDebts?'debtsMessageV10':patient?'patientCardMessageV5':'homeMessage',success + (refreshWarning ? ' Журнал не обновлён: ' + refreshWarning : ''),!refreshWarning);
    }
   } catch (error) { if (actor === actorKey()) { show('workspace'); message('homeMessage',success + '. Не удалось обновить экран: ' + error.message,true); } }
  } catch (error) {
   if (actor === actorKey()) {
    if (!committed && snapshot && (pendingPayments16.has(key) || financeRetryableErrorV16(error,error.status))) { pendingPayments16.set(key,snapshot); error = saveError({...error,uncertain:true,message:error.message},error.status); }
    message(committed ? 'homeMessage' : 'debtMessageV10',committed ? 'Оплата сохранена. Не удалось обновить экран: ' + error.message : error.message);
   }
  }
  finally { debtBusy = false; if (actor === actorKey()) host.querySelectorAll('button,input,select,textarea').forEach(input => input.disabled = pendingPayments16.has(key) && input.tagName !== 'BUTTON'); }
 };
 function treatmentEvents(data) { return Array.isArray(data) ? data : data?.events || [...(data?.procedures || []).map(event => ({...event,kind:'procedure'})),...(data?.sales || []).map(event => ({...event,kind:'sale'}))].sort((a,b) => new Date(b.at || b.visit_at || b.sold_at) - new Date(a.at || a.visit_at || a.sold_at)); }
 let debtView = 0, debtHistoryView = 0;
 function debtHistoryDateV29(value) {
  const date = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('.') : 'Дата не указана';
 }
 global.openDebtHistoryV29 = async function(patientId = null) {
  const scopedPatient = typeof patientId === 'string' && patientId ? patientId : null;
  if (!currentStaff?.id || (!isManager() && !scopedPatient)) {
   if ($('debtHistoryV29Screen')?.classList.contains('active')) show('workspace');
   message('homeMessage','Полная история погашений доступна только владельцу. Историю пациента можно открыть в его карточке.'); return;
  }
  const navigation = beginQuickNavigation4(), actor = actorKey(), view = ++debtHistoryView;
  let host = $('debtHistoryV29Screen'); if (!host) { host = document.createElement('section'); host.id = 'debtHistoryV29Screen'; host.className = 'screen debt-history-v29'; $('workspace').parentElement.appendChild(host); }
  host.dataset.patientId = scopedPatient || '';
  host.innerHTML = '<div class="row between"><h1>Погашения долгов</h1><button type="button" id="debtHistoryBackV29" class="btn secondary">Назад</button></div><p class="small">Погашения учитываются отдельно от дохода и кассы смены.</p><div id="debtHistoryMessageV29" role="status" aria-live="polite">Загружаем…</div><div id="debtHistoryBodyV29"></div>';
  $('debtHistoryBackV29').onclick = () => scopedPatient ? openPatient(scopedPatient) : global.openDebtsV10();
  show('debtHistoryV29Screen');
  const current = () => actor === actorKey() && view === debtHistoryView && quickNavigationCurrent4(navigation,currentStaff?.id) && (isManager() || !!scopedPatient);
  try {
   const data = await clinicalRpc('debt_history',scopedPatient ? {patient_id:scopedPatient} : {});
   if (!current()) return;
   const items = Array.isArray(data) ? data : data?.items || [];
   $('debtHistoryBodyV29').innerHTML = items.map(item => `<article class="item"><div class="row between"><strong>${esc(rub(item.amount ?? item.paid_total))}</strong><time>${esc(debtHistoryDateV29(item.paid_on))}</time></div><p>${esc(item.purpose || 'Назначение не указано')}</p></article>`).join('') || '<p class="small">Погашений пока нет.</p>';
   $('debtHistoryMessageV29').textContent = '';
  } catch (error) {
   if (!current()) return;
   $('debtHistoryMessageV29').textContent = error.message;
   const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn secondary wide'; retry.textContent = 'Повторить'; retry.onclick = () => global.openDebtHistoryV29(scopedPatient); $('debtHistoryMessageV29').appendChild(retry);
  }
 };
 global.openDebtsV10 = async function() {
  if (!isManager()) { message('homeMessage','Список всех долгов доступен только владельцу'); return; }
  beginQuickNavigation4(); const actor = actorKey(), view = ++debtView;
  let host = $('debtsV10'); if (!host) { host = document.createElement('section'); host.id = 'debtsV10'; host.className = 'screen'; $('workspace').parentElement.appendChild(host); }
  host.innerHTML = '<div class="row between"><h1>Долги</h1><button type="button" class="btn secondary" onclick="show(\'workspace\')">Назад</button></div><div id="debtsMessageV10" role="status">Загружаем…</div><div id="debtsBodyV10"></div>';
  show('debtsV10');
  try {
   const data = await clinicalRpc('debts');
   if (!isManager() || actor !== actorKey() || view !== debtView) return;
   const events = (Array.isArray(data) ? data : data?.debts || data?.events || treatmentEvents(data)).filter(event => event.payment_pending !== true), total = events.reduce((sum,event) => sum + Math.round(num(event.debt_total) * 100),0);
   events.forEach(rememberDebtPurposeV29);
   $('debtsBodyV10').innerHTML = `<button type="button" id="debtHistoryOpenV29" class="btn secondary wide" onclick="openDebtHistoryV29()">Погашения долгов</button><div class="card">Всего в долг: <b>${rub(total / 100)}</b></div>${events.map(event => `<div class="item clinical-history-v10"><strong>${esc(event.patient || event.patient_name || (event.kind === 'sale' ? 'Продажа без пациента' : 'Пациент'))}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)} · ${esc(event.procedure_type || (event.kind === 'sale' ? 'Продажа' : 'Процедура'))}</div><div>Долг: <b>${rub(event.debt_total)}</b></div><button type="button" class="btn primary wide" onclick="openDebtPaymentV10('${esc(event.kind)}','${esc(event.id)}',${Number(event.debt_total)},'${esc(event.patient_id || '')}',true)">Принять оплату долга</button></div>`).join('') || '<p>Долгов нет.</p>'}`;
   $('debtsMessageV10').textContent = '';
  } catch (error) { if (isManager() && actor === actorKey() && view === debtView) $('debtsMessageV10').innerHTML = `${esc(error.message)}<button type="button" class="btn secondary wide" onclick="openDebtsV10()">Повторить</button>`; }
 };
 const homeBase = renderCabinetHomeV5;
 renderCabinetHomeV5 = function() { homeBase(); if (!isManager()) return; const actions = $('workspace').querySelector('.home-actions'); if (actions && !$('homeDebtsV10')) { const button = document.createElement('button'); button.id = 'homeDebtsV10'; button.innerHTML = '<span>🧾</span><strong>Долги и погашения</strong>'; button.onclick = global.openDebtsV10; actions.appendChild(button); } };
 const showBase = show;
 show = function(id) { if (id === 'debtsV10' && !isManager()) { message('homeMessage','Список всех долгов доступен только владельцу'); id = 'workspace'; } if (id === 'debtHistoryV29Screen' && (!currentStaff?.id || (!isManager() && !$('debtHistoryV29Screen')?.dataset.patientId))) id = 'workspace'; showBase(id); };
 const signOutBase = signOut;
 signOut = async function() { session++; patientView++; editorView++; repeatView++; repeatPreparationV33 = null; $('procedure').inert = false; $('procedure').removeAttribute('aria-busy'); debtView++; debtHistoryView++; forms.proc = null; forms.sale = null; requests.clear(); ambiguousRequests16.clear(); pendingPayments16.clear(); debtPurposes29.clear(); for (const id of ['patientClinicalV10','debtPaymentV10','debtsV10','debtHistoryV29Screen']) if ($(id)) { $(id).innerHTML = ''; delete $(id).dataset.patientId; } await signOutBase(); };
 global.getClinicalStockRecordV28 = prefix => forms[prefix]?.edit || null;
})(typeof window === 'object' ? window : globalThis);
