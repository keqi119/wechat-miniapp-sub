import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineSwapPhysicalFixture} from './offline-swap-physical-fixture';
import {completeSwapHandover} from '../src/vehicle-changes/handovers';
import {readOfflineSwapFunds} from '../src/vehicle-changes/offline-money';
import {financeView} from '../src/order-changes/finance';
import {offlineChangeScope} from '../src/order-changes/agreement-facts';
async function applied(){const f=await offlineSwapPhysicalFixture();await completeSwapHandover(f.tx,f.addFact('RETURN'),'ops');await completeSwapHandover(f.tx,f.addFact('DELIVERY'),'ops');return f;}
test('applying the swap does not turn its own new obligations into its original money basis or a false financial blocker',async()=>{
 const f=await applied(),funds=await readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1);assert.deepEqual(funds.baseRows.map((r:any)=>r.amount),[10000,10000,10000]);assert.equal((await financeView(f.tx,f.change)).blockers.length,0);
});
test('reading an earlier applied swap after a later effective amendment still uses the earlier real terms prefix and rejects unknown prior sources',async()=>{
 for(const kind of ['VEHICLE_CHANGE','DELIVERY_DELAY']){const f=await applied(),later=f.addChange(true);later.change.kind=kind;later.change.targetVehicleId=kind==='VEHICLE_CHANGE'?'third-car':null;later.quote.financePreparedAt=new Date();later.version.scopeSnapshot=offlineChangeScope(later.change,later.quote,later.contract);
  for(const o of f.obligations)o.active=false;f.obligations.push(...[1,2,3].map(sequence=>({id:'later-'+sequence,orderId:f.order.id,quoteId:later.quote.id,sequence,active:true,amount:90000,startDate:new Date('2026-11-01'),endDate:new Date('2026-12-01'),dueDate:new Date('2026-11-01'),sourceBillIds:[],chargeBillId:null})));
  const funds=await readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1);assert.equal(funds.baseRows[0].startDate,'2026-10-01');assert.deepEqual(funds.baseRows.map((r:any)=>r.amount),[10000,10000,10000]);assert.equal(funds.rows[0].netPaidAmount,10645);
  f.change.priorTermsVersionId='unknown-terms';await assert.rejects(readOfflineSwapFunds(f.tx,f.order,f.change,f.q.id,f.q.revision+1),(e:any)=>e.getResponse?.().error?.code==='SWAP_FINANCE_SOURCE');
 }
});

test('the next swap takes the real prior applied quote obligations, including its adjustment bills, and rejects a borrowed prior quote',async()=>{
 const f=await applied(),next=f.addChange();next.change.kind='VEHICLE_CHANGE';const funds=await readOfflineSwapFunds(f.tx,f.order,next.change,null);
 assert.deepEqual(funds.baseRows.map((r:any)=>r.amount),[10645,20000,20000]);assert.equal(funds.rows[0].netPaidAmount,10645);assert(funds.rows[0].sourceBillIds.some((id:string)=>id.startsWith('new-bill-')));
 f.terms[0].quoteId='foreign-quote';await assert.rejects(readOfflineSwapFunds(f.tx,f.order,next.change,null),(e:any)=>e.getResponse?.().error?.code==='SWAP_FINANCE_SOURCE');
});

test('a prior applied obligation cannot silently replace the frozen amount, month or original bill source',async()=>{
 for(const field of ['amount','sequence','sourceBillIds']){const f=await applied(),next=f.addChange();next.change.kind='VEHICLE_CHANGE';const obligation=f.obligations.find((o:any)=>o.quoteId===f.q.id&&o.sequence===1);obligation[field]=field==='amount'?1:field==='sequence'?99:[];
  await assert.rejects(readOfflineSwapFunds(f.tx,f.order,next.change,null),(e:any)=>e.getResponse?.().error?.code==='SWAP_FINANCE_SOURCE');
 }
});
