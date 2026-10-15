const {test}=require('node:test');
const assert=require('node:assert/strict');
const {
 isMeasuredQuantityV31,
 medicationQuantityV31,
 configureMedicationQuantityV31,
 medicineQuantityTextV31,
 medicationLineCentsV31
}=require('../crm-measured-quantity-v31.js');
const measured={id:'reta-mg',consumption_unit:'мг'},ordinary={id:'ampoule',consumption_unit:'амп.'};

test('measured money uses SQL-compatible rounding on each line without binary half-cent loss',()=>{
 assert.equal(medicationLineCentsV31(150000,2.5),375000);
 assert.equal(medicationLineCentsV31(130000,7.5),975000);
 assert.equal(medicationLineCentsV31(100,1.005),101);
 assert.equal(medicationLineCentsV31(5,0.333)+medicationLineCentsV31(5,0.333),4);
 assert.throws(()=>medicationLineCentsV31(100,0.0001));
});

test('milligrams accept comma/dot fractions and preserve thousandths as numeric accounting quantities',()=>{
 for(const [input,expected] of [['2,5',2.5],['2.5',2.5],['7,5',7.5],['7.5',7.5],['0,001',0.001],['0.333',0.333],[' 2,500 ',2.5],[2.5,2.5],[7.5,7.5]]){
  assert.equal(medicationQuantityV31(input,measured),expected);
 }
 assert.equal(isMeasuredQuantityV31(measured),true);
 assert.equal(isMeasuredQuantityV31({unit:'мг'}),true,'captured historical unit also identifies measured quantities');
 for(const unit of ['амп.','фл.','компл.','мл','мкг','г'])assert.equal(isMeasuredQuantityV31({consumption_unit:unit}),false);
 assert.equal(medicineQuantityTextV31('2,500',measured),'2.5');
 assert.equal(medicineQuantityTextV31('0',measured),'0');
});

test('measured parser rejects incomplete, negative, nonfinite and excessive precision without rounding silently',()=>{
 for(const input of ['',null,undefined,'-1','0','0.0001','2.5000','1,2,3','1.2.3','1e3','Infinity',Infinity,NaN,'2 мг']){
  assert.throws(()=>medicationQuantityV31(input,measured),/мг|количеств/i,String(input));
 }
 assert.equal(medicationQuantityV31('0',measured,{allowZero:true}),0);
 assert.throws(()=>medicationQuantityV31('-0.1',measured,{allowZero:true}));
});

test('whole containers remain whole even when a dose text or product name contains milligrams',()=>{
 assert.equal(medicationQuantityV31('2',ordinary),2);
 assert.equal(medicationQuantityV31('7',ordinary),7);
 for(const quantity of ['0.5','2,5',0.5,7.5]){
  assert.throws(()=>medicationQuantityV31(quantity,ordinary),/целым/);
  assert.throws(()=>medicationQuantityV31(quantity,{...ordinary,name:'Мунджаро',dosage:'2.5 мг'}),/целым/);
 }
 assert.equal(medicationQuantityV31('0',ordinary,{allowZero:true}),0);
 assert.throws(()=>medicationQuantityV31('0',ordinary),/больше нуля/);
});

test('quantity controls permit comma entry only for measured medicines and reset when switching to containers',()=>{
 const input={};configureMedicationQuantityV31(input,measured);
 assert.deepEqual(input,{type:'text',inputMode:'decimal',min:'0.001',step:'0.001'});
 configureMedicationQuantityV31(input,ordinary);
 assert.deepEqual(input,{type:'number',inputMode:'numeric',min:'1',step:'1'});
 configureMedicationQuantityV31(input,measured,true);
 assert.deepEqual(input,{type:'text',inputMode:'decimal',min:'0',step:'0.001'});
});

test('protocols merge measured fractions while own medicines and procedure counts still require whole quantities',()=>{
 const {protocolItems,ownedItems,mergeServices}=require('../crm-clinical-v10.js');
 const source=[{medication_id:'reta-mg',quantity:2.5,dose:'Индивидуальная доза'},{medication_id:'reta-mg',quantity:'0,5',dose:'Индивидуальная доза'}];
 assert.deepEqual(protocolItems(source,[measured]),[{medication_id:'reta-mg',quantity:3,dose:'Индивидуальная доза'}]);
 assert.equal(source[0].quantity,2.5);
 assert.throws(()=>protocolItems([{medication_id:'ampoule',quantity:0.5}],[ordinary]),/целым/);
 assert.throws(()=>ownedItems([{name:'Свой препарат',quantity:0.5,unit:'мг',source:'patient'}]),/целым/);
 assert.throws(()=>mergeServices([{service_id:'service-1',quantity:0.5}]),/целым/);
});
