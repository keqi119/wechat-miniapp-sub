import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmedStageSwapFixture} from './stage-offline-swap-fixture';
import {createOfflineSwapQuote} from '../src/vehicle-changes/offline-quote';
import {prepareFinance} from '../src/order-changes/finance';
import {publish,confirm} from '../src/order-changes/quotes';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';

test('stage actual-day reprice carries all real prior receipts without using original-term or another-stage cash',async()=>{
 for(const [date,charge,refund] of [['2027-10-01',323,0],['2027-10-03',0,322]] as const){
  const f=await confirmedStageSwapFixture();await prepareFinance(f.tx,f.change,{id:'finance'});const first=f.obligations.find(o=>o.quoteId===f.q.id&&o.sequence===13)!;f.pay(f.bills.find(b=>b.id===first.chargeBillId)!);
  const oldAllocation=structuredClone(f.allocations.find(a=>a.obligationId===f.oldObligation.id));
  await createOfflineSwapQuote(f.tx,f.change,{...f.input,idempotencyKey:'stage-reprice-'+date,plannedReturnAt:date+'T09:00:00+08:00',plannedDeliveryAt:date+'T10:00:00+08:00'},f.ops);
  const next=f.quotes.at(-1)!;assert.equal(next.snapshot.previousPreparedQuoteId,f.q.id);assert.equal(next.snapshot.periods[0].sequence,13);assert.equal(next.snapshot.periods[0].stageSequence,1);assert.equal(next.snapshot.periods[0].netPaidAmount,29677);assert.equal(next.snapshot.periods[0].chargeAmount,charge);assert.equal(next.snapshot.periods[0].refundAmount,refund);assert.equal(next.snapshot.serviceStageScope.stageSourceHash,f.stage.snapshotHash);
  Object.assign(next,{status:'REVIEWED',reviewedBy:'finance',reviewNote:'核对真实日变化'});f.change.status='REVIEWED';await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:next.commercialHash});f.archiveQuote(next);await prepareFinance(f.tx,f.change,{id:'finance'});
  assert.deepEqual(f.allocations.find(a=>a.obligationId===f.oldObligation.id),oldAllocation);assert(f.obligations.filter(o=>o.quoteId===next.id).every(o=>o.serviceStageId===f.stage.id));assert.equal(f.refunds.reduce((n,r)=>n+r.amount,0),refund);
  for(const r of f.refunds){r.status='SUCCEEDED';const p=f.bills.flatMap(b=>b.payments).find(p=>p.id===r.paymentId)!;if(!p.refunds.some((x:any)=>x===r))p.refunds.push(r);}
  const due=f.obligations.find(o=>o.quoteId===next.id&&o.sequence===13)!;if(charge)f.pay(f.bills.find(b=>b.id===due.chargeBillId)!);
  const result=await readOfflineSwapFunds(f.tx,f.order,f.change,next.id,next.revision+1);assert.equal(result.rows[0].netPaidAmount,next.snapshot.periods[0].amount);assert.equal(result.sources.length,2);
  f.q.snapshot.serviceStageScope.stageSourceHash='f'.repeat(64);await assert.rejects(readOfflineSwapFunds(f.tx,f.order,f.change,next.id,next.revision+1),(e:any)=>e.getResponse?.().error?.code==='SWAP_FINANCE_SOURCE');
 }
});
