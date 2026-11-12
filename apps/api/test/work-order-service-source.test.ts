import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ServiceSourceOptionsService,serviceSourceListInput,readServiceSource} from '../src/asset-work-orders/service-source-options';
import {WorkOrdersService} from '../src/asset-work-orders/service';
import {workOrderFixture,seedWorkOrderSwap,woActor,woFinance,woError,woInput,woNow} from './work-orders-fixture';
const at='2026-10-30T10:00:00+08:00',query={vehicleId:'vehicle',eventAt:at};
function fixture(){const f=workOrderFixture();seedWorkOrderSwap(f);Object.assign(f.rows('serviceRequest')[0],{revision:4,type:'accident',status:'SUBMITTED',description:'真实来源描述',location:'实际地点',createdAt:woNow,mobile:'private-mobile',fileIds:['private-file']});return f;}
test('source options are readonly, filter true swap assignment before pagination and expose only approved fields',async()=>{
 const f=fixture(),s=new ServiceSourceOptionsService();for(let i=0;i<26;i++)f.seed('serviceRequest',{...f.rows('serviceRequest')[0],id:'source-'+String(i).padStart(2,'0'),description:'分页来源'});
 f.seed('serviceRequest',{...f.rows('serviceRequest')[0],id:'cancelled',status:'CANCELLED'});f.seed('serviceRequest',{...f.rows('serviceRequest')[0],id:'wrong-person',customerId:'other'});
 const result=await s.list(f.tx,woActor,{...query,page:2,pageSize:12});assert.equal(result.total,27);assert.equal(result.items.length,12);assert.deepEqual(Object.keys(result.items[0]).sort(),['id','revision','type','status','description','createdAt','orderId'].sort());
 const detail=await s.detail(f.tx,woActor,'swap-source',query);assert.equal(detail.assignment.assignmentId,'incoming');assert.equal(detail.assignment.eventAt,new Date(at).toISOString());assert.match(detail.sourceHash,/^[a-f0-9]{64}$/);assert.equal(detail.location,'实际地点');assert.equal(JSON.stringify(detail).includes('private'),false);
 const old=await s.list(f.tx,woActor,{vehicleId:'other',eventAt:'2026-09-15T00:00:00Z'});assert.equal(old.total,27);assert.equal((await s.list(f.tx,woActor,{vehicleId:'other',eventAt:'2026-10-01T00:00:00Z'})).total,0);assert.equal(f.writes.length,0);assert.equal(f.locks.length,0);
});
test('source list uses exact current role, strict date/offset and does not swallow infrastructure errors',async()=>{
 const f=fixture(),s=new ServiceSourceOptionsService();for(const actor of [woFinance,{id:'support',role:'SUPPORT',authVersion:1},{id:'field',role:'FIELD',authVersion:1}])await assert.rejects(s.list(f.tx,actor,query),woError('FORBIDDEN'));
 f.rows('adminUser')[0].authVersion++;await assert.rejects(s.list(f.tx,woActor,query),woError('STAFF_SESSION_CHANGED'));f.rows('adminUser')[0].authVersion--;
 for(const q of [{...query,eventAt:'2026-02-30T10:00:00Z'},{...query,eventAt:'2026-10-30T10:00'},{...query,keyword:'a\0'},{...query,page:100000,pageSize:100},{...query,status:'SUBMITTED'}])assert.equal(serviceSourceListInput.safeParse(q).success,false);
 f.tx.handover.findUnique=async()=>{throw Error('synthetic database down');};await assert.rejects(s.list(f.tx,woActor,query),/synthetic database down/);
});
test('source detail rejects cancellation, wrong vehicle and incomplete facts and hashes mutable public facts',async()=>{
 const f=fixture(),s=new ServiceSourceOptionsService(),first=await s.detail(f.tx,woActor,'swap-source',query);f.rows('serviceRequest')[0].description='更新但旧版本不增';const changed=await s.detail(f.tx,woActor,'swap-source',query);assert.equal(changed.revision,first.revision);assert.notEqual(changed.sourceHash,first.sourceHash);
 await assert.rejects(s.detail(f.tx,woActor,'swap-source',{...query,vehicleId:'other'}),woError('SERVICE_SOURCE_UNVERIFIED'));f.rows('serviceRequest')[0].status='CANCELLED';await assert.rejects(s.detail(f.tx,woActor,'swap-source',query),woError('SERVICE_SOURCE_UNAVAILABLE'));
});
test('create pins selected source revision/hash, rejects changed/cancelled facts and replays old success before source revalidation',async()=>{
 const f=fixture(),source=await readServiceSource(f.tx,'swap-source','vehicle',new Date(at)),s=new WorkOrdersService(()=>woNow),body=woInput({sourceServiceRequestId:'swap-source',sourceServiceRequestRevision:source.row.revision,sourceServiceRequestHash:source.sourceHash});
 const row=await f.serial(tx=>s.create(tx,woActor,body));assert.equal(row.sourceServiceRequestId,'swap-source');assert.equal(f.rows('assetWorkOrder')[0].sourceServiceSnapshot.sourceRevision,4);assert.equal(f.rows('assetWorkOrder')[0].sourceServiceSnapshot.sourceHash,source.sourceHash);
 assert(f.locks.some(line=>line.includes('ServiceRequest')));const count=f.writes.length;f.rows('serviceRequest')[0].status='CANCELLED';assert.deepEqual(await f.serial(tx=>s.create(tx,woActor,body)),row);assert.equal(f.writes.length,count);
 await assert.rejects(f.serial(tx=>s.create(tx,woActor,{...body,idempotencyKey:'cancelled-source-new-key'})),woError('SERVICE_SOURCE_UNAVAILABLE'));f.rows('serviceRequest')[0].status='SUBMITTED';f.rows('serviceRequest')[0].description='same revision changed description';await assert.rejects(f.serial(tx=>s.create(tx,woActor,{...body,idempotencyKey:'changed-source-new-key'})),woError('SERVICE_SOURCE_CHANGED'));
 f.rows('adminUser')[0].authVersion++;await assert.rejects(f.serial(tx=>s.create(tx,woActor,body)),woError('STAFF_SESSION_CHANGED'));
});
