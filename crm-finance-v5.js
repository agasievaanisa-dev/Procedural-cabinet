/* Payment allocations are confirmed before an atomic, replay-safe save. */
const financeRequests5 = new Map();
let financeReportId5 = null, financeBusy5 = false, financeView5 = 0;
const financeSnapshots5 = new Map();
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
 financeAccountingMode5 = {payment_only:data.payment_only, stock_deducted:!data.payment_only};
 renderAccountingModeV5();
 return financeAccountingMode5;
}
async function loadAccountingModeV5() {
 const actor = currentStaff?.id, token = ++financeAccountingLoad5;
 const data = await crmFinanceRpcV5('accounting_mode');
 if (!actor || currentStaff?.id !== actor || token !== financeAccountingLoad5) throw Error('Учётная запись изменилась. Откройте форму заново.');
 return setAccountingModeV5(data);
}
function accountingNoticeHtmlV5(paymentOnly) {
 return paymentOnly ? '<strong>Учёт оплаты без списания со склада</strong><p>Процедуры и продажи учитываются по прайсу в кассе и смене. Остатки препаратов не меняются.</p>' : '<strong>Складской учёт включён</strong><p>Препараты списываются из раздела «В работе».</p>';
}
function renderAccountingModeV5() {
 const home = $('workspace');
 if (home) {
  let banner = $('accountingModeBannerV5');
  if (!banner) { banner = document.createElement('div'); banner.id = 'accountingModeBannerV5'; banner.className = 'notice accounting-mode-v5'; banner.setAttribute('role','status'); home.querySelector('.sub')?.after(banner); }
  banner.innerHTML = financeAccountingMode5 ? accountingNoticeHtmlV5(financeAccountingMode5.payment_only) : 'Режим учёта ещё не проверен. При открытии процедуры или продажи программа проверит его повторно.';
 }
 for (const prefix of ['proc','sale']) {
  const screen = $(prefix === 'proc' ? 'procedure' : 'sale'); if (!screen) continue;
  let banner = $(prefix + 'AccountingModeV5');
  if (!banner) { banner = document.createElement('div'); banner.id = prefix + 'AccountingModeV5'; banner.className = 'notice accounting-mode-v5'; banner.setAttribute('role','status'); (screen.querySelector('.sub') || screen.querySelector('h1'))?.after(banner); }
  const mode = financeTreatmentMode5[prefix] || financeAccountingMode5;
  banner.innerHTML = (mode ? accountingNoticeHtmlV5(mode.payment_only) : 'Проверяем режим учёта…') + (financeAccountingMismatch5[prefix] ? `<button type="button" class="btn secondary wide" onclick="refreshTreatmentAccountingV5('${prefix}')">Обновить режим учёта</button>` : '');
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
async function crmFinanceRpcV5(action, payload = {}) {
 const {data, error} = await db.rpc('crm_finance_v5', {p_action: action, p_payload: payload});
 if (error) throw Error(error.message || 'Нет ответа от сервера');
 return data;
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
  ${[['cash','💵 Наличные'],['terminal','💳 Терминал'],['owner_card','Перевод владельцу'],['mixed','Смешанная']].map(([method,label]) => `<button type="button" class="btn secondary" data-pay-method="${method}" aria-pressed="false" onclick="selectPaymentMethodV5('${prefix}','${method}')">${label}</button>`).join('')}
 </div><div id="${prefix}PayAllocation" class="pay-allocation-v5 hidden">
  ${[['Cash','Наличные'],['Terminal','Терминал'],['OwnerCard','Перевод на карту владельца']].map(([suffix,label]) => `<div><label for="${prefix}Pay${suffix}">${label}, ₽</label><input id="${prefix}Pay${suffix}" type="number" inputmode="decimal" min="0" step="0.01" value="0.00" oninput="paymentEditedV5('${prefix}')"></div>`).join('')}
 </div><div id="${prefix}PayTenderBox"><label for="${prefix}PayTender">Получено наличными, ₽</label><input id="${prefix}PayTender" type="number" inputmode="decimal" min="0" step="0.01" oninput="paymentEditedV5('${prefix}',true)"></div>
 <div id="${prefix}PaySummary" class="payment-summary-v5" role="status" aria-live="polite"></div>
 <label class="payment-confirm-v5"><input id="${prefix}PayConfirmed" type="checkbox"> <span>Подтверждаю сумму и способы оплаты</span></label>
 ${prefix === 'sale' ? '<label id="reserveSaleOptionV5" class="payment-confirm-v5 hidden"><input id="saleReserveV5" type="checkbox" onchange="recalc()"> <span>Продажа из запаса владельцем, если в рабочем шкафу недостаточно</span></label>' : ''}`;
 paid.parentElement.appendChild(box);
}
function resetPaymentV5(prefix) {
 installPaymentControlsV5(prefix);
 financePaymentState5[prefix] = {method:'cash', total:null, tenderEdited:false};
 for (const suffix of ['Cash','Terminal','OwnerCard']) $(prefix + 'Pay' + suffix).value = '0.00';
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
 if (!['cash','terminal','owner_card','mixed'].includes(method)) return;
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
function readPaymentsV5(prefix, requireConfirmation = true) {
 if (!financePaymentState5[prefix]) throw Error('Откройте форму оплаты заново');
 const paid = financeCentsV5($(prefix + 'Paid').value, 'Стоимость');
 const cash = financeCentsV5($(prefix + 'PayCash').value, 'Наличные');
 const terminal = financeCentsV5($(prefix + 'PayTerminal').value, 'Терминал');
 const card = financeCentsV5($(prefix + 'PayOwnerCard').value, 'Перевод');
 const tender = cash > 0 ? financeCentsV5($(prefix + 'PayTender').value, 'Получено наличными') : 0;
 if (cash + terminal + card !== paid) throw Error(`Распределите ровно ${rub(paid / 100)} между способами оплаты`);
 if (tender < cash) throw Error('Получено наличными меньше наличной части оплаты');
 if (requireConfirmation && !$(prefix + 'PayConfirmed').checked) throw Error('Проверьте оплату и отметьте подтверждение');
 return {cash:cash / 100, terminal:terminal / 100, owner_card:card / 100, cash_received:tender / 100};
}
function renderPaymentSummaryV5(prefix) {
 const output = $(prefix + 'PaySummary'); if (!output) return;
 try {
  const p = readPaymentsV5(prefix, false);
  output.classList.remove('status-bad');
  output.textContent = `Наличные ${rub(p.cash)} · терминал ${rub(p.terminal)} · перевод ${rub(p.owner_card)}. Сдача: ${rub(p.cash_received - p.cash)}`;
 } catch (e) { output.classList.add('status-bad'); output.textContent = e.message; }
}

const financePrepareBase5 = prepareTreatment4;
prepareTreatment4 = async function(kind, patientId) {
 const prefix = kind === 'procedure' ? 'proc' : 'sale';
 const mode = await loadAccountingModeV5();
 financeTreatmentMode5[prefix] = {...mode};
 financeTreatmentReceipt5[prefix] = null;
 financeAccountingMismatch5[prefix] = false;
 const ready = await financePrepareBase5(kind, patientId);
 if (ready) { resetPaymentV5(prefix); renderAccountingModeV5(); }
 return ready;
};
const financeCalcProcedureBase5 = calcProcedure, financeCalcSaleBase5 = calcSale;
calcProcedure = function(...args) { financeCalcProcedureBase5(...args); syncPaymentV5('proc'); };
calcSale = function(...args) { financeCalcSaleBase5(...args); syncPaymentV5('sale'); };

treatmentRpc = async function(kind, payload) {
 const prefix = kind === 'procedure' ? 'proc' : 'sale';
 const full = {...payload, payments:readPaymentsV5(prefix)};
 const mode = financeTreatmentMode5[prefix];
 if (!mode) throw Error('Режим учёта не проверен. Откройте форму заново.');
 full.expected_stock_deducted = mode.stock_deducted;
 if (!mode.payment_only && kind === 'sale' && isManager() && $('saleReserveV5')?.checked) full.reserve_sale = true;
 const key = JSON.stringify([kind, full]);
 if (!financeRequests5.has(key)) financeRequests5.set(key, crypto.randomUUID());
 financeAccountingMismatch5[prefix] = false;
 const {data,error} = await db.rpc('record_treatment_v5', {p_kind:kind,p_payload:full,p_request_id:financeRequests5.get(key)});
 if (error) {
  if (/^[0-9A-Z]{5}$/.test(error.code || '')) financeRequests5.delete(key);
  financeAccountingMismatch5[prefix] = /^[0-9A-Z]{5}$/.test(error.code || '') && /^Режим уч[её]та (?:измен[её]н|изменился)/i.test(error.message || '');
  renderAccountingModeV5();
  throw Error(error.message || 'Нет ответа от сервера. Повторите сохранение.');
 }
 financeRequests5.delete(key); financeTreatmentReceipt5[prefix] = data; return data;
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
 return `<div class="finance-totals-v5">${[['cash','Наличные'],['terminal','Терминал'],['owner_card','Переводы владельцу'],['total','Общая выручка']].map(([key,label]) => `<div class="stat"><span>${label}</span><b>${rub(revenue[key])}</b></div>`).join('')}</div>` + (num(revenue.unclassified) ? `<p class="notice">Оплаты до обновления без способа: ${rub(revenue.unclassified)}. Они включены в общую выручку.</p>` : '');
}
function financeRemainingTextV5(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter') return 'Не применяется к этому фильтру';
 return data.cash_after_salary === null ? 'Не рассчитан: укажите зарплату за прошлые смены' : rub(data.cash_after_salary);
}
function financePayrollTextV5(data) {
 return data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : rub(data.payroll_total);
}
function financePayrollNoteV5(data) {
 if (data.payroll_scope === 'not_applicable_to_entity_filter') return '<p class="small">Зарплата и денежный остаток после её выплаты рассчитываются по сменам, а этот фильтр показывает отдельного пациента, препарат или услугу.</p>';
 return data.payroll_complete === false ? `<p class="notice">Не задана зарплата для ${num(data.payroll_unknown)} сотрудников в сменах этого отчёта. Денежный остаток будет рассчитан после заполнения.</p>` : '';
}
function financeWarningHtmlV5(warnings = []) {
 return warnings.length ? `<h2>Предупреждения</h2>${warnings.map(w => `<div class="notice finance-warning-v5"><strong>${esc(w.name || 'Препарат')}</strong> · ${esc(w.message || ({expired:'Есть просроченная партия',expiring:'Истекает срок годности',low_stock:'Минимальный остаток',low_work:'Мало в рабочем шкафу'}[w.type]) || w.type || 'Проверьте остатки')}${w.expiry_date ? ' · ' + esc(w.expiry_date) : ''}</div>`).join('')}` : '<p class="small">Предупреждений по остаткам нет.</p>';
}
function financeEventsHtmlV5(events = [], kind, owner) {
 return events.map(event => `<div class="item"><div class="row between"><strong>${kind}: ${esc(event.patient || 'Без пациента')}</strong>${owner ? `<b>${rub(event.paid_total ?? event.paid)}</b>` : ''}</div>${financeStockBadgeV5(event)}<div class="small">${esc(new Date(event.at).toLocaleString('ru-RU'))} · ${esc(event.nurse || '')}</div>${event.type ? `<div>${esc(event.type)}</div>` : ''}<div>${(event.items || []).map(m => `${esc(m.name)} × ${qty(m.quantity)} ${esc(m.unit || '')}`).join(', ') || 'Без препаратов'}</div>${event.notes ? `<div class="small">${esc(event.notes)}</div>` : ''}</div>`).join('') || '<p class="small">Записей нет.</p>';
}
function financeMedicationUsageHtmlV5(items) {
 return items.map(m => `<div class="item"><div><strong>${esc(m.name)}</strong><div class="small">Процедуры: ${qty(m.procedure_qty)} · продажи: ${qty(m.sale_qty)}</div></div><strong>${qty(m.quantity)} ${esc(m.unit)}</strong></div>`).join('');
}
function renderShiftReportV5(data, closed = false) {
 const owner = isManager(), used = data.used || [], shiftData = data.shift || {};
 $('reportBody').innerHTML = `${closed ? '<div class="notice success">Смена закрыта. Итог сохранён.</div>' : ''}<p class="small">${esc(shiftData.date || '')} · ${esc(shiftLabel(shiftData.started_at, shiftData.ended_at || shiftData.planned_end_at))}</p>
 <div class="row">${(data.staff || []).map(s => `<span class="pill">${esc(s.full_name)}</span>`).join('')}</div>
 <div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Продаж<b>${num(data.sales_count)}</b></div></div>
 ${financePaymentOnlyNoteV5(data)}
 ${owner ? financeRevenueHtmlV5(data.revenue) + `<div class="card"><div>Заработная плата: <b>${financePayrollTextV5(data)}</b></div><h2>Денежный остаток после выплаты зарплаты</h2><div class="money">${financeRemainingTextV5(data)}</div><p class="small">Выручка за вычетом зарплаты. Этот показатель не является прибылью.</p>${financePayrollNoteV5(data)}</div><h2>Зарплата сотрудников</h2>${(data.staff || []).map(s => `<details class="card salary-v5"><summary>${esc(s.full_name)} · ${s.amount == null ? 'Не задана' : rub(s.amount)}</summary><label for="salaryAmount5-${esc(s.id)}">Оплата за смену, ₽</label><input id="salaryAmount5-${esc(s.id)}" type="number" inputmode="decimal" min="0" step="0.01" value="${s.amount == null ? '' : num(s.amount)}"><label for="salaryReason5-${esc(s.id)}">Причина изменения *</label><input id="salaryReason5-${esc(s.id)}" value=""><p class="small">${s.amount == null ? 'Зарплата для этой смены не задана. Укажите сумму и причину.' : s.reason ? 'Последняя причина: ' + esc(s.reason) : 'Стандартная оплата: 2 000 ₽ за смену'}</p><button class="btn primary wide" onclick="saveSalaryV5('${esc(s.id)}')">Сохранить с указанием причины</button></details>`).join('')}` : ''}
 <h2>Списано со склада</h2><div class="report-used">${financeMedicationUsageHtmlV5(used) || '<p class="small">Списаний нет.</p>'}</div>
 ${(data.untracked || []).length ? `<h2>Учтено без складского списания</h2><p class="small">Количество препаратов в процедурах и продажах по прайсу. Эти операции включены в выручку и не меняли остатки склада.</p><div class="report-untracked-v5">${financeMedicationUsageHtmlV5(data.untracked)}</div>` : ''}
 <details><summary>Остатки ${owner ? 'склада и рабочего шкафа' : 'рабочего шкафа'}</summary>${(data.stock || []).map(m => `<div class="item"><strong>${esc(m.name)}</strong><div>В работе: ${qty(m.work)} ${esc(m.unit)}${owner ? ' · запас: ' + qty(m.reserve) + ' ' + esc(m.unit) : ''}</div></div>`).join('') || '<p>Нет препаратов.</p>'}</details>
 ${financeWarningHtmlV5((data.warnings || []).filter(w => owner || w.scope !== 'reserve'))}<details><summary>Процедуры (${num(data.procedures_count)})</summary>${financeEventsHtmlV5(data.procedures,'Процедура',owner)}</details><details><summary>Продажи (${num(data.sales_count)})</summary>${financeEventsHtmlV5(data.sales,'Продажа',owner)}</details><div id="salaryMessageV5" role="status"></div>`;
 $('report').querySelector('button[onclick="closeShift()"]').classList.toggle('hidden', closed || shiftData.status !== 'open');
 show('report');
}
async function openReportByIdV5(id) {
 try {
  const actor = currentStaff?.id, token = ++financeView5;
  financeReportId5 = id;
  const data = await crmFinanceRpcV5('shift_report', {shift_id:id});
  if (currentStaff?.id !== actor || token !== financeView5) return;
  renderShiftReportV5(data, data.shift?.status === 'closed');
 } catch (e) { message('homeMessage', e.message); const host = $('financeMessageV5'); if (host) host.textContent = e.message; }
}
openReport = async function() { if (!shift?.id) { await openShiftMenu(); return; } await openReportByIdV5(shift.id); };
closeShift = async function() {
 if (financeBusy5 || !financeReportId5) return;
 financeBusy5 = true;
 const button = $('report').querySelector('button[onclick="closeShift()"]'); if (button) button.disabled = true;
 try {
  const actor = currentStaff?.id, id = financeReportId5, data = await crmFinanceRpcV5('close', {shift_id:id});
  if (currentStaff?.id !== actor) return;
  if (shift?.id === id) shift = null;
  renderShiftReportV5(data, true); await loadQuickContext();
  if (isManager()) await refreshOwnerDashboardV5();
 } catch (e) { $('reportBody').insertAdjacentHTML('afterbegin', `<div class="notice">${esc(e.message)}</div>`); }
 finally { financeBusy5 = false; if (button) button.disabled = false; }
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

function installFinanceScreensV5() {
 const app = $('workspace')?.parentElement; if (!app) return;
 for (const [id,title] of [['cashV5','Касса'],['reportsV5','Отчёты'],['analyticsV5','Аналитика']]) {
  if ($(id)) continue;
  const screen = document.createElement('section'); screen.id = id; screen.className = 'screen finance-screen-v5';
  screen.innerHTML = `<div class="row between no-print"><h1>${title}</h1><button class="btn secondary" onclick="show('workspace')">Назад</button></div><div class="card no-print finance-filters-v5"><div class="grid2"><div><label for="${id}From">С даты</label><input id="${id}From" type="date"></div><div><label for="${id}To">По дату</label><input id="${id}To" type="date"></div></div>${id === 'reportsV5' ? `<label for="${id}Group">Группировка</label><select id="${id}Group" onchange="financeFilterGroupChangedV5()"><option value="day">По дням</option><option value="employee">По сотрудникам</option><option value="patient">По пациентам</option><option value="medication">По препаратам</option><option value="service">По услугам</option></select><label for="reportsV5Filter">Фильтр</label><select id="reportsV5Filter"><option value="">Все записи</option></select>` : ''}<button class="btn primary wide" onclick="loadFinanceSummaryV5('${id}')">Показать</button></div><div id="${id}Message" role="status" aria-live="polite"></div><div id="${id}Body"></div><div class="row no-print finance-export-v5"><button class="btn secondary" onclick="window.print()">Печать / PDF</button><button class="btn secondary" onclick="downloadFinanceCsvV5('${id}')">Скачать CSV</button></div>`;
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
 const group = $('reportsV5Group').value;
 const list = group === 'employee' ? nurses : group === 'patient' ? patients : group === 'medication' ? (inventory.length ? inventory : meds) : group === 'service' ? services : [];
 $('reportsV5Filter').innerHTML = '<option value="">Все записи</option>' + list.map(item => `<option value="${esc(item.id)}">${esc(item.full_name || item.name)}</option>`).join('');
 $('reportsV5Filter').disabled = group === 'day';
}
function renderFinanceSummaryV5(data, id) {
 const rows = data.rows || [], shifts = data.shifts || [];
 const basis = data.rows_revenue_basis === 'medication_line_share_of_paid_total' ? '<p class="small">По препаратам показана оплаченная стоимость препаратов с учётом скидки. Стоимость работы и расходников услуги в эти строки не входит. Количество — по процедурам и продажам; складские списания показаны отдельно в отчёте смены.</p>' : '';
 const operational = `<div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Продаж<b>${num(data.sales_count)}</b></div></div>`;
 return `<p class="small">${esc(data.from)} — ${esc(data.to)} · ${esc(data.time_zone || '')}</p>${operational}${financePaymentOnlyNoteV5(data)}${financeRevenueHtmlV5(data.revenue)}<div class="card"><div>Зарплата за смены: <b>${financePayrollTextV5(data)}</b></div><h2>Денежный остаток после выплаты зарплаты</h2><div class="money">${financeRemainingTextV5(data)}</div><p class="small">Выручка минус зарплата. Не является прибылью.${data.has_open_shifts === true ? ' Есть незакрытые смены: итог предварительный.' : ''}</p>${financePayrollNoteV5(data)}${num(data.payroll_open) ? `<p class="small">По открытым сменам начислено: ${rub(data.payroll_open)}</p>` : ''}</div><h2>${id === 'reportsV5' ? 'По выбранной группировке' : 'По дням'}</h2>${basis}<div class="finance-rows-v5">${rows.map(row => `<div class="item"><div class="row between"><strong>${esc(row.label || row.id || 'Без названия')}</strong><b>${rub(row.revenue?.total)}</b></div><div class="small">Пациентов: ${num(row.patients_count)} · процедур: ${num(row.procedures_count)} · продаж: ${num(row.sales_count)}${row.quantity !== undefined ? ' · учтено единиц: ' + qty(row.quantity) : ''}</div><div class="small">Наличные ${rub(row.revenue?.cash)} · терминал ${rub(row.revenue?.terminal)} · перевод ${rub(row.revenue?.owner_card)}</div></div>`).join('') || '<p class="small">За этот период записей нет.</p>'}</div><h2>Смены за период</h2><div class="finance-rows-v5">${shifts.map(s => `<button class="item click finance-shift-v5" onclick="openReportByIdV5('${esc(s.id)}')"><strong>${esc(s.shift_date)} · ${s.status === 'open' ? 'Открыта' : 'Закрыта'}</strong><div>${esc((s.staff || []).map(n => n.full_name).join(', '))}</div><div class="small">${esc(shiftLabel(s.started_at,s.ended_at))} · зарплата ${s.payroll_complete === false ? 'не полностью задана' : rub(s.payroll_total)}</div></button>`).join('') || '<p class="small">Смен нет.</p>'}</div>`;
}
async function loadFinanceSummaryV5(id) {
 let token;
 try {
  financeRequireOwnerV5(); token = ++financeView5;
  const from = $(id + 'From').value, to = $(id + 'To').value;
  if (!from || !to || from > to) throw Error('Укажите корректный период');
  const payload = {from,to,group_by:id === 'reportsV5' ? $('reportsV5Group').value : 'day'};
  if (id === 'reportsV5' && $('reportsV5Filter').value) payload[payload.group_by + '_id'] = $('reportsV5Filter').value;
  message(id + 'Message','Загружаем…');
  const [data,settings] = await Promise.all([crmFinanceRpcV5('summary',payload),id === 'cashV5' ? crmFinanceRpcV5('settings_get') : Promise.resolve(null)]);
  if (token !== financeView5 || !isManager()) return;
  financeSnapshots5.set(id,data); $(id + 'Body').innerHTML = renderFinanceSummaryV5(data,id);
  if (settings) $(id + 'Body').insertAdjacentHTML('afterbegin',`<div class="card"><span>Разменный фонд</span><div class="money">${rub(settings.float_amount)}</div><p class="small">Отдельная сумма для выдачи сдачи. В выручку и денежный остаток после зарплаты не включается.</p></div>`);
  if (id === 'analyticsV5') {
   await loadInventory(); if (token !== financeView5 || !isManager()) return;
   $(id + 'Body').insertAdjacentHTML('beforeend', renderInventoryAnalyticsV5());
  }
  message(id + 'Message','');
 } catch (e) { if (token === undefined || token === financeView5) message(id + 'Message',e.message); }
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
 const rows = [['Период',data.from,data.to],['Показатель','Значение'],['Общая выручка',revenue.total || 0],['Наличные',revenue.cash || 0],['Терминал',revenue.terminal || 0],['Переводы владельцу',revenue.owner_card || 0],['Без способа оплаты',revenue.unclassified || 0],['Зарплата',data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : data.payroll_total || 0],['Не задана зарплата: сотрудников',data.payroll_unknown || 0],['Денежный остаток после выплаты зарплаты',data.payroll_scope === 'not_applicable_to_entity_filter' ? 'Не применяется к этому фильтру' : data.cash_after_salary === null ? 'Не рассчитан: укажите зарплату за прошлые смены' : data.cash_after_salary || 0],[],['Группа','Пациенты','Процедуры','Продажи','Количество','Наличные','Терминал','Переводы','Общая выручка']];
 if (num(data.payment_only_procedures_count) || num(data.payment_only_sales_count)) rows.splice(rows.length-2,0,['Процедуры без складского списания',num(data.payment_only_procedures_count)],['Продажи без складского списания',num(data.payment_only_sales_count)]);
 rows[rows.length-1][4]='Количество по операциям';
 for (const row of data.rows || []) rows.push([row.label,row.patients_count,row.procedures_count,row.sales_count,row.quantity ?? '',row.revenue?.cash,row.revenue?.terminal,row.revenue?.owner_card,row.revenue?.total]);
 return '\uFEFF' + rows.map(row => row.map(financeCsvCellV5).join(';')).join('\r\n');
}
function downloadFinanceCsvV5(id) {
 try {
  financeRequireOwnerV5(); const data = financeSnapshots5.get(id); if (!data) throw Error('Сначала сформируйте отчёт');
  const url = URL.createObjectURL(new Blob([buildFinanceCsvV5(data)],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `procedural-cabinet-${data.from}-${data.to}.csv`; a.click(); URL.revokeObjectURL(url);
 } catch (e) { message(id + 'Message', e.message); }
}
async function refreshOwnerDashboardV5() {
 if (!isManager()) return;
 let host = $('ownerDashboardV5');
 if (!host) { host = document.createElement('div'); host.id = 'ownerDashboardV5'; $('workspace').appendChild(host); }
 const actor = currentStaff.id, generation = financeView5, date = localDateValue();
 try {
  const [data,stockLoaded] = await Promise.all([crmFinanceRpcV5('summary',{from:date,to:date,group_by:'day'}),loadInventory()]);
  if (!isManager() || currentStaff.id !== actor || generation !== financeView5) return;
  host.innerHTML = `<h2>Сегодня</h2><div class="stats"><div class="stat">Пациентов<b>${num(data.patients_count)}</b></div><div class="stat">Процедур<b>${num(data.procedures_count)}</b></div><div class="stat">Выручка<b>${rub(data.revenue?.total)}</b></div></div><div class="card"><span>Денежный остаток после выплаты зарплаты</span><div class="money">${financeRemainingTextV5(data)}</div><p class="small">${data.has_open_shifts === true ? 'Предварительно: есть открытые смены. ' : ''}Зарплата: ${financePayrollTextV5(data)}. Показатель не является прибылью.</p>${financePayrollNoteV5(data)}</div>${stockLoaded === false ? '<div class="notice">Не удалось обновить остатки склада. Откройте склад и повторите загрузку.</div>' : renderOwnerStockOverviewV5()}`;
 } catch (e) { if (isManager() && currentStaff.id === actor && generation === financeView5) host.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
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
 financeAccountingLoad5++; financeAccountingMode5 = null;
 financeTreatmentMode5.proc = null; financeTreatmentMode5.sale = null;
 financeTreatmentReceipt5.proc = null; financeTreatmentReceipt5.sale = null;
 financeAccountingMismatch5.proc = false; financeAccountingMismatch5.sale = false;
 for (const id of ['accountingModeBannerV5','procAccountingModeV5','saleAccountingModeV5']) if ($(id)) $(id).innerHTML = '';
 financeView5++; financeRequests5.clear(); financeSnapshots5.clear(); financeReportId5 = null;
 for (const id of ['cashV5Body','reportsV5Body','analyticsV5Body','ownerDashboardV5','reportBody']) if ($(id)) $(id).innerHTML = '';
 financePaymentState5.proc = null; financePaymentState5.sale = null;
 await financeSignOutBase5();
};
