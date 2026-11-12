import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publish,confirm} from '../src/order-changes/quotes';
import {prepareFinance} from '../src/order-changes/finance';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
async function prepared(){const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});f.archiveQuote();await prepareFinance(f.tx,f.change,{id:'finance'});return f;}

test('reprice reads real principal from original and already prepared adjustment bills minus every succeeded refund',async()=>{
 const f=await prepared(),o=f.obligations.find((x:any)=>x.sequence===2),bill=f.bills.find((b:any)=>b.id===o.chargeBillId);
 Object.assign(bill,{status:'PAID',paidAmount:10000,payments:[{id:'paid-adjustment',billId:bill.id,customerId:f.order.customerId,status:'SUCCEEDED',amount:10000,refunds:[]}]});
 f.bills[1].payments[0].refunds.push({id:'actual-original-refund',customerId:f.order.customerId,status:'SUCCEEDED',amount:3000});
 const writes=structuredClone(f.writes),result=await readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1);
 assert.deepEqual(result.baseRows.map((r:any)=>r.amount),[10000,10000,10000]);assert.deepEqual(result.rows.map((r:any)=>r.netPaidAmount),[10000,17000,10000]);assert(result.rows[1].sourceBillIds.includes(bill.id));assert(result.rows[1].payments.some((p:any)=>p.id==='paid-adjustment'));
 assert.equal(result.sources[0].quoteId,f.q.id);assert.equal(result.sources[0].archiveVersionId,f.version.id);assert.deepEqual(f.writes,writes);
});

test('historical money source requires complete frozen arrays and every known source bill rather than a matching truncated subset',async()=>{
 const absent=await prepared();absent.q.fundsSnapshot[0].sourceBillIds=null;await assert.rejects(readOfflineSwapFunds(absent.tx,absent.order,absent.change,absent.q.id,absent.q.revision+1),code('SWAP_FINANCE_SOURCE'));
 const truncated=await prepared();truncated.q.fundsSnapshot[0].sourceBillIds=[];truncated.obligations[0].sourceBillIds=[];await assert.rejects(readOfflineSwapFunds(truncated.tx,truncated.order,truncated.change,truncated.q.id,truncated.q.revision+1),code('SWAP_FINANCE_SOURCE'));
});

test('reprice source rejects cyclic or foreign chains, missing prepared paper pin, pending channels and over-refunded principal',async()=>{
 const cyclic=await prepared();cyclic.q.snapshot.previousPreparedQuoteId=cyclic.q.id;await assert.rejects(readOfflineSwapFunds(cyclic.tx,cyclic.order,cyclic.change,cyclic.q.id,cyclic.q.revision+1),code('SWAP_FINANCE_SOURCE'));
 const foreign=await prepared();foreign.q.changeId='other-change';await assert.rejects(readOfflineSwapFunds(foreign.tx,foreign.order,foreign.change,foreign.q.id,foreign.q.revision+1),code('SWAP_FINANCE_SOURCE'));
 const missing=await prepared();missing.q.approvedArchiveVersionId=null;await assert.rejects(readOfflineSwapFunds(missing.tx,missing.order,missing.change,missing.q.id,missing.q.revision+1));
 const pending=await prepared();pending.bills[0].payments[0].status='PENDING';await assert.rejects(readOfflineSwapFunds(pending.tx,pending.order,pending.change,pending.q.id,pending.q.revision+1),code('FUNDS_UNCONFIRMED'));
 const over=await prepared();over.bills[0].payments[0].refunds.push({id:'bad-refund',customerId:over.order.customerId,status:'SUCCEEDED',amount:10001});await assert.rejects(readOfflineSwapFunds(over.tx,over.order,over.change,over.q.id,over.q.revision+1),code('FUNDS_INCONSISTENT'));
});
