/* Independent login per tab. SDK broadcasts use a fresh document namespace;
   only this tab's sessionStorage retains its session across reloads. */
(function(global){
 'use strict';
 function navigationType(){
  try {
   const type=global.performance?.getEntriesByType?.('navigation')?.[0]?.type;
   if(type)return type;
   return global.performance?.navigation?.type===1?'reload':global.performance?.navigation?.type===2?'back_forward':'navigate';
  } catch { return 'navigate'; }
 }
 function documentId(){
  if(global.crypto?.randomUUID)return global.crypto.randomUUID();
  const bytes=new Uint8Array(16);global.crypto.getRandomValues(bytes);
  return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 }
 global.tabAuthOptionsV15=function(url){
  const prefix='procedural-cabinet.auth.v15.'+new URL(url).hostname;
  const savedKey=prefix+'.session',sdkKey=prefix+'.sdk.'+documentId(),memory=new Map();
  let storage;
  try { storage=global.sessionStorage; } catch { storage=null; }
  // An opener can copy sessionStorage to a new tab. Require its own login;
  // reloading or returning to this existing tab retains the tab's session.
  if(!['reload','back_forward'].includes(navigationType())&&storage){
   try {
    const keys=[];
    for(let index=0;index<storage.length;index++){
     const key=storage.key(index);
     if(key===savedKey||key?.startsWith(savedKey+'-'))keys.push(key);
    }
    keys.forEach(key=>storage.removeItem(key));
   } catch { storage=null; }
  }
  const keyFor=key=>key===sdkKey?savedKey:key.startsWith(sdkKey+'-')?savedKey+key.slice(sdkKey.length):prefix+'.extra.'+key;
  const adapter={
   getItem(key){
    key=keyFor(key);
    if(storage){try{const value=storage.getItem(key);if(value===null)memory.delete(key);else memory.set(key,value);return value;}catch{storage=null;}}
    return memory.get(key)??null;
   },
   setItem(key,value){
    key=keyFor(key);memory.set(key,value);
    if(storage){try{storage.setItem(key,value);}catch{storage=null;}}
   },
   removeItem(key){
    key=keyFor(key);memory.delete(key);
    if(storage){try{storage.removeItem(key);}catch{storage=null;}}
   }
  };
  return {auth:{storage:adapter,storageKey:sdkKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}};
 };
})(window);
