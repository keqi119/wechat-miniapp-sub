import test from 'node:test';
import assert from 'node:assert/strict';
import {renewalActivationFixture,activationInput} from './order-renewals-activation-fixture';
import {renewalFinance,renewalOps} from './order-renewals-fixture';
import {readPreparedRenewalSource} from '../src/order-renewals/source';
import {openSegments} from '../src/vehicle-changes/assignments';
const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
async function api(f:Awaited<ReturnType<typeof renewalActivationFixture>>){assert.equal(typeof (f.service as any).activationPreview,'function');assert.equal(typeof (f.service as any).activate,'function');return f.service as any;}

test('activation starts on the Shanghai boundary, appends exact frozen periods and leaves old facts unchanged',async()=>{
 const f=await renewalActivationFixture(),s=await api(f),old=structuredClone({periods:f.periods,segments:f.segments,obligation:f.oldObligation,assignment:f.assignment,initial:f.initial,paid:f.paidCredit,purchase:f.paidPurchase,account:f.account}),preview=await s.activationPreview(f.change.id,renewalOps);assert.equal(preview.ready,true);assert.equal(preview.effectiveAt,'2027-09-30T16:00:00.000Z');
 const input=activationInput(preview),result=await s.activate(f.change.id,input,renewalOps);assert.equal(result.status,'ACTIVE');assert.equal(f.change.status,'APPLIED');assert.equal(f.stage.status,'ACTIVE');assert.equal(f.stages.find(r=>r.kind==='INITIAL')!.status,'ENDED');
 assert.equal(f.terms.length,1);assert.deepEqual(f.terms[0].snapshot,f.quote.snapshot.renewalTerms);assert.equal(f.terms[0].hash,f.quote.commercialHash);assert.equal(f.terms[0].effectiveAt.toISOString(),preview.effectiveAt);assert.equal(f.stage.activatedAt.toISOString(),f.now().toISOString());assert.equal(f.stage.termsVersionId,f.terms[0].id);assert.equal(f.order.effectiveTermsVersionId,f.terms[0].id);
 const added=f.periods.filter(p=>p.serviceStageId===f.stage.id);assert.equal(added.length,12);assert.deepEqual(added.map(p=>[p.sequence,p.stageSequence]),Array.from({length:12},(_,i)=>[i+13,i+1]));assert(added.every(p=>p.startReadingKm===null&&p.endReadingKm===null&&p.pricingSnapshot.policyVersion==='USAGE_V2'&&p.pricingSnapshot.baseAllowanceKm===2400&&p.pricingSnapshot.excessPriceAmount===230));
 assert.equal(f.segments.length,old.segments.length+12);assert(f.segments.slice(old.segments.length).every(seg=>seg.assignmentId===f.assignment.id&&seg.vehicleId===f.vehicle.id&&seg.startReadingKm===null&&seg.endReadingKm===null&&seg.readingId===null));
 assert.deepEqual(f.periods.slice(0,12),old.periods);assert.deepEqual(f.segments.slice(0,old.segments.length),old.segments);assert.deepEqual(f.oldObligation,old.obligation);assert.deepEqual(f.assignment,old.assignment);assert.deepEqual(f.initial,old.initial);assert.deepEqual(f.paidCredit,old.paid);assert.deepEqual(f.paidPurchase,old.purchase);assert.deepEqual({...f.account,revision:(old.account as any).revision},old.account);
 assert(f.obligations.filter(o=>o.serviceStageId===f.stage.id).every(o=>o.active));assert.equal(f.oldFree.status,'EXPIRED');assert.equal(f.reservations[0].status,'RELEASED');assert.equal(f.credits.length,2,'new stage gifts remain lazy');assert.equal(f.ledger.filter(l=>l.type==='EXPIRE').length,1);
 const read=await readPreparedRenewalSource(f.tx,f.stage.id);assert.equal(read.stage.status,'ACTIVE');
 const count=f.writes.length,revision=f.order.revision;assert.deepEqual(await s.activate(f.change.id,input,renewalOps),result);assert.equal(f.writes.length,count);assert.equal(f.order.revision,revision);assert.equal(f.ledger.filter(l=>l.type==='EXPIRE').length,1);
 f.staff.get('ops')!.authVersion++;await assert.rejects(s.activate(f.change.id,input,renewalOps),code('STAFF_SESSION_CHANGED'));
});

test('activation rejects early Shanghai day and whole-stage expiry, while late activation records actual time',async()=>{
 for(const [at,expected] of [['2027-09-30T15:59:59Z','RENEWAL_NOT_STARTED'],['2028-09-30T16:00:00Z','RENEWAL_STAGE_EXPIRED']]){const f=await renewalActivationFixture(),s=await api(f);f.setNow(at);const p=await s.activationPreview(f.change.id,renewalOps),count=f.writes.length;assert.equal(p.ready,false);assert(p.blockers.includes(expected));await assert.rejects(s.activate(f.change.id,activationInput(p),renewalOps),code(expected));assert.equal(f.writes.length,count);assert.equal(f.terms.length,0);}
 const f=await renewalActivationFixture(),s=await api(f);f.setNow('2027-10-05T06:00:00+08:00');const p=await s.activationPreview(f.change.id,renewalOps);await s.activate(f.change.id,activationInput(p),renewalOps);assert.equal(f.stage.activatedAt.toISOString(),'2027-10-04T22:00:00.000Z');assert.equal(f.terms[0].effectiveAt.toISOString(),'2027-09-30T16:00:00.000Z');assert(f.periods.filter(p=>p.serviceStageId).every(p=>p.readingId===null));
});

test('activation rechecks paper, original cash, current vehicle and exact versions instead of trusting schedule',async()=>{
 for(const mutate of [(f:any)=>f.version.status='INVALIDATED',(f:any)=>f.assignment.status='CLOSED',(f:any)=>f.order.status='SETTLING',(f:any)=>f.bills.find((b:any)=>b.type==='DEPOSIT').payments[0].reconciliationRequired=true,(f:any)=>f.bills.find((b:any)=>b.serviceStageId===f.stage.id).payments[0].refunds.push({id:'pending-refund',paymentId:'paid-'+f.bills.find((b:any)=>b.serviceStageId===f.stage.id).id,customerId:f.customer.id,status:'PROCESSING',amount:1})]){
  const f=await renewalActivationFixture(),s=await api(f),p=await s.activationPreview(f.change.id,renewalOps),count=f.writes.length;mutate(f);await assert.rejects(s.activate(f.change.id,activationInput(p),renewalOps));assert.equal(f.writes.length,count);assert.equal(f.stage.status,'SCHEDULED');assert.equal(f.terms.length,0);
 }
 const f=await renewalActivationFixture(),s=await api(f),p=await s.activationPreview(f.change.id,renewalOps);await assert.rejects(s.activate(f.change.id,activationInput(p),renewalFinance),code('FORBIDDEN'));await assert.rejects(s.activate(f.change.id,{...activationInput(p),previousStageRevision:p.previousStageRevision+1},renewalOps),code('VERSION_CONFLICT'));
});

test('occupied usage numbers, including CANCELLED history, never get overwritten by activation',async()=>{
 const f=await renewalActivationFixture(),s=await api(f);f.periods.push({...f.periods[0],id:'old-cancelled-13',sequence:13,status:'CANCELLED'});const before=structuredClone(f.periods),count=f.writes.length;await assert.rejects(s.activationPreview(f.change.id,renewalOps),code('RENEWAL_USAGE_CONFLICT'));assert.deepEqual(f.periods,before);assert.equal(f.writes.length,count);
});

test('scoped openSegments touches only matching stage and account and refuses an empty scope',async()=>{
 const f=await renewalActivationFixture(),before=structuredClone(f.segments);f.stage.status='ACTIVE';f.periods.push({...f.periods[0],id:'only-renewal-period',sequence:13,serviceStageId:f.stage.id,stageSequence:1,startDate:new Date('2027-10-01'),endDate:new Date('2027-11-01'),effectiveEndDate:new Date('2027-11-01')},{...f.periods[0],id:'wrong-account',sequence:14,serviceStageId:f.stage.id,accountId:'other-account'});
 await (openSegments as any)(f.tx,f.assignment,false,{serviceStageId:f.stage.id});assert.equal(f.segments.length,before.length+1);assert.equal(f.segments.at(-1).periodId,'only-renewal-period');assert.deepEqual(f.segments.slice(0,before.length),before);const count=f.segments.length;await assert.rejects((openSegments as any)(f.tx,f.assignment,false,{serviceStageId:''}),code('USAGE_STAGE_SCOPE'));assert.equal(f.segments.length,count);
});

test('activation DTO rejects client prices and unknown source faults propagate without writes',async()=>{
 const f=await renewalActivationFixture(),s=await api(f),p=await s.activationPreview(f.change.id,renewalOps),count=f.writes.length;
 assert.throws(()=>s.activate(f.change.id,{...activationInput(p),monthlyFeeAmount:1},renewalOps));assert.equal(f.writes.length,count);
 const original=f.tx.usagePeriod.findMany,unknown=new Error('synthetic database unavailable');f.tx.usagePeriod.findMany=async()=>{throw unknown;};await assert.rejects(s.activationPreview(f.change.id,renewalOps),e=>e===unknown);assert.equal(f.writes.length,count);f.tx.usagePeriod.findMany=original;
 f.periods[0].revision++;await assert.rejects(s.activate(f.change.id,activationInput(p),renewalOps),code('PREVIEW_CHANGED'));assert.equal(f.writes.length,count);
});

test('historical superseded prepared quote remains readable but cannot authorize a current activation',async()=>{
 const f=await renewalActivationFixture(),s=await api(f);f.quote.status='SUPERSEDED';
 assert.equal((await readPreparedRenewalSource(f.tx,f.stage.id)).quote.id,f.quote.id,'historical evidence must remain readable');
 const count=f.writes.length;await assert.rejects(s.activationPreview(f.change.id,renewalOps),code('RENEWAL_STAGE_SOURCE'));assert.equal(f.writes.length,count);
});
