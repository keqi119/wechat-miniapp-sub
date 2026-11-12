import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {applicationCooperationEligible} from '../src/vehicles/application-eligibility';
import {buildOfflineLessorSnapshot,confirmOfflineLessor,lessorIdentityHash} from '../src/owner-signing/lessor';
import {readRevenueRuleSnapshot} from '../src/partners/revenue-rules';
import {readOwnerCooperationReady} from '../src/offline-documents/readiness';
import {deliveryBusinessReady} from '../src/orders/business-gates';

const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const env={skip:process.env.NODE_ENV!=='test'};
async function fixture(){
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.port==='55432'&&url.pathname==='/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),suffix=randomUUID();
 const operator=await db.adminUser.create({data:{username:'simple-'+suffix,name:'合成运营',role:'OPERATIONS',passwordHash:'unused-synthetic',partnerCapabilities:[]}});
 const actor={id:operator.id,role:operator.role,authVersion:operator.authVersion};
 const file=await db.storedFile.create({data:{adminId:actor.id,name:'合成协议.pdf',purpose:'contract',mimeType:'application/pdf',size:10,sha256:'a'.repeat(64),storagePath:'synthetic-never-read'}});
 const vehicle=await db.vehicle.create({data:{title:'合成测试车',brand:'Synthetic',model:'Sample',year:2026,city:'上海',mileageKm:0,plateNumber:'合成'+suffix.slice(0,6)}});
 return{db,actor,file,vehicle};
}
const save=(fileId:string,vehicleId:string,extra:any={})=>({revision:0,idempotencyKey:randomUUID(),status:'ACTIVE',fileIds:[fileId],vehicleIds:[vehicleId],partnerRateBps:0,...extra});

test('simple protocol with absent optional contact and old review metadata is eligible for an application',async()=>{
 const previous=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{
  const owner={id:'owner',name:'合成公司',status:'DRAFT',cooperationMode:'SIMPLE'},version={id:'version',agreementId:'agreement',ownerId:'owner',status:'ACTIVE',version:1,title:'合成协议',fileIds:['file'],vehicleIds:['vehicle'],partnerRateBps:0,contentHash:'a'.repeat(64)};
  const db:any={vehicleOperationalRestriction:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},partnerAgreementVehicle:{findUnique:async()=>({vehicleId:'vehicle',ownerId:'owner',agreementId:'agreement',agreementVersionId:'version'})},partnerAgreement:{findUnique:async()=>({id:'agreement',ownerId:'owner',status:'ACTIVE',currentVersionId:'version'})},partnerAgreementVersion:{findUnique:async()=>version},vehicleOwner:{findUnique:async()=>owner},vehicle:{findUnique:async()=>({id:'vehicle',model:'Sample'})},storedFile:{findMany:async()=>[{id:'file',adminId:'maker',purpose:'contract',mimeType:'application/pdf',sha256:'b'.repeat(64)}]},ownerVehicle:{findUnique:async()=>null}};
  Object.assign(db,{vehicleInspectionFile:{count:async()=>0},electronicFileQuarantine:{count:async()=>0}});db.storedFile.count=async()=>0;
  assert.equal(await applicationCooperationEligible(db,'vehicle',12,new Date('2026-10-28T00:00:00Z')),true);
 }finally{if(previous===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=previous;}
});

test('delivery retains the frozen simple owner and ratio after the current vehicle agreement changes',async()=>{
 const revenue={mode:'SIMPLE_AGREEMENT',ownerId:'old-owner',vehicleId:'vehicle',agreementId:'agreement',agreementVersionId:'old-version',versionId:'old-version',contentHash:'a'.repeat(64),partnerRateBps:2500};
 const lessor={version:4,mode:'SIMPLE_AGREEMENT',executionMode:'OFFLINE',ownerId:'old-owner',vehicleId:'vehicle',agreementId:'agreement',agreementVersionId:'old-version',agreementHash:'a'.repeat(64),partnerRateBps:2500};
 const version={id:'old-version',agreementId:'agreement',ownerId:'old-owner',status:'ACTIVE',fileIds:['file'],vehicleIds:['vehicle'],partnerRateBps:2500,contentHash:'a'.repeat(64)};
 const tx:any={vehicleOperationalRestriction:{count:async()=>0},vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},$queryRaw:async()=>[],order:{findUnique:async()=>({id:'order',vehicleId:'vehicle',customerId:'customer',contractMode:'OFFLINE',finalPlanSnapshot:{startDate:'2026-10-28',months:12,lessorSnapshot:lessor,revenueRuleSnapshot:revenue}})},vehicleOwner:{findUnique:async()=>({id:'old-owner',name:'后续资料变更',status:'DRAFT'})},ownerVehicle:{findUnique:async()=>({ownerId:'new-owner',status:'APPROVED'})},partnerAgreementVersion:{findUnique:async()=>version},storedFile:{findMany:async()=>[{id:'file',adminId:'maker',purpose:'contract',mimeType:'application/pdf',sha256:'b'.repeat(64)}]}};
 Object.assign(tx,{vehicleInspectionFile:{count:async()=>0},electronicFileQuarantine:{count:async()=>0},vehicle:{findUnique:async()=>({id:'vehicle',virtualAcceptanceScopeId:null})}});tx.storedFile.count=async()=>0;
 const gate=await deliveryBusinessReady(tx,'order');
 assert.equal(gate.blockers.some(blocker=>blocker.resourceType==='partners'),false);
 revenue.partnerRateBps=7500;
 assert.ok((await deliveryBusinessReady(tx,'order')).blockers.some(blocker=>blocker.code==='SIMPLE_AGREEMENT_SNAPSHOT_MISMATCH'));
});

test('database simple agreement saves with only name file explicit ratio and vehicle, with no fabricated review',env,async()=>{
 const {SimpleAgreementService,readSimpleAgreementSnapshot}=await import('../src/partners/simple-agreements');
 const f=await fixture(),{db,actor,file,vehicle}=f;try{
  const service=new SimpleAgreementService(),body={profile:{name:'合成简化公司',subjectType:'ENTERPRISE'},idempotencyKey:randomUUID()};
  const owner=await db.serial(tx=>service.create(tx,actor,body));assert.equal(owner.address,'');assert.equal(owner.creditCode,null);assert.equal(owner.cooperationMode,'SIMPLE');
  assert.equal((await db.serial(tx=>service.create(tx,actor,body))).id,owner.id);
  const input=save(file.id,vehicle.id),agreement=await db.serial(tx=>service.save(tx,actor,owner.id,input));
  assert.equal(agreement.status,'ACTIVE');assert.equal(agreement.currentVersion.partnerRateBps,0);assert.equal(agreement.currentVersion.title,file.name);
  assert.equal((await db.serial(tx=>service.save(tx,actor,owner.id,input))).id,agreement.id);
  assert.equal(await db.ownerVehicle.count({where:{vehicleId:vehicle.id}}),0);assert.equal(await db.partnerCooperationSubmission.count({where:{ownerId:owner.id}}),0);
  const snapshot=await readSimpleAgreementSnapshot(db,vehicle.id,{startDate:'2026-10-28',endDate:'2027-10-27'});
  assert.equal(snapshot!.mode,'SIMPLE_AGREEMENT');assert.equal(snapshot!.ownerId,owner.id);assert.equal(snapshot!.partnerRateBps,0);assert.equal(snapshot!.validFrom,null);
  assert.deepEqual(await readRevenueRuleSnapshot(db,owner.id,vehicle.id,'2026-10-28','2027-10-27'),snapshot);
  assert.equal((await readOwnerCooperationReady(db,owner.id,vehicle.id,'2026-10-28','2027-10-27')).ready,true);
  const draft=await db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{status:'DRAFT',partnerRateBps:null,vehicleIds:[]})));
  assert.ok(draft.missingFields.includes('partnerRateBps'));assert.equal(draft.currentVersion.partnerRateBps,null);
  await assert.rejects(db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{partnerRateBps:null}))),error('SIMPLE_AGREEMENT_INCOMPLETE'));
  await assert.rejects(db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{fileIds:[]}))),error('SIMPLE_AGREEMENT_INCOMPLETE'));
  await assert.rejects(db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{validFrom:'2020-01-01',validUntil:'2021-01-01'}))),error('SIMPLE_AGREEMENT_EXPIRED'));
  await assert.rejects(db.serial(tx=>service.save(tx,{...actor,authVersion:actor.authVersion+1},owner.id,input)),error('STAFF_SESSION_CHANGED'));
  await db.serial(tx=>service.stop(tx,actor,owner.id,agreement.id,{revision:agreement.revision,idempotencyKey:randomUUID()}));
  assert.equal(await readSimpleAgreementSnapshot(db,vehicle.id),null);await assert.rejects(readRevenueRuleSnapshot(db,owner.id,vehicle.id,'2026-10-28','2027-10-27'),error('SIMPLE_AGREEMENT_REQUIRED'));
 }finally{await db.$disconnect();}
});

test('database explicit vehicle replacement serializes races and preserves previous immutable ratio facts',env,async()=>{
 const {SimpleAgreementService,readSimpleAgreementSnapshot}=await import('../src/partners/simple-agreements');const {db,actor,file,vehicle}=await fixture();try{
  const service=new SimpleAgreementService(),owners=await Promise.all(['原公司','新公司甲','新公司乙'].map(name=>db.serial(tx=>service.create(tx,actor,{profile:{name},idempotencyKey:randomUUID()}))));
  const original=await db.serial(tx=>service.save(tx,actor,owners[0].id,save(file.id,vehicle.id,{partnerRateBps:2500}))),frozen=await readSimpleAgreementSnapshot(db,vehicle.id);
  const otherFiles=await Promise.all(owners.slice(1).map((_,i)=>db.storedFile.create({data:{adminId:actor.id,name:`合成协议${i}.pdf`,purpose:'contract',mimeType:'application/pdf',size:10,sha256:'c'.repeat(64),storagePath:'synthetic'}})));
  await assert.rejects(db.serial(tx=>service.save(tx,actor,owners[1].id,save(otherFiles[0].id,vehicle.id))),error('SIMPLE_VEHICLE_CONFLICT'));
  const binding=await (db as any).partnerAgreementVehicle.findUnique({where:{vehicleId:vehicle.id}});
  const attempts=await Promise.allSettled(owners.slice(1).map((owner,i)=>db.serial(tx=>service.save(tx,actor,owner.id,save(otherFiles[i].id,vehicle.id,{partnerRateBps:7500,replacements:[{vehicleId:vehicle.id,agreementId:original.id,revision:binding.revision}]})))));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
  const current=await readSimpleAgreementSnapshot(db,vehicle.id);assert.equal(current!.partnerRateBps,7500);assert.equal(frozen!.partnerRateBps,2500);assert.notEqual(current!.ownerId,frozen!.ownerId);
  assert.equal((await (db as any).partnerAgreementVersion.findUnique({where:{id:frozen!.agreementVersionId}})).partnerRateBps,2500);
  await assert.rejects(service.readFile(db,owners[1].id,original.id,file.id),error('NOT_FOUND'));
 }finally{await db.$disconnect();}
});

test('database v4 lessor resolves optional notice fields and changing ratio invalidates only unconfirmed quotes',env,async()=>{
 const {SimpleAgreementService}=await import('../src/partners/simple-agreements');const {db,actor,file,vehicle}=await fixture();try{
  const service=new SimpleAgreementService(),owner=await db.serial(tx=>service.create(tx,actor,{profile:{name:'合成无联系资料公司'},idempotencyKey:randomUUID()}));
  const agreement=await db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{partnerRateBps:6200})));
  for(const type of ['OFFLINE_RENTAL','owner-data-sharing']){const latest=await db.legalDocument.aggregate({where:{type},_max:{version:true}});await db.legalDocument.create({data:{type,title:'合成测试告知',content:type==='OFFLINE_RENTAL'?'合成租赁正文':'出租方{{lessorName}}；代码{{lessorCreditCode}}；地址{{lessorAddress}}；电话{{lessorPhone}}',version:(latest._max.version||0)+1,status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:actor.id}});}
  const snapshot:any=await db.serial(tx=>buildOfflineLessorSnapshot(tx,vehicle.id,{startDate:'2026-10-28',endDate:'2027-10-27'}));
  assert.equal(snapshot.version,4);assert.equal(snapshot.mode,'SIMPLE_AGREEMENT');assert.ok(snapshot.sharingNotice.content.includes('未登记'));assert.ok(!snapshot.sharingNotice.content.includes('{{'));assert.equal(snapshot.address,'');assert.equal(snapshot.verificationId,undefined);
  const initialHash=lessorIdentityHash(snapshot);
  await db.serial(tx=>service.save(tx,actor,owner.id,save(file.id,vehicle.id,{agreementId:agreement.id,revision:agreement.revision,partnerRateBps:7000})));
  await assert.rejects(db.serial(tx=>confirmOfflineLessor(tx,'synthetic-customer',vehicle.id,snapshot,{accepted:true,lessorHash:initialHash,noticeHash:snapshot.sharingNotice.contentHash})),error('OWNER_LESSOR_CHANGED'));
  assert.equal(snapshot.partnerRateBps,6200);assert.equal(lessorIdentityHash(snapshot),initialHash);
 }finally{await db.$disconnect();}
});

test('database existing approved legacy vehicle owner requires an exact explicit replacement before simple assignment',env,async()=>{
 const {SimpleAgreementService}=await import('../src/partners/simple-agreements');const {db,actor,file,vehicle}=await fixture();try{
  const legacy=await db.vehicleOwner.create({data:{name:'合成原合作商',address:'合成原地址',createdBy:actor.id}}),binding=await db.ownerVehicle.create({data:{ownerId:legacy.id,vehicleId:vehicle.id,status:'APPROVED',revision:4,evidenceFileId:file.id,reviewedBy:actor.id,reviewedAt:new Date(),createdBy:actor.id}});
  const service=new SimpleAgreementService(),next=await db.serial(tx=>service.create(tx,actor,{profile:{name:'合成新合作商'},idempotencyKey:randomUUID()}));
  await assert.rejects(db.serial(tx=>service.save(tx,actor,next.id,save(file.id,vehicle.id))),error('SIMPLE_VEHICLE_CONFLICT'));
  const detail=await service.detail(db,actor,next.id),assignment=detail.vehicleAssignments.find((row:any)=>row.vehicleId===vehicle.id);assert.equal(assignment.agreementId,'legacy:'+binding.id);assert.equal(assignment.revision,4);
  await assert.rejects(db.serial(tx=>service.save(tx,actor,next.id,save(file.id,vehicle.id,{replacements:[{vehicleId:vehicle.id,agreementId:'legacy:'+binding.id,revision:3}]}))),error('REVISION_CONFLICT'));
  await db.serial(tx=>service.save(tx,actor,next.id,save(file.id,vehicle.id,{replacements:[{vehicleId:vehicle.id,agreementId:'legacy:'+binding.id,revision:4}]})));
  assert.equal((await db.ownerVehicle.findUnique({where:{vehicleId:vehicle.id}}))!.ownerId,legacy.id);
 }finally{await db.$disconnect();}
});
