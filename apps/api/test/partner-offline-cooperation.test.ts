import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PartnerAdmissionService} from '../src/partners/admission';
import {approvedPartner} from '../src/partners/types';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {Db} from '../src/common/db';
import {ArchiveService} from '../src/offline-documents/archive.service';
import {ArchiveContextService} from '../src/offline-documents/context';
import {RevenueRuleService} from '../src/partners/revenue-rules';
import {readOwnerCooperationReady} from '../src/offline-documents/readiness';
import {assertExactDomainReviews} from '../src/partners/cooperation';
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;

test('paper cooperation approval reads independent business evidence without Customer or identity binding',async()=>{
 const row={id:'submission',ownerId:'owner',revision:1,profileRevision:3,status:'APPROVED',reviewedBy:'reviewer',reviewedAt:new Date(),domainVersions:[{domain:'SUBJECT',resourceId:'owner',revision:3,hash:'subject'},{domain:'VEHICLE',resourceId:'vehicle',revision:0,hash:'vehicle'},{domain:'ARCHIVE',resourceId:'archive',revision:2,hash:'archive'},{domain:'RULE',resourceId:'rule',revision:1,hash:'rule'}],completedActions:['SUBJECT:owner','VEHICLE:vehicle','ARCHIVE:archive','RULE:rule']};
 const tx:any={partnerCooperationSubmission:{findFirst:async()=>row},partnerVerification:{findFirst:async()=>null}};
 const approved=await approvedPartner(tx,{id:'owner',revision:3,status:'DRAFT',subjectType:'INDIVIDUAL',creditCode:null});
 assert.equal(approved.verification.id,'submission');
 await assert.rejects(approvedPartner(tx,{id:'owner',revision:4,status:'DRAFT'}),error('OWNER_BUSINESS_UNVERIFIED'));
 row.completedActions.pop();
 await assert.rejects(approvedPartner(tx,{id:'owner',revision:3,status:'DRAFT'}),error('OWNER_BUSINESS_UNVERIFIED'));
});

test('v3 paper lessor hash freezes cooperation evidence and excludes read-only access phone',()=>{
 const s:any={version:3,executionMode:'OFFLINE',ownerId:'owner',name:'合成个人',subjectType:'INDIVIDUAL',creditCode:null,address:'合成地址',phone:'13800000000',cooperationSubmissionId:'s1',cooperationSubmissionRevision:1};
 assert.notEqual(lessorIdentityHash(s),lessorIdentityHash({...s,cooperationSubmissionId:'s2'}));
 assert.equal(lessorIdentityHash(s),lessorIdentityHash({...s,portalAccessPhone:'13900000000',accessVersion:2}));
});
test('legacy v2 lessor hash and original customer consent bytes keep their original interpretation',()=>{
 const legacy={version:2,executionMode:'OFFLINE',ownerId:'legacy-owner',name:'Legacy',creditCode:null,address:'Address',phone:'13800000000',vehicleId:'legacy-vehicle',bindingId:'binding',bindingRevision:1,evidenceHash:'proof',platformLegalEntityName:'Platform',subjectType:'INDIVIDUAL',profileRevision:2,verificationId:'verification',verificationRevision:3,identityBindingId:'identity',identityBindingRevision:4,cooperationVersionId:'archive',leaseRange:{startDate:'2026-11-01',endDate:'2027-10-31'}};
 assert.equal(lessorIdentityHash(legacy),'81e66b05bf04f2387b2c38e3bf4cf8dbbdf7f85ae8ebae1ca2e61c33a64c7180');
 assert.equal(lessorIdentityHash({...legacy,cooperationSubmissionId:'new-submission',accessVersion:9}),lessorIdentityHash(legacy));
});

test('batch review cannot omit, duplicate, add or change the frozen domain revision',()=>{
 const domains:any=[{domain:'SUBJECT',resourceId:'s',revision:1,hash:'s'},{domain:'ARCHIVE',resourceId:'a',revision:2,hash:'a'}],reviews=domains.map((d:any)=>({...d,review:{}}));
 assertExactDomainReviews(domains,reviews);
 for(const invalid of [reviews.slice(1),[reviews[0],reviews[0]],[...reviews,{domain:'RULE',resourceId:'other',revision:0,review:{}}],[reviews[0],{...reviews[1],revision:3}]])assert.throws(()=>assertExactDomainReviews(domains,invalid),error('PARTNER_BATCH_REVIEW_MISMATCH'));
});

test('database independent individual saves incomplete draft without Customer, cannot submit missing facts, and contact-only change keeps business version',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),service:any=new PartnerAdmissionService();
 try{
  const seed=randomUUID(),maker=await db.adminUser.create({data:{username:'cooperation-maker-'+seed,name:'合成经办',role:'ADMIN',staffPersonId:'person-'+seed,partnerCapabilities:['partner.cooperation.read','partner.cooperation.write'],passwordHash:'synthetic-unused'}} as any),actor={id:maker.id,role:maker.role,authVersion:maker.authVersion};
  const owner=await db.serial(tx=>service.create(tx,actor,{profile:{subjectType:'INDIVIDUAL',name:'合成独立个人',address:'合成地址'},idempotencyKey:randomUUID()}));
  assert.equal(owner.creditCode,null);assert.equal(owner.contactPhone,'');
  const draft=await db.serial(tx=>service.saveDraft(tx,actor,owner.id,{revision:0,idempotencyKey:randomUUID(),patch:{representatives:[],subjectEvidenceFileIds:[],vehicles:[],cooperationVersionId:null,revenueRuleVersionIds:[]}}));
  assert.equal(draft.status,'DRAFT');assert.ok(draft.missingFields.some((m:any)=>m.section==='ARCHIVE'));
  await assert.rejects(db.serial(tx=>service.submit(tx,actor,owner.id,{revision:draft.revision,idempotencyKey:randomUUID()})),error('PARTNER_COOPERATION_INCOMPLETE'));
  const changed=await db.serial(tx=>service.update(tx,actor,owner.id,{revision:owner.revision,idempotencyKey:randomUUID(),profile:{subjectType:'INDIVIDUAL',name:owner.name,address:owner.address,contactPhone:'13800000000'},contactKind:'ORDINARY',contactRevision:0}));
  assert.equal(changed.revision,owner.revision);
  const legal=await db.serial(tx=>service.update(tx,actor,owner.id,{revision:owner.revision,idempotencyKey:randomUUID(),profile:{subjectType:'INDIVIDUAL',name:'合成新主体姓名',address:owner.address},contactKind:'ORDINARY',contactRevision:changed.contactRevision}));
  assert.equal(legal.revision,owner.revision+1);
 }finally{await db.$disconnect();}
});

test('database complete paper batch independently reviews actual domains without Customer; stale archive rolls back bindings and blank basis blocks submission',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),service=new PartnerAdmissionService(),seed=randomUUID();
 try{
  const capabilities=['partner.cooperation.read','partner.cooperation.write','partner.cooperation.review','partner.rules.read','partner.rules.write','partner.rules.review'];
  const staff=await Promise.all(['maker','reviewer','earlier-editor'].map(name=>db.adminUser.create({data:{username:`paper-${name}-${seed}`,name,role:'ADMIN',passwordHash:'synthetic-unused',staffPersonId:`person-${name}-${seed}`,partnerCapabilities:capabilities}} as any))),actor=(i:number)=>({id:staff[i].id,role:staff[i].role,authVersion:staff[i].authVersion}),customerCount=await db.customer.count();
  const owner=await db.serial(tx=>service.create(tx,actor(0),{profile:{subjectType:'INDIVIDUAL',name:'合成纸质合作个人',address:'合成地址',contactPhone:'13800000000'},idempotencyKey:randomUUID()}));
  const v=await db.vehicle.create({data:{title:'合成纸质合作车',brand:'Synthetic',model:'Test',year:2026,city:'上海',mileageKm:0}}),evidence=await db.storedFile.create({data:{adminId:staff[0].id,name:'合成出租权限.pdf',purpose:'evidence',mimeType:'application/pdf',size:10,sha256:'b'.repeat(64),storagePath:'synthetic-no-real-document'}});
  const basic=await db.serial(tx=>service.saveDraft(tx,actor(2),owner.id,{revision:0,idempotencyKey:'prepare-'+seed+'x'.repeat(128-8-seed.length),patch:{representatives:[{name:owner.name,role:'SELF',authorizationEvidenceFileIds:[]}],subjectEvidenceFileIds:[evidence.id],vehicles:[{vehicleId:v.id,evidenceFileIds:[evidence.id]}]}}));
  assert.equal(await db.ownerVehicle.count({where:{vehicleId:v.id}}),0);
  const template=await db.legalDocument.create({data:{type:'OFFLINE_OWNER_COOPERATION',version:Math.floor(Math.random()*1e9),title:'合成线下合作原件',content:'合成原件核验模板',status:'PUBLISHED',confirmedBy:staff[1].id,confirmedAt:new Date()}}),archives=new ArchiveService(db,new ArchiveContextService());
  const a=await archives.create({subjectType:'OWNER',subjectId:owner.id,kind:'OWNER_COOPERATION',templateId:template.id,scope:{vehicleIds:[v.id],validFrom:'2026-10-28',validUntil:'2031-10-27'},revision:0,idempotencyKey:randomUUID()},actor(0));
  const upload=await archives.upload(a.archiveId,a.versionId,{position:1,revision:0,idempotencyKey:randomUUID()},{buffer:Buffer.from('%PDF-synthetic-paper-cooperation-'+seed),mimetype:'application/pdf',originalname:'signed-synthetic.pdf'} as any,actor(0));
  await archives.patch(a.archiveId,a.versionId,{revision:upload.revision,idempotencyKey:randomUUID(),signedOn:'2026-10-28',contractNumber:'SYNTH-'+seed,originalCustodian:'合成保管',originalLocation:'合成柜',declaredPages:1},actor(0));
  const financial=await db.storedFile.create({data:{adminId:staff[0].id,name:'合成分润.pdf',purpose:'partner-settlement',mimeType:'application/pdf',size:10,sha256:'c'.repeat(64),storagePath:'synthetic-no-real-document'}});await db.partnerSettlementFile.create({data:{ownerId:owner.id,fileId:financial.id,uploadedBy:staff[0].id,kind:'RULE'}});
  const rules=new RevenueRuleService(),terms={cooperationVersionId:a.versionId,vehicleIds:[v.id],validFrom:'2026-10-28',validUntil:'2031-10-27',method:'RATE',rateBps:2000,fixedMonthlyAmount:null,customAgreement:null,basis:'实收租金',deductions:'已确认退款',refundRule:'实际退款扣回',cycle:'每月人工核对',expenseResponsibility:'纸质约定'};
  const blank=await db.serial(tx=>rules.create(tx,actor(0),owner.id,{revision:0,idempotencyKey:randomUUID(),terms:{...terms,basis:null},evidenceFileIds:[financial.id]}));
  const incomplete=await db.serial(tx=>service.saveDraft(tx,actor(0),owner.id,{revision:basic.revision,idempotencyKey:randomUUID(),patch:{cooperationVersionId:a.versionId,revenueRuleVersionIds:[blank.id]}}));
  await assert.rejects(db.serial(tx=>service.submit(tx,actor(0),owner.id,{revision:incomplete.revision,idempotencyKey:randomUUID()})),error('PARTNER_COOPERATION_INCOMPLETE'));
  const rule=await db.serial(tx=>rules.create(tx,actor(0),owner.id,{revision:0,idempotencyKey:randomUUID(),terms,evidenceFileIds:[financial.id]}));
  const draft=await db.serial(tx=>service.saveDraft(tx,actor(0),owner.id,{revision:incomplete.revision,idempotencyKey:randomUUID(),patch:{revenueRuleVersionIds:[rule.id]}}));
  const submitInput={revision:draft.revision,idempotencyKey:randomUUID()},submitted=await db.serial(tx=>service.submit(tx,actor(0),owner.id,submitInput));assert.deepEqual(await db.serial(tx=>service.submit(tx,actor(0),owner.id,submitInput)),submitted);
  const batch:any=await db.partnerCooperationSubmission.findUnique({where:{id:submitted.submissionId}}),av:any=await db.archiveVersion.findUnique({where:{id:a.versionId}}),checks={partiesComplete:true,authorityChecked:true,pagesComplete:true,vehicleMatches:true,termsMatch:true,annexesComplete:true,legible:true,originalRecorded:true};
  const domainReviews=batch.domainVersions.map((d:any)=>({domain:d.domain,resourceId:d.resourceId,revision:d.revision,review:d.domain==='SUBJECT'?{identityChecked:true,ownershipChecked:true,representativeAuthorityChecked:true}:d.domain==='VEHICLE'?{ownershipChecked:true}:d.domain==='RULE'?{termsChecked:true}:{checklist:checks,partyChecks:av.partiesSnapshot.map((p:any)=>({role:p.role,partyId:p.partyId,signerName:'合成签署人',signedOn:'2026-10-28',signaturePageRefs:[{fileId:upload.id,page:1}],passed:true}))}}));
  const review={revision:submitted.submissionRevision,submissionId:submitted.submissionId,submissionHash:submitted.submissionHash,decision:'APPROVE',reason:'逐项核对合成纸质材料',idempotencyKey:randomUUID(),domainReviews};
  await assert.rejects(db.serial(tx=>service.review(tx,actor(0),owner.id,review)),error('PARTNER_SELF_REVIEW'));
  await assert.rejects(db.serial(tx=>service.review(tx,actor(2),owner.id,review)),error('PARTNER_SELF_REVIEW'));
  await db.documentArchive.update({where:{id:a.archiveId},data:{revision:{increment:1}}});
  await assert.rejects(db.serial(tx=>service.review(tx,actor(1),owner.id,review)),error('PARTNER_ARCHIVE_CHANGED'));assert.equal(await db.ownerVehicle.count({where:{vehicleId:v.id}}),0);assert.equal((await db.partnerCooperationSubmission.findUnique({where:{id:batch.id}}))?.status,'SUBMITTED');
  await db.documentArchive.update({where:{id:a.archiveId},data:{revision:{decrement:1}}});
  const approved=await db.serial(tx=>service.review(tx,actor(1),owner.id,review));assert.equal(approved.status,'APPROVED');assert.deepEqual(await db.serial(tx=>service.review(tx,actor(1),owner.id,review)),approved);
  assert.equal(await db.customer.count(),customerCount);assert.equal(await db.partnerIdentityBinding.count({where:{ownerId:owner.id}}),0);
  assert.equal((await db.ownerVehicle.findUnique({where:{vehicleId:v.id}}))?.status,'APPROVED');assert.equal((await db.partnerRevenueRuleVersion.findUnique({where:{id:rule.id}}))?.status,'APPROVED');
  assert.equal((await db.serial(tx=>approvedPartner(tx,owner))).verification.id,batch.id);assert.equal((await readOwnerCooperationReady(db,owner.id,v.id,'2026-11-01','2027-11-01')).ready,true);
  const businessHash=(await db.archiveVersion.findUnique({where:{id:a.versionId}}))!.businessSnapshotHash;
  await db.serial(tx=>service.update(tx,actor(0),owner.id,{revision:0,idempotencyKey:randomUUID(),contactKind:'ORDINARY',contactRevision:0,profile:{subjectType:'INDIVIDUAL',name:owner.name,address:owner.address,contactPhone:'13900000000'}}));
  const current=await db.vehicleOwner.findUnique({where:{id:owner.id}});assert.equal(current!.revision,0);assert.equal((await db.serial(tx=>approvedPartner(tx,current))).verification.id,batch.id);assert.equal((await readOwnerCooperationReady(db,owner.id,v.id,'2026-11-01','2027-11-01')).ready,true);assert.equal((await db.archiveVersion.findUnique({where:{id:a.versionId}}))!.businessSnapshotHash,businessHash);
  await db.serial(tx=>service.update(tx,actor(0),owner.id,{revision:0,idempotencyKey:randomUUID(),profile:{subjectType:'INDIVIDUAL',name:'合成实质变更',address:owner.address,contactPhone:owner.contactPhone}}));await assert.rejects(db.serial(async tx=>approvedPartner(tx,await tx.vehicleOwner.findUnique({where:{id:owner.id}}))),error('OWNER_BUSINESS_UNVERIFIED'));
 }finally{await db.$disconnect();}
});
