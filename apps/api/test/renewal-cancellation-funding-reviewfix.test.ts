import test from 'node:test';
import assert from 'node:assert/strict';
import {readRenewalCancellationFacts} from '../src/order-renewals/cancellation-facts';
import {cancellationFactsFixture,renewalNow} from './renewal-cancellation-facts-fixture';

const read=(f:Awaited<ReturnType<typeof cancellationFactsFixture>>)=>readRenewalCancellationFacts(f.tx,{changeId:f.change.id},renewalNow);
test('PAID counter without successful receipt cannot prove zero funds, including only closed or failed attempts',async()=>{
 for(const status of [null,'CLOSED','FAILED']){const f=await cancellationFactsFixture(true),b=f.newBills[0];Object.assign(b,{status:'PAID',paidAmount:b.amount});if(status)b.payments.push({id:'attempt',billId:b.id,customerId:f.customer.id,revision:1,status,amount:b.amount,reconciliationRequired:false,providerTransactionId:null,succeededAt:null,refunds:[]});const v=await read(f);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.includes('BILL_RECEIPT_COUNTER_CONFLICT'));}
});
test('a full refund of an insufficient succeeded receipt does not explain the larger recorded bill counter',async()=>{
 const f=await cancellationFactsFixture(true),b=f.newBills[0],p=f.pay();p.amount=b.amount-1;f.allocations.find(a=>a.paymentId===p.id)!.amount=p.amount;f.refund(p);const v=await read(f);assert.equal(v.funding.remainingRefundAmount,0);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.includes('BILL_RECEIPT_COUNTER_CONFLICT'));
});
test('PAID must match its positive bill amount even when the counter is zero',async()=>{
 for(const amount of [0,1]){const f=await cancellationFactsFixture(true),b=f.newBills[0];Object.assign(b,{status:'PAID',paidAmount:amount});const v=await read(f);assert.equal(v.funding.fundsClear,false);assert.ok(v.funding.blockers.includes('BILL_PAID_STATE_CONFLICT'));}
});
test('late real receipt may exceed pending or void bill counter and stays refundable; gross receipts survive full refunds',async()=>{
 for(const status of ['PENDING','VOID']){const f=await cancellationFactsFixture(true),b=f.newBills[0],p=f.pay();Object.assign(b,{status,paidAmount:0});let v=await read(f);assert.equal(v.funding.remainingRefundAmount,p.amount);assert.ok(!v.funding.blockers.includes('BILL_RECEIPT_COUNTER_CONFLICT'));assert.ok(v.funding.payments[0].blockers.length===0);f.refund(p);v=await read(f);assert.equal(v.funding.fundsClear,true);}
 const f=await cancellationFactsFixture(true),p=f.pay();f.refund(p);const v=await read(f);assert.equal(v.funding.fundsClear,true);assert.equal(v.funding.receivedAmount,p.amount);assert.equal(v.funding.refundedAmount,p.amount);
});
