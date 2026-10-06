import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationWriter,operationRequest} from '../js/canonical-operations.js';
import {DB,upsert,remove} from '../js/store.js?v=canonical-20261006';
import {replay,compute,invalidate} from '../js/engine.js?v=canonical-20261006';
const row={id:'fixture-1',type:'buy',date:'2026-10-06',time:'12:00',account_id:'test-account',position_id:'TEST',qty:20,price:10,currency:'EUR',fx:1,commission:1,commission_ccy:'EUR',tax:0,total_eur:200,total_comm_eur:201,execution_ref:'fixture-execution',description:'Synthetic receipt'};
function journal(){let stored=null;return {read:()=>stored,write:x=>{stored=structuredClone(x);},clear:()=>{stored=null;}};}
test('native trade maps without inventing FX or dropping taxes',()=>{
 assert.equal(operationRequest(row).id,'manual-fixture-1');assert.equal(operationRequest(row).total_comm_eur,201);
 assert.throws(()=>operationRequest({...row,currency:'USD'}));assert.throws(()=>operationRequest({...row,tax:1}));
 assert.throws(()=>operationRequest({...row,type:'switch'}));assert.throws(()=>operationRequest({...row,execution_ref:''}));
});
test('unknown outcome followed by auth error retains same request for retry',async()=>{
 const log=[],j=journal();let attempt=0;
 const writer=createOperationWriter(async(name,args)=>{if(name==='cartera_ledger_snapshot')return {revision:2,enabled:true,pending:0};log.push(args);if(++attempt===1)throw Error('response lost');if(attempt===2)throw {code:'401',message:'unauthorized'};return {id:'canonical-1',revision:3};},j);
 await assert.rejects(writer.save(row));await assert.rejects(writer.save({...row,qty:21}),/pendiente/);
 await assert.rejects(writer.save(row));assert.ok(j.read());await writer.save(row);
 assert.deepEqual(log[0],log[2]);assert.equal(j.read(),null);
});
test('stale revision releases rejected draft and refreshes before explicit retry',async()=>{
 const j=journal();let reads=0;const writer=createOperationWriter(async(name)=>{if(name==='cartera_ledger_snapshot')return {revision:++reads,enabled:true,pending:0};throw {code:'P0001',message:'STALE_REVISION'};},j);
 await assert.rejects(writer.save(row));assert.equal(j.read(),null);assert.equal(reads,2);
});
test('store forbids offline operation mutations and original deletion without touching memory',async()=>{
 DB.mode='local';DB.operations=[{id:'original',qty:5}];const before=structuredClone(DB.operations);
 await assert.rejects(upsert('operations',row),/conexión/);await assert.rejects(remove('operations','original'),/No se borran/);
 assert.deepEqual(DB.operations,before);
});
test('historical negative and tiny residual remain visible, never clamped to zero',()=>{
 DB.accounts=[{id:'test-account'}];DB.positions=[{id:'TEST',ticker:'TEST',currency:'EUR',type:'stock',scope:'inversion'}];
 DB.operations=[{...row,id:'buy',type:'buy',date:'2026-10-01',qty:1},{...row,id:'sell',type:'sell',date:'2026-10-02',qty:1.0000000001}];DB.dividends=[];invalidate();
 const result=replay('2026-10-06');assert.ok(result.H['test-account|TEST'].qty<0);assert.equal(result.avisos.length,1);
 assert.ok(compute('2026-10-06').rows.some(r=>r.positionId==='TEST'&&r.qty<0));
});
test('existing execution rejects definitively and releases the draft',async()=>{
 const j=journal();const writer=createOperationWriter(async name=>{if(name==='cartera_ledger_snapshot')return {revision:0,enabled:true,pending:0};throw {code:'P0001',message:'EXECUTION_ALREADY_RECORDED'};},j);
 await assert.rejects(writer.save(row));assert.equal(j.read(),null);
 await assert.rejects(writer.save({...row,id:'another',execution_ref:'another'}));assert.equal(j.read(),null);
});
