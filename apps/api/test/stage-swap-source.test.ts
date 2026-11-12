import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageSwapSourceFixture} from './stage-swap-source-fixture';
const code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;
async function module(){const api:any=await import('../src/order-service-stages/swap-source').catch(()=>({}));assert.equal(typeof api.readSwapSourceAt,'function');assert.equal(typeof api.readHistoricalSwapSource,'function');assert.equal(typeof api.requireNoConfirmedFutureSwap,'function');return api;}

test('INITIAL null source keeps its original policy and expiry even after another real stage activates',async()=>{
 const m=await module(),f=await stageSwapSourceFixture(),before=JSON.stringify(f.order.finalPlanSnapshot);
 const original=await m.readHistoricalSwapSource(f.tx,f.order,f.account,null);assert.equal(original.kind,'INITIAL');assert.equal(original.serviceStageId,null);assert.equal(original.stageSourceHash,null);assert.equal(original.policy,null);assert.equal(original.endAt.toISOString(),'2027-01-30T16:00:00.000Z');
 const current=await m.readSwapSourceAt(f.tx,f.order,f.account,new Date('2027-01-30T16:00:00Z'));assert.equal(current.serviceStageId,'stage-2');assert.equal(current.stageSourceHash,f.stages[1].snapshotHash);assert.equal(current.policy.extraFeeAmount,34567);assert.equal(current.policy.includedCount,0);assert.equal(JSON.stringify(f.order.finalPlanSnapshot),before);assert.equal(f.writes,0);
});

test('only ACTIVE source at its actual Shanghai dates can authorize new stage rights; historical ENDED remains readable',async()=>{
 const m=await module();for(const status of ['PREPARED','SCHEDULED','ENDED']){const f=await stageSwapSourceFixture();f.stages[1]=f.row(f.snap,status);
  await assert.rejects(m.readSwapSourceAt(f.tx,f.order,f.account,new Date('2027-02-01T00:00:00+08:00')),code('SWAP_STAGE_ACTIVATION_REQUIRED'));
  if(status==='ENDED')assert.equal((await m.readHistoricalSwapSource(f.tx,f.order,f.account,'stage-2')).policy.extraFeeAmount,34567);
 }
});

test('stage mismatch or malformed source cannot fall back to initial policy',async()=>{
 const m=await module(),f=await stageSwapSourceFixture();f.stages[1].snapshotHash='f'.repeat(64);
 await assert.rejects(m.readHistoricalSwapSource(f.tx,f.order,f.account,'stage-2'),code('SERVICE_STAGE_SOURCE'));
 await assert.rejects(m.readHistoricalSwapSource(f.tx,f.order,f.account,'unknown'),code('SERVICE_STAGE_SOURCE'));
});

test('customer-confirmed renewal blocks new swaps before any stage row or archive exists, while unconfirmed draft does not',async()=>{
 const m=await module(),f=await stageSwapSourceFixture();f.stages.length=0;const c={id:'future',orderId:f.order.id,customerId:f.order.customerId,kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_ARCHIVE',activeQuoteId:'q'},q={id:'q',changeId:c.id,status:'CONFIRMED',confirmedAt:new Date()};
 f.tx.orderChange.findMany=async()=>[c];f.tx.delayQuote.findUnique=async()=>q;
 await assert.rejects(m.requireNoConfirmedFutureSwap(f.tx,f.order),code('SWAP_FUTURE_STAGE_CONFIRMED'));
 c.status='AWAITING_CONFIRMATION';q.status='PUBLISHED';(q as any).confirmedAt=null;await m.requireNoConfirmedFutureSwap(f.tx,f.order);assert.equal(f.writes,0);
});

test('PREPARED and SCHEDULED stages block new swaps without granting any gift, and foreign confirmed sources fail closed',async()=>{
 const m=await module();for(const status of ['PREPARED','SCHEDULED']){const f=await stageSwapSourceFixture();f.stages[1]=f.row(f.snap,status);await assert.rejects(m.requireNoConfirmedFutureSwap(f.tx,f.order),code('SWAP_FUTURE_STAGE_CONFIRMED'));assert.equal(f.writes,0);}
 const f=await stageSwapSourceFixture();f.stages.length=0;f.tx.orderChange.findMany=async()=>[{id:'foreign',orderId:'another',customerId:f.order.customerId,kind:'SUBSCRIPTION_EXTENSION',status:'AWAITING_ARCHIVE',activeQuoteId:'q'}];await assert.rejects(m.requireNoConfirmedFutureSwap(f.tx,f.order),code('SWAP_STAGE_SOURCE'));
});
