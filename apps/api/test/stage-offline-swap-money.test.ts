import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeRenewalMoney} from './stage-offline-swap-fixture';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';
import {hash} from '../src/common/data';

test('renewal original funds use immutable SUBSCRIPTION bills/global period keys, even after the stage ends',async()=>{
 const f=await activeRenewalMoney(),result=await readOfflineSwapFunds(f.tx,f.order,f.swap,null);
 assert.deepEqual(result.baseRows.map((r:any)=>[r.sequence,r.stageSequence]),Array.from({length:12},(_,i)=>[i+13,i+1]));assert.equal(result.rows[0].netPaidAmount,20000);assert(result.rows.every((r:any)=>r.sourceBillIds.every((id:string)=>f.bills.find(b=>b.id===id)?.serviceStageId===f.stage.id)));
 f.stage.status='ENDED';f.stage.endedAt=new Date('2028-10-01');f.addChange(true);for(const o of f.obligations)if(o.serviceStageId===f.stage.id)o.active=false;
 assert.deepEqual((await readOfflineSwapFunds(f.tx,f.order,f.swap,null)).rows,result.rows);
});
test('renewal history rejects borrowed stage/global/local/bill key and unknown storage faults propagate',async()=>{
 for(const mutate of [(f:any)=>f.obligations.find((o:any)=>o.serviceStageId===f.stage.id).stageSequence=9,(f:any)=>f.obligations.find((o:any)=>o.serviceStageId===f.stage.id).serviceStageId='other',(f:any)=>f.bills.find((b:any)=>b.serviceStageId===f.stage.id).idempotencyKey='delay-'+f.quote.id+'-13',(f:any)=>f.bills.find((b:any)=>b.serviceStageId===f.stage.id).serviceStageId=null]){
  const f=await activeRenewalMoney();mutate(f);await assert.rejects(readOfflineSwapFunds(f.tx,f.order,f.swap,null),(e:any)=>['SWAP_FINANCE_SOURCE','SWAP_STAGE_SOURCE'].includes(e.getResponse?.().error?.code));
 }
 const f=await activeRenewalMoney(),error=new Error('storage unavailable');f.tx.bill.findMany=async()=>{throw error;};await assert.rejects(readOfflineSwapFunds(f.tx,f.order,f.swap,null),e=>e===error);
});
