(function (root) {
 'use strict';

 const bundleSource = root.document?.currentScript?.src || '';
 const fonts = {Roboto:{normal:'Roboto-Regular.ttf',bold:'Roboto-Medium.ttf',italics:'Roboto-Italic.ttf',bolditalics:'Roboto-MediumItalic.ttf'}};
 const fontFiles = Object.values(fonts.Roboto);
 const omitted = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','LINK','META','BASE','FORM','INPUT','TEXTAREA','SELECT','OPTION','BUTTON','IFRAME','FRAME','OBJECT','EMBED','IMG','PICTURE','SVG','CANVAS','AUDIO','VIDEO','SOURCE','TRACK']);
 const inlineTags = new Set(['SPAN','STRONG','B','EM','I','U','S','SMALL','TIME','A','ABBR','SUP','SUB','CODE']);
 let libraryPromise = null, fontTarget = null;

 function classes(node) { return String(node.getAttribute?.('class') || '').split(/\s+/).filter(Boolean); }
 function has(node, name) { return node.classes?.includes(name) === true; }
 function integer(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }

 // Construct a detached, inert clone. Attributes, event handlers, URLs, styles,
 // controls and media never enter either the clone or the PDF definition.
 function sanitizedClone(node) {
  if (node.nodeType === 3) return {tag:'#text',text:String(node.nodeValue ?? node.textContent ?? '').replace(/\s+/g,' ')};
  if (node.nodeType !== 1) return null;
  const originalTag = String(node.tagName || '').toUpperCase(), names = classes(node);
  const tag = originalTag === 'BUTTON' && names.includes('finance-shift-v5') ? 'DIV' : originalTag;
  if (omitted.has(tag) || names.includes('no-print') || names.includes('hidden') || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return null;
  const children = Array.from(node.childNodes || []).map(sanitizedClone).filter(Boolean);
  return {tag,classes:names,children,start:integer(node.getAttribute?.('start'),1),value:integer(node.getAttribute?.('value'),null),colspan:Math.min(20,integer(node.getAttribute?.('colspan'),1))};
 }
 function textOf(node) { return node.tag === '#text' ? node.text : (node.children || []).map(textOf).join(''); }
 function meaningful(node) { return node && (node.tag === 'BR' || node.tag === 'HR' || textOf(node).trim()); }
 function compactChildren(node) { return (node.children || []).filter(meaningful); }

 function inlines(node, inherited) {
  const style = {...inherited};
  if (node.tag === '#text') return node.text ? [{text:node.text,...style}] : [];
  if (node.tag === 'BR') return [{text:'\n',...style}];
  if (['STRONG','B','TH'].includes(node.tag)) style.bold = true;
  if (['EM','I'].includes(node.tag)) style.italics = true;
  if (node.tag === 'U') style.decoration = 'underline';
  if (node.tag === 'S') style.decoration = 'lineThrough';
  if (node.tag === 'SMALL') style.fontSize = 8.5;
  if (node.tag === 'SUP') style.sup = true;
  if (node.tag === 'SUB') style.sub = true;
  if (['report-event-prices-v14','report-event-payment-v5','report-payment-methods-v34','report-inline-receipt-v39'].some(name => has(node,name))) return flowParts(node,style);
  return (node.children || []).flatMap(child => inlines(child,style));
 }
 function paragraph(nodes, options) {
  const values = (Array.isArray(nodes) ? nodes : [nodes]).flatMap(node => inlines(node,{}));
  if (!values.some(value => value.text.trim())) return null;
  // Trim only the outer edges; spaces between bold and plain fragments matter.
  values[0].text = values[0].text.trimStart();
  values[values.length - 1].text = values[values.length - 1].text.trimEnd();
  return {text:values,margin:[0,0,0,3],...options};
 }
 function table(body, options) {
  return {table:{widths:['*','auto'],body,...options},layout:{hLineWidth:()=>0,vLineWidth:()=>0,paddingLeft:()=>0,paddingRight:()=>6,paddingTop:()=>1,paddingBottom:()=>2},margin:[0,0,0,4]};
 }
 function isPair(node) {
  return has(node,'stat') || has(node,'shift-summary-row-v16') || has(node,'cash-row-v30') || (has(node,'row') && has(node,'between'));
 }
 function pair(node) {
  const children = compactChildren(node), amount = children.find(child => ['B','STRONG'].includes(child.tag) && child !== children[0]) || children.find(child => child.tag === 'B');
  if (!amount) return [{text:textOf(node).trim()},{text:''}];
  const rest = children.filter(child => child !== amount), notes = rest.filter(child => child.tag === 'SMALL'), labels = rest.filter(child => child.tag !== 'SMALL');
  return [notes.length ? {stack:[paragraph(labels,{margin:[0,0,0,0]}),...notes.map(note => paragraph(note,{fontSize:8.5,color:'#555555',margin:[0,1,0,0]}))].filter(Boolean)} : paragraph(labels,{margin:[0,0,0,0]}) || {text:''},paragraph(amount,{alignment:'right',margin:[0,0,0,0]}) || {text:''}];
 }
 function flowParts(node, inherited) {
  const children = compactChildren(node), output = [];
  children.forEach((child,index) => {
   if (index && child.tag !== '#text' && children[index - 1].tag !== '#text') output.push({text:' · '});
   output.push(...inlines(child,inherited));
  });
  return output;
 }
 function flow(node) {
  const output = flowParts(node,{});
  return output.length ? {text:output,margin:[0,0,0,3]} : null;
 }
 function definitionList(node) {
  const entries = [];
  function collect(current) {
   for (const child of current.children || []) {
    if (child.tag === 'DT' || child.tag === 'DD') entries.push(child);
    else if (child.tag !== '#text') collect(child);
   }
  }
  collect(node);
  const body = [];
  for (const entry of entries) {
   if (entry.tag === 'DT') body.push([paragraph(entry,{margin:[0,0,0,0]}) || {text:''},{text:''}]);
   else {
    if (!body.length) body.push([{text:''},{text:''}]);
    const row = body[body.length - 1], value = paragraph(entry,{bold:true,alignment:'right',margin:[0,0,0,0]}) || {text:''};
    row[1] = row[1].text === '' ? value : {stack:[row[1],value]};
   }
  }
  return body.length ? table(body) : null;
 }
 function htmlTable(node) {
  const rows = [];
  function collect(current) {
   for (const child of current.children || []) {
    if (child.tag === 'TR') rows.push(child);
    else if (['THEAD','TBODY','TFOOT'].includes(child.tag)) collect(child);
   }
  }
  collect(node);
  let columns = 0;
  const body = rows.map(row => {
   const cells = [];
   for (const cell of (row.children || []).filter(child => child.tag === 'TD' || child.tag === 'TH')) {
    const content = blocks(cell), count = cell.colspan;
    cells.push({stack:content.length ? content : [{text:''}],...(cell.tag === 'TH' ? {bold:true} : {}),...(count > 1 ? {colSpan:count} : {})});
    for (let index = 1; index < count; index++) cells.push({});
   }
   columns = Math.max(columns,cells.length);
   return cells;
  });
  if (!columns) return null;
  body.forEach(row => { while (row.length < columns) row.push({text:''}); });
  const result = table(body,{widths:Array(columns).fill('*'),headerRows:(rows[0].children || []).some(child => child.tag === 'TH') ? 1 : 0});
  return result;
 }

 function convert(node) {
  if (!meaningful(node)) return [];
  if (node.tag === '#text' || inlineTags.has(node.tag)) return [paragraph(node)].filter(Boolean);
  if (/^H[1-6]$/.test(node.tag)) {
   const level = Number(node.tag[1]);
   return [paragraph(node,{fontSize:level === 1 ? 16 : level === 2 ? 12 : 10.5,bold:true,headlineLevel:level,margin:[0,level === 1 ? 0 : 7,0,4]})];
  }
  if (node.tag === 'HR') return [{canvas:[{type:'line',x1:0,y1:0,x2:539,y2:0,lineWidth:0.5,lineColor:'#cccccc'}],margin:[0,4,0,6]}];
  if (node.tag === 'P' || node.tag === 'PRE' || node.tag === 'SUMMARY') return [paragraph(node,node.tag === 'SUMMARY' ? {bold:true,margin:[0,5,0,3]} : has(node,'small') ? {fontSize:8.5,color:'#555555'} : {})].filter(Boolean);
  if (node.tag === 'UL' || node.tag === 'OL') {
   const items = compactChildren(node).filter(child => child.tag === 'LI').map(child => {
    const content = blocks(child), item = content.length === 1 ? content[0] : {stack:content};
    return {...item,margin:[0,0,0,has(node,'shift-print-events-v5') ? 8 : 2],...(child.value ? {counter:child.value} : {})};
   });
   return items.length ? [{[node.tag === 'OL' ? 'ol' : 'ul']:items,...(node.tag === 'OL' ? {start:node.start} : {}),margin:[0,0,0,5]}] : [];
  }
  if (node.tag === 'DL') return [definitionList(node)].filter(Boolean);
  if (node.tag === 'TABLE') return [htmlTable(node)].filter(Boolean);
  if (isPair(node)) return [table([pair(node)])];
  if (['report-event-prices-v14','report-event-payment-v5','report-payment-methods-v34','report-inline-receipt-v39'].some(name => has(node,name))) return [flow(node)].filter(Boolean);
  const children = compactChildren(node);
  if (children.length && children.every(isPair)) return [table(children.map(pair))];
  return blocks(node);
 }
 function blocks(node) {
  const output = [], pending = [];
  function flush() { const value = paragraph(pending); if (value) output.push(value); pending.length = 0; }
  for (const child of node.children || []) {
   if (child.tag === '#text' || child.tag === 'BR' || inlineTags.has(child.tag)) pending.push(child);
   else { flush(); output.push(...convert(child)); }
  }
  flush();
  return output;
 }
 function firstHeading(node) {
  if (node.tag === 'H1') return textOf(node).trim();
  for (const child of node.children || []) { const heading = firstHeading(child); if (heading) return heading; }
  return '';
 }
 function pdfDefinition(sourceElement, options = {}) {
  if (!sourceElement || sourceElement.nodeType !== 1) throw Error('Откройте отчёт перед созданием PDF.');
  const clone = sanitizedClone(sourceElement);
  if (!clone) throw Error('В отчёте нет данных для PDF.');
  const content = convert(clone), title = String(options.title || firstHeading(clone) || 'Отчёт');
  if (!content.length) throw Error('В отчёте нет данных для PDF.');
  return {pageSize:'A4',pageMargins:[28,28,28,28],defaultStyle:{font:'Roboto',fontSize:10,lineHeight:1.12,color:'#17202a'},info:{title,creator:'Процедурный кабинет'},content,footer:(page,pages) => ({text:`${page} / ${pages}`,alignment:'right',fontSize:8,color:'#666666',margin:[28,8,28,0]})};
 }

 function vendorUrl(file) {
  const location = root.location;
  const url = new URL('vendor/' + file,bundleSource || location?.href || root.document.baseURI);
  if (!location || url.origin !== location.origin || !['http:','https:'].includes(url.protocol)) throw Error('Не удалось открыть локальную библиотеку PDF.');
  return url.href;
 }
 function loadScript(file, ready) {
  return new Promise((resolve,reject) => {
   const document = root.document, script = document.createElement('script');
   let settled = false;
   const finish = error => {
    if (settled) return;
    settled = true; root.clearTimeout(timer); script.onload = script.onerror = null;
    if (error) { script.remove(); reject(error); } else resolve();
   };
   const timer = root.setTimeout(() => finish(Error('Загрузка библиотеки PDF заняла слишком много времени. Повторите попытку.')),15000);
   script.onload = () => finish(ready() ? null : Error('Библиотека PDF загрузилась не полностью. Повторите попытку.'));
   script.onerror = () => finish(Error('Не удалось загрузить библиотеку PDF. Проверьте интернет и повторите попытку.'));
   try { script.src = vendorUrl(file); script.async = true; (document.head || document.body).appendChild(script); }
   catch (error) { finish(error); }
  });
 }
 function hasFonts() { return root.vfs && fontFiles.every(file => typeof root.vfs[file] === 'string' && root.vfs[file].length > 0); }
 function ensureLibraries() {
  if (libraryPromise) return libraryPromise;
  libraryPromise = (async () => {
   if (typeof root.pdfMake?.createPdf !== 'function') await loadScript('pdfmake-0.2.20.min.js',() => typeof root.pdfMake?.createPdf === 'function');
   if (fontTarget !== root.pdfMake) {
    if (!hasFonts()) await loadScript('pdfmake-vfs-0.2.20.js',hasFonts);
    if (typeof root.pdfMake.addVirtualFileSystem !== 'function') throw Error('Библиотека PDF недоступна. Повторите попытку.');
    root.pdfMake.addVirtualFileSystem(root.vfs); fontTarget = root.pdfMake;
   }
  })().finally(() => { libraryPromise = null; });
  return libraryPromise;
 }
 async function pdfBlob(sourceElement, options = {}) {
  // Capture the authorized DOM synchronously before waiting for libraries.
  const definition = pdfDefinition(sourceElement,options);
  await ensureLibraries();
  return new Promise((resolve,reject) => {
   let settled = false, stream;
   const chunks = [];
   const finish = (error,blob) => {
    if (settled) return;
    settled = true; root.clearTimeout(timer);
    if (error) reject(error); else resolve(blob);
   };
   const timer = root.setTimeout(() => {
    finish(Error('Создание PDF заняло слишком много времени. Повторите попытку.'));
    stream?.destroy?.();
   },45000);
   try {
    // getStream without a callback skips pdfmake's URL resolver. Fonts are
    // pinned to the local Roboto VFS; document content has no URL properties.
    stream = root.pdfMake.createPdf(definition,undefined,fonts,root.vfs).getStream({});
    stream.on('data',chunk => { if (!settled) chunks.push(chunk); });
    stream.on('error',error => finish(error instanceof Error ? error : Error(String(error))));
    stream.on('end',() => {
     try {
      const blob = new root.Blob(chunks,{type:'application/pdf'});
      finish(blob.size ? null : Error('PDF получился пустым. Повторите попытку.'),blob);
     } catch (error) { finish(error); }
    });
    stream.end();
   } catch (error) { finish(error instanceof Error ? error : Error(String(error))); }
  });
 }

 root.crmPdfDefinitionV40 = pdfDefinition;
 root.crmPdfBlobV40 = pdfBlob;
})(globalThis);
