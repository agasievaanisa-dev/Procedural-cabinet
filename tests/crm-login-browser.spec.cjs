const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

// Only synthetic credentials reach this SDK stub; every external request is blocked.
async function boot(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.loginAttempts=[];window.loginOutcomes=[];window.enteredUsers=[];
  window.dbStub={auth:{
   getSession:async()=>({data:{session:null},error:null}),
   signOut:async()=>({error:null}),
   signInWithPassword:async credentials=>{
    loginAttempts.push({...credentials});
    const outcome=loginOutcomes.shift()||{result:{data:{user:{id:'synthetic-user'}},error:null}};
    if(outcome.defer)await new Promise(resolve=>{window.releaseLogin=resolve;});
    if(outcome.throw)throw new Error(outcome.throw);
    return outcome.result;
   }
  }};
 });
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/vendor/supabase-2.117.2.js'))return route.fulfill({contentType:'application/javascript',body:'window.supabase={createClient:()=>window.dbStub}'});
  if(url.hostname!=='127.0.0.1')return route.abort();
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1),location=path.join(root,file);
  return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.existsSync(location)?fs.readFileSync(location,'utf8'):''});
 });
 await page.goto('/');
 await page.evaluate(()=>{enterApp=async user=>{enteredUsers.push({...user});};});
 await expect(page.locator('#loginForm')).toBeVisible();
 return errors;
}
async function fillCredentials(page,password=' Вымышленный ЁЙ пароль 42! '){
 await page.fill('#loginEmail','SYNTHETIC@example.test');
 await page.fill('#loginPassword',password);
 return password;
}
async function expectReady(page){
 await expect(page.locator('#loginSubmit')).toBeEnabled();
 await expect(page.locator('#loginSubmit')).toHaveText('Войти');
 await expect(page.locator('#loginForm')).toHaveAttribute('aria-busy','false');
}

test('password visibility preserves all characters and never submits the form',async({page})=>{
 const errors=await boot(page),password=await fillCredentials(page);
 await expect(page.locator('#loginEmail')).toHaveAttribute('autocomplete','username');
 await expect(page.locator('#loginPassword')).toHaveAttribute('autocomplete','current-password');
 await expect(page.locator('#loginPassword')).toHaveAttribute('type','password');
 await page.click('#loginPasswordToggle');
 await expect(page.locator('#loginPassword')).toHaveAttribute('type','text');
 await expect(page.locator('#loginPassword')).toHaveValue(password);
 await expect(page.locator('#loginPasswordToggle')).toHaveText('Скрыть пароль');
 await expect(page.locator('#loginPasswordToggle')).toHaveAttribute('aria-pressed','true');
 await page.click('#loginPasswordToggle');
 await expect(page.locator('#loginPassword')).toHaveAttribute('type','password');
 await expect(page.locator('#loginPassword')).toHaveValue(password);
 await expect(page.locator('#loginPasswordToggle')).toHaveText('Показать пароль');
 await expect(page.locator('#loginPasswordToggle')).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>loginAttempts.length)).toBe(0);
 await page.click('#loginSubmit');
 await expect.poll(()=>page.evaluate(()=>enteredUsers.length)).toBe(1);
 expect(await page.evaluate(()=>loginAttempts)).toEqual([{email:'synthetic@example.test',password}]);
 await expectReady(page);expect(errors).toEqual([]);
});

test('Enter submits once and repeated submissions cannot bypass the pending guard',async({page})=>{
 const errors=await boot(page),password=await fillCredentials(page);
 await page.evaluate(()=>loginOutcomes.push({defer:true,result:{data:{user:{id:'synthetic-enter-user'}},error:null}}));
 await page.press('#loginPassword','Enter');
 await expect.poll(()=>page.evaluate(()=>loginAttempts.length)).toBe(1);
 await expect(page.locator('#loginSubmit')).toBeDisabled();
 await expect(page.locator('#loginForm')).toHaveAttribute('aria-busy','true');
 await page.press('#loginPassword','Enter');
 await page.evaluate(async()=>{
  document.getElementById('loginForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await Promise.all([signIn(),signIn()]);
 });
 expect(await page.evaluate(()=>loginAttempts.length)).toBe(1);
 expect(await page.evaluate(()=>enteredUsers.length)).toBe(0);
 await page.evaluate(()=>releaseLogin());
 await expect.poll(()=>page.evaluate(()=>enteredUsers)).toEqual([{id:'synthetic-enter-user'}]);
 expect(await page.evaluate(()=>loginAttempts[0].password)).toBe(password);
 await expectReady(page);expect(errors).toEqual([]);
});

test('invalid credentials show Russian guidance and preserve the password for retry',async({page})=>{
 const errors=await boot(page),password=await fillCredentials(page);
 await page.evaluate(()=>loginOutcomes.push({result:{data:{user:null},error:{code:'invalid_credentials',message:'Invalid login credentials',status:400}}}));
 await page.click('#loginSubmit');
 await expect(page.locator('#loginMessage')).toHaveText('Не удалось войти. Проверьте email и пароль: регистр букв и раскладку клавиатуры.');
 await expectReady(page);
 await expect(page.locator('#loginPassword')).toHaveValue(password);
 expect(await page.evaluate(()=>enteredUsers.length)).toBe(0);
 await page.click('#loginSubmit');
 await expect.poll(()=>page.evaluate(()=>enteredUsers.length)).toBe(1);
 expect(await page.evaluate(()=>loginAttempts)).toEqual([{email:'synthetic@example.test',password},{email:'synthetic@example.test',password}]);
 await expectReady(page);expect(errors).toEqual([]);
});

test('a thrown network error releases the submit button and allows a successful retry',async({page})=>{
 const errors=await boot(page),password=await fillCredentials(page);
 await page.evaluate(()=>loginOutcomes.push({throw:'Failed to fetch'}));
 await page.click('#loginSubmit');
 await expect(page.locator('#loginMessage')).toHaveText('Не удалось связаться с сервером. Проверьте интернет и попробуйте снова.');
 await expectReady(page);await expect(page.locator('#loginPassword')).toHaveValue(password);
 expect(await page.evaluate(()=>enteredUsers.length)).toBe(0);
 await page.press('#loginPassword','Enter');
 await expect.poll(()=>page.evaluate(()=>enteredUsers.length)).toBe(1);
 expect(await page.evaluate(()=>loginAttempts.length)).toBe(2);
 await expectReady(page);expect(errors).toEqual([]);
});

test('only an error-free response with a user enters the cabinet and hides the password',async({page})=>{
 const errors=await boot(page),password=await fillCredentials(page);
 await page.click('#loginPasswordToggle');
 await page.evaluate(()=>loginOutcomes.push(
  {result:{data:{user:null},error:null}},
  {result:{data:{user:{id:'must-not-enter'}},error:{code:'invalid_credentials',message:'Invalid login credentials'}}},
  {result:{data:{user:{id:'verified-synthetic-user'}},error:null}}
 ));
 await page.click('#loginSubmit');
 await expect(page.locator('#loginMessage')).toHaveText('Не удалось подтвердить вход. Повторите попытку.');
 await expectReady(page);expect(await page.evaluate(()=>enteredUsers.length)).toBe(0);
 await page.click('#loginSubmit');
 await expect(page.locator('#loginMessage')).toContainText('Проверьте email и пароль');
 await expectReady(page);expect(await page.evaluate(()=>enteredUsers.length)).toBe(0);
 await page.click('#loginSubmit');
 await expect.poll(()=>page.evaluate(()=>enteredUsers)).toEqual([{id:'verified-synthetic-user'}]);
 await expect(page.locator('#loginPassword')).toHaveAttribute('type','password');
 await expect(page.locator('#loginPassword')).toHaveValue(password);
 await expect(page.locator('#loginPasswordToggle')).toHaveAttribute('aria-pressed','false');
 await expectReady(page);expect(errors).toEqual([]);
});

test('required email and password block incomplete submissions before the SDK is called',async({page})=>{
 const errors=await boot(page);
 await page.click('#loginSubmit');await page.evaluate(()=>signIn());
 expect(await page.evaluate(()=>loginAttempts.length)).toBe(0);
 await page.fill('#loginEmail','synthetic@example.test');await page.press('#loginPassword','Enter');
 expect(await page.evaluate(()=>loginAttempts.length)).toBe(0);
 await expectReady(page);expect(errors).toEqual([]);
});
