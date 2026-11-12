import {syntheticSigningTime,syntheticFinalVerification} from './electronic-fixtures';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {Db} from '../src/common/db';
import {SimpleAgreementService,readSimpleAgreementSnapshot} from '../src/partners/simple-agreements';
import {assertElectronicCooperationCurrent,activateElectronicCooperation,cooperationContentHash,reconcileElectronicCooperation} from '../src/electronic-documents/cooperation';
import {prepareElectronicDocument,resolveElectronicPreparation} from '../src/electronic-documents/prepare';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {signingParties,sha} from './electronic-fixtures';
import {canonicalHash} from '../src/customers/types';
import {finalizeElectronicArchive} from '../src/electronic-documents/archive';
import {ElectronicDocumentService} from '../src/electronic-documents/service';
import {seedV31CooperationSources,seedV31Subscription,v31FixtureContent} from './v31-cooperation-fixture';
const code=(v:string)=>(e:any)=>e?.getResponse?.().error?.code===v;
async function fixture(db:any){const uid=randomUUID(),staff=await db.adminUser.create({data:{username:uid,passwordHash:'synthetic-only',name:'合成运营',role:'OPERATIONS'}}),owner=await db.vehicleOwner.create({data:{name:'合成合作商',address:'合成地址',createdBy:staff.id}}),vehicle=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'合成车辆',year:2026,city:'上海',mileageKm:1}});return{owner,vehicle,actor:{id:staff.id,role:staff.role,authVersion:staff.authVersion},input:{revision:0,idempotencyKey:uid,status:'DRAFT',title:'合成电子合作协议',vehicleIds:[vehicle.id],partnerRateBps:7500,validFrom:'2026-11-01',validUntil:'2027-12-31'}};}
async function electronic(fn:()=>Promise<void>){const old=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{await fn();}finally{if(old===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=old;}}

test('electronic cooperation only saves terms as drafts; uploaded paper and direct activation are rejected',async()=>electronic(async()=>{const db=new Db();try{
 const f=await fixture(db),service=new SimpleAgreementService();
 await assert.rejects(db.serial(tx=>service.save(tx,f.actor,f.owner.id,{...f.input,status:'ACTIVE'})),code('ELECTRONIC_COOPERATION_REQUIRED'));
 await assert.rejects(db.serial(tx=>service.save(tx,f.actor,f.owner.id,{...f.input,fileIds:['paper']})),code('ELECTRONIC_COOPERATION_REQUIRED'));
 const draft=await db.serial(tx=>service.save(tx,f.actor,f.owner.id,f.input));assert.equal(draft.status,'DRAFT');assert.equal(draft.latestVersion.executionMode,'ELECTRONIC');assert.equal(draft.latestVersion.contentHash,cooperationContentHash(draft.latestVersion));assert.equal(draft.missingFields.includes('fileIds'),false);assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id),null);
 const again=await db.serial(tx=>service.save(tx,f.actor,f.owner.id,f.input));assert.equal(draft.id,again.id);
 await assert.rejects(db.partnerAgreementVersion.update({where:{id:draft.latestVersion.id},data:{partnerRateBps:5000}}));
 await assert.rejects(db.partnerAgreementVersion.update({where:{id:draft.latestVersion.id},data:{status:'ACTIVE'}}));
 }finally{await db.$disconnect();}}));

test('cooperation source checks latest terms and cannot activate without a two-party electronic archive',async()=>electronic(async()=>{const db=new Db();try{
 const f=await fixture(db),service=new SimpleAgreementService(),draft=await db.serial(tx=>service.save(tx,f.actor,f.owner.id,f.input));
 const version=draft.latestVersion;await assertElectronicCooperationCurrent(db,version.id,version.contentHash);
 await assert.rejects(db.serial(tx=>activateElectronicCooperation(tx,{id:'not-signed',cooperationVersionId:version.id,archiveVersionId:'missing',ownerId:f.owner.id,businessHash:version.contentHash,kind:'COOPERATION'})),code('ELECTRONIC_ARCHIVE_REQUIRED'));
 await db.serial(tx=>service.save(tx,f.actor,f.owner.id,{...f.input,agreementId:draft.id,revision:draft.revision,idempotencyKey:randomUUID(),partnerRateBps:8000}));
 await assert.rejects(assertElectronicCooperationCurrent(db,version.id,version.contentHash),code('ELECTRONIC_BUSINESS_CHANGED'));
 }finally{await db.$disconnect();}}));

async function prepareFixture(db:any){
 const f=await fixture(db);await db.vehicle.update({where:{id:f.vehicle.id},data:{vin:'SYN'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase()}});await db.vehicleOwner.update({where:{id:f.owner.id},data:{creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase()}});
 const platform=await db.vehicleOwner.create({data:{name:'上海宁达信息科技有限公司',creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),address:'合成地址',createdBy:f.actor.id}}),providerId='ND'+randomUUID().replace(/-/g,'').slice(0,25);
 await db.ownerESignAccount.create({data:{ownerId:platform.id,providerCustomerId:providerId}});process.env.FADADA_PLATFORM_CUSTOMER_ID=providerId;
 const v31Sources=await seedV31CooperationSources(db,f.actor.id,f.owner,platform,f.vehicle);
 const draft=await db.serial((tx:any)=>new SimpleAgreementService().save(tx,f.actor,f.owner.id,{...f.input,v31Sources}));
 const template=await db.legalDocument.create({data:{type:'ELECTRONIC_V31_COOPERATION',version:Math.floor(Math.random()*1000000000)+1,title:'合成车辆合作协议',content:v31FixtureContent('02-main'),status:'DRAFT'}});
 const resolveParties=async()=>signingParties().filter(p=>p.role!=='CUSTOMER').map(p=>({...p,subjectId:p.role==='OWNER'?f.owner.id:platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
 const input={kind:'COOPERATION',resourceId:draft.latestVersion.id,revision:draft.revision,templateId:template.id,idempotencyKey:randomUUID()};return{...f,platform,draft,template,input,v31Sources,options:{resolveParties,fontPath:'C:/Windows/Fonts/msyh.ttc'},writer:new ContractPdfArtifactWriterService(db)};
}
async function syntheticArchive(db:any,f:any,prepared:any){
 const task=await db.electronicSigningTask.findUnique({where:{id:prepared.taskId},include:{parties:true}}),now=Date.now(),uploadedAt=new Date(now-60000);
 const final=await f.writer.persistPdf(Buffer.from('%PDF-1.7\nSynthetic signed PDF for database test only.\n'+sha('f')+'\n%%EOF'),{customerId:null,name:'合成签后.pdf',purpose:'electronic-final'});
 await db.serial(async(tx:any)=>{
  for(const [i,p]of task.parties.entries()){const attemptedAt=new Date(now-50000+i*10000),manualConsent={version:1,taskId:task.id,role:p.role,actorId:'synthetic',sourceSha256:task.sourceSha256,businessHash:task.businessHash,identityHash:p.identityHash,acceptedAt:attemptedAt.toISOString()};await tx.electronicSigningParty.update({where:{id:p.id},data:{manualConsent,manualConsentHash:canonicalHash(manualConsent)}});await tx.electronicSigningParty.update({where:{id:p.id},data:{attemptedAt,verifiedAt:new Date(attemptedAt.getTime()+5000),...syntheticSigningTime(new Date(attemptedAt.getTime()+1000)),queryEvidenceHash:sha('b'),status:'SIGNED'}});}
  await tx.electronicSigningTask.update({where:{id:task.id},data:{status:'ARCHIVING',uploadStatus:'UPLOADED',uploadedAt,uploadEvidenceHash:sha('c'),filingStatus:'CONFIRMED',filedAt:new Date(now-10000),filingEvidenceHash:sha('d'),finalFileId:final.id,finalSha256:final.sha256,finalVerification:syntheticFinalVerification(task,final.sha256)}});
  await finalizeElectronicArchive(tx,task.id);await activateElectronicCooperation(tx,await tx.electronicSigningTask.findUnique({where:{id:task.id}}));
 });return task;
}

test('cooperation always stays manual despite technical authority and exact-document acceptance',async()=>electronic(async()=>{
 const db=new Db(),old=process.env.FADADA_PLATFORM_CUSTOMER_ID;try{
  const f=await prepareFixture(db);await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:'synthetic-approval',confirmedAt:new Date()}});
  const resolveParties=async(_tx?:any,_version?:string,readAt=new Date())=>signingParties().filter(p=>p.role!=='CUSTOMER').map(p=>{const subjectId=p.role==='OWNER'?f.owner.id:f.platform.id,now=readAt,validFrom=new Date(now.getTime()-86400000).toISOString(),validUntil=new Date(now.getTime()+86400000).toISOString();return{...p,subjectId,certificate:{...p.certificate,validFrom,validUntil,checkedAt:now.toISOString()},autoAuthority:{...p.autoAuthority!,subjectId,delegateSubjectId:f.platform.id,documentKinds:['COOPERATION' as const],cooperationVersionIds:[f.draft.latestVersion.id],vehicleIds:[f.vehicle.id],validFrom,validUntil,checkedAt:now.toISOString()}};});
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,{...f.options,resolveParties}));
  const calls:string[]=[],provider:any={verifyFinalFile:async(task:any,bytes:Buffer)=>syntheticFinalVerification(task,require('node:crypto').createHash('sha256').update(bytes).digest('hex')),upload:async()=>({evidenceHash:sha('b')}),autoSign:async(_d:any,p:any)=>{calls.push(p.role);return{evidenceHash:sha('c')};},querySigner:async()=>({...syntheticSigningTime(new Date()),status:'SIGNED',evidenceHash:sha('d')}),fileContract:async()=>({evidenceHash:sha('e')}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSYNTHETIC complete two-party signatures.\n'+sha('a')+'\n%%EOF')})};
  const service=new ElectronicDocumentService(db,provider,f.writer,{resolveParties,requireOwnerActor:async(_tx:any,id:string)=>{assert.equal(id,'synthetic-owner-person');return{} as any;},afterArchive:activateElectronicCooperation});
  await service.advance(prepared.taskId);assert.deepEqual(calls,[]);
  const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}}),input={revision:task.revision,idempotencyKey:randomUUID(),accepted:true,sourceSha256:task.sourceSha256},actor={kind:'OWNER' as const,id:'synthetic-owner-person',ownerId:f.owner.id};
  await assert.rejects(service.acceptCooperation({kind:'ADMIN',id:f.actor.id},task.id,input),code('ELECTRONIC_PERSONAL_SIGNER_REQUIRED'));
  await assert.rejects(service.acceptCooperation({...actor,ownerId:'another-owner'},task.id,input),code('NOT_FOUND'));
  await assert.rejects(service.acceptCooperation(actor,task.id,{...input,sourceSha256:sha('f')}),code('ELECTRONIC_SOURCE_CHANGED'));
  await assert.rejects(service.acceptCooperation(actor,task.id,input),code('ELECTRONIC_OPERATION_NOT_AVAILABLE'));assert.deepEqual(calls,[]);
  const party=await db.electronicSigningParty.findFirstOrThrow({where:{taskId:task.id,role:'OWNER'}});assert.equal(party.mode,'MANUAL');assert.equal(party.attemptedAt,null);
 }finally{if(old===undefined)delete process.env.FADADA_PLATFORM_CUSTOMER_ID;else process.env.FADADA_PLATFORM_CUSTOMER_ID=old;await db.$disconnect();}
}));
test('approved cooperation source freezes both parties and only verified archive activates exact vehicles and ratio',async()=>electronic(async()=>{
 const h=new JourneyHarness(),db=h.db,old=process.env.FADADA_PLATFORM_CUSTOMER_ID;try{
  await h.start();process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
  const f=await prepareFixture(db);
  await assert.rejects(db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)),code('LEGAL_NOT_APPROVED'));
  await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:'synthetic-approval',confirmedAt:new Date()}});
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)),again=await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options));assert.deepEqual(prepared,again);
  const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId},include:{parties:true}}),version=await db.archiveVersion.findUniqueOrThrow({where:{id:prepared.archiveVersionId}});
  assert.equal(task.parties.length,2);assert.equal(version.reviewedBy,null);assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id),null);
  assert.equal((version.scopeSnapshot as any).electronicDocument.positions.OWNER.length,1);
  await assert.rejects(db.archiveVersion.update({where:{id:version.id},data:{contractNumber:'REBOUND-NUMBER'}}));
  await syntheticArchive(db,f,prepared);const active=await readSimpleAgreementSnapshot(db,f.vehicle.id);assert.equal(active?.partnerRateBps,7500);assert.equal(active?.ownerId,f.owner.id);assert.equal(active?.agreementVersionId,f.draft.latestVersion.id);
  const sub=await seedV31Subscription(db,f),resolveParties=async()=>signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
  const customerPrepared=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:sub.order.revision,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties}));
  const customerArchive=await db.archiveVersion.findUniqueOrThrow({where:{id:customerPrepared.archiveVersionId}}),scope=customerArchive.scopeSnapshot as any;
  assert.equal(scope.v31Sources.context.resourceId,sub.order.id);assert.equal(scope.v31Sources.snapshot.parties.CUSTOMER.id,sub.customer.id);assert.equal(JSON.stringify(scope).includes('110101199001010000'),false);assert.equal(JSON.stringify(scope).includes('identityCiphertext'),false);
  const customerTask=await db.electronicSigningTask.findUniqueOrThrow({where:{id:customerPrepared.taskId},include:{parties:true}}),storedContract=await db.contract.findUniqueOrThrow({where:{id:customerTask.contractId!}});
  const privateValues=['110101199001010000',sub.customer.mobile,'合成联系地址'];
  for(const secret of privateValues){assert.equal(storedContract.body?.includes(secret),false,'private rendered text must not persist in generic Contract.body');assert.equal(JSON.stringify({customerTask,scope}).includes(secret),false);}
  const reference=JSON.parse(storedContract.body!);assert.equal(reference.bodyHash,scope.bodyHash);assert.equal(reference.sourceSha256,customerTask.sourceSha256);assert.equal(reference.sourceFileId,customerArchive.sourceFileId);
  for(const staff of [h.maker,h.reviewer]){
   const list=await h.get('/admin/contracts?keyword='+storedContract.id,staff),detail=await h.get('/admin/contracts/'+storedContract.id,staff);
   assert.equal(list.items.length,1);for(const response of [list.items[0],detail]){assert.equal(Object.hasOwn(response,'body'),false);for(const secret of privateValues)assert.equal(JSON.stringify(response).includes(secret),false);}
  }
  const pdfResponse=await fetch(h.base+'/api/admin/electronic-documents/'+customerTask.id+'/files/source',{headers:h.maker.headers});assert.equal(pdfResponse.status,200);assert.equal(pdfResponse.headers.get('cache-control'),'private, no-store');
  const pdfBytes=Buffer.from(await pdfResponse.arrayBuffer());assert.deepEqual(pdfBytes,await f.writer.readVerified(customerArchive.sourceFileId!,customerTask.sourceSha256));
  const python=process.env.PDF_QA_PYTHON||(process.platform==='win32'?resolve(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'):'python3');
  const pdfText=execFileSync(python,['-X','utf8','-c','import sys,io; from pypdf import PdfReader; print("\\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdfBytes,encoding:'utf8'}).replace(/\s/g,'');
  for(const secret of privateValues)assert.ok(pdfText.includes(secret),'protected PDF must retain required private identity/contact');
  // Previously persisted electronic bodies must also be protected by generic serializers.
  const legacy=await db.contract.create({data:{orderId:sub.order.id,customerId:sub.customer.id,kind:'SUBSCRIPTION',executionMode:'ELECTRONIC',documentHash:storedContract.documentHash,body:privateValues.join(' / ')}});
  for(const staff of [h.maker,h.reviewer]){
   const list=await h.get('/admin/contracts?keyword='+legacy.id,staff),detail=await h.get('/admin/contracts/'+legacy.id,staff);
   assert.equal(list.items.length,1);for(const response of [list.items[0],detail]){assert.equal(Object.hasOwn(response,'body'),false);for(const secret of privateValues)assert.equal(JSON.stringify(response).includes(secret),false);}
  }
  const agreement=await db.partnerAgreement.findUniqueOrThrow({where:{id:f.draft.id}}),amendment=await db.serial(tx=>new SimpleAgreementService().save(tx,f.actor,f.owner.id,{status:'DRAFT',title:'合成补充协议',vehicleIds:[f.vehicle.id],agreementId:agreement.id,revision:agreement.revision,idempotencyKey:randomUUID(),partnerRateBps:8000}));
  await assert.rejects(resolveElectronicPreparation(db,'COOPERATION_AMENDMENT',amendment.latestVersion.id),code('V31_COOPERATION_TEMPLATE_UNAVAILABLE'));
 }finally{await h.close();if(old===undefined)delete process.env.FADADA_PLATFORM_CUSTOMER_ID;else process.env.FADADA_PLATFORM_CUSTOMER_ID=old;}
}));

test('future effective cooperation stays signed but inactive until its Shanghai effective date',async()=>electronic(async()=>{
 const db=new Db(),old=process.env.FADADA_PLATFORM_CUSTOMER_ID;try{
  const f=await prepareFixture(db),draft=await db.serial(tx=>new SimpleAgreementService().save(tx,f.actor,f.owner.id,{status:'DRAFT',agreementId:f.draft.id,revision:f.draft.revision,idempotencyKey:randomUUID(),vehicleIds:[f.vehicle.id],partnerRateBps:7500,validFrom:'2099-11-05',validUntil:'2100-11-05',v31Sources:{...f.v31Sources,vehicleScopes:f.v31Sources.vehicleScopes.map((v:any)=>({...v,validFrom:'2099-11-05',validUntil:'2100-11-05'}))}}));
  await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:'synthetic-approval',confirmedAt:new Date()}});
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,{...f.input,resourceId:draft.latestVersion.id,revision:draft.revision,idempotencyKey:randomUUID()},f.actor.id,f.writer,f.options));
  await syntheticArchive(db,f,prepared);assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id),null);assert.equal((await db.partnerAgreementVersion.findUniqueOrThrow({where:{id:draft.latestVersion.id}})).status,'SIGNED');
  const task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}});
  await reconcileElectronicCooperation(db,new Date('2099-11-04T15:59:59Z'));assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id),null);
  await reconcileElectronicCooperation(db,new Date('2099-11-04T16:00:00Z'));const active=await readSimpleAgreementSnapshot(db,f.vehicle.id,{startDate:'2099-11-05',endDate:'2100-11-04'});assert.equal(active?.agreementVersionId,draft.latestVersion.id);
 }finally{if(old===undefined)delete process.env.FADADA_PLATFORM_CUSTOMER_ID;else process.env.FADADA_PLATFORM_CUSTOMER_ID=old;await db.$disconnect();}
}));

test('v3 cooperation refreshes Ningda authority before upload, keeps partner personal signature and automatically archives Ningda signature without order context',async()=>electronic(async()=>{
 const db=new Db(),previous={scope:process.env.OWNER_AUTHORIZATION_SCOPE_VERSION,auto:process.env.OWNER_AUTO_SIGNING_ENABLED,platform:process.env.FADADA_PLATFORM_CUSTOMER_ID};
 Object.assign(process.env,{OWNER_AUTHORIZATION_SCOPE_VERSION:'3',OWNER_AUTO_SIGNING_ENABLED:'true'});
 try{
  const f=await prepareFixture(db);await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:'synthetic-approval',confirmedAt:new Date()}});
  let fresh=false,queries=0;const signed=new Set<string>(),calls:string[]=[];
  const resolveParties=async(_tx?:any,_version?:string,now=new Date())=>signingParties().filter(p=>p.role!=='CUSTOMER').map(p=>{const subjectId=p.role==='OWNER'?f.owner.id:f.platform.id,validFrom=new Date(now.getTime()-86400000).toISOString(),validUntil=new Date(now.getTime()+86400000).toISOString();return{...p,subjectId,certificate:{...p.certificate,validFrom,validUntil,checkedAt:now.toISOString()},autoAuthority:p.role==='OWNER'?null:{...p.autoAuthority!,policyVersion:3 as const,subjectId,platformSubjectId:f.platform.id,delegateSubjectId:'XIAOLANG_NETWORK_TECHNOLOGY',applicationBinding:sha('f'),documentKinds:['COOPERATION' as const],cooperationVersionIds:null,vehicleIds:null,validFrom,validUntil,checkedAt:new Date(now.getTime()-(fresh?0:120000)).toISOString()}};});
  const prepared=await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,{...f.options,resolveParties}));
  const provider:any={upload:async()=>{calls.push('UPLOAD');return{evidenceHash:sha('b')};},manualUrl:async(_d:any,p:any)=>{calls.push('MANUAL:'+p.role);return{url:'https://textapi17.fadada.com/api2/extsign.api',expiresAt:new Date(Date.now()+60000).toISOString()};},autoSign:async(_d:any,p:any)=>{calls.push('AUTO:'+p.role);signed.add(p.role);return{evidenceHash:sha('c')};},querySigner:async(_d:any,p:any)=>({...syntheticSigningTime(new Date()),status:signed.has(p.role)?'SIGNED':'ABSENT',evidenceHash:sha('d')}),fileContract:async()=>({evidenceHash:sha('e')}),downloadFinal:async()=>({bytes:Buffer.from('%PDF-1.7\nSYNTHETIC signed two-party file.\n'+sha('a')+'\n%%EOF')}),verifyFinalFile:async(task:any,bytes:Buffer)=>syntheticFinalVerification(task,require('node:crypto').createHash('sha256').update(bytes).digest('hex'))};
  const service=new ElectronicDocumentService(db,provider,f.writer,{resolveParties,refreshAuthorities:async()=>{queries++;fresh=true;},requireOwnerActor:async(_tx:any,id:string)=>{assert.equal(id,'synthetic-owner-person');return{} as any;},afterArchive:activateElectronicCooperation});
  const command=async(extra:any={})=>({revision:(await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}})).revision,idempotencyKey:randomUUID(),...extra});
  await service.start({kind:'ADMIN',id:f.actor.id},prepared.taskId,await command());
  let task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId},include:{parties:true}});
  assert.equal(task.orderId,null);assert.ok(queries>0);assert.equal(task.parties.find(p=>p.role==='OWNER')?.mode,'MANUAL');assert.equal(task.parties.find(p=>p.role==='PLATFORM')?.mode,'AUTO');assert.deepEqual(calls,['UPLOAD']);
  const actor={kind:'OWNER' as const,id:'synthetic-owner-person',ownerId:f.owner.id};
  fresh=false; // The partner may read the PDF for longer than the provider-status freshness interval.
  await service.sign(actor,task.id,await command({accepted:true,sourceSha256:task.sourceSha256}));assert.ok(queries>=2,'refresh the original grant before personal consent can downgrade Ningda');signed.add('OWNER');await service.sync(actor,task.id,await command());
  task=await db.electronicSigningTask.findUniqueOrThrow({where:{id:task.id},include:{parties:true}});
  assert.equal(task.status,'ARCHIVED');assert.deepEqual(calls,['UPLOAD','MANUAL:OWNER','AUTO:PLATFORM']);assert.ok(task.parties.every(p=>p.status==='SIGNED'));assert.ok(await readSimpleAgreementSnapshot(db,f.vehicle.id));
 }finally{for(const [key,value]of Object.entries({OWNER_AUTHORIZATION_SCOPE_VERSION:previous.scope,OWNER_AUTO_SIGNING_ENABLED:previous.auto,FADADA_PLATFORM_CUSTOMER_ID:previous.platform})){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.$disconnect();}
}));
