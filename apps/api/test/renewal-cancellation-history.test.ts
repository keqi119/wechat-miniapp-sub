import test from 'node:test';
import assert from 'node:assert/strict';
import {completedCancellationFixture} from './renewal-cancellation-history-fixture';
import {readPreparedRenewalSource} from '../src/order-renewals/source';
import {readRenewalBillSource,readRenewalPaymentGuard,renewalPaymentBlocker} from '../src/order-renewals/payment';
import {canonicalHash} from '../src/customers/types';
const load=async(f:Awaited<ReturnType<typeof completedCancellationFixture>>)=>(await import('../src/order-renewals/cancellation-history')).readCompletedRenewalCancellationSource(f.tx,f.change.id);

test('real completed signed/unsigned cancellation remains readable with no writes and no fabricated stage',async()=>{
 for(const prepared of [true,false]){const f=await completedCancellationFixture(prepared),v=await load(f);assert.equal(v.record.id,f.record.id);assert.equal(v.stage?.status??null,prepared?'VOIDED':null);assert.equal(v.preparedSource?.snapshot.identity.serviceStageId??null,f.stage?.id??null);assert.equal(f.writes.length,f.writesBefore);}
});
test('exact original renewal and cancellation pins survive invalidation without changing completion or consulting live catalog',async()=>{
 const f=await completedCancellationFixture();const before=structuredClone(f.record);for(const v of [f.version,f.paper!.version,f.rental.versions[0]])Object.assign(v,{status:'INVALIDATED',invalidatedAt:new Date()});Object.assign(f.archive,{currentApprovedVersionId:null});f.paper!.archive.currentApprovedVersionId=null;
 for(const name of ['vehicleListing','productVersion','subscriptionPlan','insurancePolicy','coverageRequirement'])if(f.tx[name])for(const method of ['findUnique','findMany'])f.tx[name][method]=async()=>{throw Error('current eligibility forbidden');};
 const v=await load(f);assert.equal(v.stage?.status,'VOIDED');assert.deepEqual(f.record,before);assert.equal(f.writes.length,f.writesBefore);
});
test('completion hashes, original document, canceled source and actual stage cannot be substituted',async()=>{
 for(const mutate of [(f:any)=>f.record.completionHash='a'.repeat(64),(f:any)=>f.contract.body+='tamper',(f:any)=>f.stage.activatedAt=new Date(),(f:any)=>f.stage.status='ACTIVE',(f:any)=>f.tx.usagePeriod.count=async()=>1,(f:any)=>f.change.status='APPLIED',(f:any)=>f.record.customerId='foreign']){const f=await completedCancellationFixture();mutate(f);await assert.rejects(load(f));}
});
test('rehashed completed snapshot cannot replace its zero funds or approved original pin',async()=>{
 const f=await completedCancellationFixture();f.record.completionSnapshot.funding.remainingRefundAmount=1;f.record.completionHash=canonicalHash(f.record.completionSnapshot);await assert.rejects(load(f));
 const g=await completedCancellationFixture();g.paper!.version.fileManifestHash='b'.repeat(64);await assert.rejects(load(g));
});
test('completed VOIDED stage restores historical bill source but never authorizes payment initiation or allocation',async()=>{
 const f=await completedCancellationFixture();const historical=await readPreparedRenewalSource(f.tx,f.stage.id);assert.equal(historical.snapshot.termsSnapshot.monthlyFeeAmount,f.quote.snapshot.monthlyFeeAmount);assert.equal((await readRenewalBillSource(f.tx,f.bill))!.source.stage.id,f.stage.id);
 await assert.rejects(readRenewalPaymentGuard(f.tx,f.bill));assert.equal(typeof await renewalPaymentBlocker(f.tx,f.bill),'string');assert.equal(f.writes.length,f.writesBefore);
});
test('historical reads require original paper review and real assignment delivery, without using current assignment',async()=>{
 const valid=await completedCancellationFixture();Object.assign(valid.assignment,{status:'CLOSED',endAt:new Date()});valid.order.currentAssignmentId='later-real-assignment';assert.equal((await load(valid)).stage!.id,valid.stage!.id);
 for(const mutate of [(f:any)=>f.rental.versions[0].reviewedBy=null,(f:any)=>f.tx.handover.findUnique=async()=>null,(f:any)=>f.original.documentHash='f'.repeat(64)]){const f=await completedCancellationFixture();mutate(f);await assert.rejects(load(f));}
});
