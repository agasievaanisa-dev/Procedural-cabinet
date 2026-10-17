const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');

const code = fs.readFileSync(__dirname + '/../crm-pdf-v40.js','utf8');
const fontFiles = ['Roboto-Regular.ttf','Roboto-Medium.ttf','Roboto-Italic.ttf','Roboto-MediumItalic.ttf'];
const vfs = Object.fromEntries(fontFiles.map(file => [file,'local-font']));
function element(tag, attrs = {}, ...children) {
 return {nodeType:1,tagName:tag.toUpperCase(),childNodes:children.flat().map(child => typeof child === 'string' ? {nodeType:3,nodeValue:child} : child),getAttribute:name => attrs[name] ?? null,hasAttribute:name => Object.hasOwn(attrs,name)};
}
function boot(ready = true) {
 const scripts = [], definitions = [];
 const pdfMake = {addVirtualFileSystem(){},createPdf(definition,layout,fonts,files) {
  definitions.push({definition,fonts,files});
  return {getStream() { const stream = new EventEmitter();stream.end = () => {stream.emit('data',new TextEncoder().encode('%PDF-1.7 fixture'));stream.emit('end');};return stream; }};
 }};
 const context = {URL,Blob,setTimeout,clearTimeout,location:{href:'https://clinic.example/app/index.html',origin:'https://clinic.example'},document:{currentScript:{src:'https://clinic.example/app/crm-pdf-v40.js'},createElement:() => ({remove(){this.removed = true;}}),head:{appendChild:script => scripts.push(script)}},...(ready ? {pdfMake,vfs} : {})};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,scripts,pdfMake,definitions};
}
function find(value, predicate, result = []) {
 if (!value || typeof value !== 'object') return result;
 if (predicate(value)) result.push(value);
 for (const child of Object.values(value)) find(child,predicate,result);
 return result;
}

test('definition preserves visit order, doses, quantities, discounts, channels and safe anchor text without reading URLs',() => {
 const {context} = boot();
 let urlRead = false;
 const link = element('a',{href:'https://secret.example/file'},'Название документа');
 Object.defineProperty(link,'href',{get(){urlRead = true;throw Error('URL must not be read');}});
 const source = element('article',{},element('h1',{},'Отчёт смены'),element('ol',{class:'shift-print-events-v5'},
  element('li',{},element('h2',{},'Первый пациент'),element('ul',{},element('li',{},'Препарат 500 мг × 2 амп. · Доза: 250 мг')),
   element('div',{class:'report-event-prices-v14'},element('div',{},'По прайсу: ',element('b',{},'1200 ₽')),element('div',{},'Скидка: ',element('b',{},'200 ₽'))),
   element('div',{class:'report-payment-methods-v34'},element('div',{},'Наличные: ',element('b',{},'500 ₽')),element('div',{},'Терминал: ',element('b',{},'300 ₽'))),link),
  element('li',{},element('h2',{},'Второй пациент'))),
  element('script',{},'secret script'),element('form',{},'secret form'),element('button',{},'secret button'),element('img',{src:'https://secret.example/photo'}),element('iframe',{},'secret frame'),
  element('div',{class:'no-print'},'secret warehouse'),element('div',{hidden:''},'secret hidden'),element('div',{class:'hidden'},'secret class'));
 const before = source.childNodes.slice(), definition = context.crmPdfDefinitionV40(source);
 const serialized = JSON.stringify(definition);
 assert.ok(serialized.indexOf('Первый пациент') < serialized.indexOf('Второй пациент'));
 for (const text of ['Препарат 500 мг × 2 амп. · Доза: 250 мг','По прайсу:','1200 ₽','Скидка:','200 ₽','Наличные:','500 ₽','Терминал:','300 ₽','Название документа']) assert.ok(serialized.includes(text),text);
 assert.ok(!serialized.includes('secret'));
 assert.ok(!serialized.includes('href'));
 assert.equal(urlRead,false);
 assert.deepEqual(source.childNodes,before);
 assert.equal(definition.defaultStyle.font,'Roboto');
 assert.equal(definition.pageSize,'A4');
 assert.equal(find(definition,item => Array.isArray(item.ol))[0].ol.length,2);
});

test('cash counts and finance summary become compact rows while useful details remain',() => {
 const {context} = boot();
 const source = element('article',{},element('div',{class:'finance-totals-v5'},
  element('div',{class:'stat'},element('span',{},'Зарплата'),element('b',{},'4000 ₽'),element('small',{},'Учтено из наличных')),
  element('div',{class:'stat'},element('span',{},'Касса'),element('b',{},'7000 ₽'))),
  element('details',{},element('summary',{},'Сверка наличных'),element('dl',{class:'cash-count-values-v37'},
   element('div',{},element('dt',{},'По учёту'),element('dd',{},'7000 ₽')),
   element('div',{},element('dt',{},'Пересчитано'),element('dd',{},'6900 ₽')),
   element('div',{},element('dt',{},'Расхождение'),element('dd',{},'−100 ₽')))),
  element('details',{class:'no-print'},element('summary',{},'secret editing')));
 const definition = context.crmPdfDefinitionV40(source,{title:'Финансы'}), tables = find(definition,item => item.table);
 assert.equal(definition.info.title,'Финансы');
 assert.equal(tables.length,2);
 assert.equal(tables[0].table.body.length,2);
 assert.equal(tables[1].table.body.length,3);
 const text = JSON.stringify(definition);
 for (const expected of ['Учтено из наличных','Сверка наличных','Пересчитано','6900 ₽','−100 ₽']) assert.ok(text.includes(expected));
 assert.ok(!text.includes('secret editing'));
});

test('financial shift buttons become inert report rows while ordinary action buttons are omitted',() => {
 const {context} = boot();
 const source = element('article',{},element('h2',{},'Смены за период'),
  element('button',{class:'item click finance-shift-v5',onclick:"openReportByIdV5('period-shift')"},
   element('strong',{},'2026-10-15 · Закрыта'),element('div',{},'Наталья, Лилия'),
   element('div',{class:'small'},'08:30–16:00 · зарплата 4 000 ₽')),
  element('button',{onclick:'saveSalary()'},'Секретная кнопка изменения зарплаты'),
  element('button',{class:'finance-shift-v5 no-print'},'Скрытая строка смены'));
 const definition = context.crmPdfDefinitionV40(source), serialized = JSON.stringify(definition);
 for(const expected of ['Смены за период','2026-10-15 · Закрыта','Наталья, Лилия','08:30–16:00 · зарплата 4 000 ₽'])assert.ok(serialized.includes(expected),expected);
 for(const omitted of ['Секретная кнопка','Скрытая строка','onclick','openReportByIdV5','saveSalary'])assert.ok(!serialized.includes(omitted),omitted);
 assert.equal(source.childNodes[1].tagName,'BUTTON');
});

test('PDF uses local pinned fonts, captures content before awaiting and returns a PDF blob',async () => {
 const {context,definitions,scripts} = boot();
 const heading = element('h1',{},'Зафиксированный отчёт'), source = element('article',{},heading);
 const pending = context.crmPdfBlobV40(source);
 heading.childNodes[0].nodeValue = 'Изменённый отчёт';
 const blob = await pending;
 assert.equal(blob.type,'application/pdf');
 assert.ok(blob.size > 0);
 assert.equal(scripts.length,0);
 assert.ok(JSON.stringify(definitions[0].definition).includes('Зафиксированный отчёт'));
 assert.deepEqual(Object.values(definitions[0].fonts.Roboto),fontFiles);
 assert.equal(definitions[0].files,vfs);
});

test('inline receipts separate nested payment methods and tables retain empty cells',() => {
 const {context} = boot();
 const source = element('article',{},element('div',{class:'report-inline-receipt-v39'},
  element('strong',{},'Анна'),' · ',element('span',{},'Оплата после процедуры'),
  element('div',{class:'report-payment-methods-v34'},element('div',{},'Наличные: ',element('b',{},'100 ₽')),element('div',{},'Терминал: ',element('b',{},'200 ₽')))),
  element('table',{},element('tr',{},element('td',{},'Первое'),element('td'),element('td',{},'Третье'))));
 const definition = context.crmPdfDefinitionV40(source), receipt = definition.content[0].text.map(value => value.text).join('');
 assert.equal(receipt,'Анна · Оплата после процедуры · Наличные: 100 ₽ · Терминал: 200 ₽');
 assert.equal(find(definition,item => item.table)[0].table.body[0].length,3);
});

test('sequential same-origin library loading is shared and can retry after a failure',async () => {
 const {context,scripts,pdfMake} = boot(false), source = element('article',{},element('h1',{},'Отчёт'));
 const failed = context.crmPdfBlobV40(source);
 assert.equal(scripts.length,1);
 scripts[0].onerror();
 await assert.rejects(failed,/загрузить библиотеку/);
 assert.equal(scripts[0].removed,true);
 const first = context.crmPdfBlobV40(source), second = context.crmPdfBlobV40(source);
 assert.equal(scripts.length,2);
 assert.equal(scripts[1].src,'https://clinic.example/app/vendor/pdfmake-0.2.20.min.js');
 context.pdfMake = pdfMake;scripts[1].onload();
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(scripts.length,3);
 assert.equal(scripts[2].src,'https://clinic.example/app/vendor/pdfmake-vfs-0.2.20.js');
 context.vfs = vfs;scripts[2].onload();
 const blobs = await Promise.all([first,second]);
 assert.ok(blobs.every(blob => blob.type === 'application/pdf'));
});
