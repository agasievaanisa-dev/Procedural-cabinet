const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../crm-app-v5.js', 'utf8');

function fixture(role = 'admin') {
 const nodes = new Map(), shown = [], messages = [];
 function el(id) {
  if (!nodes.has(id)) nodes.set(id, {id, textContent:'', innerHTML:'', querySelector(selector){return el(id + ' ' + selector);}});
  return nodes.get(id);
 }
 const c = {
  Intl, Date, Set, console,
  currentStaff:{id:'staff-1', full_name:'Аниса', role}, shift:null,
  financeAccountingMode5:{payment_only:true},
  $:el, document:{querySelector:()=>({content:'5.5.5'})}, setInterval(){},
  isManager:()=>['admin','owner'].includes(c.currentStaff?.role),
  show:id=>shown.push(id), message:(...args)=>messages.push(args),
  enterApp:async user=>{c.currentStaff=user;}, signOut:async()=>{c.currentStaff=null;},
  loadStockDetails:async()=>{}, openSettingsV5:async()=>{},
  localDateValue(){}, shiftLabel(){}, startShift(){}, quickBusy:false
 };
 vm.createContext(c); vm.runInContext(source,c);
 return {c, el, shown, messages};
}

test('administrator and owner keep their own header names and cabinet headings',()=>{
 for(const [role,label,heading] of [
  ['admin','Администратор','Кабинет администратора'],
  ['owner','Владелец','Кабинет владельца'],
  ['nurse','Медсестра','Работа со своей сменой'],
  ['mentor','Наставник','Работа со своей сменой']
 ]) {
  const f=fixture(role);f.c.renderCabinetHomeV5();
  assert.equal(f.el('status').textContent,'Аниса · '+label);
  assert.equal(f.el('workspace h1').textContent,heading);
  assert.equal(f.c.currentStaff.role,role,'Displaying a role never changes access');
  if(['admin','owner'].includes(role))assert.match(f.el('workspace .home-actions').innerHTML,/Сотрудники/);
  else assert.doesNotMatch(f.el('workspace .home-actions').innerHTML,/Сотрудники/);
 }
});

test('entering the cabinet and navigating use the current staff role rather than manager access',async()=>{
 const f=fixture('owner');
 await f.c.enterApp({id:'admin-1',full_name:'Аниса',role:'admin'});
 assert.equal(f.el('status').textContent,'Аниса · Администратор');
 assert.equal(f.el('workspace h1').textContent,'Кабинет администратора');
 f.c.show('patients');assert.equal(f.el('status').textContent,'Аниса · Администратор');
 f.c.currentStaff={id:'nurse-1',full_name:'Марьям',role:'nurse'};
 f.c.show('patients');assert.equal(f.el('status').textContent,'Марьям · Медсестра');
 f.c.currentStaff={id:'mentor-1',full_name:'Наставник кабинета',role:'mentor'};
 f.c.show('mentor');assert.equal(f.el('status').textContent,'Наставник кабинета · Наставник');
});

test('correct role labels preserve manager screen access and nurse restrictions',()=>{
 for(const role of ['admin','owner','nurse']) {
  const f=fixture(role);f.c.show('staffV5');
  assert.equal(f.shown.at(-1),role==='nurse'?'workspace':'staffV5');
  assert.equal(f.messages.length,role==='nurse'?1:0);
 }
});

test('rendering without a signed-in staff member does not overwrite the login header',()=>{
 const f=fixture();f.c.currentStaff=null;f.el('status').textContent='СКЛАД';
 f.c.renderCabinetHomeV5();f.c.show('login');
 assert.equal(f.el('status').textContent,'СКЛАД');
});
