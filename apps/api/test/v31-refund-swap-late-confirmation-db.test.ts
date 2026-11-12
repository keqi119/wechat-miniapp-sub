import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {RefundObligationsService} from '../src/billing/refund-obligations';

test('I1 new real03 receipt before first materialization retains first confirmed A clock and separately confirms B',ctx=>runSwapCommandJourney(ctx,'gap',{
 configureSources:async()=>{},stopAfterBeforeFinance:true,preserveFailedOriginalRequest:true,run:async()=>{},
 beforeFinance:async(ctx,db,f)=>{
  const api=new RefundObligationsService(db),orderId=f.sub.order.id,first:any=await api.read(orderId,f.f.actor),a=first.candidates.find((c:any)=>c.sourceKind==='SWAP03');
  assert.ok(a);assert.equal(await db.refundObligation.count({where:{orderId}}),0);
  const t1=f.confirmedAmount.createdAt.toISOString(),b=f.lateFailedPayment;
  assert.equal(b.status,'FAILED');assert.equal(b.billId,a.billId);assert.ok(b.requestSnapshot);
  assert.ok(f.confirmedAmount.fundsSnapshot);await assert.rejects(db.swapFactAmountResponse.update({where:{id:f.confirmedAmount.id},data:{fundsSnapshot:{tampered:true}}}));
  // This request was created and failed by BillingService before original A paid.
  ctx.mock.timers.setTime(Date.now()+60000);
  const received=await f.billing.settle(b.id,{status:'SUCCEEDED',amount:b.amount,transactionId:'SYN-I1-LATE-'+randomUUID(),succeededAt:new Date().toISOString()});assert.equal(received.status,'SUCCEEDED');assert.equal(received.reconciliationRequired,true);
  const late:any=await api.read(orderId,f.f.actor),kept=late.candidates.find((c:any)=>c.paymentId===a.paymentId);
  assert.ok(kept,'A original confirmation must remain a candidate before any internal finance or materialization');assert.equal(kept.amount,a.amount);assert.equal(kept.confirmation.confirmedAt,t1);assert.equal(late.candidates.some((c:any)=>c.paymentId===b.id),false);assert.ok(late.dependencies.some((d:any)=>d.code==='SWAP_AMOUNT_CONFIRMATION_REQUIRED'||d.code==='PAYMENT_RECONCILIATION_REQUIRED'));
  const once:any=await api.materialize(orderId,{sourceHash:late.sourceHash,idempotencyKey:randomUUID()},f.reviewer),original=once.items.find((o:any)=>o.paymentId===a.paymentId);assert.equal(original.amountConfirmedAt,t1);
  const statement=late.amountStatements.find((s:any)=>s.paymentId===b.id);assert.ok(statement,'new actual cash needs its own precise amount consent');
  const confirmedB=await api.confirm(orderId,{sourceHash:statement.amountStatementHash,accepted:true,idempotencyKey:randomUUID()},f.sub.customer.id);
  const ready:any=await api.read(orderId,f.f.actor),out:any=await api.materialize(orderId,{sourceHash:ready.sourceHash,idempotencyKey:randomUUID()},f.reviewer);
  assert.equal(out.items.filter((o:any)=>o.paymentId===a.paymentId).length,1);assert.equal(out.items.find((o:any)=>o.id===original.id).amountConfirmedAt,t1);assert.equal(out.items.find((o:any)=>o.id===original.id).amount,original.amount);
  const newDebt=out.items.find((o:any)=>o.paymentId===b.id);assert.ok(newDebt);assert.equal(newDebt.amount,b.amount);assert.equal(newDebt.amountConfirmedAt,confirmedB.confirmedAt.toISOString());assert.notEqual(newDebt.amountConfirmedAt,t1);
  assert.equal(out.items.reduce((n:number,o:any)=>n+o.amount,0),first.candidates.reduce((n:number,c:any)=>n+c.amount,0)+b.amount);
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:b.id}})).reconciliationRequired,true);
  assert.equal(await db.swapFactFinance.count({where:{settlementId:f.settlement.id}}),0);
 }
}));
