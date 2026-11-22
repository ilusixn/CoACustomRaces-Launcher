const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('updating preserves realmlist and reaches ready without realm setup', async()=>{
 const main=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');let handler,status,fail=true;
 const ctx={handle:(_,fn)=>handler=fn,config:{localDownloadDemo:false},settings:{installPath:'fixture'},requireIdleClient:async()=>{},probeClientFolder:async()=>{},clientUpdater:{update:async()=>{status={phase:'finalizing'}},emit:(phase,message)=>{status={phase,message}}},mutateClient:fn=>fn(),configureRealm:async()=>{if(fail)throw Error('access denied');},clientInfo:async()=>({installed:true})};
 vm.createContext(ctx);vm.runInContext(main.slice(main.indexOf("  handle('launcher:client-update'"),main.indexOf("  handle('launcher:client-pause'")),ctx);
 assert.equal((await handler(false)).installed,true);assert.equal(status.phase,'ready');
 fail=false;assert.equal((await handler(false)).installed,true);assert.equal(status.phase,'ready');
});

test('addon inventory refreshes for a changed client and discards an old in-flight result',async()=>{
 const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');let calls=0,release;
 const ctx={state:{client:{path:'B'},addonClientPath:'A',addonLoading:false,addons:[{id:'A'}],page:'home'},api:{addons:async()=>{calls++;return{packages:[{id:'B'}]};}},renderAddonCatalog(){},render(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function loadAddons('),source.indexOf('function showAddonDetails(')),ctx);
 await ctx.loadAddons();assert.equal(calls,1);assert.equal(ctx.state.addons[0].id,'B');
 ctx.api.addons=()=>new Promise(resolve=>{release=resolve;});const pending=ctx.loadAddons(true);
 ctx.state.client.path='C';ctx.state.addons=[];release({packages:[{id:'stale B'}]});await pending;
 assert.equal(ctx.state.addons.length,0);assert.equal(ctx.state.addonLoading,false);
 ctx.api.addons=async()=>({packages:[{id:'C'}]});await ctx.loadAddons();assert.equal(ctx.state.addons[0].id,'C');
});

test('empty addon results and errors do not trigger a render/rescan loop',async()=>{
 const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
 for(const fail of [false,true]){
 let calls=0,renders=0;const pending=[];
 const ctx={state:{client:{path:'A'},addonClientPath:undefined,addonLoading:false,addons:[],page:'addons'},api:{addons:async()=>{calls++;if(fail)throw Error('scan failed');return{packages:[],folderCount:0};}},tm:s=>s,t:s=>s,renderAddonCatalog(){},render(){renders++;if(renders<4)pending.push(ctx.loadAddons());}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function loadAddons('),source.indexOf('function showAddonDetails(')),ctx);
 await ctx.loadAddons();await Promise.all(pending);assert.equal(calls,1);assert.equal(renders,1);
 await ctx.loadAddons(true);assert.equal(calls,2,'manual retry still scans');
 ctx.state.client.path='B';await ctx.loadAddons();assert.equal(calls,3,'new client rescans');
 }
});

test('home shows the CoA client download notice only without a client, through the link allowlist', () => {
  const fs = require('node:fs'); const assert = require('node:assert/strict');
  const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const main = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');
  assert.match(app, /\$\{installed \? '' : lh`<p class="hd-patches-hint">\$\{t\('For now you need your own CoA client\. Fetch it from here:'\)\}/);
  assert.match(app, /data-action="coa-link" data-link="client"/);
  assert.match(main, /client: 'https:\/\/conquestofazerothcore\.to\/download\/windows'/);
});
