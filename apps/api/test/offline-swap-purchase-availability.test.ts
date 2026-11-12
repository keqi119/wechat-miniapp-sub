import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOfflineSwapPurchases} from '../src/vehicle-changes/offline-account';
import {guardSwapPayment,grantSwapCredit,guardSwapRefund} from '../src/swap-purchases/ledger';
import {reserveCredit,releaseCredits,consumeCredit} from '../src/vehicle-changes/credits';
import {freezeSwapPricing} from '../src/swap-purchases/policy';
import {swapPurchaseEnabled} from '../src/swap-purchases/availability';
import {offlineSwapPurchaseFixture,withSwapPurchaseFlags} from './offline-swap-purchases-fixture';
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;

test('MVP OFFLINE purchase projection exposes a real zero-free-term order only after paper, qualification and delivery facts, without writes',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),before=f.writesCount(),view=await readOfflineSwapPurchases(f.tx,f.order,f.account,f.now);
 assert.equal(view.product.amount,50000);assert.equal(view.canPurchase,true);assert.deepEqual(view.purchaseBlockers,[]);assert.equal(f.writesCount(),before);assert.equal(f.store.credits.length,0);
}));
test('actual OFFLINE purchase command accepts exact separate v2 consent under MVP and creates only the frozen payable bill',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),result=await f.api.purchase(f.order.id,f.input,f.request);
 assert.equal(result.bill.amount,50000);assert.equal(result.bill.status,'PENDING');assert.equal(result.purchase.status,'PENDING_PAYMENT');assert.equal(result.purchase.canPay,true);assert.equal(f.store.credits.length,0);
 assert.deepEqual(f.store.purchases[0].pricingSnapshot,freezeSwapPricing(f.order));assert.equal(f.store.purchases[0].expiresAt.toISOString(),'2026-12-31T16:00:00.000Z');
 const before=f.writesCount();assert.equal((await f.api.purchase(f.order.id,f.input,f.request)).purchase.id,result.purchase.id);assert.equal(f.writesCount(),before);
}));
test('existing OFFLINE bill payment guard admits the same real current source without enabling global legacy MVP purchases',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture();f.store.bills.push({id:'bill',orderId:f.order.id,customerId:f.order.customerId,type:'SWAP_CREDIT',amount:50000,paidAmount:0,status:'PENDING'});
 f.store.purchases.push({id:'purchase',orderId:f.order.id,customerId:f.order.customerId,billId:'bill',quantity:1,amount:50000,currency:'CNY',status:'PENDING_PAYMENT',pricingSnapshot:freezeSwapPricing(f.order),expiresAt:new Date('2027-01-01T00:00:00+08:00')});
 await guardSwapPayment(f.tx,f.store.bills[0],f.now);assert.equal(f.store.credits.length,0);
}));
test('OFFLINE mode and an enabled flag cannot replace missing original paper, current qualification or owned actual delivery',()=>withSwapPurchaseFlags('true','true',async()=>{
 for(const damage of [(f:any)=>{f.rental.versions[0].status='INVALIDATED';},(f:any)=>{f.qualification.status='REJECTED';},(f:any)=>{f.assignment.customerId='foreign';}]){
  const f=await offlineSwapPurchaseFixture();damage(f);const before=f.writesCount(),view=await readOfflineSwapPurchases(f.tx,f.order,f.account,f.now);assert.equal(view.canPurchase,false);assert(view.purchaseBlockers.some((v:string)=>/AGREEMENT|QUALIFICATION|ASSIGNMENT/.test(v)));
  await assert.rejects(f.api.purchase(f.order.id,f.input,f.request));assert.equal(f.writesCount(),before);assert.equal(f.store.bills.length,0);
 }
}));
test('rollout admits only a stored OFFLINE mode under MVP; legacy ESIGN and missing modes keep the old MVP boundary',()=>{
 for(const flag of [undefined,'false','true'])for(const mvp of [undefined,'false','true']){
  const env={SWAP_CREDIT_PURCHASE_ENABLED:flag,MVP_V2_ENABLED:mvp};
  assert.equal(swapPurchaseEnabled({contractMode:'OFFLINE'},env),flag==='true');
  for(const mode of [undefined,null,'ESIGN'])assert.equal(swapPurchaseEnabled({contractMode:mode},env),flag==='true'&&mvp!=='true');
  for(const row of [null,undefined,{contractMode:'UNKNOWN'},{contractMode:'offline'}])assert.equal(swapPurchaseEnabled(row as any,env),false);
 }
});
test('first purchase and payment reject bad paper or qualification, while a successful original key remains read-only and requires the current session',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),first=await f.api.purchase(f.order.id,f.input,f.request);f.qualification.status='REJECTED';
 const before=f.writesCount(),replay=await f.api.purchase(f.order.id,f.input,f.request);assert.equal(replay.purchase.id,first.purchase.id);assert.equal(replay.purchase.canPay,false);assert.equal(f.writesCount(),before);
 await assert.rejects(f.api.purchase(f.order.id,{...f.input,idempotencyKey:'new-key-after-rejection'},f.request),code('CUSTOMER_QUALIFICATION_REQUIRED'));
 await assert.rejects(guardSwapPayment(f.tx,f.store.bills[0],f.now),code('CUSTOMER_QUALIFICATION_REQUIRED'));assert.equal(f.store.credits.length,0);
 f.tx.customerSession.findUnique=async()=>null;await assert.rejects(f.api.purchase(f.order.id,f.input,f.request),code('SESSION_EXPIRED'));
}));
test('ownership, exact terms and frozen cents cannot be supplied or changed by a new purchase request',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture();await assert.rejects(f.api.purchase(f.order.id,{...f.input,amount:1},f.request));
 await assert.rejects(f.api.purchase(f.order.id,{...f.input,pricingHash:'f'.repeat(64)},f.request),code('SWAP_PURCHASE_PRICE'));
 await assert.rejects(f.api.purchase(f.order.id,{...f.input,termsHash:'f'.repeat(64)},f.request),code('SWAP_PURCHASE_CONSENT'));
 f.tx.customerSession.findUnique=async()=>({...f.session,customerId:'foreign'});await assert.rejects(f.api.purchase(f.order.id,f.input,{customer:{id:'foreign'},session:f.session}),code('NOT_FOUND'));assert.equal(f.store.bills.length,0);assert.equal(f.store.credits.length,0);
}));
test('disabled rollout does not discard a trustworthy original receipt or rewrite its frozen expiry after qualification changes',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),first=await f.api.purchase(f.order.id,f.input,f.request),purchase=f.store.purchases[0],expiry=purchase.expiresAt.getTime();
 process.env.SWAP_CREDIT_PURCHASE_ENABLED='false';f.qualification.status='REJECTED';
 const bill=f.store.bills[0];bill.paidAmount=50000;bill.status='PAID';f.store.payments.push({id:'trusted-payment',billId:bill.id,customerId:f.order.customerId,amount:50000,status:'SUCCEEDED',providerTransactionId:'synthetic-reference',refunds:[]});
 await grantSwapCredit(f.tx,bill,'trusted-payment',f.now);await grantSwapCredit(f.tx,bill,'trusted-payment',f.now);
 assert.equal(f.store.credits.length,1);assert.equal(f.store.ledger.filter(r=>r.type==='GRANT').length,1);assert.equal(purchase.expiresAt.getTime(),expiry);assert.equal(purchase.amount,50000);
 const view=await readOfflineSwapPurchases(f.tx,f.order,f.account,f.now);assert.equal(view.canPurchase,false);assert.equal(view.purchases[0].id,first.purchase.id);assert.equal(view.purchases[0].amount,50000);assert.equal(view.purchases[0].status,'ACTIVE');
}));
test('unknown source failures propagate instead of being described as a safe unavailable account',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture(),failure=new Error('synthetic storage failure');f.tx.applicationRiskReview.findUnique=async()=>{throw failure;};
 await assert.rejects(readOfflineSwapPurchases(f.tx,f.order,f.account,f.now),e=>e===failure);await assert.rejects(f.api.purchase(f.order.id,f.input,f.request),e=>e===failure);assert.equal(f.store.bills.length,0);
}));

test('OFFLINE availability does not weaken frozen full-refund, real reservation or consumption rules',()=>withSwapPurchaseFlags('true','true',async()=>{
 const f=await offlineSwapPurchaseFixture();await f.api.purchase(f.order.id,f.input,f.request);const bill=f.store.bills[0];Object.assign(bill,{paidAmount:50000,status:'PAID'});
 const payment={id:'refund-original-payment',billId:bill.id,customerId:f.order.customerId,amount:50000,status:'SUCCEEDED',providerTransactionId:'synthetic-refund-source',refunds:[]};f.store.payments.push(payment);
 await grantSwapCredit(f.tx,bill,payment.id,f.now);
 await assert.rejects(guardSwapRefund(f.tx,payment,25000),code('SWAP_REFUND_REVIEW'));
 await reserveCredit(f.tx,f.order,f.account,'synthetic-change',f.now);await assert.rejects(guardSwapRefund(f.tx,payment,50000),code('SWAP_REFUND_REVIEW'));
 await releaseCredits(f.tx,'synthetic-change');await consumeCredit(f.tx,f.order,f.account,'synthetic-consumed-change',f.now);await assert.rejects(guardSwapRefund(f.tx,payment,50000),code('SWAP_REFUND_REVIEW'));
 assert.equal(f.store.purchases[0].amount,50000);assert.equal(f.store.purchases[0].status,'CONSUMED');assert.equal(f.store.credits.length,1);assert.equal(f.store.credits[0].consumedChangeId,'synthetic-consumed-change');
}));
