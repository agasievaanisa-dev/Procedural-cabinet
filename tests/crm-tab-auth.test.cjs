const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-tab-auth-v15.js'),'utf8');
const url='https://example.supabase.co';
function savedStore(values=[]){
 const valuesMap=new Map(values),storage={
  get length(){return valuesMap.size},key:i=>[...valuesMap.keys()][i]??null,
  getItem:key=>valuesMap.get(key)??null,setItem:(key,value)=>valuesMap.set(key,value),removeItem:key=>valuesMap.delete(key)
 };
 return {valuesMap,storage};
}
function options(storage,type='navigate'){
 const context={URL,Uint8Array,crypto,performance:{getEntriesByType:()=>[{type}]},sessionStorage:storage};
 Object.defineProperty(context,'localStorage',{get(){throw Error('Shared localStorage must not be read')}});
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return context.tabAuthOptionsV15(url).auth;
}
test('three tab adapters retain separate sessions and fresh SDK broadcast namespaces',()=>{
 const tabs=Array.from({length:3},()=>options(savedStore().storage));
 assert.equal(new Set(tabs.map(tab=>tab.storageKey)).size,3);
 tabs.forEach((tab,index)=>tab.storage.setItem(tab.storageKey,'account-'+index));
 tabs.forEach((tab,index)=>assert.equal(tab.storage.getItem(tab.storageKey),'account-'+index));
 tabs[1].storage.removeItem(tabs[1].storageKey);
 assert.equal(tabs[0].storage.getItem(tabs[0].storageKey),'account-0');
 assert.equal(tabs[1].storage.getItem(tabs[1].storageKey),null);
 assert.equal(tabs[2].storage.getItem(tabs[2].storageKey),'account-2');
});
test('reload remaps saved session and all SDK suffixes to a new broadcast namespace',()=>{
 const saved=savedStore(),initial=options(saved.storage);
 const suffixes=['','-user','-code-verifier','-flows-code-verifier','-flow-123-code-verifier'];
 suffixes.forEach(suffix=>initial.storage.setItem(initial.storageKey+suffix,'value'+suffix));
 for(const type of ['reload','back_forward']){
  const next=options(saved.storage,type);assert.notEqual(next.storageKey,initial.storageKey);
  suffixes.forEach(suffix=>assert.equal(next.storage.getItem(next.storageKey+suffix),'value'+suffix));
  assert.equal(next.persistSession,true);assert.equal(next.autoRefreshToken,true);assert.equal(next.detectSessionInUrl,false);
 }
});
test('fresh opener navigation requires its own login and preserves unrelated sessionStorage',()=>{
 const original=savedStore([['unrelated','keep']]),first=options(original.storage);
 first.storage.setItem(first.storageKey,'original-account');first.storage.setItem(first.storageKey+'-user','original-user');
 const cloned=savedStore(original.valuesMap),newTab=options(cloned.storage,'navigate');
 assert.equal(newTab.storage.getItem(newTab.storageKey),null);
 assert.equal(newTab.storage.getItem(newTab.storageKey+'-user'),null);
 assert.equal(cloned.storage.getItem('unrelated'),'keep');
 assert.equal(first.storage.getItem(first.storageKey),'original-account');
});
test('blocked storage uses memory and never falls back to shared localStorage',()=>{
 const blocked={getItem(){throw Error('SecurityError')},setItem(){throw Error('SecurityError')},removeItem(){throw Error('SecurityError')}};
 const auth=options(blocked,'reload');
 assert.equal(auth.storage.getItem(auth.storageKey),null);
 auth.storage.setItem(auth.storageKey,'memory-session');assert.equal(auth.storage.getItem(auth.storageKey),'memory-session');
 auth.storage.removeItem(auth.storageKey);assert.equal(auth.storage.getItem(auth.storageKey),null);
});
test('a failing write permanently switches to mirrored memory without resurrecting old session',()=>{
 const saved=savedStore(),auth=options(saved.storage);auth.storage.setItem(auth.storageKey,'old');
 let reads=0;saved.storage.getItem=()=>{reads++;return 'old'};saved.storage.setItem=()=>{throw Error('QuotaExceededError')};
 auth.storage.setItem(auth.storageKey,'refreshed');assert.equal(auth.storage.getItem(auth.storageKey),'refreshed');
 auth.storage.removeItem(auth.storageKey);assert.equal(auth.storage.getItem(auth.storageKey),null);assert.equal(reads,0);
});
test('a fresh-navigation clear failure cannot restore an inherited account',()=>{
 const saved=savedStore(),original=options(saved.storage);original.storage.setItem(original.storageKey,'inherited');
 saved.storage.removeItem=()=>{throw Error('SecurityError')};
 const next=options(saved.storage);assert.equal(next.storage.getItem(next.storageKey),null);
});
