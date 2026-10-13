/* Visit input always represents Moscow wall time, independent of device timezone. */
(function (global) {
 'use strict';
 const offset = 3 * 60 * 60 * 1000;
 const pad = value => String(value).padStart(2,'0');
 function parts(value) {
  if (value == null || value === '') throw Error('Не удалось прочитать время посещения');
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(instant)) throw Error('Не удалось прочитать время посещения');
  const date = new Date(instant + offset);
  return {date:String(date.getUTCFullYear()).padStart(4,'0') + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()),time:pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes())};
 }
 function nowParts(value = new Date()) { return parts(value); }
 function toIso(date,time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!dateMatch) throw Error('Укажите дату посещения');
  const [year,month,day] = dateMatch.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year,month - 1,day));
  if (year < 1000 || year > 9999 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw Error('Укажите существующую дату посещения');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || ''));
  if (!timeMatch) throw Error('Укажите точное время посещения');
  const [hour,minute,second] = timeMatch.slice(1).map(value => Number(value || 0));
  if (hour > 23 || minute > 59 || second > 59) throw Error('Укажите время посещения от 00:00 до 23:59');
  return new Date(Date.UTC(year,month - 1,day,hour,minute,second) - offset).toISOString();
 }
 function optionalIso(date,time) { return !date && !time ? null : toIso(date,time); }
 const helpers = {parts,nowParts,toIso,optionalIso};
 if (typeof module === 'object' && module.exports) module.exports = helpers;
 global.CrmVisitTimeV23 = helpers;
})(typeof window === 'object' ? window : globalThis);
