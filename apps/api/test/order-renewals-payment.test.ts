import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalPaymentFixture} from './order-renewals-payment-fixture';
import {markRenewalHistoricallyActive} from './order-renewals-finance-fixture';
import {readDelayPaymentGuard} from '../src/order-changes/finance';
import {readContractReady} from '../src/offline-documents/readiness';
import {allowedReconciliationResolutions,validateReconciliationResolution} from '../src/billing/reconciliation';
import {readRenewalPaymentGuard} from '../src/order-renewals/payment';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('future renewal permits its first bill only and does not block original bills',async()=>{
 const f=await renewalPaymentFixture();await readDelayPaymentGuard(f.tx,f.first);
 await assert.rejects(readDelayPaymentGuard(f.tx,f.second),code('RENEWAL_FUTURE_BILL'));
 await readDelayPaymentGuard(f.tx,f.bills.find(b=>!b.serviceStageId&&b.sequence===2));
 assert.equal(f.counters.created,0);
});
test('invalid future renewal paper does not invalidate the original period payment gate',async()=>{
 const f=await renewalPaymentFixture();f.invalidate();const gate=await readContractReady(f.tx,f.order.id,'PAYMENT');assert.equal(gate.ready,true);
 await readDelayPaymentGuard(f.tx,f.bills.find(b=>!b.serviceStageId&&b.sequence===2));
 await assert.rejects(readDelayPaymentGuard(f.tx,f.first));
});
test('real Billing.pay enforces frozen bill amounts, source, period and first-period limit before provider calls',async()=>{
 for(const mutate of [(f:any)=>f.first.amount++,(f:any)=>f.first.dueDate=new Date('2027-12-01'),(f:any)=>f.first.customerId='foreign',(f:any)=>f.obligations.find((o:any)=>o.chargeBillId===f.first.id).quoteId='foreign']){
  const f=await renewalPaymentFixture();mutate(f);await assert.rejects(f.billing.pay({id:f.customer.id,openId:'synthetic'},f.first.id,'tampered'));assert.equal(f.counters.created,0);assert.equal(f.counters.gateway,0);
 }
 const f=await renewalPaymentFixture();await assert.rejects(f.billing.pay({id:f.customer.id,openId:'synthetic'},f.second.id,'future-second'),code('RENEWAL_FUTURE_BILL'));assert.equal(f.counters.created,0);
 const result=await f.billing.pay({id:f.customer.id,openId:'synthetic'},f.first.id,'first');assert.equal(result.paymentId,'request-0');assert.equal(f.counters.gateway,1);assert.equal(f.order.effectiveTermsVersionId,null);assert.equal(f.stage.status,'PREPARED');
});
test('trusted arrival allocates only its frozen stage obligation and does not activate the renewal',async()=>{
 const f=await renewalPaymentFixture(),p=f.late();const result=await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-first-receipt'});
 assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationRequired,false);assert.equal(f.counters.allocated,1);const a=f.allocations.find(a=>a.paymentId===p.id)!;assert.equal(a.obligationId,f.obligations.find(o=>o.chargeBillId===f.first.id)!.id);assert.equal(a.amount,f.first.amount);assert.equal(f.stage.status,'PREPARED');assert.equal(f.order.effectiveTermsVersionId,null);
 await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-first-receipt'});assert.equal(f.counters.allocated,1);
});
test('trusted late arrivals after invalid paper or voiding remain money facts without allocation',async()=>{
 for(const mutate of [(f:any)=>f.invalidate(),(f:any)=>Object.assign(f.stage,{status:'VOIDED',voidedAt:new Date(),voidedBy:'finance'})]){
  const f=await renewalPaymentFixture(),p=f.late();mutate(f);const result=await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-late'});
  assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationRequired,true);assert.ok(result.reconciliationReason);assert.equal(f.first.paidAmount,p.amount);assert.equal(f.counters.allocated,0);
 }
});
test('provider request completion rechecks the frozen renewal paper before returning client parameters',async()=>{
 const f=await renewalPaymentFixture();f.providerEffect(f.invalidate);await assert.rejects(f.billing.pay({id:f.customer.id,openId:'synthetic'},f.first.id,'network-race'));
 assert.equal(f.counters.gateway,1);assert.equal(f.pending[0].status,'PENDING');assert.ok(f.pending[0].clientParameters);assert.equal(f.counters.allocated,0);
});
test('active and ended renewal historical bills remain payable after later vehicle replacement',async()=>{
 for(const status of ['ACTIVE','ENDED']){const f=await renewalPaymentFixture(),stage=markRenewalHistoricallyActive(f);if(status==='ENDED')Object.assign(stage,{status,endedAt:new Date('2028-10-01')});await readDelayPaymentGuard(f.tx,f.second);assert.equal(f.assignment.status,'CLOSED');assert.equal(f.order.vehicleId,'target');f.second.amount++;await assert.rejects(readDelayPaymentGuard(f.tx,f.second),code('RENEWAL_PAYMENT_SOURCE'));}
});
test('reconciliation cannot bypass stage allocation and paper checks through generic APPLY_TO_BILL',()=>{
 const bill={type:'SUBSCRIPTION',serviceStageId:'renewal:order:2',status:'PAID',amount:10000,paidAmount:10000},payment={status:'SUCCEEDED',providerTransactionId:'verified',amount:10000,refunds:[]};
 assert.deepEqual(allowedReconciliationResolutions(bill),['REFUNDED']);assert.throws(()=>validateReconciliationResolution(payment,bill,'APPLY_TO_BILL'),code('RECONCILIATION_APPLY_UNSUPPORTED'));
 assert.doesNotThrow(()=>validateReconciliationResolution({...payment,refunds:[{status:'SUCCEEDED',amount:10000}]},bill,'REFUNDED'));
});
test('original bill reaches provider despite future paper invalidation and late non-first renewal receipts reconcile',async()=>{
 const f=await renewalPaymentFixture(),old=f.bills.find(b=>!b.serviceStageId&&b.sequence===2)!;Object.assign(old,{status:'PENDING',paidAmount:0,payments:[]});f.invalidate();assert.equal((await f.billing.pay({id:f.customer.id,openId:'synthetic'},old.id,'old-period')).paymentId,'request-0');
 const g=await renewalPaymentFixture(),p=g.late(g.second),result=await g.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-unauthorized-period'});assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationReason,'RENEWAL_FUTURE_BILL');assert.equal(g.counters.allocated,0);
});
test('replaced obligations cannot receive fresh allocation; earlier paid callback replay preserves its original fact',async()=>{
 const f=await renewalPaymentFixture();markRenewalHistoricallyActive(f);const o=f.obligations.find(o=>o.chargeBillId===f.second.id)!;o.active=false;
 await assert.rejects(readDelayPaymentGuard(f.tx,f.second),code('RENEWAL_OBLIGATION_REPLACED'));const p=f.late(f.second),result=await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-replaced'});assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationReason,'RENEWAL_OBLIGATION_REPLACED');assert.equal(f.counters.allocated,0);
 const g=await renewalPaymentFixture(),paid=g.late();await g.billing.settle(paid.id,{status:'SUCCEEDED',amount:paid.amount,transactionId:'synthetic-original'});markRenewalHistoricallyActive(g);g.obligations.find(o=>o.chargeBillId===g.first.id)!.active=false;await g.billing.settle(paid.id,{status:'SUCCEEDED',amount:paid.amount,transactionId:'synthetic-original'});assert.equal(g.counters.allocated,1);assert.equal(paid.reconciliationRequired,false);
});
test('stage swap bills retain the swap guard; conflicting allocation sends a trusted receipt to reconciliation',async()=>{
 const f=await renewalPaymentFixture();assert.equal(await readRenewalPaymentGuard(f.tx,{...f.first,type:'SWAP_ADJUSTMENT'}),null);
 const p=f.late(),o=f.obligations.find(o=>o.chargeBillId===f.first.id)!;f.allocations.push({id:'foreign-allocation',paymentId:'another-payment',obligationId:o.id,amount:p.amount,releasedAt:null});
 const result=await f.billing.settle(p.id,{status:'SUCCEEDED',amount:p.amount,transactionId:'synthetic-conflicting-allocation'});assert.equal(result.status,'SUCCEEDED');assert.equal(result.reconciliationRequired,true);assert.equal(f.counters.allocated,0);
});
