import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerIdentityService} from '../src/owner-signing/identity';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {tokenHash} from '../src/auth/auth.service';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
import {hash} from '../src/common/data';
const seed=randomUUID().replaceAll('-','').slice(0,10),phone='134'+String(Date.now()).slice(-8);
const config:any={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,identityEncryptionKey:Buffer.alloc(32,8).toString('base64')};
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const phoneHash=(value:string)=>createHmac('sha256',process.env.SESSION_SECRET!).update('owner-invitation:'+value).digest('hex');
let db:Db,owners:OwnerService,identity:any,owner:any,actor:any,legal:any,old:any,profile:any,docs:any[]=[],seal:any,authority:any;
let proof:any,calls:string[]=[],queryHook:(()=>Promise<void>)|undefined;
const api:any={assertAvailable:()=>{},
 registerEnterprise:async()=>{calls.push('register');return{customerId:'new'+seed};},
 createVerification:async()=>{calls.push('create');return{serialNo:'newtx'+seed,url:'https://realnameverify16.fadada.com/new'};},
 queryEnterprise:async()=>{calls.push('query');if(queryHook)await queryHook();return proof;},
 queryCertificate:async()=>({bound:true,serialNo:'cert'+seed}),
 querySeals:async()=>[{customerId:'provider'+seed,signatureId:'seal'+seed,imageBase64:'synthetic',imageType:'image/png',imageHash:hash('synthetic')}]
};
const input=()=>({accepted:true,consents:docs.map(d=>({documentId:d.id,version:d.version}))});
before(async()=>{
 assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 process.env.OWNER_ONBOARDING_ENABLED='true';db=new Db();owners=new OwnerService(db);identity=new OwnerIdentityService(db,owners,config,api);
 actor=await db.adminUser.create({data:{username:'legal'+seed,name:'Synthetic operator',passwordHash:'unused',role:'OPERATIONS'}});
 legal=await db.customer.create({data:{mobile:phone}});old=await db.customer.create({data:{mobile:'133'+phone.slice(3)}});
 owner=await db.vehicleOwner.create({data:{name:'合成法人企业'+seed,creditCode:'TESTCODE'+seed.toUpperCase(),address:'合成地址',createdBy:actor.id,status:'VERIFIED'}});
 for(const c of [legal,old])await db.ownerMember.create({data:{ownerId:owner.id,customerId:c.id,status:c.id===old.id?'VERIFIED':'CLAIMED',verifiedAt:c.id===old.id?new Date():null,verifiedSerialNo:c.id===old.id?'txn'+seed:null}});
 profile=await db.ownerLegalRepresentative.create({data:{ownerId:owner.id,name:'合成法人',mobileHash:phoneHash(phone),maskedMobile:'134****'+phone.slice(-4),evidenceHash:hash('synthetic evidence'),createdBy:actor.id,updatedBy:actor.id}});
 await db.ownerESignAccount.create({data:{ownerId:owner.id,providerCustomerId:'provider'+seed,verificationTransactionNo:'txn'+seed,managerCustomerId:old.id,realNameStatus:'VERIFIED',certStatus:'BOUND',certSerialNo:'cert'+seed,checkedAt:new Date(),consentedAt:new Date(),consentSnapshot:{customerId:old.id},verificationUrlCiphertext:encryptIdentity({url:'https://realnameverify16.fadada.com/legacy'},'owner:'+owner.id+':url',config.identityEncryptionKey)}});
 seal=await db.ownerSeal.create({data:{ownerId:owner.id,providerCustomerId:'provider'+seed,providerSignatureId:'seal'+seed,status:'ACTIVE',imageHash:hash('synthetic'),imageCiphertext:'synthetic',checkedAt:new Date(),selectedBy:old.id}});
 authority=await db.ownerAutoAuthority.create({data:{ownerId:owner.id,sealId:seal.id,providerCustomerId:'provider'+seed,providerSignatureId:'seal'+seed,certificateSerialNo:'cert'+seed,providerContractId:'grant'+seed,providerTransactionId:'granttx'+seed,requestedBy:old.id,idempotencyKey:'old'+seed,requestHash:hash('old'),scope:{},scopeHash:hash({}),consentSnapshot:{},status:'AUTHORIZED',enabled:true}});
 await db.ownerInvitation.create({data:{ownerId:owner.id,mobileHash:phoneHash(old.mobile),tokenHash:hash(seed),expiresAt:new Date(Date.now()+86400000),createdBy:actor.id}});
 for(const type of ['terms','privacy','owner-identity']){const latest=await db.legalDocument.aggregate({where:{type},_max:{version:true}});docs.push(await db.legalDocument.create({data:{type,version:(latest._max.version||0)+1,title:'Synthetic legal',content:'Synthetic '+seed,status:'PUBLISHED',confirmedBy:actor.id,confirmedAt:new Date()}}));}
 proof={verified:true,customerId:'provider'+seed,serialNo:'txn'+seed,manager:{name:profile.name,mobile:phone,identityNo:'syntheticPrivateIdentity',type:'1'}};
});
after(async()=>{
 if(db){
  await db.ownerAutoAuthority.deleteMany({where:{ownerId:owner?.id}});await db.ownerSeal.deleteMany({where:{ownerId:owner?.id}});await db.ownerESignAccount.deleteMany({where:{ownerId:owner?.id}});await db.ownerLegalRepresentative.deleteMany({where:{ownerId:owner?.id}});await db.ownerInvitation.deleteMany({where:{ownerId:owner?.id}});await db.ownerMember.deleteMany({where:{ownerId:owner?.id}});await db.vehicleOwner.deleteMany({where:{id:owner?.id}});
  await db.customerConsent.deleteMany({where:{documentId:{in:docs.map(d=>d.id)}}});await db.legalDocument.deleteMany({where:{id:{in:docs.map(d=>d.id)}}});await db.auditLog.deleteMany({where:{OR:[{actorId:actor?.id},{resourceId:owner?.id}]}});await db.adminUser.deleteMany({where:{id:actor?.id}});await db.customer.deleteMany({where:{id:{in:[legal?.id,old?.id].filter(Boolean)}}});await db.$disconnect();
 }
 delete process.env.OWNER_ONBOARDING_ENABLED;delete process.env.OWNER_LEGAL_H5_ONLY;
});
test('legal refresh cannot reuse another manager consent or give an unverified legal member signing rights',async()=>{
 assert.equal(typeof identity.refreshLegal,'function');
 await assert.rejects(identity.refreshLegal(legal.id,owner.id),error('OWNER_MATERIALS_CHANGED'));assert.deepEqual(calls,[]);
});
test('provider delegate type, wrong legal name or mobile cannot rebind an existing account',async()=>{
 const started=await identity.startLegal(legal.id,owner.id,input());assert.equal(started.status,'PENDING');
 for(const change of [{type:'2'},{name:'其他法人'},{mobile:old.mobile}]){
  const original=proof.manager;proof.manager={...original,...change};
  await assert.rejects(identity.refreshLegal(legal.id,owner.id),error('OWNER_LEGAL_MISMATCH'));
  assert.equal((await db.ownerMember.findUniqueOrThrow({where:{ownerId_customerId:{ownerId:owner.id,customerId:legal.id}}})).status,'CLAIMED');
  proof.manager=original;
 }
 assert.ok(!calls.includes('register'));assert.equal(calls.filter(c=>c==='create').length,1);
});
test('lease or legal profile changing while provider query runs cannot commit a legal takeover',async()=>{
 queryHook=async()=>{await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{leaseToken:'superseded'}});};
 await assert.rejects(identity.startLegal(legal.id,owner.id,input()),error('OWNER_ATTEMPT_CHANGED'));queryHook=undefined;
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{leaseToken:null,leaseUntil:null}});
 queryHook=async()=>{await db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{revision:{increment:1}}});};
 await assert.rejects(identity.startLegal(legal.id,owner.id,input()),error('OWNER_LEGAL_CHANGED'));queryHook=undefined;
 assert.equal((await db.ownerMember.findUniqueOrThrow({where:{ownerId_customerId:{ownerId:owner.id,customerId:legal.id}}})).status,'CLAIMED');
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{realNameStatus:'FAILED'}});
});
test('changed legal proof requires a fresh transaction then verifies atomically without duplicate registration, suspends old members and disables old authority',async()=>{
 const beforeStarts=calls.filter(c=>c==='create').length;const result=await identity.startLegal(legal.id,owner.id,input());assert.equal(result.status,'PENDING');await identity.refreshLegal(legal.id,owner.id);assert.equal(calls.filter(c=>c==='create').length,beforeStarts+1);
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}});
 assert.equal(account.managerCustomerId,legal.id);assert.equal(account.providerCustomerId,'provider'+seed);assert.equal(account.verificationTransactionNo,'newtx'+seed);
 assert.equal((await db.ownerMember.findUniqueOrThrow({where:{ownerId_customerId:{ownerId:owner.id,customerId:old.id}}})).status,'SUSPENDED');
 assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:authority.id}})).enabled,false);
 assert.equal(await db.ownerInvitation.count({where:{ownerId:owner.id,revokedAt:null,mobileHash:{not:phoneHash(phone)}}}),0);
 assert.equal((await db.ownerSeal.findUniqueOrThrow({where:{id:seal.id}})).status,'DISCOVERED');
 assert.equal((await db.customer.findUniqueOrThrow({where:{id:old.id}})).mobile,old.mobile);
 assert.ok(!calls.includes('register'));assert.ok(!JSON.stringify(await owners.memberDetail(legal.id,owner.id)).includes('syntheticPrivateIdentity'));
});
test('changed preview hash cannot select a seal or record selection evidence',async()=>{
 const before=await db.ownerSeal.findUniqueOrThrow({where:{id:seal.id}}),audits=await db.auditLog.count({where:{actorId:legal.id}});
 await assert.rejects((identity.selectSeal as any)(legal.id,owner.id,seal.id,'f'.repeat(64)),error('OWNER_SEAL_CHANGED'));
 assert.deepEqual(await db.ownerSeal.findUniqueOrThrow({where:{id:seal.id}}),before);assert.equal(await db.auditLog.count({where:{actorId:legal.id}}),audits);
});

test('completed current identity rejects duplicate start before consent, audit or provider query even with stale certificate',async()=>{
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{certStatus:'UNKNOWN',checkedAt:new Date(0)}});
 const before=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}}),callCount=calls.length;
 const consents=await db.customerConsent.findMany({where:{customerId:legal.id}}),audits=await db.auditLog.count({where:{actorId:legal.id}});
 await assert.rejects(identity.startLegal(legal.id,owner.id,input()),error('OWNER_IDENTITY_COMPLETED'));
 assert.equal(calls.length,callCount);assert.deepEqual(await db.customerConsent.findMany({where:{customerId:legal.id}}),consents);assert.equal(await db.auditLog.count({where:{actorId:legal.id}}),audits);
 const after=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}});assert.deepEqual(after,before);
});

test('legal-only policy also rejects legacy refresh of delegate proof and invalidates previously usable certificate',async()=>{
 process.env.OWNER_LEGAL_H5_ONLY='true';proof.manager.type='2';
 await assert.rejects(identity.refresh(legal.id,owner.id),error('OWNER_LEGAL_MISMATCH'));
 assert.equal((await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}})).certStatus,'UNKNOWN');proof.manager.type='1';
});
test('pending legacy miniapp verification cannot be returned as H5 or auto-recreated',async()=>{
 proof.verified=false;await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{realNameStatus:'PENDING',consentSnapshot:{customerId:old.id},verificationUrlCiphertext:encryptIdentity({url:'https://realnameverify16.fadada.com/legacy'},'owner:'+owner.id+':url',config.identityEncryptionKey)}});
 await assert.rejects(identity.startLegal(legal.id,owner.id,input()),error('OWNER_LEGACY_VERIFY_PENDING'));
 assert.ok(!calls.includes('register'));proof.verified=true;
});
test('H5 details expose separate capabilities without enabling authorization flags or leaking identity proof',async()=>{
 const {OwnerH5Service}=await import('../src/owner-h5/service');
 const service=new OwnerH5Service(db,owners,identity,{} as any,config);
 const detail=await service.detail(legal.id,owner.id);
 assert.equal(detail.capabilities.canRequestAuthority,false);assert.equal(detail.capabilities.canSelectSeal,false);
 assert.ok(detail.blockers.some((text:string)=>text.includes('授权')));assert.deepEqual(detail.legalRepresentative,{name:profile.name,maskedMobile:profile.maskedMobile});
 assert.ok(!JSON.stringify(detail).includes('syntheticPrivateIdentity'));assert.equal(process.env.OWNER_AUTO_SIGNING_ENABLED,undefined);
 await assert.rejects(service.detail(old.id,owner.id));
});
test('old customer owner writes return a clear migration error after legal H5 cutover',async()=>{
 const {OwnerCustomerController}=await import('../src/owner-signing/controller');
 const controller=new OwnerCustomerController(owners,identity,{} as any);
 assert.throws(()=>controller.claim({customer:{id:legal.id}},{token:'a'.repeat(43)}),error('OWNER_H5_REQUIRED'));
});
test('a current legal member can stop an old grant but cannot refresh or enable another requester grant',async()=>{
 await identity.startLegal(legal.id,owner.id,input());
 const service=new OwnerAuthorizationService(db,owners,{...api,queryAuthorization:async()=>({authorized:true})} as any);
 await assert.rejects(service.refresh(legal.id,owner.id,authority.id),error('OWNER_AUTH_ACTOR'));
 const stopped=await service.setEnabled(legal.id,owner.id,authority.id,{enabled:false,revision:0,scopeHash:''});assert.equal(stopped.enabled,false);
});
test('authority refresh cannot preserve enabled state after the legal profile changes during provider query',async()=>{
 await db.ownerAutoAuthority.update({where:{id:authority.id},data:{requestedBy:legal.id,enabled:true,status:'AUTHORIZED'}});
 const service=new OwnerAuthorizationService(db,owners,{...api,queryAuthorization:async()=>{
  await db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{revision:{increment:1}}});return{authorized:true};
 }} as any);
 await assert.rejects(service.refresh(legal.id,owner.id,authority.id));
 assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:authority.id}})).enabled,false);
});
test('an H5 legal account keeps legal-only proof checks even before global miniapp cutover',async()=>{
 await identity.startLegal(legal.id,owner.id,input());await identity.refreshLegal(legal.id,owner.id);delete process.env.OWNER_LEGAL_H5_ONLY;proof.manager.type='2';
 await assert.rejects(identity.refresh(legal.id,owner.id),error('OWNER_LEGAL_MISMATCH'));proof.manager.type='1';
});
test('a new H5 verification reuses only its own pending URL and never repeats a chargeable start',async()=>{
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{verificationTransactionNo:null,verificationUrlCiphertext:null,realNameStatus:'NOT_STARTED'}});
 const registrations=calls.filter(c=>c==='register').length,starts=calls.filter(c=>c==='create').length;
 const first=await identity.startLegal(legal.id,owner.id,input());assert.equal(first.status,'PENDING');assert.equal(first.url,'https://realnameverify16.fadada.com/new');
 proof.verified=false;const transaction=(await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}})).verificationTransactionNo;
 await identity.refreshLegal(legal.id,owner.id);
 const repeated=await identity.startLegal(legal.id,owner.id,input());assert.equal(repeated.url,first.url);assert.equal((await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}})).verificationTransactionNo,transaction);
 assert.equal(calls.filter(c=>c==='create').length,starts+1);assert.equal(calls.filter(c=>c==='register').length,registrations);
});
test('persisted H5 policy blocks previous legal identity and invitation paths after profile phone changes with cutover disabled',async()=>{
 delete process.env.OWNER_LEGAL_H5_ONLY;proof.verified=true;await identity.startLegal(legal.id,owner.id,input());
 await db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{mobileHash:phoneHash(old.mobile),revision:{increment:1}}});
 await db.ownerMember.update({where:{ownerId_customerId:{ownerId:owner.id,customerId:old.id}},data:{status:'CLAIMED'}});
 await assert.rejects(owners.requireSigningMember(legal.id,owner.id),error('OWNER_LEGAL_REQUIRED'));
 await assert.rejects(owners.invite(actor.id,owner.id,{mobile:legal.mobile}),error('OWNER_LEGAL_REQUIRED'));
 const token='z'.repeat(43);
 await db.ownerInvitation.create({data:{ownerId:owner.id,mobileHash:phoneHash(legal.mobile),tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+86400000),createdBy:actor.id}});
 await assert.rejects(owners.claim(legal.id,{token}),error('OWNER_LEGAL_REQUIRED'));
});
test('unverified replacement legal member cannot disable or revoke and administrator emergency pause remains available',async()=>{
 let urls=0;
 const service=new OwnerAuthorizationService(db,owners,{...api,createRevocationUrl:()=>{urls++;return{url:'https://textapi17.fadada.com/api2/cancel_extsign_auto_page.api'};}} as any);
 const before=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:authority.id}});
 await assert.rejects(runOwnerH5(()=>service.setEnabled(old.id,owner.id,authority.id,{enabled:false,revision:before.revision,scopeHash:before.scopeHash})),error('OWNER_MATERIALS_CHANGED'));
 await assert.rejects(runOwnerH5(()=>service.revoke(old.id,owner.id,authority.id)),error('OWNER_MATERIALS_CHANGED'));
 const after=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:authority.id}});
 assert.equal(after.revision,before.revision);assert.equal(after.status,before.status);assert.equal(urls,0);
 await db.ownerAutoAuthority.update({where:{id:authority.id},data:{enabled:true}});
 assert.equal((await service.pause(actor.id,owner.id,authority.id)).enabled,false);
});
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
async function legacyRaceAccount(){
 delete process.env.OWNER_LEGAL_H5_ONLY;queryHook=undefined;proof.verified=true;proof.manager={...proof.manager,type:'1',mobile:old.mobile};
 await db.ownerLegalRepresentative.update({where:{ownerId:owner.id},data:{mobileHash:phoneHash(old.mobile)}});
 await db.ownerMember.update({where:{ownerId_customerId:{ownerId:owner.id,customerId:old.id}},data:{status:'VERIFIED',verifiedAt:new Date(),verifiedSerialNo:'txn'+seed}});
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{managerCustomerId:old.id,consentSnapshot:{customerId:old.id},consentedAt:new Date(),verificationTransactionNo:'txn'+seed,verificationUrlCiphertext:encryptIdentity({url:'https://realnameverify16.fadada.com/legacy'},'owner:'+owner.id+':url',config.identityEncryptionKey),realNameStatus:'VERIFIED',leaseToken:null,leaseUntil:null}});
}
function pauseAfterLegacyRouting(){
 const routed=gate(),resume=gate(),delayedOwners=new OwnerService(db),member=delayedOwners.member.bind(delayedOwners);
 delayedOwners.member=async(customerId,ownerId)=>{const result=await member(customerId,ownerId);routed.release();await resume.promise;return result;};
 return{routed,resume,service:new OwnerIdentityService(db,delayedOwners,config,api)};
}
test('legacy start routed before first H5 consent cannot overwrite the marker or active lease',{timeout:15000},async()=>{
 await legacyRaceAccount();const delayed=pauseAfterLegacyRouting(),queried=gate(),finishQuery=gate();
 const legacy=delayed.service.start(old.id,owner.id,input()).then(value=>({value,error:null}),error=>({value:null,error}));
 await delayed.routed.promise;
 queryHook=async()=>{queried.release();await finishQuery.promise;};
 const h5=identity.startLegal(old.id,owner.id,input()).then((value:any)=>({value,error:null}),(error:any)=>({value:null,error}));
 try{
  await Promise.race([queried.promise,h5.then((result:any)=>{if(result.error)throw result.error;})]);
  const leased=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}});assert.ok(leased.leaseToken);
  delayed.resume.release();const blocked=await legacy;
  assert.ok(blocked.error);assert.ok(error('OWNER_H5_REQUIRED')(blocked.error));
  const preserved=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}});assert.equal((preserved.consentSnapshot as any).channel,'OWNER_LEGAL_H5');assert.equal(preserved.leaseToken,leased.leaseToken);
 }finally{delayed.resume.release();finishQuery.release();queryHook=undefined;const completed=await h5;assert.equal(completed.error,null);}
 assert.equal(((await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}})).consentSnapshot as any).channel,'OWNER_LEGAL_H5');
});
test('legacy refresh routed before H5 migration must reject the newly read legal account before querying provider',{timeout:15000},async()=>{
 await legacyRaceAccount();const delayed=pauseAfterLegacyRouting();
 const legacy=delayed.service.refresh(old.id,owner.id).then(value=>({value,error:null}),error=>({value:null,error}));
 await delayed.routed.promise;await identity.startLegal(old.id,owner.id,input());const queried=calls.filter(c=>c==='query').length;proof.manager.type='2';
 try{
  delayed.resume.release();const blocked=await legacy;assert.ok(blocked.error);assert.ok(error('OWNER_H5_REQUIRED')(blocked.error));assert.equal(calls.filter(c=>c==='query').length,queried);
 }finally{delayed.resume.release();proof.manager.type='1';}
});
test('legacy refresh lease CAS cannot cross H5 migration after reading the old account version',{timeout:15000},async()=>{
 await legacyRaceAccount();const read=gate(),resume=gate();let paused=false;
 const accountDelegate=new Proxy(db.ownerESignAccount,{get(target,key){if(key==='findUnique')return async(args:any)=>{const account=await target.findUnique(args);if(!args.select&&!paused){paused=true;read.release();await resume.promise;}return account;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const delayedDb=new Proxy(db,{get(target,key){if(key==='ownerESignAccount')return accountDelegate;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const service=new OwnerIdentityService(delayedDb,owners,config,api),legacy=service.refresh(old.id,owner.id).then(value=>({value,error:null}),error=>({value:null,error}));
 await read.promise;await identity.startLegal(old.id,owner.id,input());const queried=calls.filter(c=>c==='query').length;proof.manager.type='2';
 try{resume.release();const blocked=await legacy;assert.ok(blocked.error);assert.ok(error('OWNER_PROCESSING')(blocked.error));assert.equal(calls.filter(c=>c==='query').length,queried);}
 finally{resume.release();proof.manager.type='1';}
});
