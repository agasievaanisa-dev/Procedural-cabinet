/* Owner-only warehouse movements for a Moscow date interval, and current stock. */
(function(root) {
 'use strict';
 const zone = 'Europe/Moscow';
 const operations = {purchase:'Поступление',correction:'Корректировка',reserve_to_work:'Перевод в работу',work_to_reserve:'Возврат в запас',write_off:'Списание',procedure_use:'Расход на процедуру',sale:'Продажа'};
 function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
 function locationLabel(value) { return value === 'reserve' ? 'Запас' : value === 'work' ? 'В работе' : value || '—'; }
 function operationLabel(value) { return operations[value] || value || 'Не указана'; }
 function moscowDate(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 }
 function moscowTime(value) {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime()) ? 'Не указано' : new Intl.DateTimeFormat('ru-RU',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
 }
 function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
 }
 function reportPayload(from,to,medicationId = '') {
  if (!validDate(from) || !validDate(to)) throw Error('Укажите начало и окончание периода');
  if (from > to) throw Error('Начало периода позже окончания');
  if (medicationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(medicationId)) throw Error('Выберите препарат из списка');
  return {from,to,...(medicationId ? {medication_id:medicationId} : {})};
 }
 function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
 }
 function buildCsv(report) {
  const rows = [
   ['Складской отчёт'],['Период движений',report.from,report.to],['Часовой пояс',zone],
   ['Текущие остатки на момент формирования',moscowTime(report.generated_at)],[],
   ['Текущие остатки'],['Препарат','Единица','Статус','Запас сейчас','В работе сейчас','Всего сейчас','Изменение запаса за период','Изменение в работе за период','Движений за период']
  ];
  for (const item of report.medications || []) rows.push([item.name,item.unit,item.active ? 'Активный' : 'Архив',item.reserve_current,item.work_current,item.total_current,item.reserve_delta,item.work_delta,item.movement_count]);
  rows.push([],['Движения за период'],['Дата и время (Москва)','Препарат','Единица','Операция','Количество','Откуда','Куда','Партия','Сотрудник','Комментарий']);
  for (const item of report.movements || []) rows.push([moscowTime(item.at),item.name,item.unit,operationLabel(item.type),item.quantity,locationLabel(item.from_location),locationLabel(item.to_location),item.batch_number,item.actor_name,item.comment]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
 }
 function quantity(value) { return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:6}).format(Number(value) || 0); }
 function renderReport(report) {
  const e = escapeHtml;
  return `<div class="card warehouse-report-summary-v5"><h2>Движения: ${e(report.from)} — ${e(report.to)}</h2><p>Москва · ${quantity(report.movements_count)} движений · ${quantity(report.medications_count)} препаратов</p><p class="small">Текущие остатки на ${e(moscowTime(report.generated_at))}. Остатки показывают состояние сейчас; изменения относятся к выбранному периоду.</p></div>
   <h2>Текущие остатки</h2><div class="warehouse-report-stocks-v5">${(report.medications || []).map(item => `<article class="card"><h3>${e(item.name)}</h3><p class="small">${e(item.unit)}${item.active ? '' : ' · Архив'}</p><div class="warehouse-report-quantities-v5"><div><span>Запас сейчас</span><strong>${quantity(item.reserve_current)}</strong></div><div><span>В работе сейчас</span><strong>${quantity(item.work_current)}</strong></div><div><span>Всего сейчас</span><strong>${quantity(item.total_current)}</strong></div></div><p class="small">Изменение за период: запас ${quantity(item.reserve_delta)}; в работе ${quantity(item.work_delta)}. Движений: ${quantity(item.movement_count)}.</p></article>`).join('') || '<p class="card">Препаратов нет</p>'}</div>
   <h2>Движения за период</h2><div class="warehouse-report-movements-v5">${(report.movements || []).map(item => `<article class="card"><div class="row between"><strong>${e(item.name)}</strong><span>${quantity(item.quantity)} ${e(item.unit)}</span></div><p>${e(operationLabel(item.type))}: ${e(locationLabel(item.from_location))} → ${e(locationLabel(item.to_location))}</p><p class="small">${e(moscowTime(item.at))} · ${e(item.actor_name)}${item.batch_number ? ' · Партия ' + e(item.batch_number) : ''}</p>${item.comment ? `<p class="small">${e(item.comment)}</p>` : ''}</article>`).join('') || '<p class="card">За выбранный период движений нет</p>'}</div>`;
 }
 const helpers = {escapeHtml,locationLabel,operationLabel,moscowDate,moscowTime,validDate,reportPayload,csvCell,buildCsv,renderReport};
 if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
 root.CrmWarehouseReportV5 = helpers;
 if (typeof document === 'undefined') return;

 const get = id => document.getElementById(id);
 let snapshot = null, generation = 0, origin = 'admin';
 function owner() { return typeof isManager === 'function' && isManager() && typeof currentStaff !== 'undefined' && !!currentStaff?.id; }
 function requireOwner() { if (!owner()) throw Error('Складской отчёт доступен только владельцу'); }
 function status(text,failed = false) {
  const node = get('warehouseReportV5Message');
  if (node) { node.textContent = text; node.className = failed ? 'warehouse-report-error-v5' : ''; }
 }
 function invalidate() {
  generation++; snapshot = null;
  if (get('warehouseReportV5Load')) get('warehouseReportV5Load').disabled = false;
  if (get('warehouseReportV5Csv')) get('warehouseReportV5Csv').disabled = true;
  if (get('warehouseReportV5Body')) get('warehouseReportV5Body').replaceChildren();
 }
 function ensureScreen() {
  if (get('warehouseReportV5')) return;
  const section = document.createElement('section');
  section.id = 'warehouseReportV5'; section.className = 'screen warehouse-report-v5';
  section.innerHTML = `<div class="row between no-print"><h1>Отчёт склада</h1><button type="button" id="warehouseReportV5Back" class="btn secondary">Назад</button></div><div class="card no-print"><div class="warehouse-report-filters-v5"><div><label for="warehouseReportV5From">С даты</label><input id="warehouseReportV5From" type="date"></div><div><label for="warehouseReportV5To">По дату</label><input id="warehouseReportV5To" type="date"></div></div><label for="warehouseReportV5Medication">Препарат</label><select id="warehouseReportV5Medication"><option value="">Все препараты, включая архив</option></select><button type="button" class="btn primary wide" id="warehouseReportV5Load">Показать отчёт</button><p class="small">Движения за период по Москве. Остатки — на момент формирования отчёта.</p></div><div id="warehouseReportV5Message" role="status" aria-live="polite"></div><div id="warehouseReportV5Body"></div><div class="row no-print"><button type="button" class="btn secondary" id="warehouseReportV5Csv" disabled>Скачать CSV</button><button type="button" class="btn secondary" id="warehouseReportV5Print">Печать / PDF</button></div>`;
  document.querySelector('.app').appendChild(section);
  const today = moscowDate();
  get('warehouseReportV5From').value = today.slice(0,8) + '01'; get('warehouseReportV5To').value = today;
  get('warehouseReportV5Back').onclick = () => show(origin);
  get('warehouseReportV5Load').onclick = loadReport;
  get('warehouseReportV5Csv').onclick = downloadCsv;
  get('warehouseReportV5Print').onclick = () => { if (owner() && snapshot) root.print(); else status('Сначала сформируйте отчёт',true); };
  for (const id of ['warehouseReportV5From','warehouseReportV5To','warehouseReportV5Medication']) get(id).onchange = () => { invalidate(); status('Параметры изменены. Нажмите «Показать отчёт».'); };
 }
 function installEntry(screenId) {
  if (!owner() || !['admin','reportsV5'].includes(screenId)) return;
  const section = get(screenId), id = screenId + 'WarehouseReportLinkV5';
  if (!section || get(id)) return;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'btn secondary warehouse-report-link-v5'; button.id = id; button.textContent = 'Отчёт склада';
  button.onclick = () => openReport(screenId);
  (section.querySelector(screenId === 'admin' ? '.warehouse-tools' : '.finance-filters-v5') || section).appendChild(button);
 }
 async function loadReport() {
  let token,staffId;
  try {
   requireOwner(); ensureScreen();
   const payload = reportPayload(get('warehouseReportV5From').value,get('warehouseReportV5To').value,get('warehouseReportV5Medication').value);
   invalidate(); token = generation; staffId = currentStaff.id;
   get('warehouseReportV5Load').disabled = true; status('Формируем отчёт…');
   const {data,error} = await db.rpc('crm_warehouse_report_v5',{p_payload:payload});
   if (token !== generation || !owner() || currentStaff.id !== staffId) return;
   if (error) throw Error(error.message || 'Не удалось получить отчёт');
   if (!data || !Array.isArray(data.medications) || !Array.isArray(data.movements)) throw Error('Сервер вернул некорректный отчёт');
   snapshot = data;
   const select = get('warehouseReportV5Medication'), chosen = select.value;
   select.innerHTML = '<option value="">Все препараты, включая архив</option>' + (data.catalog || []).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.active ? '' : ' (архив)'}</option>`).join('');
   select.value = chosen;
   get('warehouseReportV5Body').innerHTML = renderReport(data); get('warehouseReportV5Csv').disabled = false; status('');
  } catch (error) { if (token === undefined || token === generation) status(error.message,true); }
  finally { if (token === generation && get('warehouseReportV5Load')) get('warehouseReportV5Load').disabled = false; }
 }
 function openReport(from = 'admin') {
  try {
   requireOwner(); origin = ['admin','reportsV5'].includes(from) ? from : 'admin'; ensureScreen();
   if (origin === 'reportsV5' && validDate(get('reportsV5From')?.value) && validDate(get('reportsV5To')?.value)) {
    get('warehouseReportV5From').value = get('reportsV5From').value; get('warehouseReportV5To').value = get('reportsV5To').value;
   }
   show('warehouseReportV5'); loadReport();
  } catch (error) { if (typeof message === 'function') message('homeMessage',error.message); }
 }
 function downloadCsv() {
  try {
   requireOwner(); if (!snapshot) throw Error('Сначала сформируйте отчёт');
   const url = URL.createObjectURL(new Blob([buildCsv(snapshot)],{type:'text/csv;charset=utf-8'}));
   const link = document.createElement('a'); link.href = url; link.download = `warehouse-${snapshot.from}-${snapshot.to}.csv`;
   document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch (error) { status(error.message,true); }
 }
 root.openWarehouseReportV5 = openReport;
 const previousShow = show;
 show = function(id) {
  if (id === 'warehouseReportV5') {
   if (!owner()) { if (typeof message === 'function') message('homeMessage','Складской отчёт доступен только владельцу'); id = 'workspace'; }
   else ensureScreen();
  } else if (get('warehouseReportV5')?.classList.contains('active')) invalidate();
  previousShow(id); installEntry(id);
 };
 const previousSignOut = signOut;
 signOut = async function() {
  invalidate(); get('warehouseReportV5')?.remove();
  get('adminWarehouseReportLinkV5')?.remove(); get('reportsV5WarehouseReportLinkV5')?.remove();
  return previousSignOut();
 };
 installEntry('admin'); installEntry('reportsV5');
})(typeof window === 'undefined' ? globalThis : window);
