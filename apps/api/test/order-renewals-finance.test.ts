import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewalFinanceFixture,markRenewalHistoricallyActive} from './order-renewals-finance-fixture';
import {renewalNow,renewalFinance,renewalOps} from './order-renewals-fixture';
import {renewalCommercialHash} from '../src/order-renewals/types';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
async function modules(){const source:any=await import('../src/order-renewals/source').catch(()=>({})),finance:any=await import('../src/order-renewals/finance').catch(()=>({}));assert.equal(typeof source.readPreparedRenewalSource,'function','pure prepared renewal source exists');assert.equal(typeof finance.prepareRenewalFinance,'function','independent preparation exists');return{...source,...finance};}
async function prepared(options:{depositAmount?:number}={}){const m=await modules(),f=await renewalFinanceFixture(options),p=await (f.service as any).financePreview(f.change.id,renewalFinance);await (f.service as any).prepare(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:p.previewHash,idempotencyKey:'renewal-prepare-once'},renewalFinance);return{...f,m,stage:f.stages.find(s=>s.kind==='RENEWAL')!};}

test('published commercial hash survives JSONB object-key reordering of all frozen evidence',async()=>{
 const f=await renewalFinanceFixture(),s=f.quote.snapshot;
 const reordered=(v:any):any=>Array.isArray(v)?v.map(reordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().reverse().map(k=>[k,reordered(v[k])])):v;
 assert.equal(renewalCommercialHash(f.change,s,s.document.templateHash,f.contract.id,s.offlineSource),f.quote.commercialHash);
 assert.equal(renewalCommercialHash(f.change,s,s.document.templateHash,f.contract.id,reordered(s.offlineSource)),f.quote.commercialHash,'persisted JSONB must not change the signed commercial identity');
 const roundTrip=reordered(s);assert.equal(renewalCommercialHash(f.change,roundTrip,s.document.templateHash,f.contract.id,roundTrip.offlineSource),f.quote.commercialHash);
 roundTrip.renewalTerms.monthlyFeeAmount++;assert.notEqual(renewalCommercialHash(f.change,roundTrip,s.document.templateHash,f.contract.id,roundTrip.offlineSource),f.quote.commercialHash,'real commercial edits remain detectable');
});

test('prepare freezes a verified paper pin and new bills only, even after a confirmed listing is withdrawn',async()=>{
 const m=await modules(),f=await renewalFinanceFixture(),before=structuredClone({old:f.bills,initial:f.initial,account:f.account,assignment:f.assignment,terms:f.terms});f.plan.listing.status='WITHDRAWN';f.plan.listing.revision++;f.plan.active=false;f.product.status='WITHDRAWN';
 const p=await (f.service as any).financePreview(f.change.id,renewalFinance);assert.equal(f.stages.length,1);const writes=f.writes.length;
 const input={revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,previewHash:p.previewHash,idempotencyKey:'withdrawn-source-prepare'},result=await (f.service as any).prepare(f.change.id,input,renewalFinance);
 assert.equal(result.status,'PREPARED');assert.equal(f.stages.length,2);assert.equal(f.quote.approvedArchiveVersionId,f.version.id);assert.equal(f.obligations.length,12);assert(f.obligations.every(o=>o.active===false&&o.sourceBillIds.length===0&&o.chargeAmount===o.amount&&o.serviceStageId===result.stageId));assert.equal(f.bills.length,24);assert.equal(f.bills.at(-1)!.sequence,24);assert.equal(f.writes.length>writes,true);
 assert.deepEqual({old:f.bills.slice(0,12),initial:f.initial,account:f.account,assignment:f.assignment,terms:f.terms},before);const revision=f.order.revision,count=f.writes.length;assert.deepEqual(await (f.service as any).prepare(f.change.id,input,renewalFinance),result);assert.equal(f.order.revision,revision);assert.equal(f.writes.length,count);
 const frozen=await m.readPreparedRenewalSource(f.tx,result.stageId);assert.deepEqual(frozen.snapshot.termsSnapshot,f.quote.snapshot.renewalTerms);assert.equal(frozen.snapshot.source.agreement.approvedArchiveHash,f.version.fileManifestHash);
});
test('prepared source uses historical stage and assignment after a later swap without requiring the current vehicle',async()=>{
 const f=await prepared(),stage=markRenewalHistoricallyActive(f),writes=f.writes.length,source=await f.m.readPreparedRenewalSource(f.tx,stage.id);assert.equal(source.assignment.status,'CLOSED');assert.equal(source.snapshot.identity.vehicleId,'vehicle');assert.equal(f.order.vehicleId,'target');assert.equal(f.writes.length,writes);
 stage.snapshot.termsSnapshot.monthlyFeeAmount++;await assert.rejects(f.m.readPreparedRenewalSource(f.tx,stage.id),code('SERVICE_STAGE_SOURCE'));
});
test('new preparation rejects invalidated paper and foreign frozen listing associations without writes',async()=>{
 await modules();for(const mutate of [(f:any)=>f.version.status='INVALIDATED',(f:any)=>f.plan.vehicleId='foreign']){const f=await renewalFinanceFixture();mutate(f);const count=f.writes.length;await assert.rejects((f.service as any).financePreview(f.change.id,renewalFinance));assert.equal(f.writes.length,count);assert.equal(f.stages.length,1);}
});
test('schedule needs true first-stage receipt and allocation, while unpaid future regular months do not block',async()=>{
 const f=await prepared();let p=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(p.ready,false);const first=f.bills.find(b=>b.serviceStageId===f.stage.id&&b.sequence===13)!;first.status='PAID';first.paidAmount=first.amount;p=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(p.ready,false,'a bill status alone is not cash');first.status='PENDING';first.paidAmount=0;f.pay(first);
 p=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(p.ready,true);const old=structuredClone({initial:f.initial,terms:f.terms,account:f.account,assignment:f.assignment,credits:f.credits}),input={revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,stageId:f.stage.id,stageRevision:f.stage.revision,previewHash:p.previewHash,idempotencyKey:'renewal-schedule-once'};
 const result=await (f.service as any).schedule(f.change.id,input,renewalFinance);assert.equal(result.status,'SCHEDULED');assert.equal(f.change.status,'SCHEDULED');assert.equal(f.terms.length,0);assert(f.obligations.every(o=>o.active===false));assert.deepEqual({initial:f.initial,terms:f.terms,account:f.account,assignment:f.assignment,credits:f.credits},old);const count=f.writes.length;assert.deepEqual(await (f.service as any).schedule(f.change.id,input,renewalFinance),result);assert.equal(f.writes.length,count);
 f.staff.get('finance')!.authVersion++;await assert.rejects((f.service as any).schedule(f.change.id,input,renewalFinance),code('STAFF_SESSION_CHANGED'));
});
test('finance permissions, old due debt, unknown refunds and stale previews cannot schedule a future period',async()=>{
 const f=await prepared();await assert.rejects((f.service as any).schedulePreview(f.change.id,renewalOps),code('FORBIDDEN'));const first=f.bills.find(b=>b.serviceStageId===f.stage.id&&b.sequence===13)!,payment=f.pay(first),p=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(p.ready,true);
 payment.refunds.push({id:'unknown-refund',paymentId:payment.id,customerId:f.customer.id,status:'PROCESSING',amount:1} as never);let next=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(next.ready,false);payment.refunds.length=0;payment.revision++;
 await assert.rejects((f.service as any).schedule(f.change.id,{revision:f.change.revision,orderRevision:f.order.revision,accountRevision:(f.account as any).revision,stageId:f.stage.id,stageRevision:f.stage.revision,previewHash:p.previewHash,idempotencyKey:'stale-funding-schedule'},renewalFinance),code('PREVIEW_CHANGED'));assert.equal(f.stage.status,'PREPARED');
 const due=f.bills.find(b=>b.sequence===1)!;due.status='PENDING';due.paidAmount=0;due.payments=[];next=await (f.service as any).schedulePreview(f.change.id,renewalFinance);assert.equal(next.ready,false);assert.equal(f.stage.status,'PREPARED');
});
test('nonzero original deposit needs retained real cash and a completed historical service refund is not new debt',async()=>{
 const f=await prepared({depositAmount:50000}),first=f.bills.find(b=>b.serviceStageId===f.stage.id&&b.sequence===13)!;f.pay(first);assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,false);
 const deposit=f.bills.find(b=>b.id==='original-deposit')!;f.pay(deposit);assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,true);
 const old=f.bills.find(b=>b.type==='SUBSCRIPTION'&&b.sequence===1)!.payments[0];old.refunds.push({id:'old-refund',paymentId:old.id,customerId:f.customer.id,amount:old.amount,status:'SUCCEEDED',providerRefundId:'original-refund-receipt'});assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,true,'paid historical refunds must not invent a replacement debt');
 const receipt=deposit.payments[0];receipt.refunds.push({id:'deposit-refund',paymentId:receipt.id,customerId:f.customer.id,amount:1,status:'SUCCEEDED',providerRefundId:'deposit-refund-receipt'});assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,false,'original deposit must remain fully retained');
});
test('a foreign-order receipt cannot satisfy an old due obligation even for the same customer',async()=>{
 const f=await prepared(),first=f.bills.find(b=>b.serviceStageId===f.stage.id&&b.sequence===13)!;f.pay(first);const read=f.tx.serviceObligation.findMany;
 f.tx.serviceObligation.findMany=async(args:any)=>[...await read(args),{id:'old-obligation',orderId:f.order.id,quoteId:'old-real-quote',serviceStageId:null,stageSequence:null,sequence:1,startDate:new Date('2026-10-01'),endDate:new Date('2026-11-01'),dueDate:new Date('2026-10-01'),amount:100,chargeAmount:0,chargeBillId:null,sourceBillIds:['foreign-order-bill'],active:true,allocations:[{id:'foreign-allocation',obligationId:'old-obligation',paymentId:'foreign-payment',amount:100,releasedAt:null,payment:{id:'foreign-payment',billId:'foreign-order-bill',customerId:f.customer.id,status:'SUCCEEDED',amount:100,reconciliationRequired:false,refunds:[]}}]}];
 assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,false);
});
test('unknown receipt reconciliation, duplicate channel receipts and changed monthly rows all block schedule',async()=>{
 for(const mutate of [(f:any,p:any)=>p.reconciliationRequired=true,(f:any,p:any)=>p.providerTransactionId=f.bills[0].payments[0].providerTransactionId,(f:any)=>f.obligations[0].chargeAmount--]){const f=await prepared(),first=f.bills.find(b=>b.serviceStageId===f.stage.id&&b.sequence===13)!,payment=f.pay(first);mutate(f,payment);assert.equal((await (f.service as any).schedulePreview(f.change.id,renewalFinance)).ready,false);assert.equal(f.stage.status,'PREPARED');}
});
