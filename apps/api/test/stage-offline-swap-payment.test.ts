import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmedStageSwapFixture} from './stage-offline-swap-fixture';
import {prepareFinance} from '../src/order-changes/finance';
import * as paymentModule from '../src/vehicle-changes/finance';
async function prepared(){const f=await confirmedStageSwapFixture();await prepareFinance(f.tx,f.change,{id:'finance'});const bill=f.bills.find(b=>b.type==='SWAP_ADJUSTMENT')!;const guard=(paymentModule as any).readStageSwapPaymentGuard;assert.equal(typeof guard,'function');return{...f,bill,guard};}
test('staged swap payment verifies genuine pinned paper and local/global obligation, without inventing active history',async()=>{
 const f=await prepared(),before=f.writes.length,result=await f.guard(f.tx,f.bill);assert.equal(result.obligation.sequence,13);assert.equal(result.obligation.stageSequence,1);assert.equal(result.serviceStageScope.serviceStageId,f.stage.id);assert.equal(f.writes.length,before);
 Object.assign(f.bill,{status:'PAID',paidAmount:f.bill.amount});await assert.rejects(f.guard(f.tx,f.bill),(e:any)=>e.getResponse?.().error?.code==='SWAP_STAGE_PAYMENT_BLOCKED');assert(await f.guard(f.tx,f.bill,'ALLOCATION'));assert(await f.guard(f.tx,f.bill,'HISTORY'));
 f.paper.status='INVALIDATED';await assert.rejects(f.guard(f.tx,f.bill,'HISTORY'));
});
test('replaced quote retains immutable receipts but refuses fresh payment and allocation; unrelated bills remain outside this guard',async()=>{
 const f=await prepared();f.q.status='SUPERSEDED';f.change.activeQuoteId='replacement-quote';
 assert(await f.guard(f.tx,f.bill,'HISTORY'));for(const mode of ['PAYMENT','ALLOCATION'])await assert.rejects(f.guard(f.tx,f.bill,mode),(e:any)=>e.getResponse?.().error?.code==='SWAP_STAGE_PAYMENT_BLOCKED');
 assert.equal(await f.guard(f.tx,{...f.bill,type:'SUBSCRIPTION'}),null);assert.equal(await f.guard(f.tx,{...f.bill,serviceStageId:null}),null);
});
test('bill stage/key/amount or obligation local sequence cannot be borrowed and unknown storage failures propagate',async()=>{
 for(const mutate of [(f:any)=>f.bill.serviceStageId='other',(f:any)=>f.bill.idempotencyKey='foreign-key',(f:any)=>f.bill.amount++,(f:any)=>f.obligations.find((o:any)=>o.chargeBillId===f.bill.id).stageSequence=9]){
  const f=await prepared();mutate(f);await assert.rejects(f.guard(f.tx,f.bill,'HISTORY'));
 }
 const f=await prepared(),error=new Error('synthetic storage failure');f.tx.serviceObligation.findMany=async()=>{throw error;};await assert.rejects(f.guard(f.tx,f.bill,'HISTORY'),e=>e===error);
});
