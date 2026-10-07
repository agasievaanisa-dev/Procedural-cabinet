const test = require('node:test');
const assert = require('node:assert/strict');
const report = require('../crm-warehouse-report-v5.js');

test('warehouse interval uses inclusive Moscow dates and rejects invalid filters', () => {
 assert.equal(report.moscowDate('2026-10-06T21:00:00Z'),'2026-10-07');
 assert.equal(report.moscowDate('2026-10-06T20:59:59Z'),'2026-10-06');
 assert.deepEqual(report.reportPayload('2026-10-01','2026-10-07'),{from:'2026-10-01',to:'2026-10-07'});
 const id = '12345678-1234-1234-1234-123456789abc';
 assert.equal(report.reportPayload('2026-10-01','2026-10-07',id).medication_id,id);
 assert.throws(() => report.reportPayload('2026-02-30','2026-10-07'));
 assert.throws(() => report.reportPayload('2026-10-08','2026-10-07'));
 assert.throws(() => report.reportPayload('2026-10-01','2026-10-07','<script>'));
});
const example = {
 from:'2026-10-01',to:'2026-10-07',generated_at:'2026-10-07T09:30:00Z',movements_count:1,medications_count:1,
 medications:[{name:'<img src=x onerror=alert(1)>',unit:'амп.',active:false,reserve_current:12,work_current:3,total_current:15,reserve_delta:5,work_delta:-1,movement_count:1}],
 movements:[{at:'2026-10-07T00:30:00Z',name:'=HYPERLINK("bad")',unit:'амп.',type:'sale',quantity:2,from_location:'work',to_location:null,batch_number:' @formula',actor_name:'<script>alert(1)</script>',comment:'"quoted";\nnew line'}]
};
test('warehouse rendering escapes medication, employee, comment and unknown operation text', () => {
 const html = report.renderReport({...example,movements:[{...example.movements[0],type:'<iframe>'}]});
 assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<iframe>'));
 assert.ok(html.includes('&lt;img')); assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('Остатки показывают состояние сейчас'));
 assert.ok(html.includes('Архив')); assert.ok(html.includes('Изменение за период'));
});
test('warehouse CSV exports stock and movements, full quantities and spreadsheet-safe text', () => {
 const csv = report.buildCsv(example);
 assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"Текущие остатки"'));
 assert.ok(csv.includes('"Движения за период"')); assert.ok(csv.includes('"Запас сейчас"'));
 assert.ok(csv.includes('"Изменение запаса за период"')); assert.ok(csv.includes('"12";"3";"15";"5";"\'-1";"1"'));
 assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(csv.includes('"\' @formula"'));
 assert.ok(csv.includes('""quoted"";\nnew line')); assert.ok(csv.includes('Москва'));
 assert.equal(report.csvCell('+cmd'), '"\'+cmd"');
 assert.equal(report.csvCell('\t=cmd'), '"\'\t=cmd"');
 assert.equal(report.csvCell(0.123456789),'"0.123456789"');
});
