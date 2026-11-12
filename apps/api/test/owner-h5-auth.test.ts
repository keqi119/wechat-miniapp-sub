import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {RealIdentityGateway} from '../src/integrations/identity';
import {protectedPortalMobile} from '../src/partners/portal-access';
import {token,tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {createOwnerInvitationToken} from '../src/owner-signing/invitation-token';
let db:any,app:any,base:string,admin:any,consents:any[]=[];
const origin='https://app.subauto.keybox.cloud',secret='synthetic-only-portal-secret-012345678901234567890';
const ownSms=new Map<string,string>();
const codes=new Map<string,string>();let sends=0,failSend=false,afterVerify:(()=>Promise<void>)|undefined;
const newMobile=()=>`139${randomInt(10000000,99999999)}`;
before(async()=>{
 assert.ok(process.env.TEST_DATABASE_URL&&new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.NODE_ENV='test';process.env.SESSION_SECRET=secret;process.env.OWNER_LEGAL_H5_ENABLED='true';process.env.PORTAL_SMS_ENABLED='true';process.env.H5_SIGNING_ORIGIN=origin;
 for(const key of ['ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'])process.env[key]='synthetic-unused';
 db=new Db();admin=await db.adminUser.create({data:{username:'portal-auth-'+randomUUID(),name:'Synthetic',passwordHash:'unused',role:'OPERATIONS'}});
 for(const type of ['terms','privacy']){const version=((await db.legalDocument.aggregate({where:{type},_max:{version:true}}))._max.version||0)+1,doc=await db.legalDocument.create({data:{type,version,status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:admin.id,title:'Synthetic '+type,content:'Synthetic only'}});consents.push({documentId:doc.id,version});}
 const identity=new RealIdentityGateway(db,{appId:'unused',secret:'unused',smsEnabled:true,smsHashSecret:secret},async()=>{throw Error('No network allowed');},async(mobile,code)=>{if(failSend)throw Error('synthetic private provider error');sends++;codes.set(mobile,code);});
 const requestExact=identity.requestSmsChallenge.bind(identity);identity.requestSmsChallenge=async(mobile:string)=>{const result=await requestExact(mobile);ownSms.set(result.challengeId,mobile);return result;};
 const exact=(identity as any).verifySmsChallenge.bind(identity);(identity as any).verifySmsChallenge=async(input:any)=>{const result=await exact(input);if(afterVerify)await afterVerify();return result;};
 app=await createApp({db,identity});base=(await listenForHttpTests(app))+'/api';
});
after(async()=>{
 try{if(db){
  const target=new URL(process.env.TEST_DATABASE_URL!);assert.equal(process.env.MVP_TEST_GUARD,'local-project-v1');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55432');assert.equal(target.pathname,'/chundian_test');
  const rows:any[]=[];for(const [id,mobile] of ownSms){const row=await db.smsChallenge.findUniqueOrThrow({where:{id}});assert.equal(row.mobile,mobile);assert.match(mobile,/^139\d{8}$/);rows.push({id,mobile,sentAt:row.sentAt,source:'task11f-real-gateway-synthetic-sender-return'});}
  writeFileSync(resolve('../../.superpowers/sdd/2026-11-07-ninda-v31-electronic-contracts/task-11f-final-run-sms.json'),JSON.stringify({rows},null,2));
  for(const row of rows){const result=await db.smsChallenge.updateMany({where:{id:row.id,mobile:row.mobile,sentAt:row.sentAt},data:{sentAt:new Date(Date.now()-2*3600000)}});assert.equal(result.count,1);}
 }}finally{await app?.close();await db?.$disconnect();}
});
async function req(path:string,body?:any,headers:any={},method?:string){const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});let data:any;try{data=await response.json();}catch{}return{status:response.status,data,cookie:response.headers.get('set-cookie'),headers:response.headers};}
async function grant(mobile=newMobile()){
 const owner=await db.vehicleOwner.create({data:{name:'Synthetic portal '+randomUUID(),address:'Synthetic only',createdBy:admin.id}});
 const access=await db.partnerPortalAccess.create({data:{ownerId:owner.id,revision:1,accessVersion:1,status:'ENABLED',displayName:'Synthetic viewer',...protectedPortalMobile(mobile),reviewedBy:admin.id,reviewedAt:new Date()}});return{owner,access,mobile};
}
async function sms(mobile:string){return req('/owner-h5/auth/sms/request',{mobile});}
async function login(mobile:string,challengeId:string,code=codes.get(mobile)){return req('/owner-h5/auth/login',{mobile,challengeId,code,consents});}
const headers=(r:any)=>({cookie:r.cookie.split(';')[0],'x-csrf-token':r.data.csrfToken});
async function age(mobile:string){const grantHash=protectedPortalMobile(mobile).mobileHash;await db.partnerPortalChallenge.updateMany({where:{mobileHash:grantHash},data:{createdAt:new Date(Date.now()-61000)}});await db.smsChallenge.updateMany({where:{mobile},data:{sentAt:new Date(Date.now()-61000)}});}
test('unregistered enabled mobile logs in with independent scopes/consents; unsent anonymous requests reveal no owners or usable challenge',async()=>{
 const f=await grant(),before=await db.customer.count({where:{mobile:f.mobile}}),sentBefore=sends,missing=newMobile();
 const unknown=await sms(missing),known=await sms(f.mobile);
 assert.equal(known.status,201);assert.equal(unknown.status,403);assert.equal(unknown.data.challengeId,undefined);assert.match(known.data.challengeId,/^[a-f0-9]{64}$/);assert.equal(sends,sentBefore+1);
 const decoy=await db.partnerPortalChallenge.findFirst({where:{mobileHash:protectedPortalMobile(missing).mobileHash},orderBy:{createdAt:'desc'}});assert.equal(decoy.status,'DECOY');assert.equal((await login(missing,decoy.id,'123456')).status,401);
 const signed=await login(f.mobile,known.data.challengeId);assert.equal(signed.status,201,JSON.stringify(signed.data));assert.equal(signed.data.mode,'PARTNER_READONLY');assert.equal('customer' in signed.data,false);assert.deepEqual(signed.data.scopes,[{ownerId:f.owner.id,accessVersion:1}]);assert.equal(await db.customer.count({where:{mobile:f.mobile}}),before);
 const stored=await db.partnerPortalSession.findUnique({where:{id:tokenHash(signed.cookie!.split(';')[0].split('=')[1])}});assert.equal(stored.consentSnapshot.length,2);assert.equal('customerId' in stored,false);assert.match(signed.cookie!,/HttpOnly/);assert.match(signed.cookie!,/Secure/);
 assert.equal((await req('/owner-h5/auth/me',undefined,headers(signed))).status,200);
 const owners=await req('/owner-h5/owners',undefined,headers(signed));assert.equal(owners.data[0].admissionStatus,'UNVERIFIED');
 assert.equal((await login(f.mobile,known.data.challengeId)).status,401);
 const logout=await req('/owner-h5/auth/logout',{},headers(signed));assert.equal(logout.status,201);assert.equal((await req('/owner-h5/auth/me',undefined,headers(signed))).status,401);
});
test('exact challenges reject cross challenge codes, expiry, attempts and repeat requests without extra SMS',async()=>{
 const f=await grant(),first=await sms(f.mobile),code=codes.get(f.mobile)!,sent=sends,limited=await sms(f.mobile);
 assert.equal(sends,sent);assert.equal(limited.status,429);assert.equal(limited.data.challengeId,undefined);const limitedRow=await db.partnerPortalChallenge.findFirst({where:{mobileHash:protectedPortalMobile(f.mobile).mobileHash},orderBy:{createdAt:'desc'}});assert.equal(limitedRow.status,'RATE_LIMITED');assert.equal((await login(f.mobile,limitedRow.id,code)).status,401);
 const wrong=code==='000000'?'000001':'000000';for(let i=0;i<5;i++)assert.equal((await login(f.mobile,first.data.challengeId,wrong)).status,401);
 const row=await db.partnerPortalChallenge.findUnique({where:{id:first.data.challengeId}});assert.equal(row.attempts,5);assert.equal((await login(f.mobile,first.data.challengeId,code)).status,401);
 await age(f.mobile);const expired=await sms(f.mobile);await db.partnerPortalChallenge.update({where:{id:expired.data.challengeId},data:{expiresAt:new Date(Date.now()-1)}});assert.equal((await login(f.mobile,expired.data.challengeId)).status,401);
 await age(f.mobile);const older=await sms(f.mobile),olderCode=codes.get(f.mobile)!;await age(f.mobile);const newer=await sms(f.mobile);assert.equal((await login(f.mobile,older.data.challengeId,codes.get(f.mobile))).status,401);assert.equal((await login(f.mobile,newer.data.challengeId,olderCode===codes.get(f.mobile)?wrong:olderCode)).status,401);
});
test('issued scopes reject revoke, change-back and added scope; grant changes during verification do not mint sessions',async()=>{
 for(const change of ['revoke','change-back','add','during-verify']){
  const f=await grant(),challenge=await sms(f.mobile),before=await db.partnerPortalSession.count();
  if(change==='revoke')await db.partnerPortalAccess.update({where:{id:f.access.id},data:{status:'DISABLED',accessVersion:{increment:1}}});
  if(change==='change-back'){await db.partnerPortalAccess.update({where:{id:f.access.id},data:{...protectedPortalMobile(newMobile()),accessVersion:{increment:1}}});await db.partnerPortalAccess.update({where:{id:f.access.id},data:{...protectedPortalMobile(f.mobile),accessVersion:{increment:1}}});}
  if(change==='add')await grant(f.mobile);
  if(change==='during-verify')afterVerify=async()=>{await db.partnerPortalAccess.update({where:{id:f.access.id},data:{status:'DISABLED',accessVersion:{increment:1}}});};
  try{assert.equal((await login(f.mobile,challenge.data.challengeId)).status,401,change);}finally{afterVerify=undefined;}
  assert.equal(await db.partnerPortalSession.count(),before);assert.equal((await db.partnerPortalChallenge.findUnique({where:{id:challenge.data.challengeId}})).status,'REJECTED');
 }
});
test('multi-owner session loses only revoked scope and never receives newly added scopes',async()=>{
 const a=await grant(),b=await grant(a.mobile),challenge=await sms(a.mobile),signed=await login(a.mobile,challenge.data.challengeId);assert.equal(signed.status,201);const h=headers(signed);
 await db.partnerPortalAccess.update({where:{id:a.access.id},data:{status:'DISABLED',accessVersion:{increment:1}}});const c=await grant(a.mobile);
 const me=await req('/owner-h5/auth/me',undefined,h);assert.deepEqual(me.data.scopes,[{ownerId:b.owner.id,accessVersion:1}]);assert.equal((await req('/owner-h5/owners/'+a.owner.id,undefined,h)).status,403);assert.equal((await req('/owner-h5/owners/'+b.owner.id,undefined,h)).status,200);assert.equal((await req('/owner-h5/owners/'+c.owner.id,undefined,h)).status,403);
 await db.partnerPortalAccess.update({where:{id:b.access.id},data:{status:'DISABLED',accessVersion:{increment:1}}});assert.equal((await req('/owner-h5/auth/me',undefined,h)).status,401);
});
test('concurrent use consumes one portal challenge and creates one session',async()=>{
 const f=await grant(),challenge=await sms(f.mobile),before=await db.partnerPortalSession.count();
 const results=await Promise.all([login(f.mobile,challenge.data.challengeId),login(f.mobile,challenge.data.challengeId)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,401]);assert.equal(await db.partnerPortalSession.count(),before+1);
});
test('new and legacy sessions cannot write business or invoke historical provider GET; origin and CSRF remain enforced',async()=>{
 const f=await grant(),challenge=await sms(f.mobile),signed=await login(f.mobile,challenge.data.challengeId),h=headers(signed),customer=await db.customer.create({data:{mobile:newMobile()}}),raw=token();
 await db.ownerH5Session.create({data:{id:tokenHash(raw),customerId:customer.id,csrfToken:'legacy',expiresAt:new Date(Date.now()+100000)}});
 for(const sessionHeaders of [h,{cookie:'owner_h5_session='+raw,'x-csrf-token':'legacy'}])for(const path of ['/owners/claim','/owners/'+f.owner.id+'/refresh','/owners/'+f.owner.id+'/contracts/old/sign','/owners/'+f.owner.id+'/offline-archives/old/feedback']){
  const r=await req('/owner-h5'+path,{},sessionHeaders);assert.equal(r.status,403,path);assert.equal(r.data.error.code,'PARTNER_READ_ONLY');
 }
 assert.equal((await req('/owner-h5/owners/'+f.owner.id+'/authorities',undefined,h)).status,404);
 assert.equal((await req('/owner-h5/owners',undefined,{cookie:'owner_h5_session='+raw})).status,401);
 assert.equal((await req('/owner-h5/auth/logout',{}, {cookie:h.cookie})).status,403);
 assert.equal((await req('/owner-h5/auth/sms/request',{mobile:f.mobile},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await req('/owner-h5/owners',undefined,{authorization:'Bearer '+raw})).status,401);
 const sent=sends;await req('/owner-h5/auth/me',undefined,h);await req('/owner-h5/owners',undefined,h);assert.equal(sends,sent);
});

// All identity/SMS traffic still uses the synthetic transport above. Only the
// exact fixture scope/vehicle are removed; the production immutable triggers stay.
async function scopedLegalFixture(run:(f:any)=>Promise<void>){
 const savedMode=process.env.NEW_ORDER_CONTRACT_MODE;
 process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 let fixture:any;
 try{
  assert.equal(await db.virtualAcceptanceScope.count(),0,'Exclusive test runner requires an empty virtual singleton');
  fixture=await db.$transaction(async(tx:any)=>{
   const actor=await tx.customer.create({data:{mobile:newMobile()}}),customer=await tx.customer.create({data:{mobile:newMobile()}}),platformActor=await tx.customer.create({data:{mobile:newMobile()}});
   const owner=await tx.vehicleOwner.create({data:{name:'Synthetic legal '+randomUUID(),address:'Synthetic only',createdBy:admin.id}}),platform=await tx.vehicleOwner.create({data:{name:'Synthetic platform '+randomUUID(),address:'Synthetic only',createdBy:admin.id}});
   await tx.ownerLegalRepresentative.create({data:{ownerId:owner.id,name:'合成法人',mobileHash:ownerMobileHash(actor.mobile),maskedMobile:actor.mobile.slice(0,3)+'****'+actor.mobile.slice(-4),evidenceHash:'synthetic-local-only',createdBy:admin.id,updatedBy:admin.id}});
   const invitationToken=createOwnerInvitationToken(),invite=await tx.ownerInvitation.create({data:{ownerId:owner.id,mobileHash:ownerMobileHash(actor.mobile),tokenHash:tokenHash(invitationToken),expiresAt:new Date(Date.now()+3600000),createdBy:admin.id}});
   const scope=await tx.virtualAcceptanceScope.create({data:{customerId:customer.id,ownerId:owner.id,ownerActorCustomerId:actor.id,platformId:platform.id,platformActorCustomerId:platformActor.id,expiresAt:new Date(Date.now()+3600000),noticeHash:'synthetic-local-only',createdBy:admin.id}});
   const vehicle=await tx.vehicle.create({data:{virtualAcceptanceScopeId:scope.id,brand:'Synthetic',model:'Fixture',title:'Synthetic virtual login fixture',year:2026,city:'Synthetic',mileageKm:0}});
   return{actor,customer,owner,platform,scope,vehicle,invite,invitationToken};
  });
  await run(fixture);
 }finally{
  afterVerify=undefined;
  if(fixture){
   assert.equal(process.env.MVP_TEST_GUARD,'local-project-v1');
   const target=new URL(process.env.TEST_DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55432');assert.equal(target.pathname,'/chundian_test');
   await db.$transaction(async(tx:any)=>{
    const scope=await tx.virtualAcceptanceScope.findUniqueOrThrow({where:{id:fixture.scope.id}});assert.equal(scope.createdBy,admin.id);
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    await tx.vehicle.delete({where:{id:fixture.vehicle.id}});await tx.virtualAcceptanceScope.delete({where:{id:fixture.scope.id}});
   });
  }
  if(savedMode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=savedMode;
 }
}
async function legalSms(f:any,withInvitation=true){
 const input={mobile:f.actor.mobile,purpose:'ELECTRONIC_LEGAL',...(withInvitation?{invitationToken:f.invitationToken}:{})};
 const challenge=await req('/owner-h5/auth/sms/request',input);assert.equal(challenge.status,201,JSON.stringify(challenge.data));
 assert.equal((await db.partnerPortalChallenge.findUniqueOrThrow({where:{id:challenge.data.challengeId}})).status,'PENDING');
 return()=>req('/owner-h5/auth/login',{...input,challengeId:challenge.data.challengeId,code:codes.get(f.actor.mobile),consents});
}
for(const state of ['revoked','expired','unfrozen'] as const)test(`legal invitation login rejects ${state} virtual scope at the shared claim mutation`,async()=>scopedLegalFixture(async f=>{
 const finish=await legalSms(f);
 // The scope changes after real local OTP verification, before the login transaction.
 afterVerify=()=>db.virtualAcceptanceScope.update({where:{id:f.scope.id},data:state==='revoked'?{status:'REVOKED'}:state==='expired'?{status:'READY',expiresAt:new Date(Date.now()-1000)}:{status:'READY'}}).then(()=>undefined);
 const result=await finish();
 assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,state==='unfrozen'?'VIRTUAL_CONFIGURATION_CHANGED':'VIRTUAL_SCOPE_INACTIVE');
 assert.equal(await db.ownerMember.count({where:{ownerId:f.owner.id,customerId:f.actor.id}}),0);
 const invitation=await db.ownerInvitation.findUniqueOrThrow({where:{id:f.invite.id}});assert.equal(invitation.claimedBy,null);assert.equal(invitation.claimedAt,null);assert.ok(invitation.expiresAt>new Date());
 assert.equal(await db.ownerH5Session.count({where:{customerId:f.actor.id}}),0);
}));
test('existing legal members recover historical login and reads after revoke/expiry without new invitation consumption',async()=>scopedLegalFixture(async f=>{
 const member=await db.ownerMember.create({data:{ownerId:f.owner.id,customerId:f.actor.id}}),claimedAt=new Date();
 await db.ownerInvitation.update({where:{id:f.invite.id},data:{claimedBy:f.actor.id,claimedAt}});
 await db.virtualAcceptanceScope.update({where:{id:f.scope.id},data:{status:'REVOKED',expiresAt:new Date(Date.now()-1000)}});
 for(const withInvitation of [true,false]){
  const signed=await(await legalSms(f,withInvitation))();assert.equal(signed.status,201,JSON.stringify(signed.data));assert.equal(signed.data.mode,'ELECTRONIC_LEGAL');
  assert.equal((await req('/owner-h5/auth/me',undefined,headers(signed))).status,200);
  assert.equal((await req('/owner-h5/owners/'+f.owner.id,undefined,headers(signed))).status,200);
  await age(f.actor.mobile);
 }
 assert.deepEqual(await db.ownerMember.findUniqueOrThrow({where:{id:member.id}}),member);
 assert.equal((await db.ownerInvitation.findUniqueOrThrow({where:{id:f.invite.id}})).claimedAt.getTime(),claimedAt.getTime());
 // An existing member may recover, but a fresh invitation is still a new write.
 f.invitationToken=createOwnerInvitationToken();const fresh=await db.ownerInvitation.create({data:{ownerId:f.owner.id,mobileHash:ownerMobileHash(f.actor.mobile),tokenHash:tokenHash(f.invitationToken),expiresAt:new Date(Date.now()+3600000),createdBy:admin.id}});
 const denied=await(await legalSms(f))();assert.equal(denied.status,409);assert.equal(denied.data.error.code,'VIRTUAL_SCOPE_INACTIVE');
 assert.equal((await db.ownerInvitation.findUniqueOrThrow({where:{id:fresh.id}})).claimedBy,null);
 assert.deepEqual(await db.ownerMember.findUniqueOrThrow({where:{id:member.id}}),member);
}));
test('scoped legal sessions authenticate current members without promoting other owners, customer roles or stale legal identity',async()=>scopedLegalFixture(async f=>{
 await db.ownerMember.create({data:{ownerId:f.owner.id,customerId:f.actor.id}});
 await db.ownerInvitation.update({where:{id:f.invite.id},data:{claimedBy:f.actor.id,claimedAt:new Date()}});
 // Authentication reads the binding, not a fabricated provider/config approval.
 // READY with future expiry is deliberately unfrozen; it cannot authorize writes.
 await db.virtualAcceptanceScope.update({where:{id:f.scope.id},data:{status:'READY'}});
 const signed=await(await legalSms(f))();assert.equal(signed.status,201,JSON.stringify(signed.data));
 const h=headers(signed);assert.equal((await req('/owner-h5/auth/me',undefined,h)).status,200);
 assert.equal((await req('/owner-h5/owners/'+f.platform.id,undefined,h)).status,404);
 assert.equal((await req('/owner-h5/auth/logout',{}, {cookie:h.cookie})).status,403);
 assert.equal((await req('/owner-h5/auth/logout',{}, {...h,origin:'https://evil.invalid'})).status,403);
 const unrelated=await db.vehicleOwner.create({data:{name:'Synthetic unrelated '+randomUUID(),address:'Synthetic only',createdBy:admin.id}});
 await db.ownerLegalRepresentative.create({data:{ownerId:unrelated.id,name:'合成法人',mobileHash:ownerMobileHash(f.actor.mobile),maskedMobile:'139****0000',evidenceHash:'synthetic-local-only',createdBy:admin.id,updatedBy:admin.id}});
 await db.ownerMember.create({data:{ownerId:unrelated.id,customerId:f.actor.id}});
 for(const [customerId,ownerId] of [[f.actor.id,unrelated.id],[f.customer.id,f.owner.id]]){
  const raw=token();await db.ownerH5Session.create({data:{id:tokenHash(raw),customerId,csrfToken:token(),expiresAt:new Date(Date.now()+3600000),identitySnapshot:{mode:'ELECTRONIC_LEGAL',owners:[{ownerId,legalRevision:1,legalMobileHash:ownerMobileHash(f.actor.mobile)}]}}});
  assert.equal((await req('/owner-h5/auth/me',undefined,{cookie:'owner_h5_session='+raw})).status,401);
 }
 await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:{increment:1}}});
 assert.equal((await req('/owner-h5/auth/me',undefined,h)).status,401);
}));
test('ordinary ELECTRONIC legal login can claim for a company participating in an expired revoked virtual scope',async()=>scopedLegalFixture(async f=>{
 await db.virtualAcceptanceScope.update({where:{id:f.scope.id},data:{status:'REVOKED',expiresAt:new Date(Date.now()-1000)}});
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const signed=await(await legalSms(f))();assert.equal(signed.status,201,JSON.stringify(signed.data));assert.equal(signed.data.mode,'ELECTRONIC_LEGAL');
 const member=await db.ownerMember.findUniqueOrThrow({where:{ownerId_customerId:{ownerId:f.owner.id,customerId:f.actor.id}}});assert.equal(member.status,'CLAIMED');
 assert.equal((await db.ownerInvitation.findUniqueOrThrow({where:{id:f.invite.id}})).claimedBy,f.actor.id);
 assert.equal((await req('/owner-h5/auth/me',undefined,headers(signed))).status,200);
}));

// Task11f: one enterprise entry retains distinct server authorization modes.
test('enterprise center selects legal invitation then bare-root membership; optional notices are independent',async()=>scopedLegalFixture(async f=>{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const preview=await req('/owner-h5/auth/invitation/preview',{mobile:f.actor.mobile,invitationCode:f.invitationToken});
 assert.equal(preview.status,201,JSON.stringify(preview.data));assert.equal(preview.data.mode,'ELECTRONIC_LEGAL');assert.equal(preview.data.companyName,f.owner.name);
 assert.equal(await db.ownerMember.count({where:{ownerId:f.owner.id}}),0);
 const notices=await req('/owner-h5/legal-signing');assert.equal(notices.status,200);assert.ok(Array.isArray(notices.data.missingTypes));
 for(const invitationToken of [f.invitationToken,undefined]){
  const input={mobile:f.actor.mobile,purpose:'ENTERPRISE_CENTER',...(invitationToken?{invitationToken}:{})};
  const challenge=await req('/owner-h5/auth/sms/request',input);assert.equal(challenge.status,201,JSON.stringify(challenge.data));
  const denied=await req('/owner-h5/auth/login',{...input,challengeId:challenge.data.challengeId,code:codes.get(f.actor.mobile),consents:[]});assert.equal(denied.status,409);
  assert.equal((await db.partnerPortalChallenge.findUniqueOrThrow({where:{id:challenge.data.challengeId}})).attempts,0);
  const signed=await req('/owner-h5/auth/login',{...input,challengeId:challenge.data.challengeId,code:codes.get(f.actor.mobile),consents});
  assert.equal(signed.status,201,JSON.stringify(signed.data));assert.equal(signed.data.mode,'ELECTRONIC_LEGAL');await age(f.actor.mobile);
 }
}));
test('enterprise center preserves readonly with legal gate closed, binds purpose and refuses invalid explicit invite fallback',async()=>{
 const saved=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='OFFLINE';
 try{
  const f=await grant(),input={mobile:f.mobile,purpose:'ENTERPRISE_CENTER'};
  const challenge=await req('/owner-h5/auth/sms/request',input);assert.equal(challenge.status,201,JSON.stringify(challenge.data));
  const signed=await req('/owner-h5/auth/login',{...input,challengeId:challenge.data.challengeId,code:codes.get(f.mobile),consents});assert.equal(signed.status,201);assert.equal(signed.data.mode,'PARTNER_READONLY');
  await age(f.mobile);const before=sends,bad=await req('/owner-h5/auth/sms/request',{...input,invitationToken:createOwnerInvitationToken()});assert.equal(bad.status,403);assert.equal(bad.data.challengeId,undefined);assert.equal(sends,before);
  await age(f.mobile);const swap=await req('/owner-h5/auth/sms/request',input);assert.equal((await login(f.mobile,swap.data.challengeId)).status,401);
 }finally{if(saved===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=saved;}
});

test('dual grants switch only through their own OTP and replace the prior session',async()=>scopedLegalFixture(async f=>{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';await grant(f.actor.mobile);
 const legal=await(await legalSms(f))();assert.equal(legal.status,201);assert.equal(legal.data.readonlyAvailable,true);
 await age(f.actor.mobile);const challenge=await sms(f.actor.mobile);
 const readonly=await req('/owner-h5/auth/login',{mobile:f.actor.mobile,challengeId:challenge.data.challengeId,code:codes.get(f.actor.mobile),consents},{cookie:headers(legal).cookie});
 assert.equal(readonly.status,201);assert.equal(readonly.data.mode,'PARTNER_READONLY');assert.equal((await req('/owner-h5/auth/me',undefined,headers(legal))).status,401);
 assert.equal((await req('/owner-h5/owners/'+f.owner.id+'/verification',{},headers(readonly))).status,403);
}));

test('enterprise legal previews accept legacy24 and reject phone, expiry, revocation and representative changes without creating a member',async()=>scopedLegalFixture(async f=>{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const legacy=randomUUID().replaceAll('-','').slice(0,24);await db.ownerInvitation.update({where:{id:f.invite.id},data:{tokenHash:tokenHash(legacy)}});
 const preview=()=>req('/owner-h5/auth/invitation/preview',{mobile:f.actor.mobile,invitationCode:legacy});
 assert.equal((await preview()).status,201);
 assert.equal((await req('/owner-h5/auth/invitation/preview',{mobile:newMobile(),invitationCode:legacy})).status,401);
 await db.ownerInvitation.update({where:{id:f.invite.id},data:{expiresAt:new Date(Date.now()-1)}});assert.equal((await preview()).status,401);
 await db.ownerInvitation.update({where:{id:f.invite.id},data:{expiresAt:new Date(Date.now()+3600000),revokedAt:new Date()}});assert.equal((await preview()).status,401);
 await db.ownerInvitation.update({where:{id:f.invite.id},data:{revokedAt:null}});await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{mobileHash:ownerMobileHash(newMobile()),revision:{increment:1}}});assert.equal((await preview()).status,401);
 assert.equal(await db.ownerMember.count({where:{ownerId:f.owner.id}}),0);
}));
test('enterprise challenge cannot change invitation or representative revision between SMS and login',async()=>scopedLegalFixture(async f=>{
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const input={mobile:f.actor.mobile,purpose:'ENTERPRISE_CENTER',invitationToken:f.invitationToken};
 for(const change of ['invitation','representative']){
  const challenge=await req('/owner-h5/auth/sms/request',input);assert.equal(challenge.status,201);
  if(change==='representative')await db.ownerLegalRepresentative.update({where:{ownerId:f.owner.id},data:{revision:{increment:1}}});
  const signed=await req('/owner-h5/auth/login',{...input,...(change==='invitation'?{invitationToken:createOwnerInvitationToken()}:{}),challengeId:challenge.data.challengeId,code:codes.get(f.actor.mobile),consents});
  assert.equal(signed.status,401);assert.equal(await db.ownerMember.count({where:{ownerId:f.owner.id}}),0);await age(f.actor.mobile);
 }
}));

test('SMS success requires dispatch and exact persisted pending challenge; unsent failures commit attempt and expose no usable handle',async()=>{
 const f=await grant();const success=await sms(f.mobile);assert.equal(success.status,201);assert.equal(success.data.accepted,true);const pending=await db.partnerPortalChallenge.findUniqueOrThrow({where:{id:success.data.challengeId}});assert.equal(pending.status,'PENDING');assert.ok(pending.smsChallengeId);
 for(const cause of ['rate','ineligible','invalid-invite','provider']){
  const mobile=cause==='rate'?f.mobile:(await grant()).mobile,where={mobileHash:protectedPortalMobile(mobile).mobileHash};
  if(cause==='ineligible')await db.partnerPortalAccess.updateMany({where,data:{status:'DISABLED'}});
  const count=await db.partnerPortalChallenge.count({where}),sent=sends;failSend=cause==='provider';
  let result:any;try{result=await req('/owner-h5/auth/sms/request',{mobile,...(cause==='invalid-invite'?{purpose:'ENTERPRISE_CENTER',invitationToken:createOwnerInvitationToken()}:{})});}finally{failSend=false;}
  assert.equal(result.status,cause==='rate'?429:cause==='provider'?503:403,cause);
  assert.equal(result.data.accepted,undefined);assert.equal(result.data.challengeId,undefined);assert.equal(result.data.resendAfterSeconds,undefined);assert.equal(sends,sent);
  assert.equal(await db.partnerPortalChallenge.count({where}),count+1);const row=await db.partnerPortalChallenge.findFirst({where,orderBy:{createdAt:'desc'}});assert.equal(row.status,cause==='rate'?'RATE_LIMITED':cause==='provider'?'FAILED':'DECOY');assert.equal(row.smsChallengeId,null);
  assert.equal(JSON.stringify(result.data).includes('synthetic private provider error'),false);
  if(cause==='provider')assert.equal(await db.auditLog.count({where:{action:'PARTNER_PORTAL_SMS_FAILED',resourceId:row.id}}),1);
 }
});
