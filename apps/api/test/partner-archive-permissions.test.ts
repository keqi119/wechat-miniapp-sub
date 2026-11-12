import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {promises as fs} from 'node:fs';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {ArchiveController} from '../src/offline-documents/archive.controller';
import {FilesController} from '../src/files/files';
import {projectRoot} from '../src/common/config';
import {Db} from '../src/common/db';
import {randomUUID} from 'node:crypto';
const code=(name:string)=>(error:any)=>error.getResponse?.().error?.code===name;
const actor=(role='OPERATIONS')=>({id:'actor',role,authVersion:1});
const checklist={partiesComplete:false,authorityChecked:false,pagesComplete:false,vehicleMatches:false,termsMatch:false,annexesComplete:false,legible:false,originalRecorded:false};
const review={revision:0,idempotencyKey:'archive-review',versionId:'version',decision:'REJECT',reason:'材料待补充',checklist,partyChecks:[]};
function fixture(capabilities:string[],role='OPERATIONS',kind='OWNER_COOPERATION'){
 const staff=[{id:'actor',role,active:true,authVersion:1,staffPersonId:'person-actor',partnerCapabilities:capabilities},...['maker','submitter','uploader','editor'].map(id=>({id,staffPersonId:`person-${id}`}))];
 const file={id:'scan',name:'synthetic.pdf',purpose:'offline-archive',adminId:'uploader',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:resolve(projectRoot,'var/uploads/synthetic')};
 const version:any={id:'version',archiveId:'archive',version:1,status:'SUBMITTED',createdBy:'maker',editorIds:['maker','editor'],submittedBy:'submitter',files:[{versionId:'version',fileId:'scan',position:1,uploadedBy:'uploader',uploadedRole:'OPERATIONS',file}],feedback:[],scopeSnapshot:{},businessSnapshotHash:'hash'};
 const archive:any={id:'archive',kind,subjectType:kind==='OWNER_COOPERATION'?'OWNER':'ORDER',ownerId:'owner',orderId:kind==='OWNER_COOPERATION'?null:'order',createdBy:'maker',revision:0,versions:[version]};
 const audits:any[]=[],commands=new Map<string,any>(),feedback:any[]=[];
 const tx:any={
  vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findUnique:async()=>null,count:async()=>0},
  $queryRaw:async()=>[],adminUser:{findUnique:async({where}:any)=>staff.find(s=>s.id===where.id),findMany:async({where}:any)=>staff.filter(s=>where.id.in.includes(s.id))},
  documentArchive:{findUnique:async()=>structuredClone(archive),findMany:async()=>[archive],count:async()=>1,update:async({data}:any)=>{Object.assign(archive,{...data,revision:archive.revision+(data.revision?.increment||0)});return archive;}},
  archiveVersion:{update:async({data}:any)=>{Object.assign(version,data);return version;},create:async({data}:any)=>({id:'new-version',...data})},
  archiveCommand:{findUnique:async({where}:any)=>commands.get(JSON.stringify(where)),create:async({data}:any)=>{commands.set(JSON.stringify({actorId_resourceId_action_key:{actorId:data.actorId,resourceId:data.resourceId,action:data.action,key:data.key}}),data);return data;}},
  auditLog:{findMany:async()=>audits,create:async({data}:any)=>{audits.push(data);return data;}},
  archiveFeedback:{create:async({data}:any)=>{const row={id:'feedback',status:'OPEN',...data};feedback.push(row);return row;},findFirst:async()=>feedback[0],update:async({data}:any)=>Object.assign(feedback[0],data)},
  legalDocument:{findUnique:async()=>({id:'template',type:`OFFLINE_${kind}`,status:'PUBLISHED',version:1,confirmedBy:'legal',confirmedAt:new Date(),content:'{}'})},
  vehicleOwner:{findUnique:async()=>({id:'owner',revision:0})},
  storedFile:{findUnique:async()=>file,create:async({data}:any)=>({id:'new-file',...data})},archiveFile:{create:async()=>({})},
  order:{findUnique:async()=>({id:'order',customerId:'customer',finalPlanSnapshot:{commercialHash:'hash'}})},
 };
 const db:any={...tx,serial:async(fn:any)=>fn(tx)},context:any={resolve:async()=>({businessSnapshotHash:'hash',requiredSigners:['OWNER','PLATFORM'],partiesSnapshot:[],scopeSnapshot:{},ownerId:'owner'})};
 return{service:new ArchiveService(db,context),tx,db,staff,archive,version,audits,feedback,file};
}
test('cooperation archive raw detail and draft files require exact read for delegated staff; ADMIN has ordinary read',async()=>{
 for(const role of ['ADMIN','OPERATIONS','FINANCE','SUPPORT']){
  const f=fixture(['partner.cooperation.read'],role);f.version.status='DRAFT';
  const detail=await f.service.detail('archive',actor(role));assert.equal(detail.versions[0].businessSnapshotHash,'hash');assert.equal(detail.versions[0].files[0].uploadedBy,'uploader');
  let streamed=false;await f.service.readFile('archive','version','scan',actor(role),{set(){},sendFile(){streamed=true;}});assert.equal(streamed,true);
  f.staff[0].partnerCapabilities=[];
  if(role==='ADMIN')assert.ok(await f.service.detail('archive',actor(role)));else await assert.rejects(f.service.detail('archive',actor(role)),code('FORBIDDEN'));
 }
});
test('cooperation write grants work for FINANCE and SUPPORT without customer archive expansion',async()=>{
 for(const role of ['FINANCE','SUPPORT']){
  const f=fixture(['partner.cooperation.write'],role);f.version.status='DRAFT';
  const result=await f.service.patch('archive','version',{revision:0,idempotencyKey:'metadata-update',declaredPages:2},actor(role));assert.equal(result.revision,1);assert.ok(f.version.editorIds.includes('actor'));
  const other=fixture(['partner.cooperation.write','partner.cooperation.read','partner.cooperation.review'],role,'RENTAL');
  await assert.rejects(other.service.detail('archive',actor(role)),code('FORBIDDEN'));
  await assert.rejects(other.service.patch('archive','version',{revision:0,idempotencyKey:'customer-update',declaredPages:2},actor(role)),code('FORBIDDEN'));
 }
});
test('cooperation list is filtered by current capability and never by fixed FINANCE role',async()=>{
 for(const role of ['FINANCE','SUPPORT']){
  const f=fixture(['partner.cooperation.read'],role);let where:any;
  f.db.documentArchive.findMany=async(args:any)=>{where=args.where;return[f.archive];};
  assert.equal((await f.service.list({kind:'OWNER_COOPERATION',status:'SUBMITTED'},actor(role))).total,1);
  assert.equal(where.kind,'OWNER_COOPERATION');
  await assert.rejects(f.service.list({kind:'RENTAL'},actor(role)),code('FORBIDDEN'));
 }
 const f=fixture([],'ADMIN');assert.equal((await f.service.list({kind:'OWNER_COOPERATION'},actor('ADMIN'))).total,1);
});
test('only ADMIN may self review ordinary cooperation originals; delegated staff remain independent',async()=>{
 const f=fixture(['partner.cooperation.write'],'SUPPORT');f.version.submittedBy='actor';f.version.files[0].uploadedBy='actor';
 await assert.rejects(f.service.review('archive',review,actor('SUPPORT')),code('ARCHIVE_SELF_REVIEW'));
 const admin=fixture([],'ADMIN');admin.version.submittedBy='actor';admin.version.files[0].uploadedBy='actor';assert.equal((await admin.service.review('archive',review,actor('ADMIN'))).status,'REJECTED');assert.equal(admin.version.reviewedBy,'actor');assert.ok(admin.audits.some(a=>a.action==='REVIEW'));
 const ops=fixture(['partner.cooperation.write']);ops.version.submittedBy='actor';await assert.rejects(ops.service.review('archive',review,actor()),code('ARCHIVE_SELF_REVIEW'));
 const readOnly=fixture(['partner.cooperation.review']);await assert.rejects(readOnly.service.review('archive',review,actor()),code('FORBIDDEN'));
});
test('legacy cooperation batch keeps independent provenance without imposing it on archive review',async()=>{
 const unknown=fixture(['partner.cooperation.review']);unknown.version.createdBy=null;unknown.version.editorIds=[];
 await assert.rejects(unknown.service.independentReview(unknown.tx,unknown.archive,unknown.version,actor()),code('STAFF_PERSON_UNVERIFIED'));
 const known=fixture(['partner.cooperation.review']);known.version.createdBy=null;known.version.editorIds=[];
 known.audits.push({actorId:'maker',action:'CREATE',data:{versionId:'version'}});
 await known.service.independentReview(known.tx,known.archive,known.version,actor());
 const edited=fixture(['partner.cooperation.review']);edited.version.editorIds.push('actor');
 await assert.rejects(edited.service.independentReview(edited.tx,edited.archive,edited.version,actor()),code('ARCHIVE_SELF_REVIEW'));
});
test('every cooperation archive command rejects missing exact capability before mutation',async()=>{
 const input={revision:0,idempotencyKey:'ungranted-command',versionId:'version'};
 const calls=[(f:any)=>f.service.newVersion('archive',{revision:0,idempotencyKey:input.idempotencyKey,templateId:'template'},actor()),(f:any)=>f.service.patch('archive','version',{revision:0,idempotencyKey:input.idempotencyKey,declaredPages:1},actor()),(f:any)=>f.service.prepare('archive','version',{revision:0,idempotencyKey:input.idempotencyKey},actor()),(f:any)=>f.service.upload('archive','version',{position:2,revision:0,idempotencyKey:input.idempotencyKey},{buffer:Buffer.from('%PDF-synthetic'),mimetype:'application/pdf',originalname:'scan.pdf'},actor()),(f:any)=>f.service.submit('archive',input,actor()),(f:any)=>f.service.invalidate('archive',{...input,reason:'合成作废'},actor()),(f:any)=>f.service.review('archive',review,actor()),(f:any)=>f.service.resolveFeedback('archive','feedback',{revision:0,idempotencyKey:input.idempotencyKey,resolution:'合成处理'},actor()),(f:any)=>f.service.create({kind:'OWNER_COOPERATION',subjectType:'OWNER',subjectId:'owner',templateId:'template',revision:0,idempotencyKey:input.idempotencyKey},actor())];
 for(const call of calls){const f=fixture([]);await assert.rejects(call(f),code('FORBIDDEN'));assert.equal(f.audits.length,0);}
});
test('internal archive feedback is strict, versioned, replayable and records the real staff source',async()=>{
 const f=fixture(['partner.cooperation.write'],'SUPPORT');f.version.status='ARCHIVED';f.archive.currentApprovedVersionId='version';
 const controller=new ArchiveController(f.service),input={revision:0,idempotencyKey:'internal-feedback',versionId:'version',message:'电话反馈纸质附件缺页',source:'PHONE'};
 const result=await (controller as any).feedbackAdmin('archive',input,{admin:actor('SUPPORT')});
 assert.equal(result.status,'OPEN');assert.equal(f.feedback[0].actorType,'ADMIN');assert.equal(f.feedback[0].actorId,'actor');assert.equal(f.feedback[0].recordedBy,'actor');assert.equal(f.feedback[0].source,'PHONE');
 assert.deepEqual(await (controller as any).feedbackAdmin('archive',input,{admin:actor('SUPPORT')}),result);assert.equal(f.feedback.length,1);
 await assert.rejects((controller as any).feedbackAdmin('archive',{...input,idempotencyKey:'stale-feedback'}, {admin:actor('SUPPORT')}),code('REVISION_CONFLICT'));
 await assert.rejects((controller as any).feedbackAdmin('archive',{...input,actorId:'fake-owner'}, {admin:actor('SUPPORT')}),(e:any)=>e.name==='ZodError');
 const customer=fixture(['partner.cooperation.write'],'SUPPORT','RENTAL');await assert.rejects((new ArchiveController(customer.service) as any).feedbackAdmin('archive',input,{admin:actor('SUPPORT')}),code('FORBIDDEN'));
});
test('external direct draft detail returns 404 without revealing draft status',async()=>{
 const f=fixture([]);f.archive.kind='RENTAL';f.archive.orderId='order';f.version.status='DRAFT';
 await assert.rejects(f.service.detail('archive',{id:'customer',role:'CUSTOMER'}),code('NOT_FOUND'));
});
test('external detail hides candidate drafts and OWNER files recheck the independent portal grant',async()=>{
 const f=fixture([]),session={id:'portal',mode:'PARTNER_READONLY',mobileHash:'synthetic-hash',expiresAt:new Date(Date.now()+60000),scopeSnapshot:[{accessId:'access',ownerId:'owner',accessVersion:1}]};
 f.db.partnerPortalSession={findUnique:async()=>session};let enabled=true;
 f.db.partnerPortalAccess={findMany:async()=>enabled?[{id:'access',ownerId:'owner',status:'ENABLED',accessVersion:1,reviewedBy:'reviewer',reviewedAt:new Date()}]:[]};
 const owner={id:'portal',role:'OWNER',ownerId:'owner',partnerSession:session};
 f.version.status='DRAFT';await assert.rejects(f.service.detail('archive',owner),code('NOT_FOUND'));
 f.version.status='ARCHIVED';f.archive.currentApprovedVersionId='version';f.archive.versions.push({...f.version,id:'pending',version:2,status:'DRAFT',contractNumber:'private-candidate'});
 const result=await f.service.detail('archive',owner);assert.equal(result.versions.length,1);assert.equal(JSON.stringify(result).includes('private-candidate'),false);assert.equal('pendingVersionStatus' in result,false);
 let streamed=false;await f.service.readFile('archive','version','scan',owner,{set(){},sendFile(){streamed=true;}});assert.equal(streamed,true);
 enabled=false;await assert.rejects(f.service.readFile('archive','version','scan',owner,{set(){},sendFile(){assert.fail('revoked portal cannot stream');}}),code('PARTNER_ACCESS_DENIED'));
 const customer=fixture([]);customer.archive.kind='RENTAL';customer.archive.orderId='order';customer.version.status='ARCHIVED';customer.archive.currentApprovedVersionId='version';customer.archive.versions.push({...customer.version,id:'pending',version:2,status:'DRAFT'});
 const view=await customer.service.detail('archive',{id:'customer',role:'CUSTOMER'});assert.equal('pendingVersionStatus' in view,false);
});
function generic(file:any,capabilities:string[],financialKind?:string,cooperation=false){
 const zero={count:async()=>0},f=fixture(capabilities);f.db.partnerAgreementVersion=zero;let streamed=false;
 const db:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{findUnique:async()=>null,count:async()=>0},...f.db,storedFile:{findUnique:async()=>file},partnerSettlementFile:{findUnique:async()=>financialKind?{fileId:file.id,kind:financialKind,ownerId:'owner'}:null},archiveFile:{count:async()=>0},archiveVersion:{count:async()=>0},insurancePolicyFile:zero,partnerCooperationDraft:{findMany:async()=>cooperation?[{payload:{subjectEvidenceFileIds:[file.id]}}]:[]},partnerCooperationSubmission:{findMany:async()=>[]},paymentReconciliation:zero,customerQualificationVersion:zero,partnerIdentityBinding:zero,partnerVerification:zero,partnerVehicleBindingProposal:zero,ownerVehicle:zero,partnerVehicleBindingHistory:zero,offlineCancellationReview:zero,orderRenewalCancellation:zero,contract:zero,ownerSigningTask:zero,handover:zero,vehicleReceiptEvent:zero};
 return{controller:new FilesController(db),out:{setHeader(){},sendFile(){streamed=true;}},streamed:()=>streamed,db};
}
test('generic evidence uses actual financial binding kind and rejects cross-domain grants',async()=>{
 for(const [kind,capability]of [['RULE','partner.rules.read'],['ACCOUNT','partner.accounts.read'],['SETTLEMENT','partner.settlements.read'],['PAYMENT','partner.payments.read']]){
  const file={...fixture([]).file,purpose:'evidence',customerId:null};
  const denied=generic(file,['partner.cooperation.read'],kind);await assert.rejects(denied.controller.adminRead('scan',{admin:actor()},denied.out),code('FORBIDDEN'));assert.equal(denied.streamed(),false);
  const allowed=generic(file,[capability],kind);await allowed.controller.adminRead('scan',{admin:actor()},allowed.out);assert.equal(allowed.streamed(),true);
  await assert.rejects(allowed.controller.customerRead('scan',{customer:{id:'customer'}},allowed.out),code('ARCHIVE_ROUTE_REQUIRED'));
 }
});
test('generic cooperation evidence requires cooperation.read and does not grant customer identity access',async()=>{
 const file={...fixture([]).file,purpose:'evidence',customerId:null};
 const denied=generic(file,[],undefined,true);await assert.rejects(denied.controller.adminRead('scan',{admin:actor()},denied.out),code('FORBIDDEN'));
 const allowed=generic(file,['partner.cooperation.read'],undefined,true);await allowed.controller.adminRead('scan',{admin:actor()},allowed.out);assert.equal(allowed.streamed(),true);
 const privateFile=generic({...file,purpose:'identity',customerId:'customer'},['partner.cooperation.read'],undefined,true);privateFile.db.adminUser.findUnique=async()=>({id:'actor',role:'SUPPORT',active:true,authVersion:1,partnerCapabilities:['partner.cooperation.read']});
 await assert.rejects(privateFile.controller.adminRead('scan',{admin:actor('SUPPORT')},privateFile.out),code('CUSTOMER_FILE_PERMISSION'));
});
test('assigned FINANCE and SUPPORT can upload cooperation identity proof but only read it once bound with read capability',async t=>{
 t.mock.method(fs,'mkdir',async()=>undefined);t.mock.method(fs,'writeFile',async()=>undefined);
 for(const role of ['FINANCE','SUPPORT']){
  const f=generic(null,['partner.cooperation.write']);let stored:any;
  f.db.adminUser.findUnique=async()=>({id:'actor',role,active:true,authVersion:1,partnerCapabilities:['partner.cooperation.write']});
  f.db.storedFile.create=async({data}:any)=>(stored={id:'uploaded-proof',...data});f.db.auditLog={create:async()=>({})};
  const bytes=Buffer.from('%PDF-synthetic-partner-proof'),upload={buffer:bytes,size:bytes.length,mimetype:'application/pdf',originalname:'proof.pdf'} as any;
  await f.controller.adminUpload(upload,{admin:actor(role),body:{purpose:'identity'}});assert.equal(stored.customerId,null);assert.equal(stored.adminId,'actor');
  f.db.storedFile.findUnique=async()=>stored;
  await assert.rejects(f.controller.adminRead(stored.id,{admin:actor(role)},f.out),code('CUSTOMER_FILE_PERMISSION'));
  f.db.partnerCooperationDraft.findMany=async()=>[{payload:{representatives:[{authorizationEvidenceFileIds:[stored.id]}]}}];
  await assert.rejects(f.controller.adminRead(stored.id,{admin:actor(role)},f.out),code('FORBIDDEN'));
  f.db.adminUser.findUnique=async()=>({id:'actor',role,active:true,authVersion:1,partnerCapabilities:['partner.cooperation.write','partner.cooperation.read']});
  await f.controller.adminRead(stored.id,{admin:actor(role)},f.out);assert.equal(f.streamed(),true);
  f.db.adminUser.findUnique=async()=>({id:'actor',role,active:true,authVersion:1,partnerCapabilities:[]});
  await assert.rejects(f.controller.adminUpload(upload,{admin:actor(role),body:{purpose:'identity'}}),code('FORBIDDEN'));
 }
});
test('actual archive and insurance bindings block generic evidence URLs even for its customer or ADMIN',async()=>{
 for(const binding of ['archiveFile','archiveVersion','insurancePolicyFile']){
  const f=generic({...fixture([]).file,purpose:'evidence',customerId:'customer'},['partner.cooperation.read']);f.db[binding]={count:async()=>1};
  await assert.rejects(f.controller.adminRead('scan',{admin:actor()},f.out),code('ARCHIVE_ROUTE_REQUIRED'));
  await assert.rejects(f.controller.customerRead('scan',{customer:{id:'customer'}},f.out),code('ARCHIVE_ROUTE_REQUIRED'));assert.equal(f.streamed(),false);
 }
});
test('public vehicle media cannot publish an actually bound partner or archive proof',async()=>{
 for(const source of ['unbound','ACCOUNT','cooperation','archive']){
  const f=generic({...fixture([]).file,purpose:'vehicle',mimeType:'image/png',customerId:null},[],source==='ACCOUNT'?'ACCOUNT':undefined,source==='cooperation');
  f.db.storedFile.findFirst=f.db.storedFile.findUnique;f.db.vehicle={count:async()=>1};if(source==='archive')f.db.archiveFile={count:async()=>1};
  if(source==='unbound'){await f.controller.media('scan',f.out);assert.equal(f.streamed(),true);}
  else{await assert.rejects(f.controller.media('scan',f.out),code('NOT_FOUND'));assert.equal(f.streamed(),false);}
 }
});
test('database cooperation archives enforce current write grants, internal feedback and generic file domain caps',{skip:process.env.OFFLINE_ARCHIVE_DB_TESTS!=='true'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL||'http://invalid');assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test','only the isolated project database is permitted');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const token=randomUUID(),person=`archive-person-${token}`;
  const maker=await db.adminUser.create({data:{username:`archive-maker-${token}`,name:'档案合成经办',role:'SUPPORT',passwordHash:'synthetic-no-login',staffPersonId:person,partnerCapabilities:['partner.cooperation.write','partner.cooperation.read']}});
  const alternate=await db.adminUser.create({data:{username:`archive-alternate-${token}`,name:'档案合成同人账号',role:'SUPPORT',passwordHash:'synthetic-no-login',staffPersonId:person,partnerCapabilities:['partner.cooperation.review']}});
  const reviewer=await db.adminUser.create({data:{username:`archive-review-${token}`,name:'档案合成独立复核',role:'FINANCE',passwordHash:'synthetic-no-login',staffPersonId:`archive-review-person-${token}`,partnerCapabilities:['partner.cooperation.write','partner.cooperation.read']}});
  const asActor=(staff:any)=>({id:staff.id,role:staff.role,authVersion:staff.authVersion});
  const owner=await db.vehicleOwner.create({data:{name:'档案边界合成主体',subjectType:'INDIVIDUAL',address:'合成地址',createdBy:maker.id}});
  const archive=await db.documentArchive.create({data:{kind:'OWNER_COOPERATION',subjectType:'OWNER',subjectId:owner.id,ownerId:owner.id,createdBy:maker.id}});
  const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,status:'SUBMITTED',templateId:'synthetic-no-print',templateVersion:1,businessSnapshotHash:'synthetic',partiesSnapshot:[],requiredSigners:[],scopeSnapshot:{},createdBy:maker.id,editorIds:[maker.id],submittedBy:maker.id}} as any);
  const service=new ArchiveService(db,{} as any),input={...review,versionId:version.id,idempotencyKey:`review-${token}`};
  await assert.rejects(service.review(archive.id,input,asActor(alternate)),code('FORBIDDEN'));
  assert.equal((await service.review(archive.id,input,asActor(reviewer))).status,'REJECTED');
  await db.archiveVersion.update({where:{id:version.id},data:{status:'ARCHIVED'}});await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:version.id}});
  const latest=await db.documentArchive.findUniqueOrThrow({where:{id:archive.id}}),feedbackInput={revision:latest.revision,versionId:version.id,idempotencyKey:`feedback-${token}`,message:'合成电话反馈',source:'PHONE'};
  const controller=new ArchiveController(service),feedback=await (controller as any).feedbackAdmin(archive.id,feedbackInput,{admin:asActor(maker)});
  assert.deepEqual(await (controller as any).feedbackAdmin(archive.id,feedbackInput,{admin:asActor(maker)}),feedback);
  const row:any=await db.archiveFeedback.findUniqueOrThrow({where:{id:feedback.id}});assert.equal(row.actorId,maker.id);assert.equal(row.actorType,'ADMIN');assert.equal(row.source,'PHONE');assert.equal(row.recordedBy,maker.id);
  const before={audit:await db.auditLog.count({where:{resourceId:archive.id}}),commands:await db.archiveCommand.count({where:{resourceId:archive.id}})};
  await service.detail(archive.id,asActor(maker));await service.list({kind:'OWNER_COOPERATION',ownerId:owner.id},asActor(maker));
  assert.deepEqual({audit:await db.auditLog.count({where:{resourceId:archive.id}}),commands:await db.archiveCommand.count({where:{resourceId:archive.id}})},before);
  const file=await db.storedFile.create({data:{name:'synthetic-account.pdf',purpose:'evidence',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:resolve(projectRoot,'var/uploads/synthetic-account'),adminId:maker.id}});
  await db.partnerSettlementFile.create({data:{ownerId:owner.id,fileId:file.id,kind:'ACCOUNT',uploadedBy:maker.id}});
  let streamed=false;await assert.rejects(new FilesController(db).adminRead(file.id,{admin:asActor(maker)},{setHeader(){},sendFile(){streamed=true;}}),code('FORBIDDEN'));assert.equal(streamed,false);
 }finally{await db.$disconnect();}
});
