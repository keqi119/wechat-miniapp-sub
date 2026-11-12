import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Db} from '../src/common/db';
import {PlatformAuthorizationService} from '../src/owner-signing/platform-authorization';
import {platformScope} from '../src/owner-signing/platform-scope';
import {OwnerService} from '../src/owner-signing/owner.service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {identityMaterials} from '../src/owner-signing/identity-materials';
import {readPlatformAutomaticAuthority} from '../src/electronic-documents/platform-authorization';
import {listV31Authorities} from '../src/electronic-documents/authority-commands';

let db:Db,s:PlatformAuthorizationService,f:any,admin:any;
const sha='a'.repeat(64),code=(v:string)=>(e:any)=>e.getResponse?.().error?.code===v;
let authorized=false,failed=false,wrongCert=false,archives=0,invalidProof=false;
let queryBarrier:(()=>Promise<void>)|undefined;
const provider:any={createAuthorizationUrl:(i:any)=>({url:'https://textapi17.fadada.com/api2/before_authsign.api?transaction_id='+i.transactionId}),createRevocationUrl:()=>({url:'https://textapi17.fadada.com/api2/cancel_extsign_auto_page.api'}),queryAuthorization:async(i:any)=>{if(queryBarrier)await queryBarrier();if(failed)throw Error('synthetic provider outage');return{...i,authorized,status:authorized?'1':'0'};},queryCertificate:async()=>({bound:true,serialNo:wrongCert?'changed':f.account.certSerialNo,subjectHash:sha,validFrom:f.account.certValidFrom.toISOString(),validUntil:f.account.certValidUntil.toISOString()}),signedEvidence:async(a:any)=>{archives++;const bytes=Buffer.from('%PDF-1.7\nSynthetic authorized grant '+a.providerContractId+'\n%%EOF');const signedAt=new Date();return{bytes,sha256:createHash('sha256').update(bytes).digest('hex'),signedAt,evidence:{version:1,queryHash:sha,verificationHash:invalidProof?null:sha,signedAt:signedAt.toISOString(),signedAtPrecisionMs:1,verified:true,certificateSerialNo:a.certificateSerialNo,finalSha256:createHash('sha256').update(bytes).digest('hex'),subjectHash:sha,contractId:a.providerContractId,transactionId:a.providerTransactionId,customerId:a.providerCustomerId,evidenceHash:sha}};}};
async function fixture(){
 const id=randomUUID().replaceAll('-',''),mobile='138'+String(Date.now()).slice(-8),customer=await db.customer.create({data:{name:'合成法人',mobile}});
 const owner=await db.vehicleOwner.create({data:{name:'合成企业'+id,creditCode:id.slice(0,18).toUpperCase(),address:'合成地址',contactPhone:mobile,createdBy:'fixture',status:'VERIFIED'}});
 const profile=await db.ownerLegalRepresentative.create({data:{ownerId:owner.id,name:customer.name!,mobileHash:ownerMobileHash(mobile),maskedMobile:mobile,revision:1,evidenceHash:sha,createdBy:'fixture',updatedBy:'fixture'}});
 const now=new Date(),account=await db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId:id,managerCustomerId:customer.id,verificationTransactionNo:'V'+id,realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'Cert'+id,certValidFrom:new Date(now.getTime()-86400000),certValidUntil:new Date(now.getTime()+86400000),certCheckedAt:now,certSubjectHash:sha,certEvidenceHash:sha,evidenceHash:sha,checkedAt:now,verifiedAt:now,consentSnapshot:{channel:'OWNER_LEGAL_H5',ownerId:owner.id,customerId:customer.id,legalRevision:1,legalName:profile.name,legalMobileHash:profile.mobileHash,materials:identityMaterials(owner,profile)}}});
 await db.ownerMember.create({data:{ownerId:owner.id,customerId:customer.id,status:'VERIFIED',verifiedAt:now,verifiedSerialNo:account.verificationTransactionNo}});
 const seal=await db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId:account.providerCustomerId!,providerSignatureId:'S'+id,status:'ACTIVE',imageHash:sha,imageCiphertext:'synthetic',checkedAt:now,selectedBy:customer.id,selectedAt:now}});
 const platform=await db.vehicleOwner.create({data:{name:'上海宁达信息科技有限公司',creditCode:('P'+id).slice(0,18).toUpperCase(),address:'合成',contactPhone:mobile,createdBy:'fixture',status:'VERIFIED'}});
 await db.ownerESignAccount.create({data:{ownerId:platform.id,providerCustomerId:'P'+id}});process.env.FADADA_PLATFORM_CUSTOMER_ID='P'+id;
 return{owner,customer,seal,account,platform,request:{scope:platformScope(platform.id,owner.id),sealId:seal.id,accepted:true,idempotencyKey:id}};
}
before(async()=>{Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',ENTERPRISE_ONBOARDING_ENABLED:'true',ESIGN_NEW_REQUESTS_ENABLED:'true',OWNER_AUTHORIZATION_ENABLED:'true',OWNER_AUTHORIZATION_METHOD:'PROVIDER_AUTO_GRANT',OWNER_AUTHORIZATION_SCOPE_VERSION:'3',OWNER_AUTO_SIGNING_ENABLED:'false',FADADA_APP_ID:'synthetic-platform-app',FADADA_BASE_URL:'https://textapi17.fadada.com/api2/',SESSION_SECRET:'synthetic-platform-authority-test-secret'});db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});f=await fixture();admin=await db.adminUser.create({data:{username:'auto-review-'+randomUUID(),name:'合成管理员',passwordHash:'synthetic',role:'ADMIN',active:true}});s=new PlatformAuthorizationService(db,new OwnerService(db),provider,new ContractPdfArtifactWriterService(db));});
after(async()=>{await db?.$disconnect();});
let grant:any;
test('only legal H5 actor can start; server pins grantee/platform/app; repeat request reuses original transaction',async()=>{
 await assert.rejects(s.request(f.customer.id,f.owner.id,f.request),code('OWNER_LEGAL_H5_REQUIRED'));
 await assert.rejects(runOwnerH5(()=>s.request(f.customer.id,f.owner.id,{...f.request,scope:{...f.request.scope,validUntil:'2099-01-01'}})));
 grant=await runOwnerH5(()=>s.request(f.customer.id,f.owner.id,f.request));assert.equal(grant.status,'PENDING');assert.equal(grant.enabled,false);
 const again=await runOwnerH5(()=>s.request(f.customer.id,f.owner.id,{...f.request,idempotencyKey:randomUUID()}));assert.equal(again.id,grant.id);assert.equal(again.url,grant.url);
});
test('not-yet-authorized remains pending; no signature evidence or auto permission is manufactured',async()=>{
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'PENDING');assert.equal(grant.enabled,false);assert.equal(archives,0);
});
test('real channel grant is saved once; full scope review bound to exact signed file then enables without a customer second confirmation',async()=>{
 authorized=true;grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'AUTHORIZED');assert.equal(grant.enabled,false);assert.equal(grant.document.signedAvailable,true);assert.equal(grant.scopeReviewStatus,'PENDING');
 const file=await s.document(f.customer.id,f.owner.id,grant.id,'signed');assert.ok(file.buffer.toString().startsWith('%PDF-'));const count=archives;
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(archives,count);
 const review={revision:grant.revision,signedSha256:file.sha256,granteeName:'上海晓浪网络科技有限公司',platformContracts:true,dualRepresentation:true,accepted:true};
 await assert.rejects(s.reviewScope('wrong',f.owner.id,grant.id,review),code('FORBIDDEN'));
 await assert.rejects(s.reviewScope(admin.id,f.owner.id,grant.id,{...review,signedSha256:'0'.repeat(64)}),code('PLATFORM_AUTH_FILE_CHANGED'));
 grant=await s.reviewScope(admin.id,f.owner.id,grant.id,review);assert.equal(grant.enabled,true);assert.equal(process.env.OWNER_AUTO_SIGNING_ENABLED,'false');
});
test('pause survives successful refresh; explicit resume uses original grant; provider outages disable without erasing archive',async()=>{
 const subject:any={role:'PLATFORM',subjectType:'ENTERPRISE',subjectId:f.owner.id,providerCustomerId:f.account.providerCustomerId,signatureId:f.seal.providerSignatureId,certificate:{serialNo:f.account.certSerialNo}},context:any={autoSigningPolicyVersion:3,authorityCreatedBefore:new Date().toISOString(),kind:'COOPERATION',platformSubjectId:f.platform.id,cooperationVersionId:null,vehicleIds:[]};
 assert.equal((await readPlatformAutomaticAuthority(db,subject,context,new Date()))?.policyVersion,3);
 const frozenGrant=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id},include:{platformEvidence:true}});
 assert.equal(await readPlatformAutomaticAuthority(db,subject,{...context,authorityCreatedBefore:new Date(frozenGrant.platformEvidence!.scopeReviewedAt!.getTime()-1).toISOString()},new Date()),null,'authority completed after task preparation cannot retrofit that task');
 assert.equal(await readPlatformAutomaticAuthority(db,{...subject,role:'OWNER'},context,new Date()),null);
 assert.equal(await readPlatformAutomaticAuthority(db,subject,{...context,platformSubjectId:'wrong'},new Date()),null);
 grant=await s.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:false,revision:grant.revision,scopeHash:grant.scopeHash});
 assert.equal(await readPlatformAutomaticAuthority(db,subject,context,new Date()),null);
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.enabled,false);assert.ok(grant.pausedAt);
 grant=await s.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash});assert.equal(grant.enabled,true);
 failed=true;await assert.rejects(s.refresh(f.customer.id,f.owner.id,grant.id));failed=false;
 assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}})).enabled,false);
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.enabled,true);assert.equal(grant.document.signedAvailable,true);
});
test('revoke requires a reason, stops locally before channel confirmation and cannot be revived by old callbacks',async()=>{
 await assert.rejects(s.revoke(f.customer.id,f.owner.id,grant.id,{reason:''}));
 grant=await s.revoke(f.customer.id,f.owner.id,grant.id,{reason:'合成撤销验收',revision:grant.revision});assert.equal(grant.enabled,false);assert.equal(grant.status,'REVOKING');
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'REVOKING');assert.equal(grant.enabled,false);
 authorized=false;grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'REVOKED');
 authorized=true;grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'REVOKED');assert.equal(grant.enabled,false);
 await assert.rejects(s.document('not-legal',f.owner.id,grant.id,'signed'));
});
test('unknown original request never reopens or manufactures another grant page',async()=>{
 f=await fixture();authorized=false;grant=await runOwnerH5(()=>s.request(f.customer.id,f.owner.id,f.request));
 failed=true;await assert.rejects(s.refresh(f.customer.id,f.owner.id,grant.id));failed=false;
 const replay=await runOwnerH5(()=>s.request(f.customer.id,f.owner.id,f.request));
 assert.equal(replay.id,grant.id);assert.equal(replay.status,'UNKNOWN');assert.equal('url' in replay,false);
});
test('missing actual PDF verification evidence cannot archive or enable a grant',async()=>{
 authorized=true;invalidProof=true;
 try{await assert.rejects(s.refresh(f.customer.id,f.owner.id,grant.id),code('PLATFORM_AUTH_PROOF_INVALID'));}finally{invalidProof=false;}
 const a=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id},include:{platformEvidence:true}});
 assert.equal(a.enabled,false);assert.equal(a.platformEvidence?.signedFileId,null);
});
test('positive certificate change permanently invalidates original authority even if the old certificate later reappears',async()=>{
 wrongCert=true;await assert.rejects(s.refresh(f.customer.id,f.owner.id,grant.id),code('OWNER_CERT_CHANGED'));wrongCert=false;
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'INVALIDATED');assert.equal(grant.enabled,false);
 const next=await runOwnerH5(()=>s.request(f.customer.id,f.owner.id,{...f.request,idempotencyKey:randomUUID()}));assert.notEqual(next.id,grant.id);grant=next;
});
test('pausing during an in-flight status query wins over late success',async()=>{
 let release!:()=>void,started!:()=>void;const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
 queryBarrier=async()=>{started();await gate;};const pending=s.refresh(f.customer.id,f.owner.id,grant.id);await entered;
 try{grant=await s.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:false,revision:grant.revision,scopeHash:grant.scopeHash});}finally{release();queryBarrier=undefined;}
 await assert.rejects(pending,code('PLATFORM_AUTH_CHANGED'));
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.enabled,false);assert.ok(grant.pausedAt);
});
test('confirmed enterprise material changes invalidate the grant and preserve its signed file',async()=>{
 const original=f.owner.name;await db.vehicleOwner.update({where:{id:f.owner.id},data:{name:'合成变更企业名称'}});
 await assert.rejects(s.refresh(f.customer.id,f.owner.id,grant.id),code('OWNER_MATERIALS_CHANGED'));
 await db.vehicleOwner.update({where:{id:f.owner.id},data:{name:original}});
 grant=await s.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'INVALIDATED');assert.equal(grant.enabled,false);assert.equal(grant.document.signedAvailable,true);
});
test('admin workspace lists v3 authority and preserves protected archive access after identity invalidation',async()=>{
 const listed:any=await listV31Authorities(db,{kind:'ADMIN',id:admin.id},f.owner.id);
 assert.equal(listed.scopeVersion,3);assert.equal(listed.executionEnabled,false);assert.ok(listed.items.some((a:any)=>a.id===grant.id&&a.status==='INVALIDATED'));
 assert.equal(JSON.stringify(listed).includes('synthetic-platform-app'),false);
 await assert.rejects(s.adminDocument('not-staff',f.owner.id,grant.id),code('FORBIDDEN'));
 const file=await s.adminDocument(admin.id,f.owner.id,grant.id);assert.ok(file.buffer.toString().startsWith('%PDF-'));
 await assert.rejects(s.adminDocument(admin.id,'another-owner',grant.id),code('NOT_FOUND'));
});
