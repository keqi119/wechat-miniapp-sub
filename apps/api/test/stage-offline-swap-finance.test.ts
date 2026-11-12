import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmedStageSwapFixture} from './stage-offline-swap-fixture';
import {prepareFinance,financeView} from '../src/order-changes/finance';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';

test('preparing staged swap releases only this stage allocations and creates only globally numbered stage obligations/bills',async()=>{
 const f=await confirmedStageSwapFixture(),oldAllocation=f.allocations.find(a=>a.obligationId===f.oldObligation.id)!,before=structuredClone({old:f.oldObligation,allocation:oldAllocation,periods:f.periods,initial:f.initial,stage:f.stage.snapshot});
 await prepareFinance(f.tx,f.change,{id:'finance'});
 assert.deepEqual(oldAllocation,before.allocation);assert.deepEqual(f.oldObligation,before.old);
 const obligations=f.obligations.filter(o=>o.quoteId===f.q.id);assert.equal(obligations.length,12);assert(obligations.every(o=>o.serviceStageId===f.stage.id&&o.stageSequence===o.sequence-12&&!o.active));assert.deepEqual(obligations.map(o=>o.sequence),Array.from({length:12},(_,i)=>i+13));
 const bills=f.bills.filter(b=>b.type==='SWAP_ADJUSTMENT');assert.equal(bills.length,12);assert(bills.every(b=>b.serviceStageId===f.stage.id));assert.equal(bills[0].idempotencyKey,`delay-${f.q.id}-13`);assert.deepEqual(f.initial,before.initial);assert.deepEqual(f.periods,before.periods);assert.deepEqual(f.stage.snapshot,before.stage);
 const state=[f.obligations.length,f.bills.length,f.refunds.length];await prepareFinance(f.tx,f.change,{id:'finance'});assert.deepEqual([f.obligations.length,f.bills.length,f.refunds.length],state);
 const funds=await readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1);assert.equal(funds.rows[0].sequence,13);assert.equal(funds.rows[0].stageSequence,1);assert.equal(funds.rows[0].netPaidAmount,20000);assert((await financeView(f.tx,f.change)).blockers.some(x=>x.includes('应收')));
});
