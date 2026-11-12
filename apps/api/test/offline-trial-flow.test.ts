import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {validateManifest} from '../src/offline-documents/files';
import {readinessFromArchive} from '../src/offline-documents/readiness';
import {workspaceProjection} from '../src/offline-documents/workspace.service';
import {workspaceTimeline} from '../src/offline-documents/workspace-facts';

const actor={id:'operator',role:'ADMIN'};
const checks={partiesComplete:true,authorityChecked:true,pagesComplete:true,vehicleMatches:true,termsMatch:true,annexesComplete:true,legible:true};
const code=(value:string)=>(error:any)=>error.getResponse?.().error.code===value;
function setup(status='SUBMITTED'){
 const file={id:'signed',size:5,mimeType:'application/pdf',sha256:'a'.repeat(64),purpose:'offline-archive'};
 const files=[{versionId:'v1',position:1,uploadedBy:'operator',fileId:file.id,file}];
 const parties=['CUSTOMER','OWNER','PLATFORM'].map(role=>({role,partyId:role,name:role}));
 const v:any={id:'v1',archiveId:'archive',version:1,status,templateId:'template',templateVersion:1,businessSnapshotHash:'current-hash',fileManifestHash:validateManifest(files),sourceFileId:status==='DRAFT'?'source':null,declaredPages:1,signedOn:'2026-10-30',contractNumber:'TEST-1',submittedBy:'operator',requiredSigners:parties.map(p=>p.role),partiesSnapshot:parties,files,feedback:[]};
 const a:any={id:'archive',kind:'RENTAL',orderId:'order',subjectType:'ORDER',subjectId:'order',revision:3,versions:[v],currentApprovedVersionId:null};
 const commands:any[]=[];let hash='current-hash',stage='AWAITING_CONTRACT_REVIEW';
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'operator',active:true,role:'ADMIN'})},documentArchive:{findUnique:async()=>a,update:async({data}:any)=>{if(data.currentApprovedVersionId)a.currentApprovedVersionId=data.currentApprovedVersionId;if(data.revision)a.revision++;return a;}},archiveVersion:{update:async({data}:any)=>Object.assign(v,data)},archiveCommand:{findUnique:async({where}:any)=>commands.find(c=>Object.entries(where.actorId_resourceId_action_key).every(([k,val])=>c[k]===val)),findFirst:async({where}:any)=>commands.find(c=>c.resourceId===where.resourceId&&c.action===where.action&&c.resultSnapshot.sourceFileId===where.resultSnapshot.equals),create:async({data}:any)=>{commands.push(data);return data;}},order:{updateMany:async({data}:any)=>{stage=data.status;return{count:1};}},auditLog:{create:async()=>({})}};
 const service=new ArchiveService({serial:async(fn:any)=>fn(tx)} as any,{resolve:async()=>({businessSnapshotHash:hash})} as any);
 const review:any={versionId:v.id,revision:a.revision,idempotencyKey:'review-version-one',decision:'APPROVE',checklist:checks,partyChecks:parties.map(p=>({role:p.role,partyId:p.partyId,signerName:'签署人',signedOn:'2026-10-30',signaturePageRefs:[{fileId:file.id,page:1}],passed:true})),reason:'已核对签署材料'};
 return {service,a,v,tx,commands,review,setHash:(value:string)=>{hash=value;},stage:()=>stage};
}
test('administrator reviews their submitted historical version without custody fields; explicit archive alone opens payment',async()=>{
 const f=setup();const reviewed=await f.service.review(f.a.id,f.review,actor);
 assert.equal(reviewed.status,'REVIEWED');assert.equal(f.stage(),'AWAITING_CONTRACT_REVIEW');assert.equal(readinessFromArchive(f.a,'current-hash').ready,false);
 const input={versionId:f.v.id,revision:f.a.revision,idempotencyKey:'archive-version-one'};
 const archived=await (f.service as any).archive(f.a.id,input,actor);
 assert.equal(archived.status,'ARCHIVED');assert.equal(f.stage(),'AWAITING_PAYMENT');assert.equal(readinessFromArchive(f.a,'current-hash').ready,true);
 assert.deepEqual(await (f.service as any).archive(f.a.id,input,actor),archived);
});
test('archive cannot skip review and rejects changed terms after review',async()=>{
 const f=setup();await assert.rejects((f.service as any).archive(f.a.id,{versionId:f.v.id,revision:f.a.revision,idempotencyKey:'skip-review'},actor),code('STATE_CONFLICT'));
 await f.service.review(f.a.id,f.review,actor);f.setHash('changed');
 await assert.rejects((f.service as any).archive(f.a.id,{versionId:f.v.id,revision:f.a.revision,idempotencyKey:'stale-archive'},actor),code('ARCHIVE_SNAPSHOT_MISMATCH'));
 assert.equal(f.a.currentApprovedVersionId,null);assert.equal(f.stage(),'AWAITING_CONTRACT_REVIEW');
});
test('new draft upload and submit require confirmation of the current generated PDF',async()=>{
 const f=setup('DRAFT');const upload={buffer:Buffer.from('%PDF-test'),mimetype:'application/pdf',originalname:'signed.pdf'} as any;
 await assert.rejects(f.service.upload(f.a.id,f.v.id,{position:2,revision:3,idempotencyKey:'unconfirmed-upload'},upload,actor),code('ARCHIVE_PRINT_CONFIRMATION_REQUIRED'));
 await assert.rejects(f.service.submit(f.a.id,{versionId:f.v.id,revision:3,idempotencyKey:'unconfirmed-submit'},actor),code('ARCHIVE_PRINT_CONFIRMATION_REQUIRED'));
 await (f.service as any).confirmPrint(f.a.id,f.v.id,{revision:3,idempotencyKey:'confirm-current-pdf'},actor);
 assert.equal(f.commands[0].resultSnapshot.sourceFileId,'source');
 f.v.sourceFileId='replacement-source';
 await assert.rejects(f.service.submit(f.a.id,{versionId:f.v.id,revision:f.a.revision,idempotencyKey:'changed-source-submit'},actor),code('ARCHIVE_PRINT_CONFIRMATION_REQUIRED'));
});
test('changing an unsigned generated contract number invalidates its PDF and print confirmation',async()=>{
 const f=setup('DRAFT');f.v.files=[];await (f.service as any).confirmPrint(f.a.id,f.v.id,{revision:3,idempotencyKey:'confirm-before-edit'},actor);
 await f.service.patch(f.a.id,f.v.id,{revision:f.a.revision,idempotencyKey:'change-contract-number',contractNumber:'TEST-2'},actor);
 assert.equal(f.v.sourceFileId,null);
 await assert.rejects((f.service as any).confirmPrint(f.a.id,f.v.id,{revision:f.a.revision,idempotencyKey:'confirm-missing-source'},actor),code('ARCHIVE_SOURCE_REQUIRED'));
});

test('changing a generated contract number after signed upload requires correction and preserves the original source and file',async()=>{
 const f=setup('DRAFT');await f.service.confirmPrint(f.a.id,f.v.id,{revision:3,idempotencyKey:'confirm-before-uploaded-edit'},actor);
 const before=structuredClone(f.v),revision=f.a.revision,commands=f.commands.length;
 await assert.rejects(f.service.patch(f.a.id,f.v.id,{revision,idempotencyKey:'edit-signed-contract-number',contractNumber:'TEST-2'},actor),code('ARCHIVE_CORRECTION_REQUIRED'));
 assert.deepEqual(f.v,before);assert.equal(f.a.revision,revision);assert.equal(f.commands.length,commands);
});
test('reviewed contract remains unavailable to customer payments and suggests archiving to operations',()=>{
 const f=setup('REVIEWED'),order={id:'order',customerId:'customer',status:'AWAITING_CONTRACT_REVIEW',finalPlanSnapshot:{commercialHash:'current-hash'},bills:[{id:'bill',status:'PENDING',amount:100,paidAmount:0}],handovers:[]};
 assert.equal(workspaceProjection(order,[f.a],actor).nextAction.code,'ARCHIVE_OFFLINE_DOCUMENT');
 assert.equal(workspaceProjection(order,[f.a],{id:'customer',role:'CUSTOMER'}).capabilities.canPay,false);
});
test('bound retired templates remain printable but cannot be selected for a new archive',async()=>{
 const f=setup('DRAFT');f.tx.legalDocument={findUnique:async()=>({id:'template',type:'OFFLINE_RENTAL',version:1,status:'RETIRED',confirmedBy:'operator',confirmedAt:new Date()})};
 assert.equal((await (f.service as any).template(f.tx,'template','RENTAL',1)).version,1);
 await assert.rejects((f.service as any).template(f.tx,'template','RENTAL'),code('LEGAL_NOT_APPROVED'));
 await assert.rejects((f.service as any).template(f.tx,'template','RENTAL',2),code('LEGAL_NOT_APPROVED'));
});
test('reviewed versions are immutable and an older reviewed version cannot archive past a correction',async()=>{
 const f=setup('REVIEWED');
 await assert.rejects(f.service.patch(f.a.id,f.v.id,{revision:3,idempotencyKey:'edit-reviewed-version',declaredPages:2},actor),code('ARCHIVE_IMMUTABLE'));
 f.a.versions.push({id:'v2',version:2,status:'DRAFT'});
 await assert.rejects(f.service.archive(f.a.id,{versionId:f.v.id,revision:3,idempotencyKey:'archive-old-reviewed'},actor),code('ARCHIVE_VERSION_SUPERSEDED'));
});
test('timeline separates approval and actual archive time; legacy combined action stays historical',()=>{
 const archives=[{id:'a',kind:'RENTAL',versions:[{id:'v',version:1,status:'ARCHIVED',reviewedAt:'2026-10-29T10:00:00Z',archivedAt:'2026-10-30T10:00:00Z'},{id:'old',version:0,status:'INVALIDATED',reviewedAt:'2026-10-28T10:00:00Z'}]}];
 const events=workspaceTimeline({id:'order'},archives,'OPERATIONS');
 assert.equal(events.find(e=>e.id==='review:v')?.at,'2026-10-29T10:00:00.000Z');
 assert.equal(events.find(e=>e.id==='archive:v')?.at,'2026-10-30T10:00:00.000Z');
 assert.match(events.find(e=>e.id==='archive:old')?.label||'',/历史审核归档/);
});
