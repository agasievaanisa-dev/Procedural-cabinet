const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cents,paymentModel,ownedItems}=require('../crm-clinical-v10.js');

test('agreed charge, initial receipt and debt remain distinct, including a discount',()=>{
 const debt=paymentModel({list:'1200',charge:'1000',received:'300',status:'debt',reason:'Постоянный пациент',patient:'patient'});
 assert.equal(debt.list,120000);assert.equal(debt.charge,100000);assert.equal(debt.received,30000);assert.equal(debt.debt,70000);assert.equal(debt.status,'debt');
 assert.throws(()=>paymentModel({list:'1200',charge:'1000',received:'1000',status:'paid',patient:'patient'}),/комментарий/);
 assert.throws(()=>paymentModel({list:'1200',charge:'1200',received:'0',status:'debt'}),/пациента/);
});
test('free visits require an explicit reason and zero receipts; debt is not discounted away',()=>{
 const free=paymentModel({list:'300',charge:'0',received:'0',status:'free',reason:'Бесплатно по решению владельца',patient:'patient'});
 assert.equal(free.status,'free');assert.equal(free.debt,0);
 assert.throws(()=>paymentModel({list:'300',charge:'0',received:'0',status:'free',patient:'patient'}),/комментарий/);
 const debt=paymentModel({list:'300',charge:'300',received:'0',status:'debt',patient:'patient'});
 assert.equal(debt.charge,30000);assert.equal(debt.debt,30000);assert.equal(debt.reason,'');
 assert.throws(()=>paymentModel({list:'300',charge:'300',received:'300',status:'free',reason:'Помощь',patient:'patient'}),/нулевую/);
});
test('payment after the procedure preserves the discounted bill without creating a receipt',()=>{
 const waiting=paymentModel({list:'14300',charge:'11500',received:'0',status:'pending',reason:'Скидка согласована',patient:'patient'});
 assert.equal(waiting.charge,1150000);assert.equal(waiting.received,0);assert.equal(waiting.debt,1150000);assert.equal(waiting.status,'pending');
 assert.throws(()=>paymentModel({list:'300',charge:'300',received:'0',status:'pending'}),/пациента/);
 const settled=paymentModel({list:'300',charge:'300',received:'300',status:'pending',patient:'patient'});
 assert.equal(settled.status,'paid');assert.equal(settled.debt,0);
});
test('edited visit preserves earlier receipts and only counts newly collected money',()=>{
 const edited=paymentModel({list:'1700',charge:'1500',previous:'1000',received:'200',status:'debt',reason:'Скидка от владельца',patient:'patient'});
 assert.equal(edited.previous,100000);assert.equal(edited.received,20000);assert.equal(edited.debt,30000);
 assert.throws(()=>paymentModel({list:'1700',charge:'900',previous:'1000',received:'0',status:'debt',reason:'Ошибка',patient:'patient'}),/уже полученной/);
 assert.throws(()=>paymentModel({list:'1700',charge:'1700',previous:'1000',received:'200',status:'paid',patient:'patient'}),/полной оплаты/);
 assert.equal(paymentModel({list:'1700',charge:'1700',previous:'1000',received:'700',status:'paid',patient:'patient'}).debt,0);
});
test('sale without a patient preserves a full or partially paid debt and an unpaid draft',()=>{
 const unpaid=paymentModel({kind:'sale',patient:null,list:'1700',charge:'1700',received:'0',status:'debt'});
 assert.equal(unpaid.debt,170000);assert.equal(unpaid.received,0);assert.equal(unpaid.status,'debt');
 const partial=paymentModel({kind:'sale',patient:'',list:'1700',charge:'1500',received:'400',status:'debt',reason:'Согласованная скидка'});
 assert.equal(partial.list,170000);assert.equal(partial.charge,150000);assert.equal(partial.received,40000);assert.equal(partial.debt,110000);
 const pending=paymentModel({kind:'sale',list:'1700',charge:'1700',received:'0',status:'pending'});
 assert.equal(pending.status,'pending');assert.equal(pending.debt,170000);assert.equal(pending.received,0);
 const edited=paymentModel({kind:'sale',patient:null,list:'1900',charge:'1800',previous:'400',received:'200',status:'debt',reason:'Согласованная стоимость'});
 assert.equal(edited.previous,40000);assert.equal(edited.received,20000);assert.equal(edited.debt,120000);
});
test('anonymous sale exemption does not weaken procedure, discount or receipt guards',()=>{
 for(const status of ['debt','pending'])for(const kind of [undefined,'procedure','unexpected']){
  assert.throws(()=>paymentModel({kind,list:'1700',charge:'1700',received:'0',status}),/выберите пациента/);
 }
 assert.throws(()=>paymentModel({kind:'sale',list:'1700',charge:'1500',received:'0',status:'debt'}),/комментарий/);
 assert.throws(()=>paymentModel({kind:'sale',list:'1700',charge:'1500',previous:'1600',received:'0',status:'debt',reason:'Скидка'}),/уже полученной/);
 assert.throws(()=>paymentModel({kind:'sale',list:'1700',charge:'1700',received:'100',status:'paid'}),/полной оплаты/);
 assert.throws(()=>paymentModel({kind:'sale',list:'1700',charge:'0',received:'0',status:'free'}),/комментарий/);
});
test('patient and previously purchased medicine keep quantities without a selling price',()=>{
 const items=ownedItems([{name:' Витамин B12 500 мкг ',quantity:'2',unit:'амп.',source:'previously_purchased'},{name:'Препарат пациента',quantity:1,unit:'фл.',source:'patient'}]);
 assert.deepEqual(items,[{name:'Витамин B12 500 мкг',quantity:2,unit:'амп.',source:'previously_purchased'},{name:'Препарат пациента',quantity:1,unit:'фл.',source:'patient'}]);
 assert.equal('sale_price' in items[0],false);
 for(const invalid of ['0','-1','0.5','Infinity'])assert.throws(()=>ownedItems([{name:'Препарат',quantity:invalid,source:'patient'}]),/Количество/);
 assert.throws(()=>ownedItems([{name:'',quantity:1,source:'patient'}]),/название/);
});
test('financial amounts reject blank, exponent and fractions of a kopeck',()=>{
 assert.equal(cents('10,02'),1002);
 for(const invalid of ['','-1','1e4','0.001','NaN','Infinity'])assert.throws(()=>cents(invalid));
});
