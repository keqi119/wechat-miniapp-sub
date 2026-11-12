import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineLessorSnapshot,confirmOfflineLessor,lessorIdentityHash} from '../src/owner-signing/lessor';
import {hash} from '../src/common/data';
import {OwnerH5Service} from '../src/owner-h5/service';
import {OwnerH5ContractsService} from '../src/owner-h5/contracts.service';
import {OwnerH5AuthController} from '../src/owner-h5/auth.controller';
import {Db} from '../src/common/db';
import {PartnerAdmissionService} from '../src/partners/admission';
import {PartnerIdentityService,requirePartnerIdentity} from '../src/partners/identity';
import {randomUUID} from 'node:crypto';
function fixture(){
 const owner:any={id:'owner',subjectType:'INDIVIDUAL',name:'测试个人',creditCode:null,address:'测试地址',contactPhone:'13800000000',revision:4,status:'DRAFT'};
 const domains=['SUBJECT','VEHICLE','ARCHIVE','RULE'].map(domain=>({domain,resourceId:domain,revision:1,hash:'a'.repeat(64)}));
 const verification:any={id:'verify',revision:2,status:'APPROVED',profileRevision:4,submittedBy:'maker',reviewedBy:'other',reviewedAt:new Date(),domainVersions:domains,completedActions:domains.map(d=>`${d.domain}:${d.resourceId}`),submissionHash:'c'.repeat(64)};
 const scope={vehicleIds:['v'],validFrom:'2026-01-01',validUntil:'2028-12-31'};
 const version:any={id:'av',status:'ARCHIVED',scopeSnapshot:scope,businessSnapshotHash:hash({ownerId:'owner',revision:4,scope})};
 const tx:any={vehicleDocumentFile:{count:async()=>0},assetPrivateFile:{count:async()=>0},archiveFeedback:{count:async()=>0},$queryRaw:async()=>[],ownerVehicle:{findUnique:async()=>({id:'binding',ownerId:'owner',owner,vehicleId:'v',status:'APPROVED',reviewedBy:'other',reviewedAt:new Date(),evidenceFileId:'e',revision:1})},vehicleOwner:{findUnique:async()=>owner},partnerCooperationSubmission:{findFirst:async()=>verification},storedFile:{findUnique:async()=>({id:'e',sha256:'a'.repeat(64)})},documentArchive:{findFirst:async()=>({id:'a',currentApprovedVersionId:'av',versions:[version]})},legalDocument:{findFirst:async(q:any)=>({id:q.where.type,version:1,title:'测试',content:q.where.type==='owner-data-sharing'?'{{lessorName}} {{lessorCreditCode}} {{lessorAddress}} {{lessorPhone}}':'合同',confirmedBy:'other',confirmedAt:new Date()})}};
 return{owner,verification,version,tx};
}
test('offline_owner_needs_no_provider_certificate and frozen lessor includes term and cooperation',async()=>{const f=fixture();const s=await buildOfflineLessorSnapshot(f.tx,'v',{startDate:'2026-11-01',endDate:'2027-11-01'});assert.equal(s.subjectType,'INDIVIDUAL');assert.equal(s.creditCode,null);assert.equal(s.cooperationVersionId,'av');assert.ok(!JSON.stringify(s).includes('provider'));const before=JSON.stringify(s);f.owner.name='修改后的姓名';assert.equal(JSON.stringify(s),before);});
test('invite_or_sms_alone_does_not_verify_owner and changed profile revokes access',async()=>{for(const kind of ['pending','changed','range']){const f=fixture();if(kind==='pending')f.verification.status='SUBMITTED';if(kind==='changed')f.owner.revision++;if(kind==='range')f.version.scopeSnapshot.validUntil='2026-10-01';await assert.rejects(buildOfflineLessorSnapshot(f.tx,'v',{startDate:'2026-11-01',endDate:'2027-11-01'}));}});
test('offline lessor confirmation revalidates exact profile, binding and cooperation',async()=>{const f=fixture(),s=await buildOfflineLessorSnapshot(f.tx,'v',{startDate:'2026-11-01',endDate:'2027-11-01'}),input={accepted:true,lessorHash:lessorIdentityHash(s),noticeHash:s.sharingNotice.contentHash};assert.equal((await confirmOfflineLessor(f.tx,'customer','v',s,input)).ownerId,'owner');f.owner.contactPhone='13900000000';await assert.rejects(confirmOfflineLessor(f.tx,'customer','v',s,input));});
test('OFFLINE H5 initiation rejects before identity or signing providers are called',async()=>{const before=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';let calls=0;const provider:any={startLegal:async()=>{calls++},ownerSign:async()=>{calls++}};try{const service=new OwnerH5Service({} as any,{} as any,provider,{} as any,{} as any);await assert.rejects(service.verification('c','o',{}));const contracts=new OwnerH5ContractsService({} as any,{} as any,provider,{} as any);await assert.rejects(contracts.sign('c','o','task',{}));assert.equal(calls,0);}finally{if(before===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=before;}});
test('database legacy customer identity cannot create an independent portal grant or trigger SMS',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const seed=randomUUID(),customer=await db.customer.create({data:{mobile:'139'+String(Date.now()).slice(-8)}}),owner=await db.vehicleOwner.create({data:{subjectType:'INDIVIDUAL',name:'合成历史个人',address:'合成地址',createdBy:'synthetic-maker'}});
  const relation=await db.partnerIdentityBinding.create({data:{ownerId:owner.id,customerId:customer.id,relationship:'SELF',profileRevision:0,revision:1,evidenceFileIds:[],status:'APPROVED',submittedBy:'synthetic-maker',reviewedBy:'synthetic-reviewer',reviewedAt:new Date()}});
  await db.partnerVerification.create({data:{ownerId:owner.id,revision:1,profileRevision:0,subjectType:'INDIVIDUAL',identityBindingId:relation.id,identityBindingRevision:1,evidenceFileIds:[],status:'APPROVED',submittedBy:'synthetic-maker',reviewedBy:'synthetic-reviewer',reviewedAt:new Date()}});
  let sms=0;const auth=new OwnerH5AuthController(db,{requestSmsChallenge:async()=>{sms++;return{challengeId:'synthetic'}}} as any),challenge=await auth.sms({mobile:customer.mobile});
  assert.equal(sms,0);assert.equal(await db.partnerPortalAccess.count({where:{ownerId:owner.id}}),0);assert.equal((await db.partnerPortalChallenge.findUnique({where:{id:challenge.challengeId}}))?.status,'DECOY');
  await assert.rejects(requirePartnerIdentity(db,{customerId:customer.id},owner.id));
 }finally{await db.$disconnect();}
});
