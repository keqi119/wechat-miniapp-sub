import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ElectronicReconciler,reconcileElectronicBatch} from '../src/electronic-documents/reconciliation';

test('reconciliation isolates task failures and only scans live unleased tasks',async()=>{
 let query:any;const advanced:string[]=[];
 const db:any={electronicSigningTask:{updateMany:async()=>({count:1}),findMany:async(input:any)=>{if(input.where.stoppedEvidenceId===null)return[{id:'stopped'}];query=input;return[{id:'first'},{id:'second'}];}}};
 const now=new Date('2026-11-02T06:00:00Z');
 const result=await reconcileElectronicBatch(db,{reconcileStopped:async(id:string)=>{advanced.push(id);},advance:async(id:string)=>{advanced.push(id);if(id==='first')throw new Error('transient');}} as any,now);
 assert.deepEqual(result,{reconciled:2,failed:1});assert.deepEqual(advanced,['first','second','stopped']);
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
test('stopped recovery scheduling rotates past twenty unchanged or failing rows',async()=>{
 const rows=Array.from({length:21},(_,i)=>({id:String(i),updatedAt:i,recoveryNextCheckAt:null as Date|null})),seen:string[]=[];
 const db:any={electronicSigningTask:{findMany:async(q:any)=>{if(q.where.stoppedEvidenceId!==null)return[];return rows.filter(r=>!q.where.OR||!r.recoveryNextCheckAt||r.recoveryNextCheckAt<=q.where.OR[1].recoveryNextCheckAt.lte).sort((a,b)=>(a.recoveryNextCheckAt?.getTime()??0)-(b.recoveryNextCheckAt?.getTime()??0)||a.updatedAt-b.updatedAt).slice(0,q.take);},updateMany:async(q:any)=>{Object.assign(rows.find(r=>r.id===q.where.id)!,q.data);return{count:1};}}};
 const service:any={advance:async()=>{},reconcileStopped:async(id:string)=>{seen.push(id);if(id==='0')throw new Error('unavailable');}},now=new Date();
 await reconcileElectronicBatch(db,service,now);await reconcileElectronicBatch(db,service,now);assert.ok(seen.includes('20'));assert.ok(rows.slice(0,20).every(r=>r.recoveryNextCheckAt&&r.recoveryNextCheckAt>now));
});
