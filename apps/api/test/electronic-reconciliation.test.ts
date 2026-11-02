import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ElectronicReconciler,reconcileElectronicBatch} from '../src/electronic-documents/reconciliation';

test('reconciliation isolates task failures and only scans live unleased tasks',async()=>{
 let query:any;const advanced:string[]=[];
 const db:any={electronicSigningTask:{findMany:async(input:any)=>{query=input;return[{id:'first'},{id:'second'}];}}};
 const now=new Date('2026-11-02T06:00:00Z');
 const result=await reconcileElectronicBatch(db,{advance:async(id:string)=>{advanced.push(id);if(id==='first')throw new Error('transient');}} as any,now);
 assert.deepEqual(result,{reconciled:1,failed:1});assert.deepEqual(advanced,['first','second']);
 assert.equal(query.where.retiredAt,null);assert.equal(query.where.withdrawnAt,null);
 assert.deepEqual(query.where.OR,[{processingUntil:null},{processingUntil:{lte:now}}]);
 assert.ok(!query.where.status.in.includes('PREPARED'));assert.equal(query.take,20);
});

test('background database outage does not become an unhandled rejection or hold the runner lock',async()=>{
 const previous=process.env.ELECTRONIC_SIGNING_ENABLED;process.env.ELECTRONIC_SIGNING_ENABLED='true';
 const db:any={electronicSigningTask:{findMany:async()=>{throw new Error('synthetic unavailable database');}}};
 const runner:any=new ElectronicReconciler(db,{} as any);
 try{await assert.doesNotReject(runner.tick());assert.equal(runner.running,false);}
 finally{if(previous===undefined)delete process.env.ELECTRONIC_SIGNING_ENABLED;else process.env.ELECTRONIC_SIGNING_ENABLED=previous;}
});
