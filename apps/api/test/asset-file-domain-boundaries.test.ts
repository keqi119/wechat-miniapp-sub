import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {promises as fs} from 'node:fs';
import {projectRoot} from '../src/common/config';
import {evidenceFiles} from '../src/partners/types';
import {SimpleAgreementService,simpleAgreementInput,readSimpleAgreementFile,readSimpleAgreementSnapshot,requireFrozenSimpleAgreement} from '../src/partners/simple-agreements';
import {hash} from '../src/common/data';
import {FieldHandoverService} from '../src/field-handover/service';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {FieldArchiveService} from '../src/offline-documents/field';

const denied=(e:any)=>e.getStatus?.()===403&&e.getResponse?.().error?.code==='ASSET_FILE_ROUTE_REQUIRED';
const operator={id:'operator',role:'OPERATIONS',authVersion:1},fieldActor={id:'field',role:'FIELD',authVersion:1};
const file=(purpose:string,id='private')=>({id,adminId:'operator',customerId:null,name:'private-cost.pdf',purpose,mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:resolve(projectRoot,'var/uploads/synthetic-private-asset')});
const mapping=(ids=['private'])=>({count:async({where}:any)=>where.fileId.in.filter((id:string)=>ids.includes(id)).length});
function response(){let streamed=false;return{out:{set(){},setHeader(){},sendFile(){streamed=true;}},streamed:()=>streamed};}

test('partner proof acceptance rejects asset mappings even when purpose is forged to valid identity or evidence',async()=>{
 for(const purpose of ['identity','evidence']){const f=file(purpose),tx:any={electronicFileQuarantine:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:mapping(),storedFile:{count:async(query:any)=>query?.where?.purpose==='vehicle-inspection'?0:1,findMany:async()=>[f]}};await assert.rejects(evidenceFiles(tx,[f.id]),denied);tx.assetPrivateFile=mapping([]);assert.deepEqual(await evidenceFiles(tx,[f.id]),[f]);}
});
function simple(){
 const f=file('contract'),owner={id:'owner',status:'ACTIVE',cooperationMode:'SIMPLE'},agreement={id:'agreement',ownerId:'owner',revision:0,status:'ACTIVE',currentVersionId:'version'},version={id:'version',agreementId:'agreement',ownerId:'owner',version:1,status:'ACTIVE',title:'registered',contentHash:'hash',vehicleIds:['vehicle'],fileIds:[f.id],partnerRateBps:0,validFrom:null,validUntil:null};let writes=0,cached:any=null;
 const tx:any={$queryRaw:async()=>[],$executeRaw:async()=>0,electronicFileQuarantine:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:mapping(),adminUser:{findUnique:async()=>({...operator,active:true})},vehicleOwner:{findUnique:async()=>owner},vehicle:{findUnique:async()=>({id:'vehicle',model:'EV',title:'vehicle'})},partnerAgreementVehicle:{findUnique:async()=>({vehicleId:'vehicle',ownerId:'owner',agreementId:'agreement',agreementVersionId:'version'})},partnerAgreement:{findFirst:async()=>agreement,findUnique:async()=>agreement,findMany:async()=>[agreement],create:async()=>{writes++;throw Error('private file reached agreement creation');}},partnerAgreementVersion:{findUnique:async()=>version,findFirst:async()=>null,findMany:async()=>[version],count:async(query:any)=>query?.where?.purpose==='vehicle-inspection'?0:1},storedFile:{count:async(query:any)=>query?.where?.purpose==='vehicle-inspection'?0:1,findUnique:async()=>f,findMany:async()=>[f]},archiveCommand:{findUnique:async()=>cached,create:async()=>{writes++;}},auditLog:{create:async()=>{writes++;}}};
 return{tx,f,owner,agreement,version,writes:()=>writes,cache:(value:any)=>cached=value};
}
test('scoped simple agreement downloads and metadata cannot expose a mapped private asset',async()=>{
 const f=simple();await assert.rejects(readSimpleAgreementFile(f.tx,'owner','agreement','private'),denied);await assert.rejects(new SimpleAgreementService().agreements(f.tx,operator,'owner'),denied);assert.equal(f.writes(),0);
 f.tx.assetPrivateFile=mapping([]);assert.equal((await readSimpleAgreementFile(f.tx,'owner','agreement','private')).id,'private');assert.equal((await new SimpleAgreementService().agreements(f.tx,operator,'owner'))[0].files[0].id,'private');
});
test('simple agreement registration rejects private files before creating versions or command audit',async()=>{
 const f=simple();await assert.rejects(new SimpleAgreementService().save(f.tx,operator,'owner',{revision:0,idempotencyKey:'asset-register',status:'DRAFT',fileIds:['private'],vehicleIds:[]}),denied);assert.equal(f.writes(),0);
});
test('simple agreement idempotent replay rechecks private mappings before exposing cached attachment metadata',async()=>{
 const f=simple(),input={revision:0,idempotencyKey:'asset-replay',status:'DRAFT',fileIds:['private'],vehicleIds:[]};f.cache({requestHash:hash(simpleAgreementInput.parse(input)),resultSnapshot:{versions:[f.version],files:[f.f]}});await assert.rejects(new SimpleAgreementService().save(f.tx,operator,'owner',input),denied);assert.equal(f.writes(),0);
});
test('effective and frozen simple agreement scope reject private asset evidence rather than legitimizing it',async()=>{
 const f=simple(),lessor={version:4,mode:'SIMPLE_AGREEMENT',ownerId:'owner',agreementId:'agreement',agreementVersionId:'version',agreementHash:'hash',partnerRateBps:0},revenue={mode:'SIMPLE_AGREEMENT',ownerId:'owner',vehicleId:'vehicle',agreementId:'agreement',agreementVersionId:'version',versionId:'version',contentHash:'hash',partnerRateBps:0};
 await assert.rejects(readSimpleAgreementSnapshot(f.tx,'vehicle'),denied);await assert.rejects(requireFrozenSimpleAgreement(f.tx,'vehicle',lessor,revenue,{startDate:'2026-01-01',endDate:'2026-12-31'}),denied);
 f.tx.assetPrivateFile=mapping([]);assert.equal((await readSimpleAgreementSnapshot(f.tx,'vehicle'))?.agreementVersionId,'version');assert.equal((await requireFrozenSimpleAgreement(f.tx,'vehicle',lessor,revenue,{startDate:'2026-01-01',endDate:'2026-12-31'})).id,'version');
});
function field(){
 const f={...file('handover'),fieldTaskId:'task',fieldTaskGeneration:1},order={id:'order',customerId:'customer',vehicleId:'vehicle',currentAssignmentId:null,status:'AWAITING_HANDOVER',contractMode:'OFFLINE',confirmedMileageKm:0,vehicle:{title:'EV',mileageKm:0},customer:{name:'Customer'},finalPlanSnapshot:{}},task:any={id:'task',orderId:'order',assigneeId:'field',status:'ASSIGNED',version:1,materialGeneration:1,currentHandoverId:null,vehicleId:'vehicle',vehicleAssignmentId:null,type:'DELIVERY',order,draft:{actualAt:'2026-01-01T10:00:00+08:00',readingKm:10,batteryPercent:80,place:'site',accessories:'complete',condition:'normal',openItems:'none',resolutionPlan:'none',fileIds:[f.id]}};let writes=0;
 const tx:any={electronicFileQuarantine:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:mapping(),$queryRaw:async()=>[],adminUser:{findFirst:async()=>({...fieldActor,name:'Staff',active:true}),findUnique:async()=>({...fieldActor,name:'Staff',active:true})},fieldHandoverTask:{findFirst:async()=>task,findUnique:async()=>task,findMany:async()=>[task],findUniqueOrThrow:async()=>task,update:async()=>{writes++;return task;}},order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order},orderTermsVersion:{findMany:async()=>[]},orderChange:{findMany:async()=>[]},delayQuote:{findMany:async()=>[]},vehicleAssignment:{findMany:async()=>[]},vehicle:{findUniqueOrThrow:async()=>({id:'vehicle',title:'EV',mileageKm:0})},handover:{findUnique:async()=>null,findMany:async()=>[],count:async()=>0},storedFile:{findMany:async()=>[f],findFirst:async()=>f,count:async(query:any)=>query?.where?.purpose==='vehicle-inspection'?0:1},auditLog:{create:async()=>{writes++;}}};const service=new FieldHandoverService({serial:async(fn:any)=>fn(tx)} as any);
 return{tx,service,f,task,writes:()=>writes};
}
test('FIELD evidence read and metadata block private asset mapping despite matching task and material generation',async()=>{
 const f=field(),out=response();await assert.rejects(f.service.readFile('task','private','field',out.out),denied);await assert.rejects(f.service.detail('task','field'),denied);assert.equal(out.streamed(),false);assert.equal(f.writes(),0);
 f.tx.assetPrivateFile=mapping([]);assert.equal((await f.service.detail('task','field')).files[0].id,'private');await f.service.readFile('task','private','field',out.out);assert.equal(out.streamed(),true);
});
test('FIELD save and publish reject private evidence before draft or handover writes',async()=>{
 const f=field();await assert.rejects(f.service.save('task',{version:1,draft:f.task.draft},'field'),denied);await assert.rejects(f.service.publish('task',{version:1,idempotencyKey:'private-publish',checked:true},'field'),denied);assert.equal(f.writes(),0);
});
function archive(source=false){
 const f=file(source?'offline-source':'offline-archive'),v:any={id:'version',version:1,status:'ARCHIVED',sourceFileId:source?'private':null,files:source?[]:[{fileId:f.id,versionId:'version',position:1,file:f,uploadedBy:'operator'}],signedOn:'2026-01-01',contractNumber:'archive',declaredPages:1,businessSnapshotHash:'hash',scopeSnapshot:{}},a:any={id:'archive',kind:'RENTAL',orderId:'order',subjectType:'ORDER',subjectId:'order',revision:0,versions:[v]};let writes=0;
 const tx:any={$queryRaw:async()=>[],electronicFileQuarantine:{count:async()=>0},vehicleInspectionFile:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:mapping(),adminUser:{findUnique:async()=>({...operator,active:true})},documentArchive:{findUnique:async()=>a,update:async()=>{writes++;return a;}},archiveVersion:{update:async()=>{writes++;return v;}},storedFile:{count:async(query:any)=>query?.where?.purpose==='vehicle-inspection'?0:1,findUnique:async()=>f},order:{findUnique:async()=>({id:'order',customerId:'customer',finalPlanSnapshot:{commercialHash:'hash'}})},archiveCommand:{findUnique:async()=>null,findFirst:async()=>({id:'print'}),create:async()=>{writes++;}},auditLog:{create:async()=>{writes++;}}};
 const service=new ArchiveService(Object.assign(tx,{serial:async(fn:any)=>fn(tx)}) as any,{resolve:async()=>({businessSnapshotHash:'hash'})} as any);return{tx,service,f,v,a,writes:()=>writes};
}
test('customer/admin archive downloads reject asset mappings for both signed pages and source PDFs',async()=>{
 for(const source of [false,true]){const f=archive(source),out=response();await assert.rejects(f.service.readFile('archive','version','private',source?operator:{id:'customer',role:'CUSTOMER'},out.out),denied);assert.equal(out.streamed(),false);f.tx.assetPrivateFile=mapping([]);await f.service.readFile('archive','version','private',source?operator:{id:'customer',role:'CUSTOMER'},out.out);assert.equal(out.streamed(),true);}
});
test('archive metadata and print confirmation do not legitimize asset source files',async()=>{
 const f=archive(true);await assert.rejects(f.service.detail('archive',operator),denied);f.v.status='DRAFT';await assert.rejects(f.service.confirmPrint('archive','version',{revision:0,idempotencyKey:'asset-print'},operator),denied);assert.equal(f.writes(),0);
});
test('archive submit rejects private signed pages before reading file bytes or writing approvals',async t=>{
 const f=archive();f.v.status='DRAFT';f.v.sourceFileId='clean-source';let reads=0;t.mock.method(fs,'readFile',async()=>{reads++;throw Error('private bytes must not be read');});await assert.rejects(f.service.submit('archive',{revision:0,versionId:'version',idempotencyKey:'asset-submit'},operator),denied);assert.equal(reads,0);assert.equal(f.writes(),0);
});
function fieldArchive(source=false){
 const f=archive(source);f.a.kind='DELIVERY_RECEIPT';f.a.handoverId='handover';f.v.status='DRAFT';const task={id:'task',orderId:'order',assigneeId:'field',status:'ASSIGNED',version:1,materialGeneration:1,currentHandoverId:'handover',vehicleId:'vehicle',vehicleAssignmentId:null,type:'DELIVERY'};
 f.tx.adminUser.findUnique=async()=>({...fieldActor,active:true});f.tx.fieldHandoverTask={findUnique:async()=>task};f.tx.handover={findUnique:async()=>({id:'handover',fieldTaskId:'task',vehicleId:'vehicle',assignmentId:null,type:'DELIVERY',manifestHash:'hash'})};f.tx.archiveFile={findUnique:async()=>({fileId:'private',versionId:'version',version:{archiveId:'archive'},file:f.f})};
 return{...f,service:new FieldArchiveService({serial:async(fn:any)=>fn(f.tx)} as any)};
}
test('FIELD paper route rejects private signed pages with an otherwise valid current task binding',async()=>{
 const f=fieldArchive();await assert.rejects(f.service.file('task','private',fieldActor),denied);f.tx.assetPrivateFile=mapping([]);assert.equal((await f.service.file('task','private',fieldActor)).id,'private');
});
test('FIELD paper submission rejects a private generated source before bytes, metadata or commands',async t=>{
 const f=fieldArchive(true);let reads=0;t.mock.method(fs,'readFile',async()=>{reads++;throw Error('must not read bytes');});await assert.rejects(f.service.submit('task',{taskVersion:1,archiveId:'archive',versionId:'version',revision:0,idempotencyKey:'field-source',signedOn:'2026-01-01',contractNumber:'archive',declaredPages:1},fieldActor),denied);assert.equal(reads,0);assert.equal(f.writes(),0);
});
