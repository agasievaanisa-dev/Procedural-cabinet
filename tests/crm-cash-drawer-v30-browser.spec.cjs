const {test,expect}=require('@playwright/test');
const base=process.env.CRM_BROWSER_BASE_URL||'http://127.0.0.1:4173';
test.use({viewport:{width:390,height:844}});

async function boot(page,{role='nurse',status='open',confirmed=true}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/supabase-*.js',route=>route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({error:null})},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})},rpc:async()=>({data:[]})})}'}));
 await page.goto(base);await expect(page.locator('#login')).toBeVisible();
 await page.evaluate(({role,status,confirmed})=>{
  const clone=value=>JSON.parse(JSON.stringify(value));
  currentStaff={id:role==='nurse'?'nurse-1':'manager-1',full_name:role==='nurse'?'Наталья':'Аниса',role,active:true};
  shift=status==='open'?{id:'cash-shift',aId:'nurse-1',a:'Наталья',bId:'nurse-2',b:'Лилия'}:null;
  window.__cashCalls=[];window.__cashEffects=[];window.__cashReplay=new Map();window.__cashLost=false;window.__cashHold=false;window.__cashRejected=null;
  window.__cashDrawer={opening_confirmed:confirmed,opening:confirmed?500:null,received_cash:6800,salary_paid:0,cash_in:0,cash_out:0,balance:confirmed?7300:null,movements:[],payroll:[{staff_id:'nurse-1',staff_name:'Наталья',configured:2000,paid:0,outstanding:2000},{staff_id:'nurse-2',staff_name:'Лилия <img src=x>',configured:2500.25,paid:0,outstanding:2500.25}]};
  const recalc=()=>{const d=__cashDrawer,active=d.movements.filter(m=>!m.voided_at),sum=type=>Math.round(active.filter(m=>m.type===type).reduce((n,m)=>n+m.amount,0)*100)/100;d.salary_paid=sum('salary');d.cash_in=sum('cash_in');d.cash_out=Math.round(['expense','refund','owner_withdrawal'].reduce((n,t)=>n+sum(t),0)*100)/100;d.balance=d.opening_confirmed?Math.round((d.opening+d.received_cash+d.cash_in-d.salary_paid-d.cash_out)*100)/100:null;d.balance_negative=d.balance<0;for(const p of d.payroll){p.paid=Math.round(active.filter(m=>m.type==='salary'&&m.staff_id===p.staff_id).reduce((n,m)=>n+m.amount,0)*100)/100;p.outstanding=Math.round((p.configured-p.paid)*100)/100}};
  window.__cashReport=()=>({shift:{id:'cash-shift',date:'2026-10-15',status},staff:__cashDrawer.payroll.map(p=>({id:p.staff_id,full_name:p.staff_name,amount:p.configured})),patients_count:1,procedures_count:1,sales_count:0,revenue:{cash:6800,terminal:12000,owner_card:9000,total:27800},loan_debt_total:15000,pending_total:0,payroll_total:4500.25,payroll_complete:true,procedures:[],sales:[],receipts:[],stock:[],used:[],untracked:[],warnings:[],cash_drawer:clone(__cashDrawer)});
  db.rpc=async(name,args={})=>{
   __cashCalls.push({name,args:clone(args)});
   if(name==='crm_cash_drawer_v30'){
    const p=args.p_payload||{};
    if(args.p_action==='status')return {data:clone(__cashDrawer)};
    if(__cashRejected)return {error:__cashRejected,status:400};
    let result=__cashReplay.get(args.p_request_id);
    if(!result){
     if(args.p_action==='opening_set'){__cashDrawer.opening_confirmed=true;__cashDrawer.opening=p.amount}
     if(args.p_action==='movement_add')__cashDrawer.movements.push({id:'movement-'+(__cashEffects.length+1),...clone(p),staff_name:__cashDrawer.payroll.find(x=>x.staff_id===p.staff_id)?.staff_name,created_at:'2026-10-15T09:30:00Z'});
     if(args.p_action==='movement_void'){const m=__cashDrawer.movements.find(x=>x.id===p.id);m.voided_at='2026-10-15T10:00:00Z';m.void_reason=p.reason}
     recalc();__cashEffects.push({name,args:clone(args)});result=clone(__cashDrawer);__cashReplay.set(args.p_request_id,result);
    }
    if(__cashHold){__cashHold=false;await new Promise(resolve=>window.__releaseCash=resolve)}
    if(__cashLost){__cashLost=false;throw new TypeError('Load failed')}
    return {data:clone(result)};
   }
   if(name==='crm_finance_v5')return {data:__cashReport()};
   return {data:[]};
  };
  refreshDashboard=async()=>{};refreshOwnerDashboardV5=async()=>{};show('workspace');renderShiftReportV5(__cashReport(),true);
 },{role,status,confirmed});
 await expect(page.locator('#cashDrawerButtonV30')).toBeVisible();await page.click('#cashDrawerButtonV30');await expect(page.locator('#cashDrawerV30')).toBeVisible();return errors;
}
const writes=page=>page.evaluate(()=>__cashCalls.filter(x=>x.name==='crm_cash_drawer_v30'&&x.args.p_action!=='status'));
const effects=page=>page.evaluate(()=>__cashEffects);
async function movement(page,type,amount,reason){await page.selectOption('#cashMovementTypeV30',type);await page.fill('#cashMovementAmountV30',amount);await page.fill('#cashMovementReasonV30',reason);await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('Записано')}

test('unconfirmed opening stays unknown despite large bank receipts and debt, and only opening can be entered',async({page})=>{
 const errors=await boot(page,{confirmed:false});await expect(page.locator('#cashBalanceV30')).toContainText('Не рассчитан');await expect(page.locator('#cashMovementFormV30')).toHaveCount(0);await expect(page.locator('#cashOpeningAmountV30')).toHaveValue('');await expect(page.locator('#cashDrawerV30')).toContainText('Если касса была пустой, подтвердите 0');expect(await writes(page)).toHaveLength(0);expect(errors).toEqual([]);
});

test('a confirmed zero opening is valid and bank receipts and loan repayments do not enter cash',async({page})=>{
 const errors=await boot(page,{confirmed:false});await page.fill('#cashOpeningAmountV30','0');await page.locator('#cashOpeningFormV30 button').click();await expect(page.locator('#cashBalanceV30')).toContainText(/6\s*800/);await expect(page.locator('#cashMovementFormV30')).toBeVisible();const calls=await writes(page);expect(calls).toHaveLength(1);expect(calls[0].args).toMatchObject({p_action:'opening_set',p_payload:{shift_id:'cash-shift',amount:0,reason:'Подтверждённый остаток наличных на начало смены'}});expect(calls[0].args.p_request_id).toBeTruthy();expect(await page.evaluate(()=>__cashReport().revenue.total)).toBe(27800);expect(errors).toEqual([]);
});

test('salary is recorded for the selected employee and only actual paid cash reduces the drawer',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#cashMovementAmountV30')).toHaveValue('2000.00');await page.selectOption('#cashSalaryStaffV30','nurse-2');await expect(page.locator('#cashMovementAmountV30')).toHaveValue('2500.25');await page.fill('#cashMovementAmountV30','1000.10');await page.fill('#cashMovementReasonV30','Часть зарплаты Лилии');await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('Записано');
 const call=(await writes(page))[0];expect(call.args.p_payload).toEqual({shift_id:'cash-shift',type:'salary',amount:1000.1,reason:'Часть зарплаты Лилии',staff_id:'nurse-2'});expect(await page.evaluate(()=>({salary:__cashDrawer.salary_paid,balance:__cashDrawer.balance,payroll:__cashDrawer.payroll[1]}))).toMatchObject({salary:1000.1,balance:6299.9,payroll:{paid:1000.1,outstanding:1500.15}});await expect(page.locator('#cashMovementsV30')).toContainText('Лилия <img src=x>');await expect(page.locator('#cashMovementsV30 img')).toHaveCount(0);expect(await page.evaluate(()=>financeShiftSnapshot5.data.cash_drawer.balance)).toBe(6299.9);expect(errors).toEqual([]);
});

for(const [type,balance] of [['cash_in',7423.45],['expense',7176.55],['refund',7176.55],['owner_withdrawal',7176.55]])test(`${type} records an explicit cash movement without changing patient income or accrued salary`,async({page})=>{
 const errors=await boot(page);await movement(page,type,'123,45','Основание <img src=x>');const call=(await writes(page))[0];expect(call.args.p_payload).toEqual({shift_id:'cash-shift',type,amount:123.45,reason:'Основание <img src=x>'});expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(balance);expect(await page.evaluate(()=>__cashReport().revenue)).toEqual({cash:6800,terminal:12000,owner_card:9000,total:27800});expect(await page.evaluate(()=>__cashReport().payroll_total)).toBe(4500.25);await expect(page.locator('#cashMovementsV30')).toContainText('Основание <img src=x>');await expect(page.locator('#cashMovementsV30 img')).toHaveCount(0);expect(errors).toEqual([]);
});

test('cash form rejects zero, excess precision and missing explanations before sending any movement',async({page})=>{
 const errors=await boot(page);await page.selectOption('#cashMovementTypeV30','expense');
 for(const [amount,reason] of [['0','Причина'],['0.001','Причина'],['10','  ']]){await page.fill('#cashMovementAmountV30',amount);await page.fill('#cashMovementReasonV30',reason);await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashMessageV30')).not.toHaveText('');expect(await writes(page)).toHaveLength(0)}expect(errors).toEqual([]);
});

test('manager opening correction requires a reason and recalculates the actual drawer',async({page})=>{
 const errors=await boot(page,{role:'admin'});await page.locator('summary').filter({hasText:'Исправить начальный остаток'}).click();await page.fill('#cashOpeningAmountV30','800.25');await page.fill('#cashOpeningReasonV30','  ');await page.locator('#cashOpeningFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('причину');expect(await writes(page)).toHaveLength(0);await page.fill('#cashOpeningReasonV30','Пересчитан разменный фонд');await page.locator('#cashOpeningFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('Записано');expect((await writes(page))[0].args.p_payload).toEqual({shift_id:'cash-shift',amount:800.25,reason:'Пересчитан разменный фонд'});expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(7600.25);expect(errors).toEqual([]);
});

test('lost cash acknowledgement locks the draft and retries the exact action, amount, reason and UUID once',async({page})=>{
 const errors=await boot(page);await page.selectOption('#cashMovementTypeV30','expense');await page.fill('#cashMovementAmountV30','111.11');await page.fill('#cashMovementReasonV30','Канцелярия');await page.evaluate(()=>{__cashLost=true});await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashRetryV30')).toBeVisible();await expect(page.locator('#cashMovementAmountV30')).toBeDisabled();await page.evaluate(()=>{document.getElementById('cashMovementAmountV30').value='999';document.getElementById('cashMovementReasonV30').value='Подмена'});await page.click('#cashRetryV30');await expect(page.locator('#cashMessageV30')).toContainText('Записано');const calls=await writes(page);expect(calls).toHaveLength(2);expect(calls[1].args).toEqual(calls[0].args);expect(await effects(page)).toHaveLength(1);expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(7188.89);expect(errors).toEqual([]);
});

test('concurrent salary submit cannot create a second payout',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__cashHold=true;document.getElementById('cashMovementFormV30').requestSubmit();document.getElementById('cashMovementFormV30').dispatchEvent(new Event('submit',{cancelable:true}))});await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();expect(await writes(page)).toHaveLength(1);await page.evaluate(()=>__releaseCash());await expect(page.locator('#cashMessageV30')).toContainText('Записано');expect(await effects(page)).toHaveLength(1);expect(await page.evaluate(()=>__cashDrawer.salary_paid)).toBe(2000);expect(errors).toEqual([]);
});

test('manager cancels a mistaken movement with a reason while the original amount remains in history',async({page})=>{
 const errors=await boot(page,{role:'owner'});await movement(page,'expense','125','Ошибочный расход');await page.getByRole('button',{name:'Отменить ошибочную запись',exact:true}).click();const form=page.locator('#cashMovementsV30 form');await form.locator('input').fill('Внесено дважды');await form.locator('button').click();await expect(page.locator('#cashMessageV30')).toContainText('Записано');expect((await writes(page))[1].args).toMatchObject({p_action:'movement_void',p_payload:{shift_id:'cash-shift',id:'movement-1',reason:'Внесено дважды'}});expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(7300);await expect(page.locator('#cashMovementsV30')).toContainText('Ошибочный расход');await expect(page.locator('#cashMovementsV30')).toContainText('отменено: Внесено дважды');expect(await page.evaluate(()=>__cashDrawer.movements)).toHaveLength(1);expect(errors).toEqual([]);
});

test('nurse cannot correct opening or void a movement and a closed shift is read only',async({page})=>{
 const errors=await boot(page);await expect(page.locator('#cashOpeningFormV30')).toHaveCount(0);await movement(page,'expense','50','Расход');await expect(page.locator('[data-cash-void]')).toHaveCount(0);await page.evaluate(()=>openCashDrawerV30('cash-shift','closed'));await expect(page.locator('#cashMovementFormV30')).toHaveCount(0);await expect(page.locator('#cashOpeningFormV30')).toHaveCount(0);await expect(page.locator('#cashMovementsV30')).toContainText('Расход');expect(await writes(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('definitive cash rejection leaves an editable draft and corrected save uses a new UUID',async({page})=>{
 const errors=await boot(page);await page.selectOption('#cashMovementTypeV30','expense');await page.fill('#cashMovementAmountV30','500');await page.fill('#cashMovementReasonV30','Черновик расхода');await page.evaluate(()=>{__cashRejected={code:'P0001',message:'Проверьте выдачу наличных'}});await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('Проверьте выдачу');await expect(page.locator('#cashMovementAmountV30')).toBeEnabled();await expect(page.locator('#cashMovementReasonV30')).toHaveValue('Черновик расхода');await expect(page.locator('#cashRetryV30')).toHaveCount(0);await page.evaluate(()=>{__cashRejected=null});await page.fill('#cashMovementAmountV30','50');await page.locator('#cashMovementFormV30 button').click();await expect(page.locator('#cashMessageV30')).toContainText('Записано');const calls=await writes(page);expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);expect(await effects(page)).toHaveLength(1);expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(7250);expect(errors).toEqual([]);
});

test('pending cash response cannot render or retain a retry after sign out',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__cashHold=true;document.getElementById('cashMovementFormV30').requestSubmit()});await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();await page.evaluate(async()=>{await signOut();__releaseCash()});await expect(page.locator('#login')).toBeVisible();await expect(page.locator('#cashDrawerV30')).toHaveCount(0);expect(await effects(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('a completed save from drawer A unlocks drawer B without replacing B values or leaving a false retry',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{
  const drawerB=JSON.parse(JSON.stringify(__cashDrawer));drawerB.opening=3000;drawerB.balance=9800;
  const original=db.rpc;db.rpc=async(name,args)=>name==='crm_cash_drawer_v30'&&args.p_action==='status'&&args.p_payload.shift_id==='cash-shift-B'?{data:JSON.parse(JSON.stringify(drawerB))}:original(name,args);
  __cashHold=true;document.getElementById('cashMovementFormV30').requestSubmit();window.__releaseDrawerA=__releaseCash;
 });
 await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();await page.evaluate(()=>openCashDrawerV30('cash-shift-B','open'));await expect(page.locator('#cashBalanceV30')).toContainText(/9\s*800/);
 await page.evaluate(()=>__releaseDrawerA());await expect(page.locator('#cashMovementFormV30 button')).toBeEnabled();await expect(page.locator('#cashMovementAmountV30')).toBeEnabled();await expect(page.locator('#cashBalanceV30')).toContainText(/9\s*800/);await expect(page.locator('#cashMovementsV30')).not.toContainText('Выплата зарплаты');
 await page.evaluate(()=>openCashDrawerV30('cash-shift','open'));await expect(page.locator('#cashRetryV30')).toHaveCount(0);await expect(page.locator('#cashBalanceV30')).toContainText(/5\s*300/);await expect(page.locator('#cashMovementFormV30 button')).toBeEnabled();expect(await writes(page)).toHaveLength(1);expect(await effects(page)).toHaveLength(1);expect(errors).toEqual([]);
});

test('an old session completion cannot unlock or resubmit a newer session cash save',async({page})=>{
 const errors=await boot(page);await page.evaluate(()=>{__cashHold=true;document.getElementById('cashMovementFormV30').requestSubmit();window.__releaseOldCash=__releaseCash});await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();
 await page.evaluate(async()=>{await signOut();currentStaff={id:'nurse-1',full_name:'Наталья',role:'nurse',active:true};shift={id:'cash-shift',aId:'nurse-1',bId:'nurse-2'};show('workspace');await openCashDrawerV30('cash-shift','open')});
 await page.selectOption('#cashMovementTypeV30','expense');await page.fill('#cashMovementAmountV30','100');await page.fill('#cashMovementReasonV30','Новая сессия');await page.evaluate(()=>{__cashHold=true;document.getElementById('cashMovementFormV30').requestSubmit();window.__releaseNewCash=__releaseCash});await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();expect(await writes(page)).toHaveLength(2);
 await page.evaluate(async()=>{__releaseOldCash();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.getElementById('cashMovementFormV30').dispatchEvent(new Event('submit',{cancelable:true}))});
 await expect(page.locator('#cashMovementFormV30 button')).toBeDisabled();expect(await writes(page)).toHaveLength(2);await expect(page.locator('#cashMessageV30')).toContainText('Сохраняем');
 await page.evaluate(()=>__releaseNewCash());await expect(page.locator('#cashMessageV30')).toContainText('Записано');await expect(page.locator('#cashMovementFormV30 button')).toBeEnabled();await expect(page.locator('#cashRetryV30')).toHaveCount(0);expect(await effects(page)).toHaveLength(2);expect(await page.evaluate(()=>__cashDrawer.balance)).toBe(5200);expect(errors).toEqual([]);
});

test('a successful manager cash movement refreshes dashboard cash without changing shift income',async({page})=>{
 const errors=await boot(page,{role:'admin'});await page.evaluate(()=>{window.__cashDashboardRefreshes=0;window.__cashDashboardBalance=__cashDrawer.balance;refreshOwnerDashboardV5=async()=>{__cashDashboardRefreshes++;__cashDashboardBalance=__cashDrawer.balance}});
 await movement(page,'expense','125.25','Расход для кабинета');await expect.poll(()=>page.evaluate(()=>__cashDashboardRefreshes)).toBe(1);expect(await page.evaluate(()=>({balance:__cashDashboardBalance,income:__cashReport().revenue.total}))).toEqual({balance:7174.75,income:27800});await expect(page.locator('#cashBalanceV30')).toContainText(/7\s*174,75/);expect(errors).toEqual([]);
});
