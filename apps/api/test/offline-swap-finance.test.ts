import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publish,confirm} from '../src/order-changes/quotes';
import {prepareFinance} from '../src/order-changes/finance';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
const finance={id:'finance',role:'FINANCE',authVersion:1};

test('OFFLINE swap prepares period money once only after real archived quote evidence and pins that exact version',async()=>{
 const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});
 await assert.rejects(prepareFinance(f.tx,f.change,finance),code('CHANGE_STATE'));assert.equal(f.obligations.length,0);
 f.archiveQuote();await prepareFinance(f.tx,f.change,finance);
 assert.equal(f.q.approvedArchiveVersionId,f.version.id);assert(f.q.financePreparedAt);assert.deepEqual(f.obligations.map((o:any)=>o.amount),[10000,20000,20000]);
 assert.deepEqual(f.bills.filter((b:any)=>b.type==='SWAP_ADJUSTMENT').map((b:any)=>b.amount),[10000,10000]);assert.equal(f.refunds.length,0);assert.equal(f.contracts.find(c=>c.delayQuoteId===f.q.id)!.status,'DRAFT');
 const counts=[f.obligations.length,f.allocations.length,f.bills.length];await prepareFinance(f.tx,f.change,finance);assert.deepEqual([f.obligations.length,f.allocations.length,f.bills.length],counts);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
});

test('OFFLINE swap rejects broken paper evidence and changed net receipts before any obligations or refund creation',async()=>{
 for(const bad of ['archive','money']){const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});f.archiveQuote();
  if(bad==='archive')f.version.invalidatedAt=new Date();else f.bills[0].payments[0].refunds.push({status:'SUCCEEDED',amount:1});
  await assert.rejects(prepareFinance(f.tx,f.change,finance),code(bad==='archive'?'AGREEMENT_ARCHIVE_REQUIRED':'FUNDS_CHANGED'));assert.equal(f.obligations.length,0);assert.equal(f.refunds.length,0);
 }
});
