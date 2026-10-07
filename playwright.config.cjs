const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests',testMatch:'**/*browser.spec.cjs',workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:4173',headless:true,viewport:{width:390,height:844}},
 reporter:'list',
 webServer:{command:'python -m http.server 4173 --bind 127.0.0.1',url:'http://127.0.0.1:4173',reuseExistingServer:true,timeout:10000}
});
