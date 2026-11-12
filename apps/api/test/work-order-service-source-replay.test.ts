import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkOrdersService} from '../src/asset-work-orders/service';
import {createWorkOrderInput} from '../src/asset-work-orders/types';
import {archiveCommand} from '../src/offline-documents/command';
import {hash} from '../src/common/data';
import {workOrderFixture,woActor,woError,woInput,woNow} from './work-orders-fixture';

// Preserve the exact parsed field order used before source revision/hash existed.
// ArchiveCommand hashes JSON.stringify(input), not a newly canonicalized object.
const legacyFields=['revision','idempotencyKey','vehicleId','vehicleRevision','kind','occurredAt','sourceServiceRequestId','relatedWorkOrderId','title','description','priority','costConfirmationRequired','noCostReason','accident'];
function oldBody(){return woInput({idempotencyKey:'legacy-source-success-key',sourceServiceRequestId:'old-service'});}
async function historicalSuccess(){
 const f=workOrderFixture(),body=oldBody(),parsed=Object.fromEntries(legacyFields.map(key=>[key,body[key]]));
 const result={id:'historical-work-order',revision:0,status:'PENDING',vehicleId:'vehicle',sourceServiceRequestId:'old-service',title:body.title,sourceServiceSnapshot:{serviceRequestId:'old-service',assignmentId:'historical-assignment'}};
 await archiveCommand(f.tx,woActor,'work-order:asset-work-orders:create','CREATE',parsed,async()=>result);
 return{...f,body,parsed,result,service:new WorkOrdersService(()=>woNow)};
}

test('pre-proof successful ArchiveCommand replays its exact stored result and digest without rereading current source or writing',async()=>{
 const f=await historicalSuccess(),command=structuredClone(f.rows('archiveCommand')[0]),writes=f.writes.length;
 // The old source and physical assignment no longer exist; replay is historical.
 f.rows('vehicle')[0].revision=99;
 const result=await f.serial(tx=>f.service.create(tx,woActor,f.body));
 assert.deepEqual(result,f.result);assert.equal(f.writes.length,writes);
 assert.equal(command.requestHash,hash(f.parsed));assert.deepEqual(f.rows('archiveCommand')[0],command);
 assert.equal(f.reads.some(read=>['serviceRequest','vehicle','vehicleAssignment','assetWorkOrder'].includes(read.table)),false);
 assert.equal(f.rows('archiveCommand').length,1);assert.equal(f.rows('auditLog').length,0);
});

test('first-time old source body is still rejected before any physical/source read or command write',async()=>{
 const f=await historicalSuccess(),writes=f.writes.length;
 await assert.rejects(f.serial(tx=>f.service.create(tx,woActor,{...f.body,idempotencyKey:'new-key-without-proof'})),(e:any)=>e.name==='ZodError');
 assert.equal(f.writes.length,writes);assert.equal(f.rows('assetWorkOrder').length,0);
 assert.equal(f.reads.some(read=>['serviceRequest','vehicle','vehicleAssignment'].includes(read.table)),false);
 assert.equal(createWorkOrderInput.safeParse(f.body).success,false);
});

test('changing an old successful body or adding proof under its key remains an idempotency conflict',async()=>{
 const f=await historicalSuccess(),writes=f.writes.length;
 for(const changed of [{title:'different title'},{sourceServiceRequestRevision:0,sourceServiceRequestHash:'a'.repeat(64)}]){
  await assert.rejects(f.serial(tx=>f.service.create(tx,woActor,{...f.body,...changed})),woError('IDEMPOTENCY_CONFLICT'));
 }
 assert.equal(f.writes.length,writes);assert.equal(f.rows('archiveCommand')[0].requestHash,hash(f.parsed));
});

test('historical source replay still checks current staff and source/work-order permissions before ArchiveCommand lookup',async()=>{
 for(const state of ['inactive','session','finance']as const){
  const f=await historicalSuccess(),user=f.rows('adminUser')[0];let actor={...woActor};
  if(state==='inactive')user.active=false;
  if(state==='session')user.authVersion++;
  if(state==='finance'){user.role='FINANCE';actor.role='FINANCE';}
  const reads=f.reads.length,writes=f.writes.length;
  await assert.rejects(f.serial(tx=>f.service.create(tx,actor,f.body)),woError(state==='finance'?'FORBIDDEN':'STAFF_SESSION_CHANGED'));
  assert.equal(f.reads.slice(reads).some(read=>read.table==='archiveCommand'),false);
  assert.equal(f.writes.length,writes);
 }
});
