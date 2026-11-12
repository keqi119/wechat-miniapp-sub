import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalPaperFixture} from './renewal-paper-fixture';
import {customerContractRecord} from '../src/orders/customer-contract-view';
test('customer renewal receipt displays frozen new term dates and fees while keeping paper and activation distinct',async()=>{
 const f=await renewalPaperFixture();f.prepare();const c={...f.contract,delayQuote:{...f.quote,change:f.change},order:f.order};
 const result=await customerContractRecord(f.db as any,f.customer.id,c),d=result.contractDetail;
 assert(d.summaryRows.some(r=>r.label==='变更事项'&&r.value==='原单续期'));assert(d.summaryRows.some(r=>r.label==='变更进度'&&r.value==='待到期生效'));assert(d.summaryRows.some(r=>r.value.includes('2027-10-01')&&r.value.includes('2028-09-30')));assert(d.summaryRows.some(r=>r.label==='续期月费'&&r.value==='¥200.00'));assert.equal(d.canSign,false);assert.equal(d.canQuery,false);assert(!JSON.stringify(result).includes('customerProfileSnapshot'));
});
test('malformed or foreign renewal evidence yields no archive body, private files or frozen party identity',async()=>{
 for(const mutate of [(f:any)=>f.quote.snapshot.source.customerId='foreign',(f:any)=>f.quote.snapshot.renewalTerms=null,(f:any)=>f.quote.snapshot.product=null,(f:any)=>f.contract.customerId='foreign']){const f=await renewalPaperFixture();mutate(f);const result=await customerContractRecord(f.db as any,f.customer.id,{...f.contract,delayQuote:{...f.quote,change:f.change},order:f.order});assert.deepEqual(result.documents,[]);assert.deepEqual(result.contractDetail.summaryRows,[]);assert.equal(result.contractDetail.lessor.name,'未提供');}
});
