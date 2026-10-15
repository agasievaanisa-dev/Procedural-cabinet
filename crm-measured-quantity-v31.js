/* Quantities follow the medicine's accounting unit; dose text is independent. */
(function(root){
 'use strict';
 function isMeasuredQuantityV31(medicine){return (medicine?.consumption_unit??medicine?.unit)==='мг';}
 function medicationQuantityV31(value,medicine,{allowZero=false}={}){
  const measured=isMeasuredQuantityV31(medicine),raw=String(value??'').trim().replace(',','.');
  const invalid=()=>Error(measured?'Количество в мг: больше нуля, до трёх знаков после запятой':'Количество препарата должно быть целым числом больше нуля');
  if(!/^\d+(?:\.\d+)?$/.test(raw))throw invalid();
  const number=Number(raw);if(!Number.isFinite(number)||number<0||(!allowZero&&number===0))throw invalid();
  if(!measured){if(!Number.isSafeInteger(number))throw invalid();return number;}
  const scaled=number*1000,rounded=Math.round(scaled);
  if(!Number.isSafeInteger(rounded)||Math.abs(scaled-rounded)>1e-7||typeof value==='string'&&(raw.split('.')[1]||'').length>3)throw invalid();
  return rounded/1000;
 }
 function configureMedicationQuantityV31(input,medicine,allowZero=false){
  if(!input)return;const measured=isMeasuredQuantityV31(medicine);
  input.type=measured?'text':'number';input.inputMode=measured?'decimal':'numeric';
  input.min=allowZero?'0':measured?'0.001':'1';input.step=measured?'0.001':'1';
 }
 function medicineQuantityTextV31(value,medicine){return String(medicationQuantityV31(value,medicine,{allowZero:true}));}
 function medicationLineCentsV31(unitPriceCents,quantity){
  const price=Number(unitPriceCents),scaled=Math.round(Number(quantity)*1000);
  if(!Number.isSafeInteger(price)||price<0||!Number.isSafeInteger(scaled)||scaled<0||Math.abs(Number(quantity)*1000-scaled)>1e-7)throw Error('Проверьте цену и количество препарата');
  const result=Number((BigInt(price)*BigInt(scaled)+500n)/1000n);
  if(!Number.isSafeInteger(result))throw Error('Слишком большая сумма препарата');return result;
 }
 const api={isMeasuredQuantityV31,medicationQuantityV31,configureMedicationQuantityV31,medicineQuantityTextV31,medicationLineCentsV31};
 Object.assign(root,api);if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
