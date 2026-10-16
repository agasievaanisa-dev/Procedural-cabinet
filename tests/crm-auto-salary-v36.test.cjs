const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');

function runtime(){
 const calls=[];
 const context={console,Map,Set,Date,JSON,Error,Number,Math,String,Promise,window:{},
  document:{querySelectorAll:()=>[]},$:()=>null,currentStaff:{id:'owner',role:'owner'},shift:null,
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  num:value=>Number(value||0),qty:value=>String(value||0),rub:value=>String(Number(value||0))+' ₽',
  isManager:()=>true,prepareTreatment4:async()=>true,calcProcedure:()=>{},calcSale:()=>{},enterApp:async()=>{},signOut:async()=>{},
  db:{rpc:async(...args)=>{calls.push(args);throw Error('Rendering must not post financial operations')}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../crm-finance-v5.js','utf8'),context);
 return {context,calls};
}
function receipt(){return {
 staff:[{id:'one',full_name:'Марьям',amount:2000},{id:'two',full_name:'Патя',amount:2000}],payroll_total:4000,payroll_complete:true,
 revenue:{cash:35900,terminal:5400,owner_card:500,total:41800},loan_debt_total:9100,procedures:[],sales:[],receipts:[],rows:[],shifts:[],
 cash_drawer:{salary_auto:true,salary_auto_total:4000,salary_auto_remaining:4000,salary_deduction:4000,cash_after_salary_auto:31900,
  opening_confirmed:false,opening:null,received_cash:35900,salary_paid:0,cash_in:0,cash_out:0,balance:null}
};}

test('automatic salary reads the server value with unknown opening and never manufactures a payout',()=>{
 const {context:c,calls}=runtime(),data=receipt(),before=JSON.stringify(data);
 assert.equal(c.financeCashBalanceV36(data),31900);assert.equal(c.financeSalaryValueV36(data),4000);
 assert.match(c.financeRemainingTextV5(data),/31900/);assert.match(c.financeRemainingLabelV36(data),/после зарплаты/);
 assert.equal(c.financeShiftSummaryAmountsV16(data).afterSalary,31900);
 assert.equal(JSON.stringify(data),before,'Rendering may not rewrite staff salaries, opening or cash movements');assert.deepEqual(calls,[]);
});

test('actual partial or complete salary payments are not subtracted from the server result again',()=>{
 const {context:c}=runtime();
 for(const [salaryPaid,remaining,physical] of [[1000,3000,34900],[4000,0,31900]]){
  const data=receipt();Object.assign(data.cash_drawer,{opening_confirmed:true,opening:0,salary_paid:salaryPaid,salary_auto_remaining:remaining,balance:physical});
  assert.equal(c.financeCashBalanceV36(data),31900);assert.equal(c.financeShiftSummaryAmountsV16(data).afterSalary,31900);
 }
});

test('zero, cents and custom salaries use the confirmed override rather than replacing it with 2,000',()=>{
 const {context:c}=runtime(),data=receipt();data.staff[0].amount=0;data.staff[1].amount=2500.25;data.payroll_total=2500.25;
 Object.assign(data.cash_drawer,{salary_auto_total:2500.25,salary_auto_remaining:2500.25,salary_deduction:2500.25,cash_after_salary_auto:33399.75});
 assert.equal(c.financeCashBalanceV36(data),33399.75);assert.equal(c.financeSalaryValueV36(data),2500.25);
 assert.match(c.financePayrollTextV5(data),/2500\.25/);assert.deepEqual(data.staff.map(person=>person.amount),[0,2500.25]);
});

test('automatic cash preserves an explicit zero and a negative shortage, regardless of large bank income or loans',()=>{
 const {context:c}=runtime();
 for(const expected of [0,-3000]){
  const data=receipt();data.revenue.terminal=900000;data.revenue.owner_card=800000;data.loan_debt_total=700000;data.cash_drawer.cash_after_salary_auto=expected;
  assert.equal(c.financeCashBalanceV36(data),expected);assert.equal(c.financeShiftSummaryAmountsV16(data).afterSalary,expected);
 }
});

test('period salary totals stay separate from the latest shift cash and entity filters cannot reuse either',()=>{
 const {context:c}=runtime(),data=receipt();data.payroll_total=8000;data.cash_drawer.scope='latest_shift';data.revenue.cash=95900;
 assert.equal(c.financeSalaryValueV36(data),8000);assert.equal(c.financeCashBalanceV36(data),31900);assert.match(c.financeRemainingLabelV36(data),/последней смены/);
 data.payroll_scope='not_applicable_to_entity_filter';
 assert.equal(c.financeRemainingTextV5(data),'Не применяется к этому фильтру');assert.equal(c.financePayrollTextV5(data),'Не применяется к этому фильтру');
 assert.ok(c.buildFinanceCsvV5(data).includes('Не применяется к этому фильтру'));
});

test('employee-period payroll uses that employee across shifts while the drawer remains the complete latest shift',()=>{
 const {context:c}=runtime(),data=receipt();
 // The selected employee worked two two-nurse shifts: their wages are 4,000,
 // while all staff earned 8,000. The server applies the employee filter only to
 // payroll totals; the physical drawer still belongs to the complete shift.
 Object.assign(data,{salary_auto:true,salary_auto_total:4000,payroll_total:4000,payroll_scope:'employee_period_shifts',
  cash_drawer_period_totals:{salary_auto_total:8000}});
 data.cash_drawer.scope='latest_shift';
 assert.equal(c.financeSalaryValueV36(data),4000);assert.equal(c.financeCashBalanceV36(data),31900);
 assert.match(c.financePayrollTextV5(data),/4000/);assert.match(c.financeRemainingLabelV36(data),/последней смены/);
 const csv=c.buildFinanceCsvV5(data);assert.match(csv,/"Зарплата[^\r\n]*"4000"/);assert.match(csv,/"[^"]*после зарплаты[^"]*";"31900"/);
});

test('CSV and HTML use the same salary-adjusted cash and legacy receipts retain the physical cash semantics',()=>{
 const {context:c,calls}=runtime(),data=receipt();
 const html=c.financeSimpleSummaryHtmlV29(data,'смену'),csv=c.buildFinanceCsvV5(data);
 assert.match(html,/data-summary-key="cash-balance"[^]*31900/);assert.match(csv,/"[^"]*после зарплаты[^"]*";"31900"/);
 assert.match(csv,/"Зарплата[^\r\n]*"4000"/);assert.ok(!html.includes('Не рассчитан'));assert.ok(!csv.includes('Не рассчитан'));
 for(const key of ['salary_auto','salary_auto_total','salary_auto_remaining','salary_deduction','cash_after_salary_auto'])delete data.cash_drawer[key];
 data.cash_drawer.opening_confirmed=true;data.cash_drawer.opening=0;data.cash_drawer.salary_paid=1000;data.cash_drawer.balance=34900;
 assert.equal(c.financeCashBalanceV36(data),34900);assert.match(c.financeRemainingTextV5(data),/34900/);assert.deepEqual(calls,[]);
});
