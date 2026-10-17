/* Visible print fallback for browsers that silently ignore window.print(). */
(function(root){
 'use strict';
 const get=id=>document.getElementById(id);
 let current=null,session=0;
 const actor=()=>JSON.stringify([currentStaff?.id,currentStaff?.role,financeSession5,session]);
 const navigation=()=>typeof quickNavigation4==='undefined'?null:quickNavigation4;
 const allowed=()=>!!currentStaff?.id&&currentStaff.active!==false&&['owner','admin','nurse'].includes(currentStaff.role);
 function valid(saved){try{return current===saved&&allowed()&&saved.actor===actor()&&saved.navigation===navigation()&&saved.validate()===true;}catch{return false;}}
 function close(focus=false){
  const saved=current;current=null;if(!saved)return;
  clearInterval(saved.timer);if(saved.url)URL.revokeObjectURL(saved.url);
  get('crmPrintPreviewV40')?.remove();document.body.classList.remove('crm-print-preview-open-v40');
  if(saved.app){saved.app.inert=saved.inert;if(saved.aria==null)saved.app.removeAttribute('aria-hidden');else saved.app.setAttribute('aria-hidden',saved.aria);}
  try{saved.cleanup?.();}catch{}
  if(focus&&saved.actor===actor()&&saved.focus?.isConnected)saved.focus.focus();
 }
 root.crmClosePrintPreviewV40=()=>close(true);
 function requireCurrent(saved){if(!valid(saved)){close();throw Error('Документ изменился. Откройте отчёт заново.');}}
 function status(saved,text){if(valid(saved)&&get('crmPrintMessageV40'))get('crmPrintMessageV40').textContent=text;}
 function cloneDocument(source){
  const copy=source.cloneNode(true);copy.removeAttribute('id');
  // These clickable rows contain report data, unlike action buttons.
  copy.querySelectorAll('button.finance-shift-v5').forEach(node=>{const row=document.createElement('div');row.className=node.className;while(node.firstChild)row.append(node.firstChild);node.replaceWith(row);});
  copy.querySelectorAll('script,style,link,iframe,object,embed,form,button,input,select,textarea,img,.no-print,.hidden,[hidden]').forEach(node=>node.remove());
  for(const node of [copy,...copy.querySelectorAll('*')])for(const attribute of [...node.attributes])if(attribute.name==='id'||attribute.name.startsWith('on')||['src','srcset','href'].includes(attribute.name))node.removeAttribute(attribute.name);
  copy.querySelectorAll('a').forEach(node=>node.replaceWith(document.createTextNode(node.textContent)));
  copy.id='crmPrintDocumentV40';copy.classList.add('crm-print-document-v40');return copy;
 }
 function fileName(title){return (String(title||'Отчёт').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').trim().slice(0,150)||'Отчёт')+'.pdf';}
 function attemptPrint(saved){
  try{requireCurrent(saved);saved.print();status(saved,'Предпросмотр готов. Если окно печати не открылось, нажмите «Скачать PDF».');}
  catch(error){if(valid(saved))status(saved,'Окно печати недоступно в этом браузере. Нажмите «Скачать PDF».');}
 }
 async function preparePdf(saved){
  if(saved.busy)return;
  try{
   requireCurrent(saved);saved.busy=true;get('crmPrintPdfV40').disabled=true;status(saved,'Готовим PDF…');
   const blob=await root.crmPdfBlobV40(saved.document,{title:saved.title});
   requireCurrent(saved);if(!(blob instanceof Blob)||blob.type!=='application/pdf'||blob.size<100)throw Error('PDF не сформирован. Повторите скачивание.');
   if(saved.url)URL.revokeObjectURL(saved.url);saved.url=URL.createObjectURL(blob);saved.blob=blob;
   const open=get('crmPrintOpenPdfV40'),download=get('crmPrintDownloadV40');
   open.href=download.href=saved.url;download.download=saved.filename;open.hidden=download.hidden=false;
   const share=get('crmPrintShareV40');
   if(share&&typeof navigator.canShare==='function'&&typeof File==='function'){
    const file=new File([blob],saved.filename,{type:'application/pdf'});try{if(navigator.canShare({files:[file]})){saved.file=file;share.hidden=false;}}catch{}
   }
   status(saved,'PDF готов. Если файл не скачался, нажмите «Открыть PDF» или «Сохранить PDF».');
   download.click();
  }catch(error){if(valid(saved))status(saved,'Не удалось подготовить PDF: '+error.message+' Нажмите «Скачать PDF» ещё раз.');}
  finally{if(current===saved){saved.busy=false;if(get('crmPrintPdfV40'))get('crmPrintPdfV40').disabled=false;}}
 }
 root.crmOpenPrintPreviewV40=function(options){
  if(!allowed()||!options?.source||typeof options.validate!=='function'||options.validate()!==true)throw Error('Сначала откройте актуальный отчёт.');
  const documentCopy=cloneDocument(options.source);close();
  const app=document.querySelector('.app'),saved={actor:actor(),navigation:navigation(),title:String(options.title||'Отчёт'),filename:fileName(options.title),document:documentCopy,validate:options.validate,print:options.print,cleanup:options.cleanup,busy:false,url:null,app,inert:app?.inert,aria:app?.getAttribute('aria-hidden'),focus:document.activeElement};
  current=saved;
  const host=document.createElement('section');host.id='crmPrintPreviewV40';host.className='crm-print-preview-v40';host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-labelledby','crmPrintTitleV40');
  host.innerHTML='<div class="crm-print-panel-v40"><div class="crm-print-toolbar-v40"><h1 id="crmPrintTitleV40"></h1><button type="button" id="crmPrintCloseV40" class="btn secondary">Назад к отчёту</button><button type="button" id="crmPrintRetryV40" class="btn secondary">Печать</button><button type="button" id="crmPrintPdfV40" class="btn primary">Скачать PDF</button><a id="crmPrintOpenPdfV40" class="btn secondary" target="_blank" rel="noopener" hidden>Открыть PDF</a><a id="crmPrintDownloadV40" class="btn secondary" hidden>Сохранить PDF</a><button type="button" id="crmPrintShareV40" class="btn secondary" hidden>Поделиться PDF</button><p id="crmPrintMessageV40" role="status" aria-live="polite">Предпросмотр готов. Если окно печати не открылось, скачайте PDF.</p></div></div>';
  host.querySelector('.crm-print-panel-v40').append(documentCopy);document.body.append(host);document.body.classList.add('crm-print-preview-open-v40');
  if(app){app.inert=true;app.setAttribute('aria-hidden','true');}
  get('crmPrintTitleV40').textContent=saved.title;get('crmPrintCloseV40').onclick=()=>close(true);get('crmPrintRetryV40').onclick=()=>attemptPrint(saved);get('crmPrintPdfV40').onclick=()=>preparePdf(saved);
  for(const id of ['crmPrintOpenPdfV40','crmPrintDownloadV40'])get(id).addEventListener('click',event=>{if(!valid(saved)){event.preventDefault();close();}});
  get('crmPrintShareV40').onclick=async()=>{try{requireCurrent(saved);await navigator.share({files:[saved.file],title:saved.title});}catch(error){if(error.name!=='AbortError')status(saved,'Откройте PDF и сохраните файл через меню браузера.');}};
  host.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();close(true);}if(event.key==='Tab'){const buttons=[...host.querySelectorAll('button,a[href]')].filter(node=>!node.hidden&&!node.disabled);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  saved.timer=setInterval(()=>{if(!valid(saved))close();},200);get('crmPrintCloseV40').focus();
  return {print:()=>attemptPrint(saved),close:()=>close(true)};
 };
 const showBase=show;show=function(){close();return showBase.apply(this,arguments);};
 const signOutBase=signOut;signOut=async function(){++session;close();return signOutBase.apply(this,arguments);};
 root.addEventListener('beforeprint',()=>{
  if(!current||valid(current))return;
  close();if(typeof clearShiftPrintV5==='function')clearShiftPrintV5();
  const failed=document.createElement('article');failed.id='shiftPrintV5';failed.innerHTML='<h1>Документ изменился</h1><p>Откройте отчёт заново и нажмите «Печать».</p>';document.body.append(failed);document.body.classList.add('crm-shift-printing-v5');
 });
})(typeof window==='object'?window:globalThis);
