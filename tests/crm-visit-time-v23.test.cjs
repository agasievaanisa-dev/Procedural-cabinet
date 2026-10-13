const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parts,nowParts,toIso,optionalIso}=require('../crm-visit-time-v23.js');

test('Moscow input uses the same instant in UTC and Los Angeles process timezones',()=>{
 const previous=process.env.TZ;
 try {
  for(const timezone of ['UTC','America/Los_Angeles','Asia/Tokyo']){
   process.env.TZ=timezone;
   assert.deepEqual({input:toIso('2026-10-13','10:25'),now:nowParts(new Date('2026-10-13T07:33:27Z'))},{input:'2026-10-13T07:25:00.000Z',now:{date:'2026-10-13',time:'10:33'}});
  }
 } finally { if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous; }
});
test('Moscow dates roll across UTC midnight without changing the typed visit date',()=>{
 assert.deepEqual(parts('2026-10-12T21:30:43.123Z'),{date:'2026-10-13',time:'00:30'});
 assert.equal(toIso('2026-10-13','00:30'),'2026-10-12T21:30:00.000Z');
 assert.equal(toIso('2026-12-31','23:59:45'),'2026-12-31T20:59:45.000Z');
});
test('dates and times are checked before an invalid input can be silently normalized',()=>{
 for(const date of ['2026-02-30','2026-02-29','2026-04-31','2026-00-10','2026-13-01','2026-01-00','0999-01-01'])assert.throws(()=>toIso(date,'10:25'),/существующую дату/);
 for(const time of ['24:00','12:60','12:30:60','-1:00','1:00',''])assert.throws(()=>toIso('2026-10-13',time),/время посещения/);
 assert.equal(toIso('2028-02-29','10:25'),'2028-02-29T07:25:00.000Z');
 assert.throws(()=>parts('not-a-timestamp'),/прочитать время/);
});
test('optional patient registration fields are empty together and never discard a half-entered visit',()=>{
 assert.equal(optionalIso('',''),null);assert.equal(optionalIso(null,null),null);
 assert.throws(()=>optionalIso('2026-10-13',''),/точное время/);
 assert.throws(()=>optionalIso('','10:25'),/дату посещения/);
 assert.deepEqual(nowParts(new Date('2026-10-13T07:25:19.150Z')),{date:'2026-10-13',time:'10:25'});
});
