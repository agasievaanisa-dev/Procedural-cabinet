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
  if ((status === 'debt' || status === 'pending') && !input.patient) throw Error('Для записи без полной оплаты выберите пациента');
  return {list,charge,previous,received,debt,status:debt > 0 ? (status === 'pending' ? 'pending' : 'debt') : charge === 0 ? 'free' : 'paid',reason};
 }
 function ownedItems(items) {
  return items.map(item => {
   const name = String(item.name || '').trim(), unit = String(item.unit || 'амп.').trim(), quantity = Number(item.quantity);
   if (!name || name.length > 200) throw Error('Укажите название своего препарата длиной до 200 символов');
   if (!Number.isSafeInteger(quantity) || quantity < 1) throw Error('Количество своего препарата должно быть целым и больше нуля');
   if (!['patient','previously_purchased'].includes(item.source)) throw Error('Укажите, откуда препарат пациента');
   if (!unit || unit.length > 30) throw Error('Укажите единицу своего препарата');
   return {name,quantity,unit,source:item.source};
  });
 }
 const helpers = {cents,paymentModel,ownedItems};
 if (typeof module === 'object' && module.exports) module.exports = helpers;
 if (typeof document === 'undefined') return;
 global.CrmClinicalV10 = helpers;
 const forms = {proc:null,sale:null}, requests = new Map();
 let session = 0, patientView = 0, editorView = 0, debtBusy = false;
 const amount = value => (value / 100).toFixed(2);
 const state = prefix => forms[prefix];
 function actorKey() { return JSON.stringify([currentStaff?.id,currentStaff?.role,session]); }
 function assertActor(actor) { if (!currentStaff?.id || actorKey() !== actor) throw Error('Учётная запись изменилась. Откройте форму заново'); }
 async function clinicalRpc(action, payload = {}, mutate = false) {
  const actor = actorKey(), key = JSON.stringify([actor,action,payload]);
  if (mutate && !requests.has(key)) requests.set(key, crypto.randomUUID());
  let response;
  try { response = await db.rpc('crm_clinical_v10', {p_action:action,p_payload:payload,p_request_id:mutate ? requests.get(key) : null}); }
  catch (error) { throw Error(financeNetworkErrorV5(error) ? 'Не удалось получить ответ. Черновик сохранён; повторите с теми же данными.' : error.message); }
  assertActor(actor);
  if (response?.error) {
   if (mutate && /^[0-9A-Z]{5}$/.test(response.error.code || '')) requests.delete(key);
   throw Error(financeNetworkErrorV5(response.error,response.status) ? 'Не удалось получить ответ. Черновик сохранён; повторите с теми же данными.' : response.error.message || 'Не удалось выполнить действие');
  }
  if (!response) throw Error('Не удалось получить ответ. Повторите действие');
  if (mutate) requests.delete(key);
  return response.data;
 }
 function servicePrice(prefix, id) {
  const snapshot = state(prefix)?.servicePrices?.get(id), service = services.find(s => s.id === id);
  return snapshot ?? Math.round((num(service?.work_price) + num(service?.consumables_price)) * 100);
 }
 function selectedServices() {
  const primary = $('procService')?.value;
  return (primary ? [{service_id:primary,quantity:1}] : []).concat([...$('procAdditionalServicesV10').querySelectorAll('.clinical-service-v10')].map(row => ({service_id:row.querySelector('select').value,quantity:Number(row.querySelector('input').value)})).filter(item => item.service_id));
 }
 function listCents(prefix) {
  const medicines = rows(prefix + 'Meds').reduce((sum,item) => {
   const price = state(prefix)?.medicationPrices?.get(item.medication_id) ?? Math.round(num(meds.find(m => m.id === item.medication_id)?.sale_price) * 100);
   return sum + price * Number(item.quantity);
  },0);
  return medicines + (prefix === 'proc' ? selectedServices().reduce((sum,item) => sum + servicePrice(prefix,item.service_id) * item.quantity,0) : 0);
 }
 function clearConfirmation(prefix) { if ($(prefix + 'PayConfirmed')) $(prefix + 'PayConfirmed').checked = false; }
 function chargeChanged(prefix) {
  if (!state(prefix)) return;
  state(prefix).chargeEdited = true; clearConfirmation(prefix); calculate(prefix,false);
 }
 function paymentStatusChanged(prefix) {
  const s = state(prefix); if (!s) return;
  const status = $(prefix + 'PaymentStatusV10').value;
  if (status === 'free') { $(prefix + 'Paid').value = '0.00'; s.chargeEdited = true; $(prefix + 'ReceivedV10').value = '0.00'; }
  else if ($(prefix + 'Paid').value === '0.00' && !s.edit) { s.chargeEdited = false; $(prefix + 'Paid').value = amount(listCents(prefix)); }
  if (status === 'debt' || status === 'pending') $(prefix + 'ReceivedV10').value = '0.00';
  clearConfirmation(prefix); discountVisibility(prefix); syncPaymentV5(prefix,true);
 }
 function install(prefix) {
  installPaymentControlsV5(prefix);
  if ($(prefix + 'ClinicalV10')) return;
  const paid = $(prefix + 'Paid'), host = document.createElement('div');
  host.id = prefix + 'ClinicalV10'; host.className = 'clinical-payment-v10';
  host.innerHTML = `<label for="${prefix}PaymentStatusV10">Вариант оплаты</label><select id="${prefix}PaymentStatusV10"><option value="paid">Полностью оплачено</option><option value="debt">В долг / частично оплачено</option><option value="free">Бесплатно</option></select><div id="${prefix}ReceivedBoxV10" class="hidden"><label for="${prefix}ReceivedV10">Оплачено сейчас, ₽</label><input id="${prefix}ReceivedV10" type="number" inputmode="decimal" min="0" step="0.01" value="0.00"></div><div id="${prefix}DebtSummaryV10" class="small" role="status" aria-live="polite"></div><div id="${prefix}EditReasonBoxV10" class="hidden"><label for="${prefix}EditReasonV10">Что изменили и почему *</label><textarea id="${prefix}EditReasonV10"></textarea></div>`;
  paid.after(host); paid.previousElementSibling.textContent = 'Стоимость с учётом скидки, ₽'; paid.removeAttribute('oninput');
  $(prefix + 'PaymentStatusV10').add(new Option('Оплатит после процедуры','pending'),1);
  const debtHint = document.createElement('p'); debtHint.id = prefix + 'DebtHintV13'; debtHint.className = 'notice hidden';
  debtHint.textContent = 'Скидку можно сохранить и без оплаты. Укажите стоимость после скидки и её причину. Если деньги не получены, оставьте «Оплачено сейчас» равным 0: вся стоимость сохранится в долг.';
  $(prefix + 'PaymentStatusV10').after(debtHint);
  paid.addEventListener('input',() => chargeChanged(prefix));
  $(prefix + 'PaymentStatusV10').addEventListener('change',() => paymentStatusChanged(prefix));
  $(prefix + 'ReceivedV10').addEventListener('input',() => { clearConfirmation(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountComment').addEventListener('input',() => { clearConfirmation(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountReason').removeAttribute('onchange');
  $(prefix + 'DiscountReason').addEventListener('change',() => { clearConfirmation(prefix); discountVisibility(prefix); syncPaymentV5(prefix); });
  $(prefix + 'DiscountComment').previousElementSibling.textContent = 'Почему стоимость отличается от прайса / бесплатно *';
  const inline = document.createElement('div'); inline.className = 'clinical-discount-inline-v11';
  inline.innerHTML = `<label for="${prefix}ChargeInPaymentV11">Стоимость с учётом скидки (включая долг), ₽</label><input id="${prefix}ChargeInPaymentV11" type="number" inputmode="decimal" min="0" step="0.01"><div id="${prefix}DiscountInPaymentBoxV11" class="hidden"><label for="${prefix}DiscountInPaymentV11">Причина изменения стоимости / бесплатно *</label><textarea id="${prefix}DiscountInPaymentV11" placeholder="Например: скидка от начальника"></textarea></div>`;
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
   if (notice) notice.textContent = 'Стоимость по прайсу рассчитана автоматически. При скидке или бесплатной процедуре укажите комментарий.';
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
  row.innerHTML = `<label>Название препарата<input class="own-name-v10" aria-label="Название своего препарата" maxlength="200" placeholder="Название и дозировка" value="${esc(item.name || '')}"></label><label>Откуда препарат<select class="own-source-v10" aria-label="Откуда препарат"><option value="patient">Принёс пациент</option><option value="previously_purchased">Ранее куплен у нас</option></select></label><div class="grid2"><label>Количество<input class="own-quantity-v10" aria-label="Количество своего препарата" type="number" min="1" step="1" inputmode="numeric" value="${Number(item.quantity || 1)}"></label><label>Единица<input class="own-unit-v10" aria-label="Единица своего препарата" maxlength="30" value="${esc(item.unit || 'амп.')}"></label></div><button type="button" class="btn danger" aria-label="Убрать свой препарат">Убрать</button>`;
  row.querySelector('select').value = item.source || 'patient';
  row.addEventListener('input',() => clearConfirmation('proc')); row.addEventListener('change',() => clearConfirmation('proc'));
  row.querySelector('button').onclick = () => { row.remove(); clearConfirmation('proc'); };
  $('procOwnMedsV10').appendChild(row); clearConfirmation('proc');
 }
 function readOwn() { return ownedItems([...$('procOwnMedsV10').querySelectorAll('.clinical-own-v10')].map(row => ({name:row.querySelector('.own-name-v10').value,quantity:row.querySelector('.own-quantity-v10').value,unit:row.querySelector('.own-unit-v10').value,source:row.querySelector('.own-source-v10').value}))); }
 function calculate(prefix, update = true) {
  const s = state(prefix); if (!s) return;
  const total = listCents(prefix); $(prefix + 'List').textContent = rub(total / 100);
  if ((!s.chargeEdited && update) || $(prefix + 'Paid').value === '') $(prefix + 'Paid').value = amount(total);
  if (prefix === 'proc') $('servicePriceInfo').textContent = 'Работа и расходники выбранных процедур: ' + rub(selectedServices().reduce((sum,item) => sum + servicePrice(prefix,item.service_id) * item.quantity,0) / 100);
  discountVisibility(prefix); syncPaymentV5(prefix);
 }
 function receivedCents(prefix) {
  const s = state(prefix), status = $(prefix + 'PaymentStatusV10').value, charge = cents($(prefix + 'Paid').value || '0');
  return status === 'free' ? 0 : status === 'debt' || status === 'pending' ? cents($(prefix + 'ReceivedV10').value,'Оплата сейчас') : Math.max(0,charge - (s?.previous || 0));
 }
 function currentModel(prefix) {
  const s = state(prefix); if (!s) throw Error('Откройте форму заново');
  return paymentModel({list:amount(listCents(prefix)),charge:$(prefix + 'Paid').value,previous:amount(s.previous || 0),received:amount(receivedCents(prefix)),status:$(prefix + 'PaymentStatusV10').value,reason:$(prefix + 'DiscountComment').value,patient:$(prefix + 'Patient').value});
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
  $(prefix + 'EditReasonBoxV10').classList.add('hidden'); clearConfirmation(prefix); $(prefix + 'Paid').readOnly = false;
  if (prefix === 'sale') { $('saleReserveV5').checked = false; $('reserveSaleOptionV5').classList.toggle('hidden',!isManager() || isPaymentOnlyV5('sale')); }
  calculate(prefix);
 };
 syncPaymentV5 = function(prefix, force = false) {
  const s = state(prefix), pay = financePaymentState5[prefix]; if (!s || !pay || !$(prefix + 'ClinicalV10')) return;
  let total = null; try { total = receivedCents(prefix); } catch {}
  if (pay.total !== total || force) {
   clearConfirmation(prefix);
   if (pay.method !== 'mixed' || force) for (const [suffix,method] of [['Cash','cash'],['Terminal','terminal'],['OwnerCard','owner_card']]) $(prefix + 'Pay' + suffix).value = amount(pay.method === method || (pay.method === 'mixed' && method === 'cash') ? total || 0 : 0);
   pay.total = total;
  }
  $(prefix + 'PayAllocation').classList.toggle('hidden',pay.method !== 'mixed');
  $(prefix + 'PaymentV5').querySelectorAll('[data-pay-method]').forEach(button => { const selected = button.dataset.payMethod === pay.method; button.setAttribute('aria-pressed',String(selected)); button.classList.toggle('primary',selected); button.classList.toggle('secondary',!selected); });
  let cash = 0; try { cash = cents($(prefix + 'PayCash').value); } catch {}
  if (!pay.tenderEdited) $(prefix + 'PayTender').value = amount(cash);
  $(prefix + 'PayTenderBox').classList.toggle('hidden',total === 0 || (cash === 0 && pay.method !== 'cash' && pay.method !== 'mixed'));
  const paymentStatus = $(prefix + 'PaymentStatusV10').value,pendingSelected = paymentStatus === 'pending';
  $(prefix + 'ReceivedBoxV10').classList.toggle('hidden',paymentStatus !== 'debt' && !pendingSelected);
  const debtSelected = $(prefix + 'PaymentStatusV10').value === 'debt';
  $(prefix + 'DebtHintV13').classList.toggle('hidden',!debtSelected && !pendingSelected);
  $(prefix + 'DebtHintV13').textContent = pendingSelected ? 'Сохраните процедуру с оплатой сейчас 0 ₽ и переходите к следующему пациенту. Когда пациент оплатит, откройте журнал смены или его карточку и нажмите «Принять оплату».' : 'Скидку можно сохранить и без оплаты. Укажите стоимость после скидки и её причину. Если деньги не получены, оставьте «Оплачено сейчас» равным 0: вся стоимость сохранится в долг.';
  $(prefix + 'PaymentV5').querySelector('h2').textContent = 'Стоимость и оплата';
  $(prefix + 'PayConfirmed').nextElementSibling.textContent = 'Подтверждаю стоимость, оплату и остаток долга';
  const kind = prefix === 'proc' ? 'procedure' : 'sale';
  const saveButton = document.querySelector('#' + kind + ' button[onclick="' + (prefix === 'proc' ? 'saveProcedure()' : 'saveSale()') + '"]');
  if (saveButton) saveButton.textContent = pendingSelected && total === 0 ? 'Сохранить без оплаты' : prefix === 'proc' ? (debtSelected ? 'Сохранить процедуру в долг' : 'Сохранить процедуру') : (debtSelected ? 'Сохранить продажу в долг' : 'Сохранить продажу');
  let unpaidBalance = 0; try { unpaidBalance = cents($(prefix + 'Paid').value || '0') - (s.previous || 0); } catch {}
  $(prefix + 'SavePendingV14').classList.toggle('hidden',pendingSelected || paymentStatus === 'free' || unpaidBalance <= 0);
  $(prefix + 'ReceivedV10').previousElementSibling.textContent = s.edit ? 'Доплата сейчас, ₽' : 'Оплачено сейчас, ₽';
  try { const m = currentModel(prefix); $(prefix + 'DebtSummaryV10').textContent = `По прайсу: ${rub(m.list / 100)}. Скидка: ${rub(Math.max(0,m.list - m.charge) / 100)}. К оплате с учётом скидки: ${rub(m.charge / 100)}. ${s.edit ? 'Ранее оплачено: ' + rub(m.previous / 100) + '. ' : ''}Оплата сейчас: ${rub(m.received / 100)}. ${m.status === 'pending' ? 'Ожидает оплаты' : 'Долг'}: ${rub(m.debt / 100)}${m.status === 'free' ? '. Бесплатно' : ''}`; }
  catch (error) { $(prefix + 'DebtSummaryV10').textContent = error.message; }
  inlinePayment(prefix); renderPaymentSummaryV5(prefix);
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
  forms[prefix] = {chargeEdited:false,previous:0,edit:null,medicationPrices:new Map(),servicePrices:new Map()};
  install(prefix);
  if (prefix === 'proc') { $('procAdditionalServicesV10').innerHTML = ''; $('procOwnMedsV10').innerHTML = ''; }
  const ready = await prepareBase(kind,patientId,navigation);
  if (!quickNavigationCurrent4(navigation,actor)) return false;
  if (ready) { $(kind).querySelector('h1').textContent = kind === 'procedure' ? 'Новая процедура' : 'Продажа препаратов'; $('repeatHint')?.classList.remove('hidden'); $(prefix + 'Patient').disabled = false; $(prefix + 'Nurse').disabled = false; }
  return ready;
 };
 saveTreatment = async function(kind) {
  if (clinicalBusy) return;
  const prefix = kind === 'procedure' ? 'proc' : 'sale', actor = actorKey();
  let saved = false;
  try {
   const s = state(prefix); if (!s) throw Error('Откройте форму заново');
   if (!s.edit && !shift?.id) throw Error('Сначала откройте смену');
   if (kind === 'procedure' && (!$('procPatient').value || !$('procService').value)) throw Error('Выберите пациента и услугу');
   const selected = rows(prefix + 'Meds');
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
   const model = currentModel(prefix), payments = readPaymentsV5(prefix,!(model.status === 'pending' && model.received === 0));
   if (model.status === 'pending' && model.received === 0) $(prefix + 'PayConfirmed').checked = true;
   const allServices = kind === 'procedure' ? selectedServices() : [];
   allServices.forEach(item => positiveWhole(item.quantity,'Количество процедур'));
   const payload = {shift_id:s.edit?.shift_id || shift.id,nurse_id:$(prefix + 'Nurse').value,patient_id:$(prefix + 'Patient').value || null,service_id:kind === 'procedure' ? $('procService').value : null,services:allServices,own_medications:kind === 'procedure' ? readOwn() : [],items:selected,charge_total:model.charge / 100,paid_total:model.received / 100,payment_status:model.status,payments,discount_reason:$(prefix + 'DiscountReason').value || (model.charge !== model.list ? 'Корректировка стоимости' : null),discount_comment:model.reason || null,notes:$(prefix + 'Notes').value.trim() || null,expected_stock_deducted:!paymentOnly};
   if (!paymentOnly && kind === 'sale' && isManager() && $('saleReserveV5')?.checked) payload.reserve_sale = true;
   if (s.edit && model.received > 0 && shift?.id && shift.id !== s.edit.shift_id) { payload.payment_shift_id=shift.id; payload.payment_nurse_id=[shift.aId,shift.bId].includes(currentStaff.id)?currentStaff.id:shift.aId; }
   if (s.edit) { payload.kind = kind; payload.id = s.edit.id; payload.expected_version = s.edit.version; payload.edit_reason = $(prefix + 'EditReasonV10').value.trim(); if (!payload.edit_reason) throw Error('Укажите, что изменили в процедуре и почему'); }
   clinicalBusy = true;
   document.querySelectorAll('#' + kind + ' button,#' + kind + ' input,#' + kind + ' select,#' + kind + ' textarea').forEach(element => element.disabled = true);
   message(kind + 'Message','Сохраняем…');
   const receipt = s.edit ? await clinicalRpc('treatment_edit',payload,true) : await treatmentRpc(kind,payload);
   assertActor(actor); saved = true; forms[prefix] = null; $(prefix + 'Meds').innerHTML = ''; $(prefix + 'Paid').value = '';
   show('workspace');
   message('homeMessage',`${s.edit ? 'Изменения сохранены' : kind === 'procedure' ? 'Процедура сохранена' : 'Продажа сохранена'}. Оплачено: ${rub(receipt?.paid_total ?? (model.previous + model.received) / 100)}. ${model.status === 'pending' ? 'Ожидает оплаты' : 'Долг'}: ${rub(receipt?.debt_total ?? model.debt / 100)}.`,true);
   try { await refreshDashboard(); } catch (error) { message('homeMessage','Запись сохранена. Не удалось обновить экран: ' + error.message); }
  } catch (error) { if (actorKey() === actor) message(saved ? 'homeMessage' : kind + 'Message',error.message); }
  finally { clinicalBusy = false; document.querySelectorAll('#' + kind + ' button,#' + kind + ' input,#' + kind + ' select,#' + kind + ' textarea').forEach(element => element.disabled = false); if (state(prefix)?.edit) { $(prefix + 'Patient').disabled = true; $(prefix + 'Nurse').disabled = true; } }
 };
 const treatmentBase = treatmentRpc;
 async function saveWithoutPayment(kind) {
  const prefix = kind === 'procedure' ? 'proc' : 'sale';
  if (clinicalBusy || !state(prefix)) return;
  $(prefix + 'PaymentStatusV10').value = 'pending'; $(prefix + 'ReceivedV10').value = '0.00';
  syncPaymentV5(prefix,true); $(prefix + 'PayConfirmed').checked = true;
  await saveTreatment(kind);
 }
 global.saveProcedureWithoutPaymentV14 = () => saveWithoutPayment('procedure');
 global.saveSaleWithoutPaymentV14 = () => saveWithoutPayment('sale');
 treatmentRpc = async function(kind,payload) { try { return await treatmentBase(kind,payload); } catch (error) { if (financeNetworkErrorV5(error)) throw Error('Не удалось получить ответ. Черновик сохранён; повторите с теми же данными.'); throw error; } };
 global.editTreatmentV10 = async function(kind,id) {
  if (clinicalBusy) return;
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
   (record.items || []).forEach(item => addMedRow(prefix + 'Meds',item.medication_id,item.quantity,{id:item.medication_id,name:item.name,consumption_unit:item.unit}));
   $(prefix + 'Notes').value = record.notes || ''; $(prefix + 'DiscountReason').value = record.discount_reason || ''; $(prefix + 'DiscountComment').value = record.discount_comment || '';
   $(prefix + 'Paid').value = amount(cents(record.charge_total ?? record.paid_total ?? 0)); resetPaymentV5(prefix); $(prefix + 'Paid').value = amount(cents(record.charge_total ?? record.paid_total ?? 0));
   $(prefix + 'PaymentStatusV10').value = num(record.debt_total) > 0 ? (record.payment_pending ? 'pending' : 'debt') : num(record.charge_total ?? record.paid_total) === 0 ? 'free' : 'paid'; $(prefix + 'ReceivedV10').value = '0.00'; $(prefix + 'EditReasonBoxV10').classList.remove('hidden');
   $(kind).querySelector('h1').textContent = kind === 'procedure' ? 'Редактирование процедуры' : 'Редактирование продажи'; show(kind); calculate(prefix,false); renderAccountingModeV5();
   message(kind + 'Message','Сохранённые цены и полученная оплата сохранены. Добавьте нужную процедуру или препарат. Укажите причину изменения.');
  } catch (error) { if (actorKey() === actor) message('patientCardMessageV5',error.message); }
 };
 function dateText(at) { return esc(new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})); }
 global.treatmentActionsHtmlV14 = function(event,fromJournal=false) {
  if (!event.id) return '';
  const kind = event.kind === 'sale' ? 'sale' : 'procedure',remaining = financeEventAmountsV5(event).debt,patientId = event.patient_id || (!fromJournal ? currentPatientId : null);
  const edit = event.editable ? `<button type="button" class="btn secondary" onclick="editTreatmentV10('${esc(kind)}','${esc(event.id)}')">Редактировать</button>` : '';
  const pay = remaining > 0 && patientId ? `<button type="button" class="btn primary" onclick="${fromJournal ? 'openJournalPaymentV14' : 'openSavedPaymentV14'}('${esc(kind)}','${esc(event.id)}',${remaining},'${esc(patientId)}',${event.payment_pending === true})">${event.payment_pending ? 'Принять оплату' : 'Принять оплату долга'}</button>` : '';
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
   host.innerHTML = `<h2>Оплата и изменения</h2>${events.map(event => `<div class="card clinical-history-v10"><strong>${esc(event.kind === 'sale' ? 'Продажа' : event.procedure_type || 'Процедура')}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)}</div>${financeEventPaymentHtmlV5(event)}${(event.own_medications || []).map(item => `<div class="small">${esc(item.name)} × ${qty(item.quantity)} ${esc(item.unit)} · ${item.source === 'previously_purchased' ? 'Ранее куплен у нас' : 'Препарат пациента'}</div>`).join('')}${global.treatmentActionsHtmlV14(event)}</div>`).join('') || '<p class="small">Записей пока нет.</p>'}`;
  } catch (error) { if (version === patientView && id === currentPatientId && actor === actorKey()) host.innerHTML = `<div class="notice">${esc(error.message)}<button type="button" class="btn secondary wide" onclick="loadPatientClinicalV10()">Повторить</button></div>`; }
 };
 const openPatientBase = openPatient;
 openPatient = async function(id) { const actor = actorKey(); await openPatientBase(id); if (actor === actorKey() && currentPatientId === id && $('patientCard').classList.contains('active')) await global.loadPatientClinicalV10(id); };
 global.openDebtPaymentV10 = function(kind,id,debt,patientId=currentPatientId,returnToDebts=false) {
  beginQuickNavigation4();
  let host = $('debtPaymentV10'); if (!host) { host = document.createElement('section'); host.id = 'debtPaymentV10'; host.className = 'screen'; $('workspace').parentElement.appendChild(host); }
  host.dataset.kind = kind; host.dataset.recordId = id; host.dataset.debt = String(debt); host.dataset.patientId = patientId || ''; host.dataset.returnToDebts=String(returnToDebts);
  delete host.dataset.returnToJournal;
  host.innerHTML = `<h1>Оплата долга</h1><div class="card"><p>Осталось оплатить: <b>${rub(debt)}</b></p><label for="debtAmountV10">Получено сейчас, ₽</label><input id="debtAmountV10" type="number" inputmode="decimal" min="0.01" step="0.01" value="${Number(debt).toFixed(2)}"><label for="debtMethodV10">Способ оплаты</label><select id="debtMethodV10"><option value="cash">Наличные</option><option value="terminal">Терминал</option><option value="owner_card">Перевод владельцу</option></select><label for="debtTenderV10">Получено наличными для расчёта сдачи, ₽</label><input id="debtTenderV10" type="number" inputmode="decimal" min="0" step="0.01" value="${Number(debt).toFixed(2)}"><label for="debtNoteV10">Комментарий</label><input id="debtNoteV10"><label class="payment-confirm-v5"><input id="debtConfirmV10" type="checkbox"><span>Подтверждаю полученную оплату</span></label><button type="button" class="btn primary wide" onclick="saveDebtPaymentV10()">Сохранить оплату долга</button><div id="debtMessageV10" role="status" aria-live="polite"></div></div><button type="button" class="btn secondary" onclick="${returnToDebts?'openDebtsV10()':`openPatient('${esc(patientId)}')`}">${returnToDebts?'Назад к долгам':'Назад к пациенту'}</button>`;
  host.querySelectorAll('input,select').forEach(input => input.addEventListener('input',() => { if (input.id !== 'debtConfirmV10') $('debtConfirmV10').checked = false; }));
  let tenderEdited = false;
  $('debtTenderV10').addEventListener('input',() => { tenderEdited = true; });
  $('debtAmountV10').addEventListener('input',() => { if (!tenderEdited) $('debtTenderV10').value = $('debtAmountV10').value; });
  $('debtMethodV10').addEventListener('change',() => { const cash = $('debtMethodV10').value === 'cash'; $('debtTenderV10').classList.toggle('hidden',!cash); $('debtTenderV10').previousElementSibling.classList.toggle('hidden',!cash); $('debtConfirmV10').checked = false; });
  show('debtPaymentV10');
 };
 global.openSavedPaymentV14 = function(kind,id,amount,patientId,pending=false) {
  global.openDebtPaymentV10(kind,id,amount,patientId);
  if (pending) $('debtPaymentV10').querySelector('h1').textContent = 'Оплата процедуры';
 };
 global.openJournalPaymentV14 = function(kind,id,amount,patientId,pending=false) {
  const date = $('journalDateV12')?.value;
  global.openSavedPaymentV14(kind,id,amount,patientId,pending);
  const host = $('debtPaymentV10'); host.dataset.returnToJournal = date || '';
  host.querySelector('.btn.secondary').onclick = () => global.openShiftJournalV12(date);
 };
 global.saveDebtPaymentV10 = async function() {
  if (debtBusy) return; const navigation=quickNavigation4, actor = actorKey(), host = $('debtPaymentV10');
  try {
   if (!shift?.id) throw Error('Для приёма оплаты откройте свою смену');
   const paid = cents($('debtAmountV10').value), remaining = cents(host.dataset.debt), method = $('debtMethodV10').value;
   if (!paid || paid > remaining) throw Error('Укажите оплату больше нуля и не больше оставшегося долга');
   if (!$('debtConfirmV10').checked) throw Error('Проверьте оплату и отметьте подтверждение');
   const tender = method === 'cash' ? cents($('debtTenderV10').value,'Получено наличными') : 0;
   if (method === 'cash' && tender < paid) throw Error('Получено наличными меньше суммы оплаты');
   debtBusy = true; host.querySelectorAll('button,input,select').forEach(input => input.disabled = true);
   const nurseId = [shift.aId,shift.bId].includes(currentStaff.id) ? currentStaff.id : shift.aId;
   const receipt = await clinicalRpc('debt_payment',{kind:host.dataset.kind,id:host.dataset.recordId,shift_id:shift.id,nurse_id:nurseId,payments:{cash:method === 'cash' ? paid / 100 : 0,terminal:method === 'terminal' ? paid / 100 : 0,owner_card:method === 'owner_card' ? paid / 100 : 0,cash_received:tender / 100},comment:$('debtNoteV10').value.trim() || null},true);
   assertActor(actor); $('debtConfirmV10').checked = false;
   const patient = host.dataset.patientId, returnToDebts=host.dataset.returnToDebts==='true',returnToJournal=host.dataset.returnToJournal; host.innerHTML = '';
   if(!quickNavigationCurrent4(navigation,currentStaff?.id))return;
   if(returnToJournal)await global.openShiftJournalV12(returnToJournal);else if(returnToDebts)await global.openDebtsV10();else await openPatient(patient);
   message(returnToJournal?'journalMessageV12':returnToDebts?'debtsMessageV10':'patientCardMessageV5','Оплата сохранена. Осталось: ' + rub(receipt?.debt_total ?? (remaining - paid) / 100),true);
  } catch (error) { if (actor === actorKey()) message('debtMessageV10',error.message); }
  finally { debtBusy = false; host.querySelectorAll('button,input,select').forEach(input => input.disabled = false); }
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
   $('debtsBodyV10').innerHTML = `<div class="card">Всего к оплате: <b>${rub(total / 100)}</b></div>${events.map(event => `<div class="item clinical-history-v10"><strong>${esc(event.patient || event.patient_name || 'Пациент')}</strong><div class="small">${dateText(event.at || event.visit_at || event.sold_at)} · ${esc(event.procedure_type || (event.kind === 'sale' ? 'Продажа' : 'Процедура'))}</div><div>Долг: <b>${rub(event.debt_total)}</b></div><button type="button" class="btn primary wide" onclick="openDebtPaymentV10('${esc(event.kind)}','${esc(event.id)}',${Number(event.debt_total)},'${esc(event.patient_id)}',true)">Принять оплату долга</button></div>`).join('') || '<p>Долгов нет.</p>'}`;
   $('debtsMessageV10').textContent = '';
  } catch (error) { if (isManager() && actor === actorKey() && view === debtView) $('debtsMessageV10').innerHTML = `${esc(error.message)}<button type="button" class="btn secondary wide" onclick="openDebtsV10()">Повторить</button>`; }
 };
 const homeBase = renderCabinetHomeV5;
 renderCabinetHomeV5 = function() { homeBase(); if (!isManager()) return; const actions = $('workspace').querySelector('.home-actions'); if (actions && !$('homeDebtsV10')) { const button = document.createElement('button'); button.id = 'homeDebtsV10'; button.innerHTML = '<span>🧾</span><strong>Долги пациентов</strong>'; button.onclick = global.openDebtsV10; actions.appendChild(button); } };
 const showBase = show;
 show = function(id) { if (id === 'debtsV10' && !isManager()) { message('homeMessage','Список всех долгов доступен только владельцу'); id = 'workspace'; } showBase(id); };
 const signOutBase = signOut;
 signOut = async function() { session++; patientView++; editorView++; debtView++; forms.proc = null; forms.sale = null; requests.clear(); for (const id of ['patientClinicalV10','debtPaymentV10','debtsV10']) if ($(id)) $(id).innerHTML = ''; await signOutBase(); };
})(typeof window === 'object' ? window : globalThis);
