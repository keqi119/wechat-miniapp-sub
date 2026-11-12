import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publish,confirm} from '../src/order-changes/quotes';
import {prepareFinance,financeView} from '../src/order-changes/finance';
import {OrderChangesService} from '../src/order-changes/service';
import {offlineSwapLifecycleFixture} from './offline-swap-lifecycle-fixture';
import {swapV2Input,swapOps} from './offline-swap-quotes-fixture';

async function prepared(){const f=await offlineSwapLifecycleFixture();await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:f.q.commercialHash});f.archiveQuote();await prepareFinance(f.tx,f.change,{id:'finance'});return f;}
function paid(f:Awaited<ReturnType<typeof prepared>>,sequence:number){const o=f.obligations.find((x:any)=>x.quoteId===f.q.id&&x.sequence===sequence),bill=f.bills.find((b:any)=>b.id===o.chargeBillId),payment={id:'actual-'+bill.id,billId:bill.id,customerId:f.order.customerId,status:'SUCCEEDED',amount:bill.amount,refunds:[]};Object.assign(bill,{status:'PAID',paidAmount:bill.amount,payments:[payment]});f.allocations.push({paymentId:payment.id,obligationId:o.id,amount:payment.amount});return payment;}
async function acceptReprice(f:Awaited<ReturnType<typeof prepared>>){const q=f.quotes.at(-1)!;Object.assign(q,{status:'REVIEWED',reviewedBy:'finance',reviewNote:'重新核对净差'});f.change.status='REVIEWED';await publish(f.tx,f.change);await confirm(f.tx,f.change,{commercialHash:q.commercialHash});f.archiveQuote(q);return q;}

test('later actual delivery creates a new auto price and only the net refund, preserving real previous payments and requiring new confirmation',async()=>{
 const f=await prepared();paid(f,2);const old=structuredClone(f.q),bills=structuredClone(f.bills),input={...swapV2Input(f),idempotencyKey:'reprice-later-key',plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'};
 const service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));await service.act(f.change.id,'quotes',input,swapOps);const q=f.quotes.at(-1)!;
 assert.notEqual(q.id,old.id);assert.equal(q.snapshot.previousPreparedQuoteId,old.id);assert.equal(q.snapshot.financeSourceQuoteId,undefined);assert.equal(q.snapshot.document,null);assert.equal(q.financePreparedAt,undefined);assert.equal(q.snapshot.periods[1].amount,19667);assert.equal(q.snapshot.periods[1].netPaidAmount,20000);assert.equal(q.snapshot.periods[1].refundAmount,333);assert.equal(q.snapshot.periods[1].chargeAmount,0);assert.equal(f.change.status,'REVIEW_PENDING');
 assert.deepEqual(f.bills,bills);assert.equal(f.refunds.length,0);const count=f.quotes.length;await service.act(f.change.id,'quotes',input,swapOps);assert.equal(f.quotes.length,count);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
});

test('earlier actual delivery charges only the additional original-service-month day and keeps all previous source principal',async()=>{
 const f=await prepared();paid(f,2);await new OrderChangesService(f.db as any,()=>new Date('2026-10-31')).act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'reprice-earlier-key',plannedReturnAt:'2026-10-31T09:00:00+08:00',plannedDeliveryAt:'2026-10-31T10:00:00+08:00'},swapOps);
 const q=f.quotes.at(-1)!;assert.equal(q.snapshot.periods[0].amount,10323);assert.equal(q.snapshot.periods[0].chargeAmount,323);assert.equal(q.snapshot.periods[1].amount,20000);assert.equal(q.snapshot.periods[1].chargeAmount,0);assert.equal(q.snapshot.periods[1].refundAmount,0);assert(q.fundsSnapshot[1].payments.some((p:any)=>p.id.startsWith('actual-')));assert.equal(q.snapshot.pricing.pricing.periods[0].chargeDays,1);
});

test('new archived net plan refunds only the difference once, and another reprice uses the actual refunded principal',async()=>{
 const f=await prepared();paid(f,2);const service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'reprice-net-second',plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'},swapOps);const second=await acceptReprice(f);
 const input={revision:f.change.revision,idempotencyKey:'prepare-net-second'},actor={id:'finance',role:'FINANCE',authVersion:1};await service.act(f.change.id,'prepare-finance',input,actor);await service.act(f.change.id,'prepare-finance',input,actor);
 assert.deepEqual(f.refunds.map((r:any)=>r.amount),[333]);assert.equal(f.bills.find((b:any)=>b.id===f.obligations.find((o:any)=>o.quoteId===f.q.id&&o.sequence===3).chargeBillId).status,'VOID');assert.equal(f.bills[0].status,'PAID');
 f.refunds[0].status='SUCCEEDED';assert.equal((await financeView(f.tx,f.change)).blockers.length,0);
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'reprice-net-third',plannedReturnAt:'2026-11-01T09:00:00+08:00',plannedDeliveryAt:'2026-11-01T10:00:00+08:00'},swapOps);const third=f.quotes.at(-1)!;
 assert.equal(third.snapshot.previousPreparedQuoteId,second.id);assert.equal(third.snapshot.preparedSources.length,2);assert.equal(third.snapshot.periods[1].netPaidAmount,19667);assert.equal(third.snapshot.periods[1].chargeAmount,333);assert.equal(third.snapshot.periods[1].refundAmount,0);assert.equal(f.refunds.length,1);
});

test('late trusted source money after financial preparation blocks handover until a new net plan accounts for it',async()=>{
 const f=await prepared();paid(f,2);assert.equal((await financeView(f.tx,f.change)).blockers.length,0);
 f.bills[0].payments.push({id:'late-source-receipt',billId:f.bills[0].id,customerId:f.order.customerId,status:'SUCCEEDED',amount:100,refunds:[]});
 const view=await financeView(f.tx,f.change);assert(view.blockers.some((b:string)=>b.includes('真实收退款')));assert.equal(f.refunds.length,0);
});

test('a completed old-car return survives new paper consent and net preparation without reopening the physical fact',async()=>{
 const f=await prepared();paid(f,2);const actualAt=new Date('2026-11-01T01:00:00Z');
 Object.assign(f.assignment,{status:'CLOSED',endAt:actualAt,endReadingKm:200,returnHandoverId:'physical-return'});f.order.currentAssignmentId=null;f.change.returnHandoverId='physical-return';f.change.status='SWAP_RETURNED';
 f.handovers.push({id:'physical-return',orderId:f.order.id,customerId:f.order.customerId,changeId:f.change.id,vehicleId:f.vehicle.id,assignmentId:f.assignment.id,type:'SWAP_RETURN',executionMode:'OFFLINE',status:'COMPLETED',actualAt,readingKm:200});
 const fact=structuredClone(f.handovers.at(-1)),service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'returned-net-second',plannedReturnAt:actualAt.toISOString(),plannedDeliveryAt:'2026-11-02T10:00:00+08:00'},swapOps);const q=await acceptReprice(f);
 await prepareFinance(f.tx,f.change,{id:'finance'});assert.equal(f.change.status,'SWAP_RETURNED');assert.equal(f.change.returnHandoverId,'physical-return');assert.equal(f.order.currentAssignmentId,null);assert.deepEqual(f.handovers.find(h=>h.id==='physical-return'),fact);assert.equal(q.approvedArchiveVersionId,'paper-'+q.id+'-v1');
});

test('cancelling an unconfirmed net reprice restores the real prepared paper quote and hold without reallocating funds or granting credits',async()=>{
 const f=await prepared();paid(f,2);const service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31')),oldId=f.q.id;
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'cancel-net-create',plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'},swapOps);const draft=f.quotes.at(-1)!,bills=structuredClone(f.bills),allocations=structuredClone(f.allocations);
 const input={revision:f.change.revision,idempotencyKey:'cancel-net-once',reason:'保持原已签安排'};await service.act(f.change.id,'cancel',input,swapOps);await service.act(f.change.id,'cancel',input,swapOps);
 assert.equal(f.change.activeQuoteId,oldId);assert.equal(f.change.status,'AWAITING_FINANCE');assert.equal(f.q.status,'CONFIRMED');assert.equal(draft.status,'REJECTED');assert.equal(f.holds.find((h:any)=>h.id===f.target.holdId)?.quoteId,oldId);assert.deepEqual(f.bills,bills);assert.deepEqual(f.allocations,allocations);assert.equal(f.credits.length,1);assert.equal(f.ledger.filter(l=>l.type==='GRANT').length,1);assert.equal(f.ledger.filter(l=>l.type==='RESERVE').length,1);assert.equal(f.ledger.filter(l=>l.type==='CONSUME').length,0);
});

test('prepared retries still validate every original paper source, and failed refunds retry only remaining real principal once',async()=>{
 const f=await prepared();paid(f,2);const service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'retry-net-create',plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'},swapOps);await acceptReprice(f);await prepareFinance(f.tx,f.change,{id:'finance'});
 f.refunds[0].status='FAILED';f.version.invalidatedAt=new Date();const before=f.refunds.length;await assert.rejects(prepareFinance(f.tx,f.change,{id:'finance'}),(e:any)=>e.getResponse?.().error?.code==='AGREEMENT_ARCHIVE_REQUIRED');assert.equal(f.refunds.length,before);
 delete f.version.invalidatedAt;await prepareFinance(f.tx,f.change,{id:'finance'});assert.deepEqual(f.refunds.map((r:any)=>r.amount),[333,333]);await assert.rejects(prepareFinance(f.tx,f.change,{id:'finance'}),(e:any)=>e.getResponse?.().error?.code==='FUNDS_UNCONFIRMED');assert.equal(f.refunds.length,2);
});

test('a historical prepared node cannot rewrite its frozen predecessor hash',async()=>{
 const f=await prepared();paid(f,2);const service=new OrderChangesService(f.db as any,()=>new Date('2026-10-31'));
 await service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'chain-immutable-second',plannedReturnAt:'2026-11-02T09:00:00+08:00',plannedDeliveryAt:'2026-11-02T10:00:00+08:00'},swapOps);const second=await acceptReprice(f);await prepareFinance(f.tx,f.change,{id:'finance'});f.refunds[0].status='SUCCEEDED';second.snapshot.preparedSourceHash='0'.repeat(64);
 await assert.rejects(service.act(f.change.id,'quotes',{...swapV2Input(f),idempotencyKey:'chain-immutable-third'},swapOps),(e:any)=>e.getResponse?.().error?.code==='SWAP_FINANCE_SOURCE');assert.equal(f.quotes.length,2);
});
