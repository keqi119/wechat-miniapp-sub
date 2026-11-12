import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {canReadArchive} from '../src/offline-documents/projection';
import {readOfflineCancellationFacts} from '../src/offline-documents/cancellation';
const actor={id:'operator',role:'OPERATIONS'},businessHash='a'.repeat(64);
function fixture(kind='RENTAL'){
 const file={fileId:'signed-original',position:1},old:any={id:'old',archiveId:'a',version:1,status:'DRAFT',templateId:'template',templateVersion:2,sourceFileId:'printed-source',contractNumber:'CONTRACT-1',files:[file],scopeSnapshot:{vehicleId:'car'},businessSnapshotHash:businessHash};
 const a:any={id:'a',orderId:'o',kind,revision:5,versions:[old]},commands=new Map(),events:any[]=[];let createCount=0;
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({active:true,role:'OPERATIONS'})},documentArchive:{findUnique:async()=>a,update:async()=>{a.revision++;return a;}},archiveVersion:{update:async({where,data}:any)=>Object.assign(a.versions.find((v:any)=>v.id===where.id),data),create:async({data}:any)=>{createCount++;const v={id:'new',files:[],...data};a.versions.push(v);return v;}},archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where.actorId_resourceId_action_key)),create:async({data}:any)=>{const key={actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key};commands.set(JSON.stringify(key),data);return data;}},auditLog:{create:async({data}:any)=>{events.push(data);return data;}},legalDocument:{findUnique:async()=>({id:'template',version:2,type:'OFFLINE_'+kind,status:'PUBLISHED',confirmedBy:'legal',confirmedAt:new Date()})}};
 const context={resolve:async()=>({businessSnapshotHash:businessHash,scopeSnapshot:{vehicleId:'car'},partiesSnapshot:[],requiredSigners:['CUSTOMER','OWNER','PLATFORM']})};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,context as any);
 return{service,a,old,file,events,get createCount(){return createCount;}};
}
const code=(expected:string)=>(e:any)=>e.getResponse?.().error.code===expected;

test('uploaded signed files make draft print source immutable; signature metadata stays editable',async()=>{
 const f=fixture();await assert.rejects(f.service.prepare('a','old',{revision:5,idempotencyKey:'reprint-signed-draft'},actor),code('ARCHIVE_CORRECTION_REQUIRED'));
 await assert.rejects(f.service.patch('a','old',{revision:5,idempotencyKey:'change-signed-number',contractNumber:'NEW-NUMBER'},actor),code('ARCHIVE_CORRECTION_REQUIRED'));
 assert.equal(f.old.sourceFileId,'printed-source');assert.equal(f.old.contractNumber,'CONTRACT-1');assert.equal(f.old.files[0],f.file);
 await f.service.patch('a','old',{revision:5,idempotencyKey:'signing-metadata',signedOn:'2026-10-30',declaredPages:3},actor);assert.equal(f.old.signedOn,'2026-10-30');assert.equal(f.old.declaredPages,3);
});

test('explicit correction keeps old draft files and source, creates one new version, and replays idempotently',async()=>{
 const f=fixture(),input={revision:5,idempotencyKey:'explicit-draft-correction',templateId:'template',supersedeDraftVersionId:'old'};
 const result=await f.service.newVersion('a',input,actor);assert.equal(result.id,'new');assert.equal(f.createCount,1);assert.equal(f.old.status,'SUPERSEDED');assert.equal(f.old.sourceFileId,'printed-source');assert.equal(f.old.files[0],f.file);assert.equal(f.old.reviewedBy,undefined);assert.match(f.old.invalidationReason,/补正.*非审核结论/);
 const current=f.a.versions.find((v:any)=>v.id==='new');assert.equal(current.status,'DRAFT');assert.equal(current.version,2);assert.deepEqual(current.files,[]);assert.equal(current.sourceFileId,undefined);assert.equal(current.businessSnapshotHash,businessHash);assert.ok(f.events.some(e=>e.action==='SUPERSEDE_DRAFT'));
 assert.deepEqual(await f.service.newVersion('a',input,actor),result);assert.equal(f.createCount,1);
});

test('an unprinted empty draft can explicitly switch to the newly enabled template without deleting history',async()=>{
 const f=fixture();f.old.files=[];f.old.sourceFileId=null;
 const result=await f.service.newVersion('a',{revision:5,idempotencyKey:'switch-empty-template',templateId:'template',supersedeDraftVersionId:'old'},actor);
 assert.equal(result.version,2);assert.equal(f.old.status,'SUPERSEDED');assert.equal(f.old.reviewedBy,undefined);assert.equal(f.a.versions.find((v:any)=>v.id===result.id).status,'DRAFT');
});

test('superseded draft remains private and never proves a rental contract was signed',async()=>{
 const f=fixture();await f.service.newVersion('a',{revision:5,idempotencyKey:'private-correction',templateId:'template',supersedeDraftVersionId:'old'},actor);
 assert.equal(canReadArchive({id:'c1',role:'CUSTOMER'},{...f.a,customerId:'c1'},f.old),false);assert.equal(canReadArchive({id:'p1',role:'OWNER',ownerId:'owner'},{...f.a,ownerId:'owner'},f.old),false);
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},offlineCancellationReview:{findFirst:async()=>null},archiveVersion:{count:async({where}:any)=>where.status.in.includes(f.old.status)?1:0},documentArchive:{findFirst:async()=>null},archiveFeedback:{findMany:async()=>[]}};
 const facts=await readOfflineCancellationFacts(tx,{id:'o',finalPlanSnapshot:{commercialHash:businessHash}});assert.equal(facts.historical,false);
});

test('correction is explicit, exact latest draft, revision-bound, and cannot bypass another pending version',async()=>{
 for(const scenario of ['implicit','wrong-id','another-submitted','not-latest','stale']){
  const f=fixture();if(scenario==='another-submitted')f.a.versions.push({id:'pending',version:2,status:'SUBMITTED',files:[]});if(scenario==='not-latest')f.a.versions.push({id:'newer',version:2,status:'REJECTED',files:[]});
  const input:any={revision:scenario==='stale'?4:5,idempotencyKey:'invalid-'+scenario,templateId:'template'};if(scenario!=='implicit')input.supersedeDraftVersionId=scenario==='wrong-id'?'other':'old';
  await assert.rejects(f.service.newVersion('a',input,actor));assert.equal(f.old.status,'DRAFT');assert.equal(f.createCount,0);
 }
});
