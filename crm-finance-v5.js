/* Payment allocations are confirmed before an atomic, replay-safe save. */
const financeRequests5 = new Map();
const financePendingTreatment16 = {proc:null,sale:null};
let financeReportId5 = null, financeBusy5 = false, financeView5 = 0;
const financeSnapshots5 = new Map();
const financeSnapshotFilters5 = new Map();
let financeSession5 = 0;
let financeDashboardReadV25 = 0;
let financeShiftSnapshot5 = null;
const financePaymentState5 = {proc: null, sale: null};
let financeAccountingMode5 = null, financeAccountingLoad5 = 0;
const financeTreatmentMode5 = {proc:null, sale:null};
const financeTreatmentReceipt5 = {proc:null, sale:null};
const financeAccountingMismatch5 = {proc:false, sale:false};

function isPaymentOnlyV5(prefix = null) {
 if (!prefix) prefix = $('procedure')?.classList.contains('active') ? 'proc' : $('sale')?.classList.contains('active') ? 'sale' : null;
 return (prefix ? financeTreatmentMode5[prefix] : null)?.payment_only ?? financeAccountingMode5?.payment_only ?? false;
}
function setAccountingModeV5(data) {
 if (typeof data?.payment_only !== 'boolean') throw Error('Не удалось проверить режим учёта. Повторите открытие формы.');
 financeAccountingMode5 = {payment_only:data.payment_only, stock_deducted:!data.payment_only,...(typeof data.partial_stock === 'boolean' ? {partial_stock:data.partial_stock,stock_mode:data.stock_mode} : {})};
 renderAccountingModeV5();
 return financeAccountingMode5;
}
async function loadAccountingModeV5() {
 const actor = currentStaff?.id, token = ++financeAccountingLoad5;
 const data = await crmFinanceRpcV5('accounting_mode');
 if (!actor || currentStaff?.id !== actor || token !== financeAccountingLoad5) throw Error('Учётная запись изменилась. Откройте форму заново.');
 return setAccountingModeV5(data);
}
function accountingNoticeHtmlV5(paymentOnly, partial = false) {
 if (partial) return '<strong>Поэтапный складской учёт</strong><p>Подключённые препараты списываются автоматически: из рабочего шкафа и при необходимости из запаса. Остальные учитываются по оплате. Расход без списания остаётся в списке для сверки.</p>';
 return paymentOnly ? '<strong>Учёт оплаты без списания со склада</strong><p>Процедуры и продажи учитываются по прайсу в кассе и смене. Остатки препаратов не меняются.</p>' : '<strong>Складской учёт включён</strong><p>Препараты списываются из раздела «В работе».</p>';
}
function renderAccountingModeV5() {
 const home = $('workspace');
 if (home) {
  let banner = $('accountingModeBannerV5');
  if (!banner) { banner = document.createElement('div'); banner.id = 'accountingModeBannerV5'; banner.className = 'notice accounting-mode-v5'; banner.setAttribute('role','status'); home.querySelector('.sub')?.after(banner); }
  banner.innerHTML = financeAccountingMode5 ? accountingNoticeHtmlV5(financeAccountingMode5.payment_only,financeAccountingMode5.partial_stock) : 'Режим учёта ещё не проверен. При открытии процедуры или продажи программа проверит его повторно.';
 }
 for (const prefix of ['proc','sale']) {
  const screen = $(prefix === 'proc' ? 'procedure' : 'sale'); if (!screen) continue;
  let banner = $(prefix + 'AccountingModeV5');
  if (!banner) { banner = document.createElement('div'); banner.id = prefix + 'AccountingModeV5'; banner.className = 'notice accounting-mode-v5'; banner.setAttribute('role','status'); (screen.querySelector('.sub') || screen.querySelector('h1'))?.after(banner); }
  const mode = financeTreatmentMode5[prefix] || financeAccountingMode5;
  banner.innerHTML = (mode ? accountingNoticeHtmlV5(mode.payment_only,mode.partial_stock) : 'Проверяем режим учёта…') + (financeAccountingMismatch5[prefix] ? `<button type="button" class="btn secondary wide" onclick="refreshTreatmentAccountingV5('${prefix}')">Обновить режим учёта</button>` : '');
 }
 const reserveOption = $('reserveSaleOptionV5');
 if (reserveOption) reserveOption.classList.toggle('hidden', !isManager() || isPaymentOnlyV5('sale'));
 if (isPaymentOnlyV5('sale') && $('saleReserveV5')) $('saleReserveV5').checked = false;
 if (typeof renderCabinetHomeV5 === 'function' && currentStaff) renderCabinetHomeV5();
}
async function refreshTreatmentAccountingV5(prefix) {
 if (clinicalBusy || !financeAccountingMismatch5[prefix]) return;
 const screen = prefix === 'proc' ? 'procedure' : 'sale';
 try {
  const mode = await loadAccountingModeV5();
  financeTreatmentMode5[prefix] = {...mode};
  financeAccountingMismatch5[prefix] = false;
  $(prefix + 'PayConfirmed').checked = false;
  renderAccountingModeV5(); renderMedVisualCatalog(prefix + 'Meds',$(prefix + 'MedSearch').value); renderTreatmentAvailability4();
  message(screen + 'Message','Режим учёта обновлён. Черновик сохранён. Проверьте и подтвердите оплату заново.',true);
 } catch (e) { message(screen + 'Message',e.message); }
}
function financeStockBadgeV5(event) {
 if (event.stock_mode === 'partial') { const s=event.stock_summary || {}; return `<span class="pill accounting-badge-v5 partial-stock-badge-v28">Склад: списано ${qty(s.deducted_quantity || 0)} · к сверке ${qty(s.pending_quantity || 0)}</span>`; }
 return event.stock_deducted === false ? '<span class="pill accounting-badge-v5">Без списания со склада</span>' : '';
}
function financePaymentOnlyNoteV5(data) {
 const procedures = num(data.payment_only_procedures_count), sales = num(data.payment_only_sales_count);
 return procedures || sales ? `<div class="notice accounting-mode-v5">${isManager() ? 'В выручку включены' : 'Проведены'} операции без складского списания: процедур — ${procedures}, продаж — ${sales}. Их количества показаны отдельно от списаний.</div>` : '';
}

function financeCentsV5(value, label = 'Сумма') {
 const s = String(value ?? '').trim().replace(',', '.');
 if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw Error(`${label}: укажите сумму от нуля с точностью до копеек`);
 const [whole, fraction = ''] = s.split('.');
 const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
 if (!Number.isSafeInteger(cents)) throw Error(`${label}: слишком большая сумма`);
 return cents;
}
function financeAmountV5(cents) { return (cents / 100).toFixed(2); }
function financeListCentsV5(prefix) {
 const medicationCents = rows(prefix + 'Meds').reduce((sum, item) => {
  const m = meds.find(x => x.id === item.medication_id);
  return sum + Math.round(num(m?.sale_price) * num(item.quantity) * 100);
 }, 0);
 const service = prefix === 'proc' ? services.find(x => x.id === $('procService').value) : null;
 return medicationCents + Math.round((num(service?.work_price) + num(service?.consumables_price)) * 100);
}
function financeNetworkErrorV5(error, status) {
 if (error?.code || (status != null && status !== 0)) return false;
 return /^(?:(?:TypeError|NetworkError):\s*)?(?:Load failed|Failed to fetch|Network request failed|NetworkError when attempting to fetch resource)\.?$/i.test(String(error?.message || '').trim());
}
function financeRetryableErrorV16(error, status) {
 if (error?.uncertain === true || /^08/.test(error?.code || '')) return true;
 if (globalThis.SaveRecoveryV16?.isRetryable) return globalThis.SaveRecoveryV16.isRetryable(error,status);
 return financeNetworkErrorV5(error,status) || (!error?.code && /fetch|network|timeout|connection|load failed/i.test(error?.message || ''));
}
function financeSaveErrorV16(error, status, fallback = 'Не удалось выполнить действие') {
 const result = new Error(error?.message || fallback);
 for (const field of ['code','details','hint','uncertain','recoveryAttemptedV16']) if (error?.[field] !== undefined) result[field] = error[field];
 if (status !== undefined || error?.status !== undefined) result.status = status ?? error.status;
 if (financeRetryableErrorV16(error,status)) result.uncertain = true;
 return result;
}
async function crmFinanceRpcV5(action, payload = {}) {
 const actor = currentStaff?.id, role = currentStaff?.role, session = financeSession5;
 const requireActor = () => {
  if (!actor || currentStaff?.id !== actor || currentStaff?.role !== role || session !== financeSession5) throw Error('Учётная запись изменилась. Откройте форму заново.');
 };
 const readOnly = ['summary','settings_get','accounting_mode','shift_report'].includes(action);
 for (let attempt = 0; attempt < 2; attempt++) {
  requireActor();
  let response;
  try { response = await db.rpc('crm_finance_v5', {p_action: action, p_payload: payload}); }
  catch (error) { response = {error}; }
  requireActor();
  const {data,error,status} = response || {};
  if (!response) throw Error('Нет ответа от сервера');
  if (!error) return data;
  if (!financeNetworkErrorV5(error,status)) throw financeSaveErrorV16(error,status,'Нет ответа от сервера');
  if (!readOnly || attempt === 1 || error.recoveryAttemptedV16) throw financeSaveErrorV16({...error,message:'Не удалось связаться с сервером. Проверьте интернет и повторите действие.'},status);
  await new Promise(resolve => setTimeout(resolve,350));
 }
}
function financeRequireOwnerV5() {
 if (!isManager()) throw Error('Этот раздел доступен только владельцу');
}

function installPaymentControlsV5(prefix) {
 if ($(prefix + 'PaymentV5')) return;
 const paid = $(prefix + 'Paid');
 if (!paid) return;
 const box = document.createElement('div');
 box.id = prefix + 'PaymentV5'; box.className = 'payment-v5';
 box.innerHTML = `<h2>Оплата</h2><div class="pay-methods-v5" role="group" aria-label="Способ оплаты">
  ${[['cash','💵 Наличные'],['terminal','💳 Терминал'],['owner_card','Перевод на карту начальника'],['other_card','Другая карта'],['mixed','Смешанная']].map(([method,label]) => `<button type="button" class="btn secondary" data-pay-method="${method}" aria-pressed="false" onclick="selectPaymentMethodV5('${prefix}','${method}')">${label}</button>`).join('')}
 </div><div id="${prefix}PayAllocation" class="pay-allocation-v5 hidden">
  ${[['Cash','Наличные'],['Terminal','Терминал'],['OwnerCard','Перевод на карту начальника'],['OtherCard','Другая карта']].map(([suffix,label]) => `<div><label for="${prefix}Pay${suffix}">${label}, ₽</label><input id="${prefix}Pay${suffix}" type="number" inputmode="decimal" min="0" step="0.01" value="0.00" oninput="paymentEditedV5('${prefix}')"></div>`).join('')}
 </div><div id="${prefix}PayTenderBox"><label for="${prefix}PayTender">Получено наличными, ₽</label><input id="${prefix}PayTender" type="number" inputmode="decimal" min="0" step="0.01" oninput="paymentEditedV5('${prefix}',true)"></div>
 <div id="${prefix}PaySummary" class="payment-summary-v5" role="status" aria-live="polite"></div>
 <label class="payment-confirm-v5"><input id="${prefix}PayConfirmed" type="checkbox"> <span>Подтверждаю сумму и способы оплаты</span></label>
 ${prefix === 'sale' ? '<label id="reserveSaleOptionV5" class="payment-confirm-v5 hidden"><input id="saleReserveV5" type="checkbox" onchange="recalc()"> <span>Продажа из запаса владельцем, если в рабочем шкафу недостаточно</span></label>' : ''}`;
 paid.parentElement.appendChild(box);
}
function resetPaymentV5(prefix) {
 installPaymentControlsV5(prefix);
 financePaymentState5[prefix] = {method:null, total:null, tenderEdited:false};
 for (const suffix of ['Cash','Terminal','OwnerCard','OtherCard']) $(prefix + 'Pay' + suffix).value = '0.00';
 $(prefix + 'PayConfirmed').checked = false;
 if (prefix === 'sale') {
  $('saleReserveV5').checked = false;
  $('reserveSaleOptionV5').classList.toggle('hidden', !isManager() || isPaymentOnlyV5('sale'));
 }
 $(prefix + 'Paid').readOnly = !isManager();
 $(prefix + 'DiscountBox').classList.toggle('hidden', !isManager());
 syncPaymentV5(prefix);
}
function selectPaymentMethodV5(prefix, method) {
 if (!['cash','terminal','owner_card','other_card','mixed'].includes(method)) return;
 const state = financePaymentState5[prefix]; if (!state) return;
 state.method = method; state.tenderEdited = false;
 $(prefix + 'PayConfirmed').checked = false;
 syncPaymentV5(prefix, true);
}
function paymentEditedV5(prefix, tender = false) {
 if (tender && financePaymentState5[prefix]) financePaymentState5[prefix].tenderEdited = true;
 if (!tender && !financePaymentState5[prefix]?.tenderEdited) {
  try { $(prefix + 'PayTender').value = financeAmountV5(financeCentsV5($(prefix + 'PayCash').value)); } catch {}
 }
 $(prefix + 'PayConfirmed').checked = false;
 renderPaymentSummaryV5(prefix);
}
function syncPaymentV5(prefix, force = false) {
 const state = financePaymentState5[prefix]; if (!state || !$(prefix + 'PaymentV5')) return;
 if (!isManager()) {
  $(prefix + 'Paid').value = financeAmountV5(financeListCentsV5(prefix));
  $(prefix + 'DiscountBox').classList.add('hidden');
 }
 let total; try { total = financeCentsV5($(prefix + 'Paid').value || '0'); } catch { total = null; }
 const changed = total !== state.total;
 if (changed || force) {
  $(prefix + 'PayConfirmed').checked = false;
  if (state.method !== 'mixed' || force) {
   $('' + prefix + 'PayCash').value = financeAmountV5(state.method === 'cash' || state.method === 'mixed' ? total || 0 : 0);
   $(prefix + 'PayTerminal').value = financeAmountV5(state.method === 'terminal' ? total || 0 : 0);
   $(prefix + 'PayOwnerCard').value = financeAmountV5(state.method === 'owner_card' ? total || 0 : 0);
   $(prefix + 'PayOtherCard').value = financeAmountV5(state.method === 'other_card' ? total || 0 : 0);
  }
  state.total = total;
 }
 $(prefix + 'PayAllocation').classList.toggle('hidden', state.method !== 'mixed');
 $(prefix + 'PaymentV5').querySelectorAll('[data-pay-method]').forEach(button => {
  const selected = button.dataset.payMethod === state.method;
  button.setAttribute('aria-pressed', String(selected));
  button.classList.toggle('primary', selected); button.classList.toggle('secondary', !selected);
 });
 let cash = 0; try { cash = financeCentsV5($(prefix + 'PayCash').value); } catch {}
 $(prefix + 'PayTenderBox').classList.toggle('hidden', cash === 0 && state.method !== 'cash' && state.method !== 'mixed');
 if (!state.tenderEdited) $(prefix + 'PayTender').value = financeAmountV5(cash);
 renderPaymentSummaryV5(prefix);
}
function financeAllocationCentsV43(value, label) {
 return String(value ?? '').trim() === '' ? 0 : financeCentsV5(value,label);
}
function readPaymentsV5(prefix, requireConfirmation = true) {
 if (!financePaymentState5[prefix]) throw Error('Откройте форму оплаты заново');
 const paid = financeCentsV5($(prefix + 'Paid').value, 'Стоимость');
 const method = financePaymentState5[prefix].method;
 if (paid > 0 && !['cash','terminal','owner_card','other_card','mixed'].includes(method)) throw Error('Выберите способ оплаты: наличные, терминал, перевод на карту начальника, другая карта или смешанная оплата');
 const cash = financeAllocationCentsV43($(prefix + 'PayCash').value, 'Наличные');
 const terminal = financeAllocationCentsV43($(prefix + 'PayTerminal').value, 'Терминал');
 const card = financeAllocationCentsV43($(prefix + 'PayOwnerCard').value, 'Перевод');
 const otherCard = financeAllocationCentsV43($(prefix + 'PayOtherCard').value, 'Другая карта');
 if (paid > 0 && method !== 'mixed' && ((method !== 'cash' && cash > 0) || (method !== 'terminal' && terminal > 0) || (method !== 'owner_card' && card > 0) || (method !== 'other_card' && otherCard > 0))) throw Error('Суммы не соответствуют выбранному способу оплаты. Выберите способ оплаты заново');
 const tender = cash > 0 ? financeCentsV5($(prefix + 'PayTender').value, 'Получено наличными') : 0;
 if (cash + terminal + card + otherCard !== paid) throw Error(`Распределите ровно ${rub(paid / 100)} между способами оплаты`);
 if (tender < cash) throw Error('Получено наличными меньше наличной части оплаты');
 if (requireConfirmation && !$(prefix + 'PayConfirmed').checked) throw Error('Проверьте оплату и отметьте подтверждение');
 return {cash:cash / 100, terminal:terminal / 100, owner_card:card / 100,...(otherCard > 0 ? {other_card:otherCard / 100} : {}),cash_received:tender / 100};
}
function renderPaymentSummaryV5(prefix) {
 const output = $(prefix + 'PaySummary'); if (!output) return;
 try {
  const p = readPaymentsV5(prefix, false);
  output.classList.remove('status-bad');
  const parts = [[p.cash,'Наличные'],[p.terminal,'Терминал'],[p.owner_card,'Перевод на карту начальника'],[p.other_card,'Другая карта']].filter(([value]) => value > 0).map(([value,label]) => `${label}: ${rub(value)}`);
  output.textContent = parts.length ? `Оплата сейчас: ${rub(p.cash + p.terminal + p.owner_card + num(p.other_card))} · ${parts.join(' · ')}${p.cash > 0 ? '. Сдача: ' + rub(p.cash_received - p.cash) : ''}` : 'Оплата сейчас: 0 ₽. Новая оплата не вносится.';
 } catch (e) { output.classList.add('status-bad'); output.textContent = e.message; }
}

const financePrepareBase5 = prepareTreatment4;
prepareTreatment4 = async function(kind, patientId, navigation = quickNavigation4) {
 const prefix = kind === 'procedure' ? 'proc' : 'sale';
 const actor = currentStaff?.id;
 const mode = await loadAccountingModeV5();
 if (!quickNavigationCurrent4(navigation,actor)) return false;
 financeTreatmentMode5[prefix] = {...mode};
 financeTreatmentReceipt5[prefix] = null;
 financeAccountingMismatch5[prefix] = false;
 const ready = await financePrepareBase5(kind, patientId,navigation);
 // The base form initializes payment before it becomes visible. Resetting
 // here, after the asynchronous patient-history hint, overwrites user input.
 if (ready) renderAccountingModeV5();
 return ready;
};
const financeCalcProcedureBase5 = calcProcedure, financeCalcSaleBase5 = calcSale;
calcProcedure = function(...args) { financeCalcProcedureBase5(...args); syncPaymentV5('proc'); };
calcSale = function(...args) { financeCalcSaleBase5(...args); syncPaymentV5('sale'); };

treatmentRpc = async function(kind, payload) {
 const prefix = kind === 'procedure' ? 'proc' : 'sale';
 const actor = JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5]);
 const requireActor = () => { if (!currentStaff?.id || actor !== JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5])) throw Error('Учётная запись изменилась. Откройте форму заново.'); };
 requireActor();
 const pending = financePendingTreatment16[prefix]?.actor === actor ? financePendingTreatment16[prefix] : null;
 let full;
 if (pending) full = pending.payload;
 else {
  full = {...payload, payments:payload.payments || readPaymentsV5(prefix)};
  const mode = financeTreatmentMode5[prefix];
  if (!mode) throw Error('Режим учёта не проверен. Откройте форму заново.');
  full.expected_stock_deducted = mode.stock_deducted;
  if (typeof mode.partial_stock === 'boolean') full.expected_partial_stock = mode.partial_stock;
  if (!mode.payment_only && kind === 'sale' && isManager() && $('saleReserveV5')?.checked) full.reserve_sale = true;
  full = JSON.parse(JSON.stringify(full));
 }
 const key = pending?.key || JSON.stringify([actor,kind,full]);
 if (!financeRequests5.has(key)) financeRequests5.set(key, crypto.randomUUID());
 const requestId = financeRequests5.get(key);
 const forget = () => { if (financeRequests5.get(key) === requestId) financeRequests5.delete(key); };
 financeAccountingMismatch5[prefix] = false;
 let response;
 try { response = await db.rpc('record_treatment_v5', {p_kind:kind,p_payload:full,p_request_id:requestId}); }
 catch (error) { response = {error}; }
 requireActor();
 const {data,error,status} = response || {error:{uncertain:true,message:'Нет ответа от сервера. Повторите сохранение.'}};
 if (error) {
  const failure = financeSaveErrorV16(error,status,'Нет ответа от сервера. Повторите сохранение.');
  if (pending || failure.uncertain) {
   failure.uncertain = true;
   financePendingTreatment16[prefix] = {actor,payload:full,key};
  } else if (/^[0-9A-Z]{5}$/.test(error.code || '')) forget();
  financeAccountingMismatch5[prefix] = /^[0-9A-Z]{5}$/.test(error.code || '') && /^Режим уч[её]та (?:измен[её]н|изменился)/i.test(error.message || '');
  renderAccountingModeV5();
  throw failure;
 }
 forget(); financePendingTreatment16[prefix] = null; financeTreatmentReceipt5[prefix] = data; return data;
};
// The workflow-v3 save still supplies the single-flight lock and preserves failed forms.
saveTreatment = async function(kind) {
 if (clinicalBusy) return;
 const prefix = kind === 'procedure' ? 'proc' : 'sale';
 try {
  if (kind === 'procedure' && (!$('procPatient').value || !$('procService').value)) throw Error('Выберите пациента и услугу');
  readPaymentsV5(prefix);
  if (!isManager() && financeCentsV5($(prefix + 'Paid').value) !== financeListCentsV5(prefix)) throw Error('Медсестра не может менять стоимость');
  const totals = new Map();
  rows(prefix + 'Meds').forEach(item => totals.set(item.medication_id, (totals.get(item.medication_id) || 0) + item.quantity));
  if (!financeTreatmentMode5[prefix]) throw Error('Режим учёта не проверен. Откройте форму заново.');
  const paymentOnly = isPaymentOnlyV5(prefix);
  const reserveAllowed = !paymentOnly && kind === 'sale' && isManager() && $('saleReserveV5')?.checked;
  for (const [id, quantity] of totals) {
   const med = meds.find(m => m.id === id);
   if (!med || med.active === false) throw Error('Препарат недоступен. Замените его или уберите из записи.');
   if (paymentOnly && num(med.sale_price) <= 0) throw Error('У препарата не указана цена продажи. Владелец может добавить её в карточке препарата.');
   if (!paymentOnly && !reserveAllowed && quantity > num(med.work_qty)) throw Error('Недостаточно препарата в рабочем шкафу. Пополните шкаф или исправьте количество.');
  }
  financeTreatmentReceipt5[prefix] = null;
  await originalSaveTreatment4(kind);
  const receipt = financeTreatmentReceipt5[prefix];
  if (receipt && $('workspace').classList.contains('active')) message('homeMessage', (kind === 'procedure' ? 'Процедура сохранена. ' : 'Продажа сохранена. ') + (receipt.stock_deducted === false ? 'Оплата учтена. Остатки склада не изменены.' : 'Оплата учтена, препараты списаны.'), true);
 } catch (e) { message(kind + 'Message', e.message); }
};

function financeRevenueHtmlV5(revenue = {}) {
 return `<div class="finance-totals-v5">${[['total','Получено'],['terminal','Оплата терминалом'],['owner_card','Переводы на карту начальника'],['other_card','Другая карта'],['cash','Наличные']].map(([key,label]) => `<div class="stat"><span>${label}</span><b>${rub(revenue[key])}</b></div>`).join('')}</div>` + (num(revenue.unclassified) ? `<p class="notice">У оплат на ${rub(revenue.unclassified)} не указан способ. Они включены в полученную сумму.</p>` : '');
}
function financeCashBalanceV36(data) {
 const drawer = data.cash_drawer;
 return drawer?.salary_auto === true ? drawer.cash_after_salary_auto ?? null : drawer?.balance ?? null;
}
function financeRemainingLabelV36(data) {
 const drawer = data.cash_drawer,latest = drawer?.scope === 'latest_shift';
 if (drawer?.salary_auto === true) return drawer.opening_confirmed ? 'Остаток наличных' + (latest ? ' последней смены' : '') + ' после зарплаты' : 'Наличные ' + (latest ? 'последней смены' : 'смены') + ' после зарплаты';
 return 'Остаток наличных в кассе' + (latest ? ' последней смены' : '');
}
function financeSalaryValueV36(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter') return null;
 if (data.salary_auto === true && data.salary_auto_total != null) return num(data.salary_auto_total);
 if (data.cash_drawer_period_totals?.salary_auto === true && data.cash_drawer_period_totals.salary_auto_total != null) return num(data.cash_drawer_period_totals.salary_auto_total);
 if (data.cash_drawer?.salary_auto === true && data.cash_drawer.scope !== 'latest_shift' && data.cash_drawer.salary_auto_total != null) return num(data.cash_drawer.salary_auto_total);
 return data.payroll_complete === false ? null : num(data.payroll_total);
}
function financeRemainingTextV5(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter') return 'Не применяется к этому фильтру';
 const value = financeCashBalanceV36(data);
 return value != null ? rub(value) : 'Не рассчитан: укажите остаток на начало смены';
}
function financePayrollTextV5(data) {
 const value = financeSalaryValueV36(data);
 return data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : value == null ? 'Не задана полностью' : rub(value);
}
function financePayrollNoteV5(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter') return '<p class="small">Зарплата и касса учитываются по сменам, а этот фильтр показывает отдельного пациента, препарат или услугу.</p>';
 if (data.salary_auto === true || data.cash_drawer?.salary_auto === true) return '<p class="small">Зарплата учитывается автоматически; отмеченные выплаты повторно не вычитаются.</p>';
 return data.payroll_complete === false ? `<p class="notice">Не задана зарплата для ${num(data.payroll_unknown)} сотрудников. В кассе учитывается только фактически выплаченная наличными зарплата.</p>` : '';
}
function financePayrollDetailsHtmlV36(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter' || data.cash_drawer?.salary_auto !== true) return '';
 const drawer = data.cash_drawer,people = drawer.salary_auto_payroll || drawer.payroll || [];
 return people.length ? `<div class="finance-payroll-details-v36"><p class="small">Зарплата ${drawer.scope === 'latest_shift' ? 'последней смены ' : ''}по сотрудникам</p>${people.map(person => `<div class="shift-summary-row-v16"><span>${esc(person.staff_name || person.full_name || 'Сотрудник')}</span><b>${person.configured == null ? 'Не задана' : esc(rub(person.configured))}</b></div>`).join('')}</div>` : '';
}
function financeShiftSalaryStaffV36(data) {
 const payroll = data.cash_drawer?.salary_auto === true ? data.cash_drawer.salary_auto_payroll || data.cash_drawer.payroll || [] : [];
 return (data.staff || []).map(person => {
  const target = payroll.find(row => row.staff_id === person.id);
  return target?.configured != null ? {...person,amount:target.configured} : person;
 });
}
function financeWarningHtmlV5(warnings = []) {
 return warnings.length ? `<h2>Предупреждения</h2>${warnings.map(w => `<div class="notice finance-warning-v5"><strong>${esc(w.name || 'Препарат')}</strong> · ${esc(w.message || ({expired:'Есть просроченная партия',expiring:'Истекает срок годности',low_stock:'Минимальный остаток',low_work:'Мало в рабочем шкафу'}[w.type]) || w.type || 'Проверьте остатки')}${w.expiry_date ? ' · ' + esc(w.expiry_date) : ''}</div>`).join('')}` : '<p class="small">Предупреждений по остаткам нет.</p>';
}
function financeDateV41(value) {
 const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
 if (!match) return 'Дата не указана';
 const [,year,month,day] = match,date = new Date(year + '-' + month + '-' + day + 'T12:00:00Z');
 return Number.isFinite(+date) && date.toISOString().slice(0,10) === match[0] ? day + '.' + month + '.' + year : 'Дата не указана';
}
function financeDateTimeV5(value) {
 if (!value) return 'Время не указано';
 const date = new Date(value);
 return Number.isFinite(+date) ? date.toLocaleString('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : 'Время не указано';
}
function financeShiftPaymentScopeV45(event) {
 if (event.payment_scope_v45 !== 'shift' || !['number','string'].includes(typeof event.shift_received_total_v45) || String(event.shift_received_total_v45).trim() === '') return null;
 const value = Number(event.shift_received_total_v45),cents = Math.round(value * 100);
 return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(cents) ? {received:cents / 100,payments:event.shift_payments_v45 || {}} : null;
}
function financeEventAmountsV5(event) {
 const received = financeShiftPaymentScopeV45(event)?.received ?? num(event.received_total ?? event.paid_total ?? event.paid);
 const debt = num(event.debt_total ?? event.debt_amount);
 const charge = num(event.charge_total ?? event.charged_total ?? (received + debt));
 return {received,debt,charge,list:num(event.list_total ?? (charge + num(event.discount_amount)))};
}
function financeEventPriceHtmlV14(event) {
 const amounts = financeEventAmountsV5(event),discount = Math.max(0,Math.round((amounts.list - amounts.charge) * 100) / 100),surcharge = Math.max(0,Math.round((amounts.charge - amounts.list) * 100) / 100);
 return `<div class="report-event-prices-v14"><div>По прайсу: <b>${esc(rub(amounts.list))}</b></div><div>Скидка: <b>${esc(rub(discount))}</b></div>${surcharge > 0 ? `<div>Надбавка: <b>${esc(rub(surcharge))}</b></div>` : ''}<div>К оплате: <b>${esc(rub(amounts.charge))}</b>${amounts.charge === 0 ? ' · Бесплатно' : ''}</div></div>`;
}
function financeEventDetailsHtmlV5(event) {
 const serviceItems = Array.isArray(event.services) && event.services.length ? event.services : event.type || event.service_name ? [{name:event.service_name || event.type,quantity:1}] : [];
 const medications = Array.isArray(event.items) ? event.items : [];
 const ownMedications = Array.isArray(event.own_medications) ? event.own_medications : [];
 const line = item => `<li>${esc(item.name || item.service_name || 'Без названия')}${item.dosage ? ' · ' + esc(item.dosage) : ''}${item.quantity !== undefined ? ' × ' + esc(qty(item.quantity)) + ' ' + esc(item.unit || '') : ''}${typeof item.dose === 'string' && item.dose ? ' · Доза: ' + esc(item.dose) : ''}${item.line_total !== undefined ? ' · ' + esc(rub(item.line_total)) : ''}${item.source === 'previously_purchased' ? ' · ранее куплен в кабинете' : ''}</li>`;
 return `${serviceItems.length ? `<div class="report-detail-label-v5">Услуги</div><ul>${serviceItems.map(line).join('')}</ul>` : ''}${medications.length ? `<div class="report-detail-label-v5">Препараты кабинета</div><ul>${medications.map(line).join('')}</ul>` : ''}${ownMedications.length ? `<div class="report-detail-label-v5">Препараты пациента</div><ul>${ownMedications.map(line).join('')}</ul>` : event.own_medications === true || event.own_meds === true ? '<p>Пациент со своими препаратами</p>' : ''}${!medications.length && !ownMedications.length && !event.own_medications && !event.own_meds ? '<p>Без препаратов кабинета</p>' : ''}`;
}
function financeEventMethodsV34(event) {
 const cents = value => {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') return 0;
  const parsed = Number(value), rounded = Math.round(parsed * 100);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isSafeInteger(rounded) ? rounded : 0;
 };
 const received = cents(event.lifetime_received_total ?? event.received_total ?? event.paid_total ?? event.paid), candidate = cents(event.debt_repayments_total), repayment = candidate <= received ? candidate : 0;
 const scoped = financeShiftPaymentScopeV45(event),ordinary = scoped ? cents(scoped.received) : received - repayment, source = scoped ? scoped.payments : event.payments || {};
 let cash = cents(source.cash), terminal = cents(source.terminal), owner_card = cents(source.owner_card),other_card = cents(source.other_card);
 if (cash + terminal + owner_card + other_card > ordinary) cash = terminal = owner_card = other_card = 0;
 return {cash:cash / 100,terminal:terminal / 100,owner_card:owner_card / 100,...(other_card > 0 ? {other_card:other_card / 100} : {}),unclassified:(ordinary - cash - terminal - owner_card - other_card) / 100,debt_repayments_total:repayment / 100};
}
function financeEventMethodsHtmlV34(event) {
 const payments = financeEventMethodsV34(event), rows = [['cash','Наличные'],['terminal','Терминал'],['owner_card','Перевод на карту начальника'],['other_card','Другая карта'],['unclassified','Способ оплаты не указан']];
 return `<div class="report-payment-methods-v34">${rows.filter(([key]) => payments[key] > 0).map(([key,label]) => `<div data-payment-method="${key}">${label}: <b>${esc(rub(payments[key]))}</b></div>`).join('')}${payments.debt_repayments_total > 0 ? `<div data-payment-method="debt_repayment" title="Погашение долга хранится отдельно и не входит в сумму и наличные смены">Погашено долга отдельно: <b>${esc(rub(payments.debt_repayments_total))}</b></div>` : ''}</div>`;
}
function financeEventPaymentHtmlV5(event) {
 const amounts = financeEventAmountsV5(event),pending = event.payment_pending === true;
 const reason = [event.discount_reason,event.discount_comment].filter(Boolean).join(' · ');
 return `${financeEventPriceHtmlV14(event)}<div class="report-event-payment-v5"><span>${financeShiftPaymentScopeV45(event) ? 'Оплачено в этой смене' : event.received_total !== undefined ? 'Оплачено всего' : 'Оплачено'}: <b>${esc(rub(amounts.received))}</b></span>${amounts.debt > 0 ? `<span>${pending ? 'Ожидает оплаты' : 'Долг'}: <b>${esc(rub(amounts.debt))}</b></span>` : ''}</div>${pending && amounts.debt > 0 ? '<p class="small">Пациент ещё на процедуре или ожидает расчёта. Это не долг.</p>' : ''}${reason ? `<p class="report-discount-reason-v5">Причина изменения стоимости: ${esc(reason)}</p>` : ''}${financeEventMethodsHtmlV34(event)}${financeOtherShiftPaymentHtmlV45(event)}`;
}
function financeOtherShiftPaymentHtmlV45(event) {
 const other = num(event.received_other_shifts_v45);
 return financeShiftPaymentScopeV45(event) && other > 0 ? `<p class="small report-other-shift-payment-v45">Оплата в других сменах: <b>${esc(rub(other))}</b>. В сумму и кассу этой смены не входит.</p>` : '';
}

function financeReceiptHtmlV5(receipt) {
 return `<p><b>Получено: ${esc(rub(receipt.paid_total))}</b></p>${financeEventMethodsHtmlV34(receipt)}${receipt.comment ? `<p>Комментарий: ${esc(receipt.comment)}</p>` : ''}`;
}
function financeReceiptEventsHtmlV5(receipts = []) {
 return receipts.map(receipt => `<div class="item report-event-v5"><div class="row between"><strong>${esc(receipt.patient || 'Без пациента')}</strong><b>${esc(rub(receipt.paid_total))}</b></div><p>${esc(financeDateTimeV5(receipt.at))} · ${esc(receipt.nurse || '')}</p>${financeReceiptHtmlV5(receipt)}</div>`).join('');
}
// Presentation links only. The receipt ledger and lifetime payment snapshots
// remain intact: adding a receipt to received_total would count the money twice.
function financeShiftDisplayV39(data = {}) {
 const groups = {procedures:(data.procedures || []).map(event => ({...event,shift_receipts_v39:[]})),sales:(data.sales || []).map(event => ({...event,shift_receipts_v39:[]})),otherReceipts:[]};
 const targets = new Map();
 for (const [kind,events] of [['procedure',groups.procedures],['sale',groups.sales]]) for (const event of events) {
  if (typeof event.id === 'string' && event.id) targets.set(kind + ':' + event.id,event);
 }
 for (const receipt of financeShiftReceiptsV29(data)) {
  const key = ['procedure','sale'].includes(receipt.kind) && typeof receipt.record_id === 'string' && receipt.record_id ? receipt.kind + ':' + receipt.record_id : null;
  const target = key && targets.get(key);
  if (target) target.shift_receipts_v39.push(receipt); else groups.otherReceipts.push(receipt);
 }
 return groups;
}
function financeInlineReceiptsHtmlV39(receipts = [],includePatient = false) {
 return receipts.length ? `<div class="report-inline-receipts-v39">${receipts.map(receipt => `<div class="report-inline-receipt-v39" data-receipt-id="${esc(receipt.id || '')}">${includePatient ? `<strong>${esc(receipt.patient || 'Без пациента')}</strong> · ` : ''}${financeReceiptMetaHtmlV41(receipt)}${financePaidLineHtmlV41(financeEventMethodsV34(receipt))}${receipt.comment ? `<span>Комментарий: ${esc(receipt.comment)}</span>` : ''}</div>`).join('')}</div>` : '';
}
function financeOtherReceiptsHtmlV39(receipts = []) {
 return receipts.length ? `<section class="shift-print-other-payments-v39"><h2>Оплаты по другим записям</h2><p class="small">По записям вне списка этой смены; в число посещений не входят.</p>${financeInlineReceiptsHtmlV39(receipts,true)}</section>` : '';
}
// A visit's methods already include ordinary later collections. Show each
// collection once; attaching a receipt must never add it to the paid total.
function financePaidLineHtmlV41(methods, adjustment = '', receipt = null) {
 const rows = [['cash','Наличные'],['terminal','Терминал'],['owner_card','Перевод на карту начальника'],['other_card','Другая карта'],['unclassified','Способ оплаты не указан']];
 const values = rows.filter(([key]) => methods[key] > 0).map(([key,label]) => `<span data-payment-method="${key}">${label}: <b>${esc(rub(methods[key]))}</b></span>`);
 const time = receipt ? financeReceiptMetaHtmlV41(receipt,true) : '';
 return `<div class="report-paid-line-v41">Оплачено: ${values.join(' · ') || '<b>' + esc(rub(0)) + '</b>'}${adjustment}${time ? ' · ' + time : ''}</div>`;
}
function financeReceiptMetaHtmlV41(receipt, compact = false) {
 if (compact) {
  const date = receipt.at ? new Date(receipt.at) : null;
  if (!date || !Number.isFinite(+date)) return '';
  return `<span class="report-payment-time-v42">Время оплаты: <time>${esc(date.toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}))}</time></span>`;
 }
 return `<span class="report-payment-date-v41"><time>${esc(financeDateTimeV5(receipt.at))}</time>${receipt.nurse ? ' · ' + esc(receipt.nurse) : ''} · ${receipt.kind === 'sale' ? 'Оплата продажи' : 'Оплата после процедуры'}</span>`;
}
function financeVisitPaymentHtmlV41(event) {
 const amounts = financeEventAmountsV5(event),methods = financeEventMethodsV34(event),cents = value => Math.round(num(value) * 100);
 const keys = ['cash','terminal','owner_card','other_card','unclassified'],ordinary = keys.reduce((sum,key) => sum + cents(methods[key]),0);
 const receipts = financeShiftReceiptsV29({receipts:Array.isArray(event.shift_receipts_v39) ? event.shift_receipts_v39 : []}).slice().sort((a,b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
 const collections = receipts.map(receipt => ({receipt,total:cents(receipt.paid_total),methods:financeEventMethodsV34({paid_total:receipt.paid_total,payments:receipt.payments})}));
 const receiptTotal = collections.reduce((sum,item) => sum + item.total,0),residual = ordinary - receiptTotal;
 const reasons = [...new Set([event.discount_reason,event.discount_comment].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
 const difference = Math.round((amounts.list - amounts.charge) * 100),reason = reasons.length ? ' (' + esc(reasons.join(' · ')) + ')' : '';
 const adjustment = (amounts.charge === 0 ? ' · Бесплатно' : '') + (difference > 0 ? ` · <span class="report-adjustment-v41">со скидкой <b>${esc(rub(difference / 100))}</b>${reason}</span>` : difference < 0 ? ` · <span class="report-adjustment-v41">с надбавкой <b>${esc(rub(-difference / 100))}</b>${reason}</span>` : reason);
 let lines = '';
 if (residual >= 0 && collections.every(item => item.total >= 0 && Number.isSafeInteger(item.total))) {
  const remaining = Object.fromEntries(keys.map(key => [key,cents(methods[key]) - collections.reduce((sum,item) => sum + cents(item.methods[key]),0)]));
  const exact = keys.every(key => remaining[key] >= 0) && keys.reduce((sum,key) => sum + remaining[key],0) === residual;
  const baseMethods = exact ? Object.fromEntries(keys.map(key => [key,remaining[key] / 100])) : {unclassified:residual / 100};
  if (residual > 0 || !collections.length) lines += financePaidLineHtmlV41(baseMethods,collections.length ? '' : adjustment);
  lines += collections.map((item,index) => `<div class="report-inline-receipt-v39" data-receipt-id="${esc(item.receipt.id || '')}">${financePaidLineHtmlV41(item.methods,index === collections.length - 1 ? adjustment : '',item.receipt)}${item.receipt.comment ? `<span>Комментарий: ${esc(item.receipt.comment)}</span>` : ''}</div>`).join('');
 } else {
  // Inconsistent legacy snapshots cannot justify additional received money.
  lines = financePaidLineHtmlV41(methods,adjustment) + collections.map(item => `<div class="report-inline-receipt-v39" data-receipt-id="${esc(item.receipt.id || '')}">${financeReceiptMetaHtmlV41(item.receipt,true)}${item.receipt.comment ? `<span>Комментарий: ${esc(item.receipt.comment)}</span>` : ''}</div>`).join('');
 }
 return `<div class="report-visit-payment-v41"><div class="report-price-line-v41">Оплата по прайсу: <b>${esc(rub(amounts.list))}</b></div>${lines}${financeOtherShiftPaymentHtmlV45(event)}${amounts.debt > 0 ? `<div class="report-unpaid-v41">${event.payment_pending === true ? 'Ожидает оплаты' : 'Долг'}: <b>${esc(rub(amounts.debt))}</b>${event.payment_pending === true ? ' · Это не долг.' : ''}</div>` : ''}${methods.debt_repayments_total > 0 ? `<div data-payment-method="debt_repayment" title="Погашение долга хранится отдельно и не входит в сумму и наличные смены">Погашено долга отдельно: <b>${esc(rub(methods.debt_repayments_total))}</b></div>` : ''}</div>`;
}
function financeShiftTotalsV5(data) {
 const events = [...(data.procedures || []),...(data.sales || [])];
 return {charge:num(data.charge_total ?? data.charged_total ?? events.reduce((sum,event) => sum + financeEventAmountsV5(event).charge,0)),debt:num(data.debt_total ?? events.reduce((sum,event) => sum + financeEventAmountsV5(event).debt,0))};
}
function financeShiftBalanceHtmlV5(data) {
 const amounts = financeShiftTotalsV5(data);
 return `<div class="finance-totals-v5"><div class="stat"><span>Стоимость процедур и продаж</span><b>${esc(rub(amounts.charge))}</b></div><div class="stat"><span>В долг</span><b>${esc(rub(amounts.debt))}</b></div></div><p class="small">Долг показан на момент формирования отчёта. Выручка — деньги, полученные в этой смене.</p>`;
}
// Shift income follows the date money was actually received. Lifetime receipts
// on a treatment belong to later shifts and must not be counted a second time.
function financeShiftSummaryAmountsV16(data = {}) {
 const cents = value => Math.round(num(value) * 100);
 const procedures = data.procedures || [],sales = data.sales || [],receipts = financeShiftReceiptsV29(data);
 const initial = event => cents(event.initial_paid_total ?? event.paid_total ?? event.paid);
 const procedureIncome = procedures.reduce((total,event) => total + initial(event),0);
 const saleIncome = sales.reduce((total,event) => total + initial(event),0);
 const laterIncome = receipts.reduce((total,receipt) => total + cents(receipt.paid_total ?? receipt.amount),0);
 const revenue = data.revenue || {},categorized = procedureIncome + saleIncome + laterIncome;
 const total = cents(revenue.total ?? data.cash_total ?? categorized / 100);
 const events = [...procedures,...sales],totals = financeShiftTotalsV5(data);
 const pending = cents(data.pending_total ?? events.reduce((value,event) => value + (event.payment_pending ? financeEventAmountsV5(event).debt : 0),0));
 const debt = cents(totals.debt),staff = data.staff || [];
 const loan = financeDebtAmountV29(data);
 const automaticSalary = data.salary_auto === true || data.cash_drawer?.salary_auto === true;
 const payrollUnknown = automaticSalary ? 0 : num(data.payroll_unknown ?? staff.filter(person => person.amount == null).length);
 const payrollComplete = automaticSalary ? true : data.payroll_complete ?? (staff.length > 0 && payrollUnknown === 0);
 const payroll = cents(automaticSalary ? financeSalaryValueV36(data) : data.payroll_total ?? staff.reduce((value,person) => value + num(person.amount),0));
 return {total:total / 100,procedures:procedureIncome / 100,sales:saleIncome / 100,receipts:laterIncome / 100,
  other:Math.max(0,total - categorized) / 100,categoriesMatch:categorized <= total,
  cash:num(revenue.cash),terminal:num(revenue.terminal),ownerCard:num(revenue.owner_card),otherCard:num(revenue.other_card),unclassified:num(revenue.unclassified),
  charge:totals.charge,debt:debt / 100,pending:pending / 100,loan:num(loan),
  payroll:payroll / 100,payrollUnknown,payrollComplete,
  afterSalary:financeCashBalanceV36(data)};
}
function financeShiftReceiptsV29(data = {}) {
 return (data.receipts || []).filter(receipt => receipt.receipt_kind !== 'debt_repayment' && receipt.payment_kind !== 'debt_repayment' && receipt.is_debt_repayment !== true && receipt.payment_scope !== 'debt');
}
function financeDebtAmountV29(data = {}) {
 if (data.loan_debt_total != null || data.true_debt_total != null) return num(data.loan_debt_total ?? data.true_debt_total);
 const events = [...(data.procedures || []),...(data.sales || [])];
 if (events.length) return events.reduce((sum,event) => sum + (event.payment_pending ? 0 : Math.round(financeEventAmountsV5(event).debt * 100)),0) / 100;
 return Math.max(0,num(data.debt_total));
}
function financeSimpleSummaryHtmlV29(data = {},scope = 'период') {
 const revenue = data.revenue || {},suffix = 'за ' + scope,drawer = data.cash_drawer,automaticSalary = drawer?.salary_auto === true,applicable = data.payroll_scope !== 'not_applicable_to_entity_filter';
 const rows = [['revenue','Получено ' + suffix,rub(revenue.total)],['terminal','Оплата терминалом',rub(revenue.terminal)],['owner-card','Переводы на карту начальника',rub(revenue.owner_card)],['other-card','Другая карта',rub(revenue.other_card)],['loan','Долг',rub(financeDebtAmountV29(data))],['cash','Наличные ' + suffix,rub(revenue.cash)],['payroll-total','Зарплата ' + suffix,financePayrollTextV5(data)],['cash-balance',financeRemainingLabelV36(data),financeRemainingTextV5(data)]];
 return `<section class="finance-simple-summary-v29" aria-label="Финансовые итоги"><div class="finance-totals-v5">${rows.map(([key,label,value]) => `<div class="stat" data-summary-key="${key}"><span>${label}</span><b>${esc(value)}</b>${key === 'payroll-total' && drawer && applicable ? `<small>${automaticSalary ? 'Учтено из наличных' : 'Из кассы выплачено'}${drawer.scope === 'latest_shift' ? ' последней смены' : ''} ${esc(rub(automaticSalary ? drawer.salary_deduction : drawer.salary_paid))}</small>` : ''}</div>`).join('')}</div>${automaticSalary && applicable ? financePayrollDetailsHtmlV36(data) + financePayrollNoteV5(data) : ''}<p class="small">Оплата после процедуры входит в полученную сумму. Погашения долгов учитываются отдельно.</p>${num(data.pending_total) ? `<p class="notice" data-summary-key="pending">Ожидают оплаты после процедуры: <b>${esc(rub(data.pending_total))}</b>. Это не долг.</p>` : ''}${applicable && automaticSalary && !drawer.opening_confirmed ? '<p class="small">Показаны наличные этой смены после зарплаты и других движений. Наличные на начало смены не указаны и в эту сумму не включены.</p>' : ''}${applicable && automaticSalary && financeCashBalanceV36(data) != null && num(financeCashBalanceV36(data)) < 0 ? '<p class="notice">Наличных не хватает на зарплату.</p>' : ''}${financeCashBalanceV36(data) == null && applicable ? '<p class="small">Для остатка в кассе укажите начальные наличные и движения кассы. Терминал и переводы в наличные не входят.</p>' : ''}${data.has_open_shifts === true ? '<p class="small">Есть открытые смены: суммы ещё могут измениться.</p>' : ''}${drawer?.scope === 'latest_shift' && applicable ? '<p class="small">Остаток наличных относится к последней смене выбранного периода.</p>' : ''}</section>`;
}

function financeShiftSummaryHtmlV16(data) {
 const amounts = financeShiftSummaryAmountsV16(data);
 return `<section class="shift-financial-summary-v16" aria-label="Итоги смены">${financeSimpleSummaryHtmlV29({...data,revenue:{...data.revenue,total:amounts.total},loan_debt_total:amounts.loan,pending_total:amounts.pending,payroll_total:amounts.payroll,payroll_complete:amounts.payrollComplete},'смену')}<details class="no-print"><summary>Подробнее</summary><div class="shift-summary-row-v16"><span>Получено за процедуры и препараты</span><b>${esc(rub(amounts.procedures))}</b></div><div class="shift-summary-row-v16"><span>Получено за продажи</span><b>${esc(rub(amounts.sales))}</b></div>${amounts.receipts ? `<div class="shift-summary-row-v16"><span>Оплата после процедуры</span><b>${esc(rub(amounts.receipts))}</b></div>` : ''}<div class="shift-summary-row-v16"><span>Стоимость процедур и продаж</span><b>${esc(rub(amounts.charge))}</b></div>${financeShiftSalaryStaffV36(data).map(person => `<div class="shift-summary-row-v16"><span>Зарплата: ${esc(person.full_name || 'Сотрудник')}</span><b>${person.amount == null ? 'Не задана' : esc(rub(person.amount))}</b></div>`).join('')}${financePayrollNoteV5(data)}</details></section>`;
}

function financePeriodDebtHtmlV5(data, note = true) {
 if (data.charge_total === undefined && data.debt_total === undefined && data.debt_payments_total === undefined) return '';
 return `<details class="finance-details-v29 no-print"><summary>Подробнее о стоимости и оплатах</summary><p>Стоимость процедур и продаж: <b>${esc(rub(data.charge_total))}</b></p><p>Долг по процедурам и продажам: <b>${esc(rub(financeDebtAmountV29(data)))}</b></p><p>Ожидает оплаты после процедуры: <b>${esc(rub(data.pending_total))}</b>. Это не долг.</p>${num(data.debt_payments_total) ? `<p>Оплата после процедуры, принятая отдельно от записи: <b>${esc(rub(data.debt_payments_total))}</b>. Входит в полученную сумму.</p>` : ''}${note ? '<p class="small">Долг и ожидаемая оплата показаны на момент формирования отчёта. Погашения долгов хранятся отдельно от смен.</p>' : ''}</details>`;
}

function financeEventsHtmlV5(events = [], kind, owner) {
 return events.map(event => `<div class="item report-event-v5" data-event-id="${esc(event.id || '')}"><div class="row between"><strong>${esc(kind)}: ${esc(event.patient || 'Без пациента')}</strong><b>${esc(rub(financeEventAmountsV5(event).charge))}</b></div>${owner ? financeStockBadgeV5(event) : ''}<div class="small">${esc(financeDateTimeV5(event.at))} · ${esc(event.nurse || '')}</div>${financeEventDetailsHtmlV5(event)}<div class="report-visit-payment-v39">${financeVisitPaymentHtmlV41(event)}</div>${event.notes ? `<div class="small">${esc(event.notes)}</div>` : ''}${typeof treatmentActionsHtmlV14 === 'function' ? treatmentActionsHtmlV14(event) : ''}</div>`).join('') || '<p class="small">Записей нет.</p>';
}
function buildShiftPrintV5(data) {
 const shiftData = data.shift || {},display = financeShiftDisplayV39(data);
 const events = [...display.procedures.map(event => ({...event,print_kind:'Процедура'})),...display.sales.map(event => ({...event,print_kind:'Продажа препарата'}))].sort((a,b) => {
  const first = Date.parse(a.at),second = Date.parse(b.at);
  return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity) || String(a.id || '').localeCompare(String(b.id || ''));
 });
 return `<header><h1>Процедурный кабинет · Отчёт смены</h1><p><b>Смена:</b> ${esc(financeDateV41(shiftData.date))} · ${esc(shiftData.started_at ? shiftLabel(shiftData.started_at,shiftData.ended_at || shiftData.planned_end_at) : 'Время не указано')}</p><p><b>Медсёстры:</b> ${esc((data.staff || []).map(staff => staff.full_name).join(', ') || 'Не указаны')}</p><p>${shiftData.status === 'closed' ? 'Смена закрыта' : 'Смена открыта · предварительный отчёт'} · пациентов ${num(data.patients_count)} · процедур ${num(data.procedures_count)} · продаж ${num(data.sales_count)}</p></header><ol class="shift-print-events-v5">${events.map(event => `<li class="shift-print-event-v5"><h2>${esc(event.patient || 'Без пациента')}</h2><p><b>${esc(event.print_kind)}</b> · ${esc(financeDateTimeV5(event.at))}${event.nurse ? ' · ' + esc(event.nurse) : ''}</p>${financeEventDetailsHtmlV5(event)}<div class="report-visit-payment-v39">${financeVisitPaymentHtmlV41(event)}</div>${event.notes ? `<p>Комментарий: ${esc(event.notes)}</p>` : ''}</li>`).join('') || '<li>За смену записей нет.</li>'}</ol>${financeOtherReceiptsHtmlV39(display.otherReceipts)}<footer><h2>Итоги смены</h2>${financeShiftSummaryHtmlV16(data)}</footer>`;
}
function clearShiftPrintV5() {
 if (document.body?.classList) document.body.classList.remove('crm-shift-printing-v5');
 document.getElementById?.('shiftPrintV5')?.remove();
}
function requireShiftSnapshotV5() {
 const saved = financeShiftSnapshot5;
 if (!saved || saved.actor !== currentStaff?.id || saved.role !== currentStaff?.role || saved.session !== financeSession5 || saved.id !== financeReportId5) throw Error('Сначала откройте отчёт своей смены');
 return saved.data;
}
function prepareShiftPrintV5() {
 const data = requireShiftSnapshotV5();
 clearShiftPrintV5();
 const printView = document.createElement('article');printView.id = 'shiftPrintV5';printView.innerHTML = buildShiftPrintV5(data);
 document.body.appendChild(printView);document.body.classList.add('crm-shift-printing-v5');
}
function printShiftReportV5() {
 try {
  prepareShiftPrintV5();
  if (typeof crmOpenPrintPreviewV40 === 'function') {
   const saved = financeShiftSnapshot5;
   return crmOpenPrintPreviewV40({source:$('shiftPrintV5'),title:'Отчёт смены ' + financeDateV41(saved.data.shift?.date),
    validate:() => financeShiftSnapshot5 === saved && saved.actor === currentStaff?.id && saved.role === currentStaff?.role && saved.session === financeSession5 && saved.id === financeReportId5 && $('report').classList.contains('active'),
    print:() => {prepareShiftPrintV5();window.print();},cleanup:clearShiftPrintV5}).print();
  }
  window.print();
 }
 catch (error) { clearShiftPrintV5();message('reportPrintMessageV5',error.message); }
}
if (typeof window.addEventListener === 'function') {
 window.addEventListener('afterprint',clearShiftPrintV5);
 window.addEventListener('beforeprint',() => {
  if (!$('report')?.classList.contains('active')) {clearShiftPrintV5();return;}
  try {prepareShiftPrintV5();} catch (error) {
   clearShiftPrintV5();
   const failed = document.createElement('article');failed.id = 'shiftPrintV5';
   failed.innerHTML = '<h1>Отчёт не подготовлен</h1><p>Откройте отчёт заново и нажмите «Печать».</p>';
   document.body.appendChild(failed);document.body.classList.add('crm-shift-printing-v5');message('reportPrintMessageV5',error.message);
  }
 });
}
function financeMedicationUsageHtmlV5(items) {
 return items.map(m => `<div class="item"><div><strong>${esc(m.name)}</strong><div class="small">Процедуры: ${qty(m.procedure_qty)} · продажи: ${qty(m.sale_qty)}</div></div><strong>${qty(m.quantity)} ${esc(m.unit)}</strong></div>`).join('');
}
function renderShiftReportV5(data, closed = false) {
 const owner = isManager(), used = data.used || [], shiftData = data.shift || {}, salaryStaff = financeShiftSalaryStaffV36(data),display = financeShiftDisplayV39(data);
 financeReportId5 = shiftData.id || financeReportId5 || shift?.id;
 financeShiftSnapshot5 = {id:financeReportId5,actor:currentStaff?.id,role:currentStaff?.role,session:financeSession5,data:JSON.parse(JSON.stringify(data))};
 clearShiftPrintV5();
 $('reportBody').innerHTML = `${closed ? '<div class="notice success">Смена закрыта. Итог сохранён.</div>' : ''}<p class="small">${esc(financeDateV41(shiftData.date))} · ${esc(shiftLabel(shiftData.started_at, shiftData.ended_at || shiftData.planned_end_at))}</p>
 <div class="row">${(data.staff || []).map(s => `<span class="pill">${esc(s.full_name)}</span>`).join('')}</div>
 <div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Продаж<b>${num(data.sales_count)}</b></div></div>
 ${owner ? '<div class="no-print">' + financePaymentOnlyNoteV5(data) + '</div>' : ''}
 ${financeShiftSummaryHtmlV16(data)}
 ${owner ? `<h2 class="no-print">Изменить зарплату сотрудников</h2>${salaryStaff.map(s => `<details class="card salary-v5"><summary>${esc(s.full_name)} · ${s.amount == null ? 'Не задана' : rub(s.amount)}</summary><label for="salaryAmount5-${esc(s.id)}">Оплата за смену, ₽</label><input id="salaryAmount5-${esc(s.id)}" type="number" inputmode="decimal" min="0" step="0.01" value="${s.amount == null ? '' : num(s.amount)}"><label for="salaryReason5-${esc(s.id)}">Причина изменения *</label><input id="salaryReason5-${esc(s.id)}" value=""><p class="small">${s.amount == null ? 'Зарплата для этой смены не задана. Укажите сумму и причину.' : s.reason ? 'Последняя причина: ' + esc(s.reason) : 'Стандартная оплата: 2 000 ₽ за смену'}</p><button class="btn primary wide" onclick="saveSalaryV5('${esc(s.id)}')">Сохранить с указанием причины</button></details>`).join('')}` : ''}
 ${owner ? `<div class="no-print report-warehouse-v5"><h2>Списано со склада</h2><div class="report-used">${financeMedicationUsageHtmlV5(used) || '<p class="small">Списаний нет.</p>'}</div>
 ${(data.untracked || []).length ? `<h2>Учтено без складского списания</h2><p class="small">Количество препаратов в процедурах и продажах по прайсу. Эти операции включены в выручку и не меняли остатки склада.</p><div class="report-untracked-v5">${financeMedicationUsageHtmlV5(data.untracked)}</div>` : ''}
 <details><summary>Остатки ${owner ? 'склада и рабочего шкафа' : 'рабочего шкафа'}</summary>${(data.stock || []).map(m => `<div class="item"><strong>${esc(m.name)}</strong><div>В работе: ${qty(m.work)} ${esc(m.unit)}${owner ? ' · запас: ' + qty(m.reserve) + ' ' + esc(m.unit) : ''}</div></div>`).join('') || '<p>Нет препаратов.</p>'}</details>
 ${financeWarningHtmlV5(data.warnings || [])}</div>` : ''}<details><summary>Процедуры (${num(data.procedures_count)})</summary>${financeEventsHtmlV5(display.procedures,'Процедура',owner)}</details><details><summary>Продажи (${num(data.sales_count)})</summary>${financeEventsHtmlV5(display.sales,'Продажа',owner)}</details>${financeOtherReceiptsHtmlV39(display.otherReceipts)}<div id="salaryMessageV5" role="status"></div><div id="reportPrintMessageV5" role="status" class="no-print"></div>`;
 const printButton = $('report').querySelector('button[onclick="window.print()"],#reportPrintV5');
 if (printButton) {printButton.id = 'reportPrintV5';printButton.setAttribute('onclick','printShiftReportV5()');printButton.disabled = false;}
 $('report').querySelector('button[onclick="closeShift()"]').classList.toggle('hidden', closed || shiftData.status !== 'open');
 show('report');
}
async function openReportByIdV5(id) {
 const navigation = beginQuickNavigation4(), actor = currentStaff?.id;
 try {
  const token = ++financeView5;
  financeShiftSnapshot5 = null;clearShiftPrintV5();
  if ($('reportPrintV5')) $('reportPrintV5').disabled = true;
  financeReportId5 = id;
  const data = await crmFinanceRpcV5('shift_report', {shift_id:id});
  if (!quickNavigationCurrent4(navigation,actor) || token !== financeView5) return false;
  if (data?.shift?.id !== id) throw Error('Не удалось получить отчёт выбранной смены. Откройте его повторно.');
  renderShiftReportV5(data, data.shift?.status === 'closed');
  return true;
 } catch (e) { if(!quickNavigationCurrent4(navigation,actor)) return false; message('homeMessage', e.message); const host = $('financeMessageV5'); if (host) host.textContent = e.message; return false; }
}
openReport = async function() { if (!shift?.id) { await openShiftMenu(); return; } await openReportByIdV5(shift.id); };
closeShift = async function() {
 if (financeBusy5 || !financeReportId5) return;
 financeBusy5 = true;
 let committed = false;
 const actor = currentStaff?.id,role = currentStaff?.role,session = financeSession5,navigation = quickNavigation4,view = financeView5;
 const sameActor = () => currentStaff?.id === actor && currentStaff?.role === role && financeSession5 === session;
 const sameView = () => sameActor() && quickNavigationCurrent4(navigation,actor) && financeView5 === view && $('report')?.classList.contains('active');
 const button = $('report').querySelector('button[onclick="closeShift()"]'); if (button) button.disabled = true;
 try {
  const id = financeReportId5, data = await crmFinanceRpcV5('close', {shift_id:id});
  if (!sameActor()) return;
  if (data?.shift?.id !== id || data.shift.status !== 'closed') throw Error('Закрытие смены не подтверждено. Обновите отчёт и проверьте статус смены.');
  committed = true;
  if (shift?.id === id) shift = null;
  if (!sameView()) return;
  renderShiftReportV5(data, true); await loadQuickContext();
  if (sameView() && isManager()) await refreshOwnerDashboardV5();
 } catch (e) { if (sameView()) $('reportBody').insertAdjacentHTML('afterbegin', `<div class="notice">${esc(committed ? 'Смена закрыта. Не удалось обновить экран: ' + e.message : e.message)}</div>`); }
 finally { if (sameActor()) financeBusy5 = false; if (button) button.disabled = false; }
};
async function saveSalaryV5(staffId) {
 if (financeBusy5) return;
 try {
  financeRequireOwnerV5();
  const amount = financeCentsV5($('salaryAmount5-' + staffId).value, 'Зарплата') / 100;
  const reason = $('salaryReason5-' + staffId).value.trim(); if (!reason) throw Error('Укажите причину изменения зарплаты');
  financeBusy5 = true;
  const actor = currentStaff.id;
  const report = await crmFinanceRpcV5('salary', {shift_id:financeReportId5,staff_id:staffId,amount,reason});
  if (!isManager() || currentStaff.id !== actor) return;
  renderShiftReportV5(report, report.shift?.status === 'closed');
  message('salaryMessageV5','Зарплата изменена. Причина записана в журнал.',true);
 } catch (e) { message('salaryMessageV5', e.message); } finally { financeBusy5 = false; }
}

function financeSummaryKeyV5(id) {
 return JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5,$(id + 'From')?.value || '',$(id + 'To')?.value || '',id === 'reportsV5' ? $('reportsV5Group')?.value || 'day' : 'day',id === 'reportsV5' ? $('reportsV5Filter')?.value || '' : '']);
}
function setFinanceExportStateV5(id, ready) {
 for (const suffix of ['Print','Csv']) if ($(id + suffix)) $(id + suffix).disabled = !ready;
}
function invalidateFinanceSummaryV5(id, notify = true) {
 financeView5++;
 financeSnapshots5.delete(id); financeSnapshotFilters5.delete(id);
 if ($(id + 'Body')) $(id + 'Body').innerHTML = '';
 setFinanceExportStateV5(id,false);
 if (notify) message(id + 'Message','Параметры изменены. Нажмите «Показать».');
 return financeView5;
}
function requireFinanceSnapshotV5(id) {
 financeRequireOwnerV5();
 const data = financeSnapshots5.get(id);
 if (!data || financeSnapshotFilters5.get(id) !== financeSummaryKeyV5(id)) {
  invalidateFinanceSummaryV5(id,false);
  throw Error('Сначала сформируйте отчёт за выбранный период');
 }
 return data;
}
function printFinanceReportV5(id) {
 try {
  const saved = requireFinanceSnapshotV5(id);clearShiftPrintV5();
  if (typeof crmOpenPrintPreviewV40 === 'function') return crmOpenPrintPreviewV40({source:$(id + 'Body'),title:'Финансовый отчёт ' + financeDateV41(saved.from) + ' — ' + financeDateV41(saved.to),
   validate:() => requireFinanceSnapshotV5(id) === saved && $(id).classList.contains('active'),
   print:() => {requireFinanceSnapshotV5(id);clearShiftPrintV5();window.print();}}).print();
  window.print();
 }
 catch (e) { message(id + 'Message',e.message); }
}
function installFinanceScreensV5() {
 const app = $('workspace')?.parentElement; if (!app) return;
 for (const [id,title] of [['cashV5','Касса'],['reportsV5','Отчёты'],['analyticsV5','Аналитика']]) {
  if ($(id)) continue;
  const screen = document.createElement('section'); screen.id = id; screen.className = 'screen finance-screen-v5';
  screen.innerHTML = `<div class="row between no-print"><h1>${title}</h1><button class="btn secondary" onclick="show('workspace')">Назад</button></div><div class="card no-print finance-filters-v5"><div class="grid2"><div><label for="${id}From">С даты</label><input id="${id}From" type="date" oninput="invalidateFinanceSummaryV5('${id}')" onchange="invalidateFinanceSummaryV5('${id}')"></div><div><label for="${id}To">По дату</label><input id="${id}To" type="date" oninput="invalidateFinanceSummaryV5('${id}')" onchange="invalidateFinanceSummaryV5('${id}')"></div></div>${id === 'reportsV5' ? `<label for="${id}Group">Группировка</label><select id="${id}Group" onchange="financeFilterGroupChangedV5()"><option value="day">По дням</option><option value="employee">По сотрудникам</option><option value="patient">По пациентам</option><option value="medication">По препаратам</option><option value="service">По услугам</option></select><label for="reportsV5Filter">Фильтр</label><select id="reportsV5Filter" onchange="invalidateFinanceSummaryV5('reportsV5')"><option value="">Все записи</option></select>` : ''}<button class="btn primary wide" onclick="loadFinanceSummaryV5('${id}')">Показать</button></div><div id="${id}Message" role="status" aria-live="polite"></div><div id="${id}Body"></div><div class="row no-print finance-export-v5"><button id="${id}Print" class="btn secondary" onclick="printFinanceReportV5('${id}')" disabled>Печать / PDF</button><button id="${id}Csv" class="btn secondary" onclick="downloadFinanceCsvV5('${id}')" disabled>Скачать CSV</button></div>`;
  app.appendChild(screen);
 }
}
async function openFinanceScreenV5(id) {
 try {
  financeRequireOwnerV5(); installFinanceScreensV5();
  const date = localDateValue(); if (!$(id + 'From').value) $(id + 'From').value = id === 'reportsV5' ? date.slice(0,8) + '01' : date;
  if (!$(id + 'To').value) $(id + 'To').value = date;
  if (id === 'reportsV5') financeFilterGroupChangedV5();
  show(id); await loadFinanceSummaryV5(id);
 } catch (e) { message('homeMessage', e.message); }
}
function openCashV5() { return openFinanceScreenV5('cashV5'); }
function openReportsV5() { return openFinanceScreenV5('reportsV5'); }
function openAnalyticsV5() { return openFinanceScreenV5('analyticsV5'); }
function financeFilterGroupChangedV5() {
 invalidateFinanceSummaryV5('reportsV5');
 const group = $('reportsV5Group').value;
 const list = group === 'employee' ? nurses : group === 'patient' ? patients : group === 'medication' ? (inventory.length ? inventory : meds) : group === 'service' ? services : [];
 $('reportsV5Filter').innerHTML = '<option value="">Все записи</option>' + list.map(item => `<option value="${esc(item.id)}">${esc(item.full_name || item.name)}</option>`).join('');
 $('reportsV5Filter').disabled = group === 'day';
}
function renderFinanceSummaryV5(data, id) {
 const rows = data.rows || [], shifts = data.shifts || [];
 const basis = data.rows_revenue_basis === 'medication_line_share_of_paid_total' ? '<p class="small">По препаратам показана оплаченная стоимость с учётом скидки. Работа и расходники услуги в эти строки не входят.</p>' : '';
 const operational = `<div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Продаж<b>${num(data.sales_count)}</b></div></div>`;
 return `<p class="small">${esc(financeDateV41(data.from))} — ${esc(financeDateV41(data.to))}</p>${operational}<div class="no-print">${financePaymentOnlyNoteV5(data)}</div>${financeSimpleSummaryHtmlV29(data,'период')}${financePeriodDebtHtmlV5(data)}${financePayrollNoteV5(data)}<h2>${id === 'reportsV5' ? 'По выбранной группировке' : 'По дням'}</h2>${basis}<div class="finance-rows-v5">${rows.map(row => `<div class="item"><div class="row between"><strong>${esc(row.label || row.id || 'Без названия')}</strong><b>${rub(row.revenue?.total)}</b></div><div class="small">Пациентов: ${num(row.patients_count)} · процедур: ${num(row.procedures_count)} · продаж: ${num(row.sales_count)}${row.quantity !== undefined ? ' · учтено единиц: ' + qty(row.quantity) : ''}</div><div class="small">Наличные ${rub(row.revenue?.cash)} · терминал ${rub(row.revenue?.terminal)} · перевод на карту начальника ${rub(row.revenue?.owner_card)} · другая карта ${rub(row.revenue?.other_card)} · долг ${rub(financeDebtAmountV29(row))}</div></div>`).join('') || '<p class="small">За этот период записей нет.</p>'}</div><h2>Смены за период</h2><div class="finance-rows-v5">${shifts.map(s => `<button class="item click finance-shift-v5" onclick="openReportByIdV5('${esc(s.id)}')"><strong>${esc(financeDateV41(s.shift_date))} · ${s.status === 'open' ? 'Открыта' : 'Закрыта'}</strong><div>${esc((s.staff || []).map(n => n.full_name).join(', '))}</div><div class="small">${esc(shiftLabel(s.started_at,s.ended_at))} · зарплата ${s.payroll_complete === false ? 'не полностью задана' : rub(s.payroll_total)}</div></button>`).join('') || '<p class="small">Смен нет.</p>'}</div>`;
}
async function loadFinanceSummaryV5(id) {
 let token, actor, key;
 try {
  financeRequireOwnerV5(); actor = currentStaff.id;
  token = invalidateFinanceSummaryV5(id,false); key = financeSummaryKeyV5(id);
  const from = $(id + 'From').value, to = $(id + 'To').value;
  if (!from || !to || from > to) throw Error('Укажите корректный период');
  const payload = {from,to,group_by:id === 'reportsV5' ? $('reportsV5Group').value : 'day'};
  if (id === 'reportsV5' && $('reportsV5Filter').value) payload[payload.group_by + '_id'] = $('reportsV5Filter').value;
  message(id + 'Message','Загружаем…');
  const [data,settings] = await Promise.all([crmFinanceRpcV5('summary',payload),id === 'cashV5' ? crmFinanceRpcV5('settings_get') : Promise.resolve(null)]);
  if (token !== financeView5 || !isManager() || currentStaff.id !== actor || key !== financeSummaryKeyV5(id)) return;
  let html = renderFinanceSummaryV5(data,id);
  if (settings) html = `<div class="card"><span>Разменный фонд</span><div class="money">${rub(settings.float_amount)}</div><p class="small">Начальные наличные указываются отдельно в кассе смены. Этот фонд не является оплатой пациентов.</p></div>` + html;
  if (id === 'analyticsV5') {
   const loaded = await loadInventory();
   if (token !== financeView5 || !isManager() || currentStaff.id !== actor || key !== financeSummaryKeyV5(id)) return;
   if (loaded === false) throw Error('Не удалось обновить остатки склада. Нажмите «Показать», чтобы повторить.');
   html += '<div class="no-print">' + renderInventoryAnalyticsV5() + '</div>';
  }
  financeSnapshots5.set(id,data); financeSnapshotFilters5.set(id,key);
  $(id + 'Body').innerHTML = html; setFinanceExportStateV5(id,true);
  message(id + 'Message','');
 } catch (e) { if ((token === undefined || token === financeView5) && isManager() && (!actor || currentStaff.id === actor)) message(id + 'Message',e.message); }
}
function renderInventoryAnalyticsV5() {
 const active = inventory.filter(m => m.active !== false);
 const low = active.filter(m => num(m.reserve_available ?? m.reserve_qty) + num(m.work_available ?? m.work_qty) <= num(m.min_total_stock));
 const expiring = active.filter(m => { const days = expiryDays(m.nearest_expiry); return days !== null && days <= 30; });
 return `<h2>Остатки склада</h2><div class="card">Препаратов в учёте: <b>${active.length}</b><div>С минимальным остатком: <b>${low.length}</b></div><div>С истекающим сроком: <b>${expiring.length}</b></div></div><details><summary>Минимальные остатки (${low.length})</summary>${low.map(m => `<div class="item"><strong>${esc(m.name)}</strong> · ${qty(num(m.reserve_available ?? m.reserve_qty) + num(m.work_available ?? m.work_qty))} ${esc(unit(m))} · минимум ${qty(m.min_total_stock)}</div>`).join('') || '<p>Таких препаратов нет.</p>'}</details><details><summary>Сроки годности (${expiring.length})</summary>${expiring.map(m => `<div class="item"><strong>${esc(m.name)}</strong> · ${esc(m.nearest_expiry)}${expiryDays(m.nearest_expiry) < 0 ? ' · срок истёк' : ''}</div>`).join('') || '<p>Таких препаратов нет.</p>'}</details><details><summary>Все остатки (${active.length})</summary>${active.map(m => `<div class="item"><strong>${esc(m.name)}</strong><div>Запас: ${qty(m.reserve_qty)} · в работе: ${qty(m.work_qty)} ${esc(unit(m))}</div></div>`).join('')}</details>`;
}
function renderOwnerStockOverviewV5() {
 const active = inventory.filter(m => m.active !== false);
 const low = active.filter(m => num(m.reserve_available ?? m.reserve_qty) + num(m.work_available ?? m.work_qty) < num(m.min_total_stock));
 const expiring = active.filter(m => { const days = expiryDays(m.nearest_expiry); return days !== null && days <= 30; });
 return `<div class="card"><h2>Склад</h2><div>Препаратов в учёте: <b>${active.length}</b></div><div>Минимальный остаток: <b>${low.length}</b></div><div>Истекающий срок годности: <b>${expiring.length}</b></div>${low.length ? `<p class="small">Пополнить: ${low.slice(0,4).map(m => esc(m.name)).join(', ')}${low.length > 4 ? '…' : ''}</p>` : ''}${expiring.length ? `<p class="small">Проверить сроки: ${expiring.slice(0,4).map(m => esc(m.name)).join(', ')}${expiring.length > 4 ? '…' : ''}</p>` : ''}<button class="btn secondary wide" onclick="openAnalyticsV5()">Аналитика и остатки склада</button></div>`;
}
function financeCsvCellV5(value) {
 let s = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
 return '"' + s.replaceAll('"','""') + '"';
}
function buildFinanceCsvV5(data) {
 const revenue = data.revenue || {};
 const rows = [['Период',data.from,data.to],['Показатель','Значение'],['Получено за период',revenue.total || 0],['Оплата терминалом',revenue.terminal || 0],['Переводы на карту начальника',revenue.owner_card || 0],['Другая карта',revenue.other_card || 0],['Долг',financeDebtAmountV29(data)],['Наличные за период',revenue.cash || 0],['Зарплата за период',data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : financeSalaryValueV36(data) ?? 'Не задана полностью'],[financeRemainingLabelV36(data),data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : financeCashBalanceV36(data) ?? 'Не рассчитан: укажите остаток на начало смены'],['Ожидает оплаты после процедуры (не долг)',data.pending_total || 0],['Стоимость процедур и продаж',data.charge_total ?? revenue.total ?? 0],['Пояснение','Погашения долгов учитываются отдельно и не входят в сумму смены. Обычная оплата после процедуры входит в смену.'],[],['Группа','Пациенты','Процедуры','Продажи','Количество','Наличные','Терминал','Переводы на карту начальника','Другая карта','Получено','Долг','Ожидает оплаты']];
 if (data.cash_drawer?.salary_auto === true && data.payroll_scope !== 'not_applicable_to_entity_filter') {
  rows.splice(rows.length - 1,0,['Зарплата учитывается автоматически; отмеченные выплаты повторно не вычитаются.']);
  for (const person of data.cash_drawer.salary_auto_payroll || data.cash_drawer.payroll || []) rows.splice(rows.length - 1,0,[(data.cash_drawer.scope === 'latest_shift' ? 'Зарплата последней смены: ' : 'Зарплата: ') + (person.staff_name || person.full_name || 'Сотрудник'),person.configured ?? 'Не задана']);
  if (!data.cash_drawer.opening_confirmed) rows.splice(rows.length - 1,0,['Пояснение к наличным','Наличные на начало смены не указаны и в сумму не включены.']);
  if (data.cash_drawer.scope === 'latest_shift') rows.splice(rows.length - 1,0,['Пояснение к кассе','Остаток наличных относится к последней смене выбранного периода.']);
 }
 const reconciliation = data.payroll_scope !== 'not_applicable_to_entity_filter' ? data.cash_drawer?.reconciliation_v37 : null;
 if (reconciliation) {
  const count = reconciliation.count;
  rows.splice(rows.length - 1,0,['Сверка наличных',!count ? 'Не проведена' : reconciliation.stale ? 'Устарела: после сверки были изменения' : 'Проведена']);
  if (count) {
   for (const row of [
    ['Фактически пересчитано наличными',count.counted_cash],
    ['Ожидаемый фактический остаток на момент сверки',count.expected_cash],
    ['Расхождение: излишек (+) / недостача (−)',count.difference],
    ['Зарплата подтверждена как выданная полностью',count.salary_confirmed ? 'Да' : 'Нет / не полностью'],
    ['Сверку внёс сотрудник',count.staff_name || 'Сотрудник'],
    ['Время сохранения сверки',financeDateTimeV5(count.created_at)],
    ['Комментарий к сверке',count.reason || '']
   ]) rows.splice(rows.length - 1,0,row);
  }
 }
 for (const row of data.rows || []) rows.push([row.label,row.patients_count,row.procedures_count,row.sales_count,row.quantity ?? '',row.revenue?.cash,row.revenue?.terminal,row.revenue?.owner_card,row.revenue?.other_card,row.revenue?.total,financeDebtAmountV29(row),row.pending_total || 0]);
 return '\uFEFF' + rows.map(row => row.map(financeCsvCellV5).join(';')).join('\r\n');
}

function downloadFinanceCsvV5(id) {
 try {
  const data = requireFinanceSnapshotV5(id);
  const url = URL.createObjectURL(new Blob([buildFinanceCsvV5(data)],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `procedural-cabinet-${data.from}-${data.to}.csv`; a.click(); URL.revokeObjectURL(url);
 } catch (e) { message(id + 'Message', e.message); }
}
async function refreshOwnerDashboardV5() {
 if (!isManager()) return;
 let host = $('ownerDashboardV5');
 if (!host) { host = document.createElement('div'); host.id = 'ownerDashboardV5'; $('workspace').appendChild(host); }
 const actor = currentStaff.id,role = currentStaff.role,session = financeSession5,view = financeView5;
 const generation = ++financeDashboardReadV25,date = localDateValue();
 const stillCurrent = () => isManager() && currentStaff?.id === actor && currentStaff?.role === role
  && financeSession5 === session && financeView5 === view && financeDashboardReadV25 === generation;
 try {
  const [data,stockLoaded] = await Promise.all([financeDashboardRpcV25(date),loadInventory()]);
  if (!stillCurrent()) return;
  host.innerHTML = financeDashboardHtmlV25(data) + (stockLoaded === false ? '<div class="notice">Не удалось обновить остатки склада. Откройте склад и повторите загрузку.</div>' : renderOwnerStockOverviewV5());
 } catch (e) { if (stillCurrent()) host.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
}
async function financeDashboardRpcV25(date) {
 const actor = currentStaff?.id,role = currentStaff?.role,session = financeSession5;
 const requireActor = () => {
  if (!actor || !isManager() || currentStaff?.id !== actor || currentStaff?.role !== role || financeSession5 !== session) throw Error('Учётная запись изменилась. Откройте страницу заново.');
 };
 for (let attempt = 0;attempt < 2;attempt++) {
  requireActor();let response;
  try {response = await db.rpc('crm_dashboard_day_v25',{p_date:date});} catch (error) {response = {error};}
  requireActor();const {data,error,status} = response || {};
  if (!response) throw Error('Нет ответа от сервера');
  if (!error) {
   if (!data?.working_day || !data?.receipts_day) throw Error('Не удалось загрузить итоги дня. Обновите страницу.');
   return data;
  }
  if (!financeNetworkErrorV5(error,status)) throw financeSaveErrorV16(error,status);
  if (attempt || error.recoveryAttemptedV16) throw Error('Не удалось связаться с сервером. Проверьте интернет и обновите страницу.');
  await new Promise(resolve => setTimeout(resolve,350));
 }
}
function financeDashboardHtmlV25(data) {
 const working = data.working_day,calendar = data.receipts_day;
 const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date.split('-').reverse().join('.') : data.date || '';
 return `<section aria-label="Смены дня" data-dashboard-section="shifts"><h2>Смены за ${esc(date)}</h2><p class="small">Каждый пациент учитывается один раз. Ожидание оплаты после процедуры не считается долгом.</p><div class="stats"><div class="stat" data-dashboard-stat="patients">Пациентов<b>${num(working.patients_count)}</b></div><div class="stat" data-dashboard-stat="procedures">Процедур<b>${num(working.procedures_count)}</b></div><div class="stat" data-dashboard-stat="sales">Продаж<b>${num(working.sales_count)}</b></div></div>${financeSimpleSummaryHtmlV29(working,'смены')}${financePeriodDebtHtmlV5(working)}</section><details class="card no-print" aria-label="Календарные поступления" data-dashboard-section="calendar"><summary>Подробнее: оплаты за календарный день</summary><p class="small">${esc(date)}. Обычные оплаты по дате получения. Погашения долгов сюда не входят.</p>${financeRevenueHtmlV5(calendar.revenue)}</details>`;
}
refreshDashboard = async function() {
 if (isManager()) { await refreshOwnerDashboardV5(); return; }
 if (!shift?.id) return;
 try {
  const actor = currentStaff?.id, data = await crmFinanceRpcV5('shift_report',{shift_id:shift.id});
  if (currentStaff?.id !== actor) return;
  $('patientCount').textContent = num(data.patients_count); $('procedureCount').textContent = num(data.procedures_count); $('cashTotal').textContent = '';
 } catch (e) { message('homeMessage', e.message); }
};
const financeEnterBase5 = enterApp, financeSignOutBase5 = signOut;
enterApp = async function(user) {
 await financeEnterBase5(user);
 if (!currentStaff || !['owner','admin','nurse'].includes(currentStaff.role)) return;
 installPaymentControlsV5('proc'); installPaymentControlsV5('sale'); installFinanceScreensV5();
 try { await loadAccountingModeV5(); } catch (e) { message('homeMessage', e.message); }
 if (isManager()) await refreshOwnerDashboardV5();
};
signOut = async function() {
 financeSession5++;
 financeBusy5 = false;
 financeDashboardReadV25++;
 financeShiftSnapshot5 = null;clearShiftPrintV5();
 financeAccountingLoad5++; financeAccountingMode5 = null;
 financeTreatmentMode5.proc = null; financeTreatmentMode5.sale = null;
 financeTreatmentReceipt5.proc = null; financeTreatmentReceipt5.sale = null;
 financeAccountingMismatch5.proc = false; financeAccountingMismatch5.sale = false;
 for (const id of ['accountingModeBannerV5','procAccountingModeV5','saleAccountingModeV5']) if ($(id)) $(id).innerHTML = '';
 financeView5++; financeRequests5.clear(); financeSnapshots5.clear(); financeSnapshotFilters5.clear(); financeReportId5 = null;
 financePendingTreatment16.proc = null; financePendingTreatment16.sale = null;
 for (const id of ['cashV5','reportsV5','analyticsV5']) setFinanceExportStateV5(id,false);
 for (const id of ['cashV5Body','reportsV5Body','analyticsV5Body','ownerDashboardV5','reportBody']) if ($(id)) $(id).innerHTML = '';
 financePaymentState5.proc = null; financePaymentState5.sale = null;
 await financeSignOutBase5();
};
