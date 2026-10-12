/* Origin labels use the saved country; an unknown country stays unclassified. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const foreign=/германи|япони|коре|итали|китай|турци|испани|франци|индия|индию|румыни|бельги|сша|швейцари|австри|польш|germany|japan|korea|italy|china|turkey|spain|france|india|romania|belgium|usa/i;
 function origin(m){
  const country=String(m?.manufacturer_country||m?.country||'').trim();
  if(country){
   if(/^(?:не указана?|неизвестно|unknown|[-—])$/i.test(country))return null;
   const parts=country.split(/[,/;|]/).map(s=>s.trim()).filter(Boolean);
   if(parts.length&&parts.every(s=>/^(?:россия|рф|russia|russian federation)$/i.test(s)))return null;
   return country;
  }
  const label=String(m?.name||'').match(/\(([^)]*)\)/g)?.find(s=>foreign.test(s));
  return label?label.slice(1,-1).trim():null;
 }
 const className=m=>origin(m)?'med-origin-import-v21':'';
 const badge=m=>{const country=origin(m);return country?'<span class="med-origin-badge-v21">Импорт · '+escape(country)+'</span>':'';};
 const api={origin,className,badge};root.CrmMedicationOriginV21=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
