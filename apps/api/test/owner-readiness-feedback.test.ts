import './legacy-esign-mode';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerH5Service} from '../src/owner-h5/service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {OwnerService} from '../src/owner-signing/owner.service';
import {buildLessorSnapshot} from '../src/owner-signing/lessor';

const envKeys=['SESSION_SECRET','OWNER_ONBOARDING_ENABLED','OWNER_CONTRACTS_ENABLED','OWNER_AUTHORIZATION_ENABLED','OWNER_AUTHORIZATION_SCOPE_VERSION'] as const;
const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
before(()=>{process.env.SESSION_SECRET='synthetic-readiness-test-secret-32-characters';process.env.OWNER_ONBOARDING_ENABLED='true';process.env.OWNER_CONTRACTS_ENABLED='true';process.env.OWNER_AUTHORIZATION_ENABLED='true';process.env.OWNER_AUTHORIZATION_SCOPE_VERSION='2';});
after(()=>{for(const key of envKeys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});

function fixture(){
 const now=new Date(),customer={id:'customer',mobile:'19900000001'};
 const profile={name:'测试法人',mobileHash:ownerMobileHash(customer.mobile),maskedMobile:'199****0001',revision:1};
 const account:any={realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'private-certificate',providerCustomerId:'private-provider',managerCustomerId:customer.id,verificationTransactionNo:'private-verification',checkedAt:now,consentedAt:now,leaseToken:null,leaseUntil:null,consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:customer.id,legalRevision:1,legalName:profile.name,legalMobileHash:profile.mobileHash}};
 const seal:any={id:'seal',status:'ACTIVE',checkedAt:now,imageHash:'a'.repeat(64),providerCustomerId:account.providerCustomerId};
 const owner:any={id:'owner',name:'合成企业',creditCode:'913100000000000001',address:'合成地址',contactPhone:'19900000002',status:'VERIFIED',revision:1,esignAccount:account,legalRepresentative:profile,seals:[seal],authorities:[]};
 const member:any={id:'member',customerId:customer.id,ownerId:owner.id,status:'VERIFIED',verifiedSerialNo:account.verificationTransactionNo,customer,owner};
 const binding:any={id:'binding',status:'APPROVED',reviewedBy:'operator',reviewedAt:now,revision:1,evidenceFileId:'file',owner};
 const db:any={customer:{findUnique:async()=>customer},ownerMember:{findUnique:async()=>member,findMany:async()=>[member]},ownerVehicle:{findMany:async()=>[{vehicleId:'vehicle'}],findUnique:async()=>({...binding,owner:{...owner,seals:owner.seals.filter((s:any)=>s.status==='ACTIVE')}})},storedFile:{findUnique:async()=>({sha256:'b'.repeat(64)})},legalDocument:{findFirst:async({where}:any)=>({id:where.type,type:where.type,version:3,title:'合成文案',content:where.type==='owner-data-sharing'?'向{{lessorName}}提供本单信息':'合成正文',confirmedBy:'operator',confirmedAt:now})}};
 db.virtualAcceptanceScope={findFirst:async()=>null};
 for(const model of ['vehicleDocumentFile','assetPrivateFile','vehicleInspectionFile','electronicFileQuarantine'])db[model]={count:async()=>0};db.storedFile.count=async()=>0;
 db.ownerSeal={findMany:async()=>owner.seals};
 const service=new OwnerH5Service(db,new OwnerService(db),{} as any,{} as any,{enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true} as any);
 return{account,seal,owner,member,binding,service,db,detail:()=>service.detail(customer.id,owner.id) as Promise<any>,list:()=>service.list(customer.id) as Promise<any[]>};
}

test('stale historical certification and selected seal say refresh required in both list and detail',async()=>{
 const f=fixture();f.account.checkedAt=f.seal.checkedAt=new Date(Date.now()-86400001);
 const detail=await f.detail(),list=await f.list();
 assert.equal(detail.verificationDisplay?.state,'REFRESH_REQUIRED');
 assert.equal(detail.verificationDisplay.label,'待更新核验');
 assert.equal(detail.verificationDisplay.certification.state,'REFRESH_REQUIRED');
 assert.equal(detail.verificationDisplay.seal.state,'REFRESH_REQUIRED');
 assert.match(detail.verificationDisplay.seal.label,/已选/);
 assert.deepEqual(list[0].verificationDisplay,detail.verificationDisplay);
 assert.equal(detail.certificationComplete,false);assert.equal(detail.capabilities.canRefreshVerification,true);assert.equal(detail.capabilities.canSelectSeal,false);
 assert.equal(detail.realNameStatus,'VERIFIED');assert.equal(detail.certStatus,'BOUND');assert.equal(detail.seals[0].status,'ACTIVE');
 assert.doesNotMatch(detail.blockers.join('；'),/已过期|选择本企业印章/);
 assert.doesNotMatch(JSON.stringify(detail.verificationDisplay),/private-|legalMobileHash/);
});

test('incomplete real-name evidence never displays historic certification as ready',async()=>{
 const f=fixture();f.owner.status='DRAFT';f.member.status='CLAIMED';f.account.realNameStatus='PENDING';
 const detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'INCOMPLETE');assert.equal(detail.verificationDisplay.certification.state,'INCOMPLETE');assert.equal(detail.certificationComplete,false);
 assert.match(detail.verificationDisplay.certification.message,/法人|认证/);
});

test('unknown certificate is distinguished from a stale bound certificate',async()=>{
 const f=fixture();f.account.certStatus='UNKNOWN';f.account.certSerialNo=null;
 const detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'INCOMPLETE');assert.equal(detail.verificationDisplay.certification.state,'INCOMPLETE');assert.match(detail.verificationDisplay.certification.message,/尚未确认有效/);assert.doesNotMatch(detail.verificationDisplay.certification.message,/已过期/);assert.equal(detail.certificationComplete,false);
});

test('fresh certification with no selected seal asks for selection',async()=>{
 const f=fixture();f.seal.status='DISCOVERED';
 const detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'INCOMPLETE');assert.equal(detail.verificationDisplay.certification.state,'VERIFIED');assert.equal(detail.verificationDisplay.seal.state,'NOT_SELECTED');assert.match(detail.verificationDisplay.seal.message,/选用/);assert.equal(detail.certificationComplete,true);assert.equal(detail.capabilities.canSelectSeal,true);
});

test('selected seal with stale evidence stays selected but requires refresh',async()=>{
 const f=fixture();f.seal.checkedAt=new Date(Date.now()-86400001);
 const detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'REFRESH_REQUIRED');assert.equal(detail.verificationDisplay.certification.state,'VERIFIED');assert.equal(detail.verificationDisplay.seal.state,'REFRESH_REQUIRED');assert.match(detail.verificationDisplay.seal.label,/已选/);assert.doesNotMatch(detail.blockers.join('；'),/选择本企业印章/);assert.equal(detail.readyForSigning,false);
});

test('fresh matching evidence displays ready without exposing supplier identifiers',async()=>{
 const f=fixture(),detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'READY');assert.equal(detail.verificationDisplay.certification.state,'VERIFIED');assert.equal(detail.verificationDisplay.seal.state,'READY');assert.equal(detail.certificationComplete,true);assert.equal(detail.readyForSigning,true);assert.doesNotMatch(JSON.stringify((await f.list())[0]),/private-|consentSnapshot/);
});

test('selected seal with mismatched enterprise binding is never displayed ready or exposed',async()=>{
 const f=fixture();f.seal.providerCustomerId='private-other-enterprise';
 const detail=await f.detail(),list=await f.list();
 assert.equal(detail.verificationDisplay?.state,'INCOMPLETE');assert.equal(detail.verificationDisplay.seal.state,'UNAVAILABLE');assert.equal(detail.verificationDisplay.seal.label,'印章归属待核对');assert.match(detail.verificationDisplay.seal.message,/归属.*不匹配/);
 assert.deepEqual(list[0].verificationDisplay,detail.verificationDisplay);assert.doesNotMatch(JSON.stringify(detail.verificationDisplay),/private-|providerCustomerId/);assert.doesNotMatch(JSON.stringify(list[0]),/private-|providerCustomerId/);
});

test('future account time and in-flight query retain existing H5 capability gates',async()=>{
 const f=fixture();f.account.checkedAt=new Date(Date.now()+60000);
 let detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'REFRESH_REQUIRED');assert.equal(detail.certificationComplete,false);assert.equal(detail.capabilities.canSelectSeal,false);
 f.account.checkedAt=new Date();f.account.leaseToken='lease';f.account.leaseUntil=new Date(Date.now()+60000);
 detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'PROCESSING');assert.equal(detail.capabilities.canRefreshVerification,false);assert.equal(detail.capabilities.canSelectSeal,false);
});

test('current legal consent mismatch stays incomplete and cannot offer refresh',async()=>{
 const f=fixture();f.account.consentSnapshot.legalRevision=0;
 const detail=await f.detail();assert.equal(detail.verificationDisplay?.state,'INCOMPLETE');assert.equal(detail.certificationComplete,false);assert.equal(detail.capabilities.canRefreshVerification,false);
});

test('displayed seal defects and unfinished queries cannot advertise signing capabilities',async()=>{
 for(const defect of ['different-provider','multiple-seals','future-seal','unfinished-query']){
  const f=fixture();
  if(defect==='different-provider')f.seal.providerCustomerId='unrelated-private-provider';
  if(defect==='multiple-seals')f.owner.seals.push({...f.seal,id:'seal-two'});
  if(defect==='future-seal')f.seal.checkedAt=new Date(Date.now()+60000);
  if(defect==='unfinished-query'){f.account.leaseToken='unfinished';f.account.leaseUntil=new Date(0);}
  const detail=await f.detail();
  assert.notEqual(detail.verificationDisplay.state,'READY',defect);
  assert.equal(detail.readyForSigning,false,defect);
  assert.equal(detail.capabilities.canRequestAuthority,false,defect);
  assert.equal(detail.capabilities.canEnableAuthority,false,defect);
  assert.ok(detail.blockers.length>0,defect);
 }
});

async function lessorError(f:ReturnType<typeof fixture>){
 try{await buildLessorSnapshot(f.db,'vehicle');assert.fail('expected lessor rejection');}catch(error:any){assert.equal(error.getResponse?.().error?.code,'OWNER_NOT_READY');return error.getResponse().error.message as string;}
}
test('final quote reports stale verification without claiming certificate expiry',async()=>{
 const f=fixture();f.account.checkedAt=new Date(Date.now()-86400001);const message=await lessorError(f);assert.match(message,/24小时|更新核验/);assert.match(message,/法人本人/);assert.doesNotMatch(message,/证书.*已过期|记录.*变化/);
});
test('final quote identifies actual missing enterprise, certificate and seal evidence',async()=>{
 const unverified=fixture();unverified.owner.status='DRAFT';assert.match(await lessorError(unverified),/企业.*实名|企业.*认证/);
 const cert=fixture();cert.account.certStatus='UNKNOWN';assert.match(await lessorError(cert),/尚未确认有效.*证书/);
 const seal=fixture();seal.seal.status='DISCOVERED';assert.match(await lessorError(seal),/尚未选用/);
 const mismatch=fixture();mismatch.seal.providerCustomerId='different-provider';assert.match(await lessorError(mismatch),/归属|匹配/);
});
test('lessor diagnostics retain the original lease and freshness gates without adopting display-only checks',async()=>{
 const f=fixture();f.account.leaseToken='expired-lease';f.account.leaseUntil=new Date(0);assert.match(await lessorError(f),/处理|核验任务/);
 f.account.leaseToken=null;f.account.checkedAt=new Date(Date.now()+60000);f.seal.checkedAt=new Date(0);
 const snapshot=await buildLessorSnapshot(f.db,'vehicle');assert.equal(snapshot.ownerId,f.owner.id);
 f.binding.status='DRAFT';await assert.rejects(buildLessorSnapshot(f.db,'vehicle'),(error:any)=>error.getResponse?.().error?.code==='OWNER_VEHICLE_REQUIRED');
});

test('completed current identity remains complete and cannot start again regardless of certificate freshness',async()=>{
 for(const state of ['fresh','stale','UNKNOWN','EXPIRED']){
  const f=fixture();if(state==='stale')f.account.checkedAt=new Date(0);if(['UNKNOWN','EXPIRED'].includes(state))f.account.certStatus=state;
  const d=await f.detail();assert.equal(d.verificationDisplay.identity?.complete,true,state);assert.equal(d.capabilities.canStartVerification,false,state);
 }
 const changed=fixture();changed.account.consentSnapshot.legalRevision=0;assert.equal((await changed.detail()).verificationDisplay.identity?.complete,false);
});

test('historical verification is not a current pending attempt after representative or actor changes',async()=>{
 for(const change of ['revision','actor','manager']){
  const f=fixture();if(change==='revision')f.account.consentSnapshot.legalRevision=0;if(change==='actor')f.account.consentSnapshot.customerId='previous-actor';if(change==='manager')f.account.managerCustomerId='previous-manager';
  const d=await f.detail();assert.equal(d.verificationDisplay.identity.complete,false,change);assert.equal(d.verificationDisplay.identity.currentAttempt,false,change);assert.equal(d.verificationDisplay.identity.state,'REAUTH_REQUIRED',change);assert.equal(d.capabilities.canStartVerification,true,change);
 }
});
test('only current pending proof can offer continuation and unknown or leased proof stays blocked',async()=>{
 const f=fixture();f.owner.status='DRAFT';f.member.status='CLAIMED';f.account.realNameStatus='PENDING';
 let d=await f.detail();assert.equal(d.verificationDisplay.identity.currentAttempt,true);assert.equal(d.verificationDisplay.identity.state,'PENDING');assert.equal(d.capabilities.canStartVerification,true);
 f.account.leaseToken='synthetic-lease';f.account.leaseUntil=new Date(Date.now()+60000);d=await f.detail();assert.equal(d.verificationDisplay.identity.state,'PROCESSING');assert.equal(d.capabilities.canStartVerification,false);
 f.account.leaseToken=null;f.account.leaseUntil=null;f.account.verificationTransactionNo=null;f.account.realNameStatus='VERIFY_UNKNOWN';d=await f.detail();assert.equal(d.verificationDisplay.identity.currentAttempt,false);assert.equal(d.capabilities.canStartVerification,false);
});
