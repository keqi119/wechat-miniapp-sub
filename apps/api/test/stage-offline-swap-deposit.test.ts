import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSwapAdjustments} from '../src/vehicle-changes/finance';
function fixture(net=50000){let writes=0;const tx:any={payment:{findMany:async()=>[{id:'actual-deposit',amount:50000,refunds:[]}]},bill:{updateMany:async()=>{writes++;return{count:0};}}};const change={orderId:'order',customerId:'customer'},q={id:'quote',financePreparedAt:null,snapshot:{depositFunds:[{net,amount:50000,id:'actual-deposit'}],depositChargeAmount:0,depositRefundAmount:0,handoverFeeAmount:0}};return{tx,change,q,get writes(){return writes;}};}
test('nonzero actual deposit survives JSONB field ordering without changing any frozen document or money facts',async()=>{
 const f=fixture(),snapshot=structuredClone(f.q.snapshot);await prepareSwapAdjustments(f.tx,f.change,f.q,{id:'finance'});assert.equal(f.writes,1);assert.deepEqual(f.q.snapshot,snapshot);
});
test('deposit value drift still rejects before any adjustment write',async()=>{
 const f=fixture(49999);await assert.rejects(prepareSwapAdjustments(f.tx,f.change,f.q,{id:'finance'}),(e:any)=>e.getResponse?.().error?.code==='FUNDS_CHANGED');assert.equal(f.writes,0);
});
