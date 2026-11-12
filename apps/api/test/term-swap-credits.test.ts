import {hash} from '../src/common/data';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditView,reserveCredit,releaseCredits,consumeCredit} from '../src/vehicle-changes/credits';
import {grantSwapCredit,guardSwapRefund,settleSwapRefund,guardSwapPayment,expireSwapPurchases} from '../src/swap-purchases/ledger';
import {purchaseView} from '../src/swap-purchases/view';
import {restoreState} from '../src/swap-purchases/restore';
import {termSwapFixture} from './term-swap-fixture';
test('term read creates no grants even at maximum allowance, and zero gifts never grants an annual fallback',async()=>{
 const f=termSwapFixture(2147483647),v:any=await creditView(f.tx,f.order,f.account,f.now);assert.equal(v.policyVersion,'SWAP_TERM_V2');assert.equal(v.term.available,2147483647);assert.equal(v.cycle,undefined);assert.equal(f.writes(),0);
 const zero=termSwapFixture(0);await assert.rejects(zero.serial(tx=>reserveCredit(tx,zero.order,zero.account,'change',zero.now)));assert.equal(zero.credits.length,0);
 const old=termSwapFixture(2,80000,true),legacy:any=await creditView(old.tx,old.order,old.account,old.now);assert.equal(legacy.cycle.sequence,1);assert.equal(legacy.cycle.freeAvailable,1);assert.equal('term'in legacy,false);
});
test('one lazy gift is reserved, released and reused; only completed delivery consumes it once and years do not reset it',async()=>{
 const f=termSwapFixture(1),reserve=()=>f.serial(tx=>reserveCredit(tx,f.order,f.account,'change',f.now));const first=await reserve();assert.equal(f.credits.length,1);assert.equal(f.credits[0].termSequence,1);assert.equal(f.credits[0].cycleSequence,null);assert.deepEqual(f.credits[0].policySnapshot,f.policy);assert.equal((await reserve()).id,first.id);
 await f.serial(tx=>releaseCredits(tx,'change'));await reserve();assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);
 const complete=()=>f.serial(tx=>consumeCredit(tx,f.order,f.account,'change',f.now));assert.deepEqual(await complete(),await complete());assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);
 const nextYear=new Date('2027-02-01T00:00:00+08:00'),view:any=await creditView(f.tx,f.order,f.account,nextYear);assert.equal(view.term.consumed,1);assert.equal(view.term.available,0);await assert.rejects(f.serial(tx=>reserveCredit(tx,f.order,f.account,'second',nextYear)));assert.equal(f.credits.length,1);
});
test('last gift has one winner and a forged stored source cannot be displayed or spent',async()=>{
 const f=termSwapFixture(1),outcomes=await Promise.allSettled(['a','b'].map(id=>f.serial(tx=>reserveCredit(tx,f.order,f.account,id,f.now))));assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.reservations.filter(r=>r.status==='RESERVED').length,1);
 f.credits[0].policySnapshot={...f.policy,sourceHash:'b'.repeat(64)};await assert.rejects(creditView(f.tx,f.order,f.account,f.now));await assert.rejects(f.serial(tx=>consumeCredit(tx,f.order,f.account,'a',f.now)));
});
test('nonlegacy paid amount grants once, displays exact frozen price, and full exception refund retires only that source',async()=>{
 const f=termSwapFixture(0),{p,bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);assert.equal(f.credits.length,1);assert.deepEqual(f.credits[0].policySnapshot,f.policy);
 const view=await purchaseView(f.tx,p,f.now);assert.equal(view.amount,50000);await assert.rejects(guardSwapRefund(f.tx,payment,80000));await assert.rejects(guardSwapRefund(f.tx,payment,25000));await guardSwapRefund(f.tx,payment,50000);assert.equal(p.status,'REFUND_PENDING');
 await settleSwapRefund(f.tx,{id:'refund',paymentId:payment.id,customerId:'customer',amount:50000,payment:{...payment,bill}});assert.equal(p.status,'REFUNDED');assert.equal(f.credits[0].status,'REFUNDED');
});
test('nonlegacy refund restoration still requires a rejected never-approved refund and no reservation',async()=>{
 const f=termSwapFixture(0),{p,bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);await guardSwapRefund(f.tx,payment,50000);payment.refunds=[{id:'rejected',status:'REJECTED',approvedBy:null,providerRefundId:null}];assert.equal((await restoreState(f.tx,p,f.now)).allowed,true);payment.refunds[0].approvedBy='someone';assert.equal((await restoreState(f.tx,p,f.now)).allowed,false);
});
test('OFFLINE new payments stay blocked while trusted old receipts still record frozen-price credits',async()=>{
 const f=termSwapFixture(0),{p,bill,payment}=f.purchase();f.order.contractMode='OFFLINE';bill.status='PENDING';bill.paidAmount=0;await assert.rejects(guardSwapPayment(f.tx,bill,f.now));await grantSwapCredit(f.tx,bill,payment.id,f.now,true);assert.equal(p.status,'PAYMENT_REVIEW');assert.equal(f.credits[0].status,'FROZEN');
});
test('refund rejects a credit rebound to another payment even on the same order',async()=>{
 const f=termSwapFixture(0),{bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);f.credits[0].sourcePaymentId='other-payment';await assert.rejects(guardSwapRefund(f.tx,payment,50000));assert.equal(f.credits[0].status,'ACTIVE');
});

test('purchase v2 safe terms retain both frozen template and rendered evidence, v1 stays unchanged',async()=>{
 for(const v1 of [false,true]){
  const f=termSwapFixture(0,50000,v1),{p}=f.purchase();const templateContent='单次 {{extraFeeYuan}} 元',content='单次 500.00 元';
  Object.assign(p.termsSnapshot,{documentId:'document',documentVersion:2,hash:hash(content),content,...(v1?{}:{templateContent,templateHash:hash(templateContent)})});
  const result=await purchaseView(f.tx,p,f.now);assert.equal(result.terms.templateContent,v1?undefined:templateContent);assert.equal(result.terms.templateHash,v1?undefined:hash(templateContent));assert.equal(result.terms.content,v1?undefined:content);
 }
});
test('v1 annual gifts still renew, while old OFFLINE orders do not acquire phantom gifts',async()=>{
 const f=termSwapFixture(0,80000,true);await consumeCredit(f.tx,f.order,f.account,'first',f.now);await consumeCredit(f.tx,f.order,f.account,'second',new Date('2027-02-01T00:00:00+08:00'));
 assert.deepEqual(f.credits.map(c=>c.cycleSequence),[1,2]);assert.ok(f.credits.every(c=>c.policySnapshot===null&&c.termSequence===null));
 const old=termSwapFixture(0,80000,true);old.order.contractMode='OFFLINE';await assert.rejects(reserveCredit(old.tx,old.order,old.account,'blocked',old.now));assert.equal(old.credits.length,0);
});
test('expiration touches only materialized term gifts, releases reservations, and is idempotent',async()=>{
 const f=termSwapFixture(2147483647);await reserveCredit(f.tx,f.order,f.account,'unused',f.now);f.account.returnedOn=new Date('2026-02-02');
 await expireSwapPurchases(f.tx,f.order.id,f.now,true);const writes=f.writes();await expireSwapPurchases(f.tx,f.order.id,f.now,true);assert.equal(f.writes(),writes);assert.equal(f.credits.length,1);assert.equal(f.credits[0].status,'EXPIRED');assert.equal(f.reservations[0].status,'RELEASED');
 const result:any=await creditView(f.tx,f.order,f.account,f.now);assert.equal(result.term.available,0);assert.equal(result.term.remaining,2147483647);assert.equal(result.term.reserved,0);
});
test('one cent and maximum database integer prices stay exact through grant and full refund; v1 remains 80000',async()=>{
 for(const [amount,v1] of [[1,false],[2147483647,false],[80000,true]] as const){const f=termSwapFixture(0,amount,v1),{p,bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);await grantSwapCredit(f.tx,bill,payment.id,f.now);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal((await purchaseView(f.tx,p,f.now)).amount,amount);await guardSwapRefund(f.tx,payment,amount);await settleSwapRefund(f.tx,{id:'refund',paymentId:payment.id,customerId:'customer',amount,payment:{...payment,bill}});assert.equal(p.status,'REFUNDED');}
});
test('reserved and consumed paid credits reject refunds, while a duplicate receipt refund preserves the original credit',async()=>{
 const f=termSwapFixture(0),{p,bill,payment}=f.purchase();await grantSwapCredit(f.tx,bill,payment.id,f.now);await reserveCredit(f.tx,f.order,f.account,'change',f.now);await assert.rejects(guardSwapRefund(f.tx,payment,50000));await releaseCredits(f.tx,'change');await consumeCredit(f.tx,f.order,f.account,'change',f.now);await assert.rejects(guardSwapRefund(f.tx,payment,50000));
 const extra={...payment,id:'extra',providerTransactionId:'extra-transaction',reconciliationRequired:true};f.payments.push(extra);await guardSwapRefund(f.tx,extra,50000);await settleSwapRefund(f.tx,{id:'extra-refund',paymentId:extra.id,customerId:'customer',amount:50000,payment:{...extra,bill}});assert.equal(p.status,'CONSUMED');assert.equal(f.credits[0].status,'ACTIVE');assert.equal(f.credits[0].consumedChangeId,'change');assert.equal(f.credits.length,1);
});

test('credit locks and identical reserve/consume replays do not mutate business revisions',async()=>{
 const f=termSwapFixture(1),before=[f.order.revision,f.account.revision];await reserveCredit(f.tx,f.order,f.account,'same',f.now);const firstWrites=f.writes();await reserveCredit(f.tx,f.order,f.account,'same',f.now);assert.equal(f.writes(),firstWrites);assert.deepEqual([f.order.revision,f.account.revision],before);
 await consumeCredit(f.tx,f.order,f.account,'same',f.now);const consumedWrites=f.writes();await consumeCredit(f.tx,f.order,f.account,'same',f.now);assert.equal(f.writes(),consumedWrites);assert.deepEqual([f.order.revision,f.account.revision],before);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,1);
});
