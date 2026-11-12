import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishHandoverRecord} from '../src/operations/handover-records';
test('publishing an offline delivery rechecks current order contract and money under its lock',async()=>{
 let writes=0,locks=0;const tx:any={$queryRaw:async()=>{locks++;return[];},handover:{findUnique:async()=>({id:'h',orderId:'o',executionMode:'OFFLINE',type:'DELIVERY',status:'DRAFT'}),update:async()=>{writes++;return{};}},orderChange:{count:async()=>1},auditLog:{create:async()=>{}},notification:{create:async()=>{}}};
 await assert.rejects(publishHandoverRecord(tx,'h','operator'),(e:any)=>e.getResponse?.().error?.code==='HANDOVER_NOT_READY');assert.equal(writes,0);assert.ok(locks>0);
});
