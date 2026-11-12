import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerCooperationReady,contractReady} from '../src/offline-documents/readiness';
import {cooperationBusinessHash} from '../src/offline-documents/snapshot';
test('open cooperation feedback blocks its covered vehicle even if the archived hash is current',async()=>{
 const scope={vehicleIds:['vehicle'],validFrom:'2026-01-01',validUntil:'2030-12-31'};
 const tx:any={$queryRaw:async()=>[],vehicleOwner:{findUnique:async()=>({id:'owner',revision:1})},documentArchive:{findFirst:async()=>({id:'cooperation',currentApprovedVersionId:'v1',versions:[{id:'v1',status:'ARCHIVED',scopeSnapshot:scope,businessSnapshotHash:cooperationBusinessHash('owner',1,scope)}]})},archiveFeedback:{count:async({where}:any)=>{assert.equal(where.version.archive.ownerId,'owner');return 1;}}};
 const result=await ownerCooperationReady(tx,'owner','vehicle','2027-01-01','2027-12-31');assert.equal(result.ready,false);assert.ok(result.blockers.includes('OWNER_COOPERATION_FEEDBACK_OPEN'));
});
test('frozen cooperation feedback blocks pre-delivery payment and later settlement, not active lease payment',async()=>{
 let status='AWAITING_PAYMENT';const tx:any={$queryRaw:async()=>[],order:{findUnique:async()=>({id:'order',vehicleId:'vehicle',status,finalPlanSnapshot:{commercialHash:'hash',lessorSnapshot:{ownerId:'owner',cooperationVersionId:'c1'}}})},documentArchive:{findFirst:async()=>({id:'rental',currentApprovedVersionId:'r1',versions:[{id:'r1',status:'ARCHIVED',businessSnapshotHash:'hash'}]})},archiveFeedback:{count:async({where}:any)=>where.version.archive.ownerId==='owner'?1:0}};
 assert.equal((await contractReady(tx,'order','PAYMENT')).ready,false);status='ACTIVE';assert.equal((await contractReady(tx,'order','PAYMENT')).ready,true);assert.equal((await contractReady(tx,'order','SETTLEMENT')).ready,false);
});
