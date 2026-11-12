import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyReadingFixture} from './renewal-legacy-reading-fixture';
import {reviewUsageReading} from '../src/usage/usage.service';
import {segmentUsage,refreshSegmentPeriods} from '../src/vehicle-changes/segments';
const command={revision:1,idempotencyKey:'renewal-first-usage'};
const conflict=(error:any)=>error.getStatus?.()===409;
const frozen=(f:any)=>{const {account:_relation,...previous}=f.previous;return structuredClone({previous,readings:f.readings,earlier:f.segments.filter((s:any)=>s.id!==f.segment.id)});};

test('real legacy review and settlement supply only the new renewal segment start, preserving both monthly prices',async()=>{
 const f=await legacyReadingFixture();Object.assign(f.previous,{status:'REVIEW_PENDING',revision:0,endReadingKm:null,settledAt:null,settlementKey:null});Object.assign(f.readings[0],{status:'SUBMITTED',reviewedBy:null});
 await reviewUsageReading(f.tx,f.readings[0],{decision:'APPROVED',boundaryConfirmed:true,note:'真实月界照片核验'},'reviewer');
 const old=await f.service.settle(f.previous.id,{revision:1,idempotencyKey:'legacy-real-settlement'},'finance');
 assert.equal(old.usedKm,2500);assert.equal(old.excessAmount,150000);assert.equal(old.baseAllowanceKm,1500);
 const before=frozen(f),result=await f.service.settle(f.current.id,command,'finance');
 assert.equal(result.startReadingKm,7000);assert.equal(result.usedKm,3000);assert.equal(result.baseAllowanceKm,2200);assert.equal(result.excessAmount,140000);assert.equal(f.segment.startReadingKm,7000);assert.equal(f.segment.status,'FROZEN');assert.match(f.segment.frozenHash,/^[a-f0-9]{64}$/);assert.deepEqual(frozen(f),before);
 const writes=f.writes.length;assert.deepEqual(await f.service.settle(f.current.id,command,'finance'),result);assert.equal(f.writes.length,writes);assert.equal(f.bills.length,2);
});

test('nearest legacy month wins over an older FROZEN segment, including cancelled global month numbers',async()=>{
 const f=await legacyReadingFixture(25);f.addStale();const before=frozen(f),result=await f.service.settle(f.current.id,command,'finance');
 assert.equal(result.usedKm,3000);assert.equal(result.startReadingKm,7000);assert.equal(result.excessAmount,140000);assert.equal(f.bills[0].sequence,25);assert.deepEqual(frozen(f),before);assert.equal(f.vehicle.mileageKm,999999,'current vehicle odometer is never a start source');
});

test('bad legacy mileage identity, review or boundary evidence cannot fall back to an older FROZEN reading',async()=>{
 const cases:Array<(f:any)=>void>=[f=>f.readings[0].status='SUBMITTED',f=>f.readings[0].orderId='foreign',f=>f.readings[0].customerId='another',f=>f.readings[0].periodId='another-month',f=>f.readings[0].readingKm=6999,f=>f.readings[0].recordedAt=new Date('2027-01-30T15:59:59Z'),f=>f.readings[0].reviewedBy=null,f=>f.staff.length=0,f=>f.readings[0].segmentId='unrelated-segment',f=>f.readings[0].assignmentId='another-assignment',f=>f.readings[0].fileIds=[]];
 for(const mutate of cases){const f=await legacyReadingFixture();f.addStale();mutate(f);const before=frozen(f);await assert.rejects(f.service.settle(f.current.id,command,'finance'),conflict);assert.equal(f.segment.startReadingKm,null);assert.equal(f.segment.status,'READY');assert.equal(f.bills.length,0);assert.deepEqual(frozen(f),before);}
});

test('the legacy start requires real own mileage images rather than unrelated or malformed private files',async()=>{
 for(const mutate of [(f:any)=>f.files[0].customerId='another',(f:any)=>f.files[0].purpose='vehicle',(f:any)=>f.files[0].mimeType='application/pdf',(f:any)=>f.files[0].sha256='bad',(f:any)=>f.files[0].size=0,(f:any)=>f.files[0].assetPrivateFile={fileId:'legacy-photo'},(f:any)=>f.files.shift()]){const f=await legacyReadingFixture();f.addStale();mutate(f);await assert.rejects(f.service.settle(f.current.id,command,'finance'),conflict);assert.equal(f.segment.startReadingKm,null);assert.equal(f.bills.length,0);}
});

test('one real same-customer same-car assignment must cover the full legacy month and new boundary',async()=>{
 for(const mutate of [(f:any)=>f.assignment.customerId='another',(f:any)=>f.assignment.orderId='foreign',(f:any)=>f.assignment.vehicleId='other-car',(f:any)=>f.assignment.startAt=new Date('2027-01-15T00:00:00+08:00'),(f:any)=>{f.assignment.status='CLOSED';f.assignment.endAt=new Date('2027-01-31T00:00:00+08:00');},(f:any)=>f.assignments.push({...f.assignment,id:'overlap',vehicleId:'other-car'}),(f:any)=>f.assignments.length=0]){const f=await legacyReadingFixture();f.addStale();mutate(f);await assert.rejects(f.service.settle(f.current.id,command,'finance'),conflict);assert.equal(f.segment.startReadingKm,null);assert.equal(f.bills.length,0);}
});

test('legacy bridge refuses a malformed prior month or first-segment boundary even with stale evidence available',async()=>{
 for(const mutate of [(f:any)=>f.previous.accountId='foreign',(f:any)=>f.previous.orderId='foreign',(f:any)=>f.previous.status='READY',(f:any)=>f.previous.endReadingKm=null,(f:any)=>f.previous.effectiveEndDate=new Date('2027-01-30'),(f:any)=>f.segment.startAt=new Date('2027-01-31T00:01:00+08:00')]){const f=await legacyReadingFixture();f.addStale();mutate(f);await assert.rejects(f.service.settle(f.current.id,command,'finance'),conflict);assert.equal(f.segment.startReadingKm,null);assert.equal(f.bills.length,0);}
});

test('ordinary segmented continuation retains its existing same-assignment FROZEN predecessor path',async()=>{
 const f=await legacyReadingFixture();f.current.serviceStageId=null;f.current.stageSequence=null;f.addStale();
 const result=await (segmentUsage as any)(f.tx,f.current,f.previous);assert.equal(result.used,5500);assert.equal(f.segment.startReadingKm,4500);
});

test('a verified zero legacy boundary remains zero rather than falling back to another odometer',async()=>{
 const f=await legacyReadingFixture();Object.assign(f.previous,{startReadingKm:0,endReadingKm:0,usedKm:0,baseUsedKm:0,excessKm:0,excessAmount:0});Object.assign(f.periods[0],{startReadingKm:0,endReadingKm:0});f.readings[0].readingKm=0;f.assignment.startReadingKm=0;
 const result=await f.service.settle(f.current.id,command,'finance');assert.equal(result.startReadingKm,0);assert.equal(result.usedKm,10000);assert.equal(result.excessAmount,1365000);
});

test('an actually FROZEN preceding segment uses the ordinary continuation without reinterpreting a legacy month',async()=>{
 const f=await legacyReadingFixture();f.addStale();f.segments.push({...f.segments[1],id:'previous-segment',periodId:f.previous.id,startAt:new Date('2026-12-31T00:00:00+08:00'),endAt:new Date('2027-01-31T00:00:00+08:00'),startReadingKm:4500,endReadingKm:7000});
 const before=frozen(f),result=await f.service.settle(f.current.id,command,'finance');assert.equal(result.usedKm,3000);assert.equal(result.startReadingKm,7000);assert.deepEqual(frozen(f),before);
});

function refreshFixture(){
 const periods:any[]=[{id:'old',orderId:'order',serviceStageId:null,status:'OPEN',revision:0},{id:'new',orderId:'order',serviceStageId:'stage-2',status:'OPEN',revision:0}],queries:any[]=[];
 const tx:any={usagePeriod:{findMany:async({where}:any)=>{queries.push(where);return periods.filter(p=>p.orderId===where.orderId&&!where.status.notIn.includes(p.status)&&(where.serviceStageId===undefined||p.serviceStageId===where.serviceStageId));},update:async({where,data}:any)=>{const p=periods.find(p=>p.id===where.id);Object.assign(p,{...data,revision:p.revision+data.revision.increment});return p;}},usageSegment:{findMany:async({where}:any)=>[{id:'segment-'+where.periodId,status:'READY',endReadingKm:where.periodId==='old'?7000:10000}]}};
 return{tx,periods,queries};
}
test('explicit stage refresh never aggregates or revises a prior stage, while omitted scope keeps legacy behavior',async()=>{
 const scoped=refreshFixture(),old=structuredClone(scoped.periods[0]);await (refreshSegmentPeriods as any)(scoped.tx,'order',{serviceStageId:'stage-2'});assert.deepEqual(scoped.periods[0],old);assert.equal(scoped.periods[1].status,'READY');
 const legacy=refreshFixture();await refreshSegmentPeriods(legacy.tx,'order');assert(legacy.periods.every(p=>p.status==='READY'&&p.revision===1));
});
test('an invalid explicit segment-refresh scope cannot silently become a whole-order refresh',async()=>{
 for(const scope of [null,{}, {serviceStageId:''},{serviceStageId:' stage-2'},{serviceStageId:'stage\0two'}]){const f=refreshFixture();await assert.rejects((refreshSegmentPeriods as any)(f.tx,'order',scope),conflict);assert.equal(f.queries.length,0);assert(f.periods.every(p=>p.status==='OPEN'));}
});
