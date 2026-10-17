import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerIdentityService} from '../src/owner-signing/identity';
import {hash} from '../src/common/data';
let db:Db,owners:OwnerService,identity:OwnerIdentityService,owner:any,actor:any,customer:any,other:any,docs:any[];
let calls:string[]=[],verified=false,managerMobile='',certBound=true,verificationThrows=false;
const suffix=randomUUID().replaceAll('-','').slice(0,10),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF4kAAAAASUVORK5CYII=';
const config:any={enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true,identityEncryptionKey:Buffer.alloc(32,7).toString('base64')};
const api:any={registerEnterprise:async()=>{calls.push('register');return{customerId:'Owner'+suffix};},createVerification:async()=>{calls.push('verify');if(verificationThrows)throw Error('synthetic timeout');return{customerId:'Owner'+suffix,serialNo:'Flow'+suffix,url:'https://realnameverify16.fadada.com/test'};},queryEnterprise:async()=>({verified,customerId:'Owner'+suffix,serialNo:'Flow'+suffix,manager:verified?{name:'Synthetic manager',mobile:managerMobile,identityNo:'syntheticSensitiveId',type:'1'}:undefined}),queryCertificate:async()=>({bound:certBound,serialNo:'Cert'+suffix}),querySeals:async()=>[{customerId:'Owner'+suffix,signatureId:'Seal'+suffix,imageBase64:png,imageType:'image/png',imageHash:hash(png)}]};
const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
before(async()=>{
 assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;db=new Db();process.env.OWNER_ONBOARDING_ENABLED='true';
 actor=await db.adminUser.create({data:{username:'ov'+suffix,name:'Synthetic operator',passwordHash:'unused',role:'OPERATIONS'}});
 customer=await db.customer.create({data:{mobile:'136'+String(Date.now()).slice(-8)}});other=await db.customer.create({data:{mobile:'135'+String(Date.now()).slice(-8)}});managerMobile=customer.mobile;
 owners=new OwnerService(db);owner=await owners.create(actor.id,{name:'合成企业'+suffix,creditCode:'TESTCODE'+suffix.toUpperCase(),address:'合成地址'});
 for(const c of [customer,other]){const invitation=await owners.invite(actor.id,owner.id,{mobile:c.mobile});await owners.claim(c.id,{token:invitation.token});}
 docs=await Promise.all(['terms','privacy','owner-identity'].map(async type=>{const max=await db.legalDocument.aggregate({where:{type},_max:{version:true}});return db.legalDocument.create({data:{type,version:(max._max.version||0)+1,title:'Synthetic approved',content:'Synthetic approved text',status:'PUBLISHED',confirmedBy:actor.id,confirmedAt:new Date()}});}));
 identity=new OwnerIdentityService(db,owners,config,api);
});
after(async()=>{if(db){await db.ownerSeal.deleteMany({where:{ownerId:owner?.id}});await db.ownerESignAccount.deleteMany({where:{ownerId:owner?.id}});await db.ownerInvitation.deleteMany({where:{ownerId:owner?.id}});await db.ownerMember.deleteMany({where:{ownerId:owner?.id}});await db.vehicleOwner.deleteMany({where:{id:owner?.id}});await db.customerConsent.deleteMany({where:{documentId:{in:docs?.map(d=>d.id)||[]}}});await db.legalDocument.deleteMany({where:{id:{in:docs?.map(d=>d.id)||[]}}});await db.auditLog.deleteMany({where:{OR:[{actorId:actor?.id},{resourceId:owner?.id}]}});await db.adminUser.deleteMany({where:{id:actor?.id}});await db.customer.deleteMany({where:{id:{in:[customer?.id,other?.id].filter(Boolean)}}});await db.$disconnect();}delete process.env.OWNER_ONBOARDING_ENABLED;});
test('owner-specific unchecked consent and disabled capability make no provider request',async()=>{
 await assert.rejects(identity.start(customer.id,owner.id,{consents:docs.map(d=>({documentId:d.id,version:d.version})),accepted:false}));assert.equal(calls.length,0);
 process.env.OWNER_ONBOARDING_ENABLED='false';await assert.rejects(identity.start(customer.id,owner.id,{accepted:true,consents:docs}),error('OWNER_ONBOARDING_DISABLED'));process.env.OWNER_ONBOARDING_ENABLED='true';assert.equal(calls.length,0);
});
test('one certification attempt is saved and reused, and a second contact cannot take it over',async()=>{
 const input={accepted:true,consents:docs.map(d=>({documentId:d.id,version:d.version}))};const first=await identity.start(customer.id,owner.id,input);assert.match(first.url,/^https:\/\/realnameverify16/);
 const second=await identity.start(customer.id,owner.id,input);assert.equal(second.url,first.url);assert.deepEqual(calls,['register','verify']);
 await assert.rejects(identity.start(other.id,owner.id,input),error('OWNER_MANAGER_BOUND'));
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:owner.id}});assert.ok(account.consentSnapshot);assert.ok(!JSON.stringify(account).includes('https://realnameverify'));assert.equal(account.realNameStatus,'PENDING');
});
test('returning without provider proof or a different certified manager grants no signing power',async()=>{
 let result=await identity.refresh(customer.id,owner.id);assert.equal(result.readyForSigning,false);assert.equal(result.memberStatus,'CLAIMED');
 verified=true;managerMobile=other.mobile;await assert.rejects(identity.refresh(customer.id,owner.id),error('OWNER_MANAGER_MISMATCH'));assert.equal((await owners.memberDetail(customer.id,owner.id)).readyForSigning,false);managerMobile=customer.mobile;
});
test('current enterprise identity plus certificate still requires explicit seal selection by its verified manager',async()=>{
 const result=await identity.refresh(customer.id,owner.id);assert.equal(result.memberStatus,'VERIFIED');assert.equal(result.readyForSigning,false);
 assert.ok(!JSON.stringify(result).includes('syntheticSensitiveId'));assert.ok(!JSON.stringify(result).includes(png));
 const seal=await db.ownerSeal.findFirstOrThrow({where:{ownerId:owner.id}});assert.equal(seal.status,'DISCOVERED');
 await assert.rejects(identity.selectSeal(other.id,owner.id,seal.id),error('OWNER_MEMBER_NOT_VERIFIED'));
 await identity.selectSeal(customer.id,owner.id,seal.id);assert.equal((await owners.memberDetail(customer.id,owner.id)).readyForSigning,true);
 const image=await identity.sealImage(customer.id,owner.id,seal.id);assert.equal(image.imageBase64,png);
 await assert.rejects(identity.sealImage(other.id,owner.id,seal.id),error('OWNER_MEMBER_NOT_VERIFIED'));
 certBound=false;assert.equal((await identity.refresh(customer.id,owner.id)).readyForSigning,false);
});
test('a contradictory refresh invalidates previous signing readiness',async()=>{
 certBound=true;await identity.refresh(customer.id,owner.id);const seal=await db.ownerSeal.findFirstOrThrow({where:{ownerId:owner.id}});await identity.selectSeal(customer.id,owner.id,seal.id);
 managerMobile=other.mobile;await assert.rejects(identity.refresh(customer.id,owner.id),error('OWNER_MANAGER_MISMATCH'));assert.equal((await owners.memberDetail(customer.id,owner.id)).readyForSigning,false);managerMobile=customer.mobile;
});
test('unknown start result cannot create a new chargeable verification attempt on retry',async()=>{
 await db.ownerESignAccount.update({where:{ownerId:owner.id},data:{realNameStatus:'VERIFY_UNKNOWN',verificationTransactionNo:null,verificationUrlCiphertext:null}});
 const before=calls.length;await assert.rejects(identity.start(customer.id,owner.id,{accepted:true,consents:docs.map(d=>({documentId:d.id,version:d.version}))}),error('OWNER_VERIFY_UNKNOWN'));assert.equal(calls.length,before);
});
