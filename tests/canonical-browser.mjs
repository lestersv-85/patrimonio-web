import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'/opt/codex/cua_node/lib/node_modules/playwright/index.mjs'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.route('https://patrimonio.test/**',route=>{
  const name=new URL(route.request().url()).pathname;
  if(name==='/')return route.fulfill({contentType:'text/html',body:'<div id="modalbg"><div id="modal"></div></div><div id="toast"></div>'});
  const target=path.resolve(root,'.'+name);if(!target.startsWith(root+'/'))throw Error('Path outside fixture');
  return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(target,'utf8').replaceAll('3476a071-0e0f-475b-86a1-07a5fb503bae','synthetic-owner')});
 });
 await page.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'text/javascript',body:'export function createClient(){return window.fixtureClient;}'}));
 await page.goto('https://patrimonio.test/');
 await page.evaluate(()=>{
  const operations=[],receipts=new Map();window.calls=[];window.rpcMode='rejected';
  window.fixtureClient={auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-owner'}}}})},
   from(table){const query={select(){return this;},range(){return this;},order(){return this;},limit(){return this;},
    maybeSingle:async()=>({data:null}),then(resolve){return Promise.resolve({data:table==='accounts'?[{id:'test-account',name:'Synthetic account'}]:table==='positions'?[{id:'TEST',ticker:'TEST',name:'Synthetic issuer',currency:'USD',type:'stock'}]:table==='operations'?operations.map(x=>({...x})):[]}).then(resolve);},
    upsert(){throw Error('Direct write forbidden in fixture');},delete(){throw Error('Direct delete forbidden in fixture');}};return query;},
   async rpc(name,args){if(name==='cartera_ledger_snapshot')return {data:{revision:receipts.size,enabled:true,pending:0,operations:[]}};
    window.calls.push(structuredClone(args));if(window.rpcMode==='rejected')return {error:{code:'P0001',message:'TRADE_AMOUNTS_MISMATCH'}};
    const e=args.p_event;if(!receipts.has(e.id)){receipts.set(e.id,'canonical-'+e.id);operations.push({...e,id:receipts.get(e.id)});}
    if(window.rpcMode==='lost'){window.rpcMode='success';return {error:{message:'Response lost'}};}
    return {data:{id:receipts.get(e.id),revision:receipts.size}};
   }};
 });
 await page.evaluate(async()=>{window.store=await import('/js/store.js?v=canonical-20261006');await window.store.loadAll();window.forms=await import('/js/forms.js');window.forms.openOpForm(null,{account_id:'test-account',position_id:'TEST'});});
 await page.locator('#f-qty').fill('2');await page.locator('#f-price').fill('10');
 await page.locator('#f-reference').fill('synthetic-receipt');await page.locator('#f-notes').fill('Synthetic source');
 await page.locator('#f-save').click();try{await page.waitForFunction(()=>window.calls.length===1,{},{timeout:3000});}catch(e){console.log(await page.evaluate(()=>({status:window.store.DB.operationWriteStatus,toast:document.querySelector('#toast').textContent,fields:[...document.querySelectorAll('input,select')].map(x=>[x.id,x.value]),calls:window.calls})));throw e;}
 if(await page.evaluate(()=>window.store.DB.operations.length)!==0)throw Error('Rejected write changed memory');
 if(await page.locator('#f-save').isDisabled())throw Error('Rejected form locked');
 await page.evaluate(()=>window.rpcMode='lost');await page.locator('#f-save').click();await page.waitForFunction(()=>window.calls.length===2);
 if(await page.evaluate(()=>window.store.DB.operations.length)!==0)throw Error('Uncertain write changed memory');
 await page.locator('#f-save').click();await page.waitForFunction(()=>window.store.DB.operations.length===1);
 const calls=await page.evaluate(()=>window.calls);if(JSON.stringify(calls[1].p_event)!==JSON.stringify(calls[2].p_event))throw Error('Retry changed request');
 if(calls[2].p_event.currency!=='EUR')throw Error('Position currency overwrote settlement currency');
 if(await page.evaluate(()=>window.store.pendingCanonicalOperation())!==null)throw Error('Confirmed request still pending');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS Chromium Patrimonio: single RPC, no memory on rejection/uncertainty, idempotent retry, EUR settlement preserved. No live writes.');
}finally{await browser.close();}
