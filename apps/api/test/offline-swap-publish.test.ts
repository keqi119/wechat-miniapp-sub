import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publish,confirm} from '../src/order-changes/quotes';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
import {canonicalHash} from '../src/customers/types';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;

test('OFFLINE swap publishes only approved paper text with frozen target, actual-day price, original TERM and usage facts',async()=>{
 const f=await offlineSwapLifecycleFixture(),frozen=canonicalHash(f.initial);await publish(f.tx,f.change);
 const q=f.q,contract=f.contracts.find(c=>c.delayQuoteId===q.id)!;assert.equal(q.status,'PUBLISHED');assert.equal(f.change.status,'AWAITING_CONFIRMATION');assert.equal(contract.executionMode,'OFFLINE');assert.equal(contract.status,'DRAFT');assert.equal(contract.providerTaskId,undefined);assert.equal(contract.signedFileId,undefined);
 assert.equal(q.snapshot.offlineSource.policy,'OFFLINE_SWAP_V2');assert.equal(q.snapshot.document.type,'OFFLINE_ORDER_AMENDMENT');assert.equal(q.snapshot.document.content,contract.body);assert.equal(contract.documentHash,q.commercialHash);
 for(const value of ['target-listing','明确升级产品','原出租方','100.00','200.00','2026-12-31','合同期赠送2次','500.00','充换电费用由客户自付','保险','原服务月','30天','原用量政策'])assert(contract.body.includes(value),value);
 assert.equal(canonicalHash(f.initial),frozen);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);assert.equal(f.obligations.length,0);assert.equal(f.refunds.length,0);
});

test('OFFLINE swap refuses an approved old template missing the versioned swap facts group without creating a contract',async()=>{
 const f=await offlineSwapLifecycleFixture();f.legal.content='旧模板 {{periodSchedule}} {{financialSchedule}}';const before=f.contracts.length;
 await assert.rejects(publish(f.tx,f.change),code('LEGAL_PLACEHOLDERS'));assert.equal(f.contracts.length,before);assert.equal(f.q.status,'REVIEWED');
});

test('the printed original contract number is the real archived paper number rather than its internal contract ID',async()=>{
 const f=await offlineSwapLifecycleFixture();f.rental.versions[0].contractNumber='REAL-PAPER-2026-0123';f.legal.content+=' 原纸质合同编号 {{originalContractNo}}';await publish(f.tx,f.change);assert(f.q.snapshot.document.content.includes('原纸质合同编号 REAL-PAPER-2026-0123'));assert.equal(f.q.snapshot.offlineSource.originalContractId,f.change.originalContractId);
});

test('the shared changeFacts template carries the complete swap facts and still requires both price schedules',async()=>{
 const f=await offlineSwapLifecycleFixture();f.legal.content=f.legal.content.replace('{{swapFacts}}','{{changeFacts}}');await publish(f.tx,f.change);const body=f.q.snapshot.document.content;
 for(const fact of ['target-listing','原合同期赠送2次','500.00','保险及责任','充换电费用由客户自付','原路应退'])assert(body.includes(fact),fact);assert(!body.includes('{{'));
 for(const missing of ['periodSchedule','financialSchedule']){const bad=await offlineSwapLifecycleFixture();bad.legal.content='{{changeFacts}} {{periodSchedule}} {{financialSchedule}}'.replace('{{'+missing+'}}','');await assert.rejects(publish(bad.tx,bad.change),code('LEGAL_PLACEHOLDERS'));}
 const unknown=await offlineSwapLifecycleFixture();unknown.legal.content+=' {{unverifiedExtraFee}}';await assert.rejects(publish(unknown.tx,unknown.change),code('LEGAL_PLACEHOLDERS'));
});

test('customer accepts exact frozen paper quote with current consents and waits for archive without supplier calls',async()=>{
 const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);let consentReads=0;f.tx.customerConsent.count=async()=>{consentReads++;return 1;};
 await assert.rejects(confirm(f.tx,f.change,{commercialHash:'f'.repeat(64)}),code('QUOTE_MISMATCH'));
 await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});assert(consentReads>=2);assert.equal(f.change.status,'AWAITING_ARCHIVE');assert.equal(f.q.status,'CONFIRMED');assert(f.q.confirmedAt);assert.equal(f.contracts.find(c=>c.delayQuoteId===f.q.id)!.status,'DRAFT');
});
