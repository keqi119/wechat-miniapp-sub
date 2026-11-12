import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {seedV31CooperationSources} from './v31-cooperation-fixture';
import {SimpleAgreementService,readSimpleAgreementSnapshot,requireFrozenSimpleAgreement} from '../src/partners/simple-agreements';
import {applicationCooperationEligible} from '../src/vehicles/application-eligibility';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {readDeliveryBusinessReady} from '../src/orders/business-gates';
import {resolveElectronicPreparation,prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {resolveV31SourceIds} from '../src/contract-terms/sources';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {assertPaperSigningAllowed} from '../src/offline-documents/mode';

const local={skip:process.env.NODE_ENV!=='test'};
const code=(expected:string)=>(error:any)=>error.getResponse?.().error?.code===expected;
function restore(key:string,value:string|undefined){if(value===undefined)delete process.env[key];else process.env[key]=value;}
function assertLocal(){const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');}

/** Register real-shaped paper evidence while the synthetic system is still pre-cutover. */
async function historical(db:Db,actor:any,dates:{validFrom?:string;validUntil?:string}={}){
 const service=new SimpleAgreementService(),suffix=randomUUID();
 const owner=await db.serial(tx=>service.create(tx,actor,{profile:{name:'合成历史合作 '+suffix,subjectType:'ENTERPRISE',creditCode:'SYN'+suffix.replaceAll('-','').slice(0,15).toUpperCase(),address:'合成历史公司地址'},idempotencyKey:randomUUID()}));
 const vehicle=await db.vehicle.create({data:{brand:'合成',model:'EV',title:'合成历史合作车辆',year:2026,city:'上海',mileageKm:1,vin:'SYN'+randomUUID().replaceAll('-','').slice(0,14).toUpperCase()}});
 const file=await db.storedFile.create({data:{adminId:actor.id,name:'合成既有合作原件.pdf',mimeType:'application/pdf',purpose:'contract',size:64,sha256:'a'.repeat(64),storagePath:'synthetic-never-read'}});
 const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{
  const agreement=await db.serial(tx=>service.save(tx,actor,owner.id,{...command(),status:'ACTIVE',fileIds:[file.id],vehicleIds:[vehicle.id],partnerRateBps:7500,...dates}));
  return{owner,vehicle,file,agreement,service,actor};
 }finally{restore('NEW_ORDER_CONTRACT_MODE',previous);}
}
async function restrict(db:Db,vehicleId:string,actorId:string){
 const work=await db.assetWorkOrder.create({data:{vehicleId,workOrderNo:'SYN-'+randomUUID(),kind:'MAINTENANCE',occurredAt:new Date(),title:'合成停用',description:'仅本地验证限制',costConfirmationRequired:false,noCostReason:'合成测试',createdBy:actorId,updatedBy:actorId}});
 const file=await db.storedFile.create({data:{adminId:actorId,name:'合成限制依据.pdf',purpose:'evidence',mimeType:'application/pdf',size:64,sha256:'b'.repeat(64),storagePath:'synthetic-never-read'}});
 return db.vehicleOperationalRestriction.create({data:{vehicleId,workOrderId:work.id,scopes:['ALLOCATION','DELIVERY'],reason:'合成运营限制',evidenceFileIds:[file.id],evidenceSnapshot:[{fileId:file.id,sha256:file.sha256}],createdBy:actorId}});
}

test('historical valid cooperation supports public application and an electronic confirmed order without enabling paper writes',local,async()=>{
 assertLocal();const h=new JourneyHarness(),saved={policy:process.env.CUSTOMER_IDENTITY_POLICY,location:process.env.HANDOVER_LOCATION_POLICY_JSON};
 try{
  await h.start();const staff=await h.db.adminUser.findUniqueOrThrow({where:{id:h.maker.id}}),actor={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  const f=await historical(h.db,actor),before=await h.db.partnerAgreementVersion.findUniqueOrThrow({where:{id:f.agreement.currentVersion.id}});
  const platform=await h.db.vehicleOwner.create({data:{name:'上海宁达信息科技有限公司',creditCode:'SYN'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase(),address:'合成平台地址',createdBy:actor.id}}),providerId='SYN-'+randomUUID();
  await h.db.ownerESignAccount.create({data:{ownerId:platform.id,providerCustomerId:providerId}});process.env.FADADA_PLATFORM_CUSTOMER_ID=providerId;
  const sources=await seedV31CooperationSources(h.db,actor.id,f.owner,platform,f.vehicle),plan=await h.publishGoods(f.vehicle.id,sources.productVersionIds[0]);
  await h.db.vehicle.update({where:{id:f.vehicle.id},data:{status:'PUBLISHED',catalogPublished:true}});
  process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';process.env.CUSTOMER_IDENTITY_POLICY='SIGNING_REQUIRED';
  const publicDetail=await h.get(`/public/vehicles/${f.vehicle.id}`,{id:'anonymous',headers:{}});
  assert.equal(publicDetail.vehicle.available,true,'Existing valid cooperation must remain an application source after electronic cutover');
  assert.equal(publicDetail.plans[0].available,true);
  const customer=await h.customer('历史合作电子客户');await h.db.customer.update({where:{id:customer.id},data:{mobile:'138'+Math.floor(10000000+Math.random()*89999999)}});
  const documents=await h.completeProfile(customer,await h.proof(customer,'identity'));
  const locationVersion=((await h.db.legalDocument.aggregate({where:{type:'handover-location'},_max:{version:true}}))._max.version||0)+1;
  const notice=await h.db.legalDocument.create({data:{type:'handover-location',version:locationVersion,title:'合成交付地点告知',content:'合成地点用途',status:'PUBLISHED',confirmedBy:h.reviewer.id,confirmedAt:new Date()}});
  process.env.HANDOVER_LOCATION_POLICY_JSON=JSON.stringify(Object.fromEntries([h.docs.privacy,h.docs.application,notice].map(d=>[d.type,{documentId:d.id,version:d.version,contentHash:hash(d.content)}])));
  const input={vehicleId:f.vehicle.id,subscriptionPlanId:plan.id,profile:{name:'合成历史合作客户',fileIds:[],handoverLocation:{source:'MANUAL',name:'合成场地',address:'上海市合成路交付中心'}},consents:[{documentId:h.docs.application.id,version:h.docs.application.version}],idempotencyKey:randomUUID()};
  const application=await h.post('/customer/applications',input,customer);
  assert.equal((await h.post('/customer/applications',input,customer)).id,application.id);
  await h.post(`/admin/applications/${application.id}/review`,{decision:'IN_REVIEW',note:'合成检查'});
  const qs=await h.get(`/admin/customers/${customer.id}/qualifications`);
  const q=await h.post(`/admin/customers/${customer.id}/qualifications`,{...command(),profileHash:qs.profileHash,verificationSource:'MANUAL',identityFileIds:[documents.identityFront.id,documents.identityBack.id],drivingLicenseFileIds:[documents.drivingLicense.id],identityLongTerm:true,drivingLicenseLongTerm:true});
  await h.post(`/admin/customers/${customer.id}/qualifications/reviews`,{...command(q.revision),qualificationId:q.id,decision:'APPROVED'},h.reviewer);
  const consent=await h.post(`/customer/applications/${application.id}/credit-consent`,{documentId:h.docs['credit-verification'].id,version:h.docs['credit-verification'].version,decision:'ACCEPT',idempotencyKey:randomUUID()},customer);
  const credit=await h.post(`/admin/applications/${application.id}/credit-verifications`,{consentId:consent.consent.id,creditRevision:consent.creditRevision,band:'B700_749',customerPresented:true,idempotencyKey:randomUUID()});
  const defaults=await h.get(`/admin/applications/${application.id}/final-plan-defaults`);
  const draft=await h.post(`/admin/applications/${application.id}/final-plan`,{...defaults.values,...command(application.revision),creditVerificationId:credit.verification.id,months:6,commercialTerms:{...defaults.values.commercialTerms,customerAddress:'合成客户联系地址'},startDate:'2026-11-12'});
  assert.equal(draft.finalPlan.contractMode,'ELECTRONIC');assert.equal(draft.finalPlan.reviewStatus,'DRAFT');
  await h.post(`/admin/applications/${application.id}/risk-reviews`,{...command(draft.revision),planRevision:draft.finalPlan.revision,commercialHash:draft.finalPlan.commercialHash,qualificationId:q.id,creditVerificationId:credit.verification.id,decision:'APPROVED',identityChecked:true,drivingQualificationChecked:true,reasonCodes:[],supplementaryInstructions:''},h.reviewer);
  const final=await h.db.finalPlan.findUniqueOrThrow({where:{id:draft.finalPlan.id}}),lessor:any=final.lessorSnapshot;
  const confirmed=await h.post(`/customer/applications/${application.id}/confirm`,{revision:draft.revision,commercialHash:final.commercialHash,ownerSharing:{accepted:true,lessorHash:lessorIdentityHash(lessor),noticeHash:lessor.sharingNotice.contentHash}},customer);
  const order=await h.db.order.findUniqueOrThrow({where:{id:confirmed.id}}),contract=await h.db.contract.findFirstOrThrow({where:{orderId:order.id,kind:'SUBSCRIPTION'}});
  assert.equal(order.contractMode,'ELECTRONIC');assert.equal(contract.executionMode,'ELECTRONIC');assert.equal(contract.status,'DRAFT');
  assert.equal(order.status,'AWAITING_SIGNATURE');assert.equal((order.finalPlanSnapshot as any).lessorSnapshot.agreementVersionId,before.id);
  const preparation=await h.db.serial(tx=>resolveElectronicPreparation(tx,'SUBSCRIPTION',order.id));
  assert.equal(preparation.context.cooperationVersionId,before.id);assert.equal(preparation.kind,'SUBSCRIPTION');
  const delivery=await readDeliveryBusinessReady(h.db,order.id,new Date('2026-11-12T01:00:00Z'));
  assert.deepEqual(delivery.blockers.filter(b=>b.resourceType==='partners'),[],'Historical source must not fail delivery solely because its signing channel was paper');
  await restrict(h.db,f.vehicle.id,actor.id);
  assert.ok((await readDeliveryBusinessReady(h.db,order.id,new Date('2026-11-12T01:00:00Z'))).blockers.some(b=>b.code==='VEHICLE_DELIVERY_RESTRICTED'));
  const missing=await resolveV31SourceIds(h.db,{ownerId:f.owner.id,cooperationVersionId:before.id,customerId:customer.id,vehicleId:f.vehicle.id,productVersionId:sources.productVersionIds[0]});
  assert.ok(missing.missing.some(m=>m.field==='cooperation.scope'));assert.ok(missing.missing.some(m=>m.field==='cooperation.periodAndRate'));
  await assert.rejects(h.db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:order.id,revision:order.revision,idempotencyKey:randomUUID()},actor.id,new ContractPdfArtifactWriterService(h.db))),code('V31_PRODUCT_SOURCE_REQUIRED'));
  assert.equal(await h.db.electronicSigningTask.count({where:{ownerId:f.owner.id}}),0,'Missing real contract facts must not dispatch a signing task');
  assert.throws(assertPaperSigningAllowed,code('PAPER_SIGNING_DISABLED'));
  await h.reject('/admin/offline-archives',{kind:'RENTAL',subjectType:'ORDER',subjectId:order.id,templateId:h.docs.OFFLINE_RENTAL.id,...command()},h.maker,'PAPER_SIGNING_DISABLED');
  await assert.rejects(h.db.serial(tx=>f.service.save(tx,actor,f.owner.id,{...command(f.agreement.revision),agreementId:f.agreement.id,status:'ACTIVE',fileIds:[f.file.id],vehicleIds:[f.vehicle.id],partnerRateBps:7500})),code('ELECTRONIC_COOPERATION_REQUIRED'));
  assert.deepEqual(await h.db.partnerAgreementVersion.findUniqueOrThrow({where:{id:before.id}}),before);
  assert.equal(h.externalCalls+h.identityCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();restore('CUSTOMER_IDENTITY_POLICY',saved.policy);restore('HANDOVER_LOCATION_POLICY_JSON',saved.location);}
});

test('historical cooperation still checks full term current binding owner evidence and operational restrictions in electronic mode',local,async()=>{
 assertLocal();const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),previous=process.env.NEW_ORDER_CONTRACT_MODE;
 try{
  const staff=await db.adminUser.create({data:{username:'historical-guards-'+randomUUID(),name:'合成运营',passwordHash:'synthetic-unused',role:'OPERATIONS'}}),actor={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  const f=await historical(db,actor,{validFrom:'2026-01-01',validUntil:'2028-01-01'});process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
  const range={startDate:'2026-11-12',endDate:'2027-11-11'},snapshot=await readSimpleAgreementSnapshot(db,f.vehicle.id,range);
  assert.ok(snapshot,'Valid historical paper evidence must survive new-order mode changes');
  const binding=await db.partnerAgreementVehicle.findUniqueOrThrow({where:{vehicleId:f.vehicle.id}});
  const lessor={version:4,mode:'SIMPLE_AGREEMENT',executionMode:'ELECTRONIC',ownerId:f.owner.id,vehicleId:f.vehicle.id,bindingRevision:binding.revision,agreementId:snapshot.agreementId,agreementVersionId:snapshot.agreementVersionId,agreementHash:snapshot.contentHash,partnerRateBps:snapshot.partnerRateBps};
  assert.equal((await requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,range)).id,snapshot.agreementVersionId);
  assert.equal(await applicationCooperationEligible(db,f.vehicle.id,12,new Date('2026-11-12T00:00:00Z')),true);
  assert.equal(await applicationCooperationEligible(db,f.vehicle.id,24,new Date('2026-11-12T00:00:00Z')),false);
  assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id,{startDate:'2025-12-31',endDate:'2026-11-30'}),null);
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,{startDate:'2026-11-12',endDate:'2028-11-11'}),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,{...lessor,agreementHash:'0'.repeat(64)},snapshot,range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,{...lessor,bindingRevision:binding.revision+1},snapshot,range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,{...snapshot,partnerRateBps:9999},range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'SUSPENDED'}});
  assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id,range),null);
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await db.vehicleOwner.update({where:{id:f.owner.id},data:{status:'DRAFT'}});
  const restriction=await restrict(db,f.vehicle.id,actor.id);
  assert.equal(await applicationCooperationEligible(db,f.vehicle.id,12,new Date('2026-11-12T00:00:00Z')),false);
  await db.vehicleOperationalRestriction.update({where:{id:restriction.id},data:{status:'RELEASED',revision:{increment:1},releasedBy:actor.id,releasedAt:new Date(),releaseReason:'合成已解除',releaseEvidenceFileIds:restriction.evidenceFileIds,releaseEvidenceSnapshot:restriction.evidenceSnapshot!}});
  await db.storedFile.update({where:{id:f.file.id},data:{purpose:'identity'}});
  assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id,range),null);
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,range));
  await db.storedFile.update({where:{id:f.file.id},data:{purpose:'contract'}});
  await db.partnerAgreement.update({where:{id:f.agreement.id},data:{status:'STOPPED'}});
  assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id,range),null);
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  await db.partnerAgreement.update({where:{id:f.agreement.id},data:{status:'ACTIVE'}});
  const other=await historical(db,actor);
  await db.partnerAgreementVehicle.update({where:{vehicleId:f.vehicle.id},data:{agreementId:other.agreement.id,agreementVersionId:other.agreement.currentVersion.id,ownerId:other.owner.id,revision:{increment:1}}});
  assert.equal(await readSimpleAgreementSnapshot(db,f.vehicle.id,range),null,'A foreign agreement without this vehicle cannot be borrowed');
  await assert.rejects(requireFrozenSimpleAgreement(db,f.vehicle.id,lessor,snapshot,range),code('SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
  assert.equal(await db.electronicSigningTask.count({where:{ownerId:f.owner.id}}),0);
 }finally{await db.$disconnect();restore('NEW_ORDER_CONTRACT_MODE',previous);}
});
