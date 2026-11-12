import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerH5Service} from '../src/owner-h5/service';
import {OwnerH5AuthController} from '../src/owner-h5/auth.controller';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
import {hash} from '../src/common/data';
const flags=['OWNER_AUTHORIZATION_ENABLED','OWNER_AUTO_SIGNING_ENABLED','OWNER_ONBOARDING_ENABLED'];
const prior=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
let db:Db,f:any,service:OwnerAuthorizationService,h5:OwnerH5Service;
before(async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.endsWith('_test'));
 db=new Db({datasourceUrl:url.href});f=await ownerAuthorityFixture(db);
 const mobile='135'+String(Date.now()).slice(-8),name='Synthetic legal representative';
 await db.customer.update({where:{id:f.customer.id},data:{mobile}});
 await db.ownerLegalRepresentative.create({data:{ownerId:f.owner.id,name,mobileHash:ownerMobileHash(mobile),maskedMobile:'135****'+mobile.slice(-4),evidenceHash:'f'.repeat(64),createdBy:'fixture',updatedBy:'fixture'}});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentedAt:new Date(),consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:f.customer.id,legalRevision:1,legalName:name,legalMobileHash:ownerMobileHash(mobile)}}});
 const latest=await db.legalDocument.aggregate({where:{type:'owner-identity'},_max:{version:true}});
 f.docs.push(await db.legalDocument.create({data:{type:'owner-identity',version:(latest._max.version||0)+1,title:'Synthetic identity',content:'Synthetic identity',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}}));
 const account=await db.ownerESignAccount.findUniqueOrThrow({where:{ownerId:f.owner.id}});
 const provider:any={assertAvailable:()=>{},createAuthorizationUrl:()=>({url:'https://textapi17.fadada.com/api2/before_authsign.api?synthetic=1'}),queryAuthorization:async()=>({authorized:true}),queryCertificate:async()=>({bound:true,serialNo:account.certSerialNo})};
 const owners=new OwnerService(db);service=new OwnerAuthorizationService(db,owners,provider);
 h5=new OwnerH5Service(db,owners,{} as any,service,{enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true} as any);
 process.env.OWNER_ONBOARDING_ENABLED='true';
});
after(async()=>{for(const k of flags){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}await db?.$disconnect();});
const request=()=>({...f.request,idempotencyKey:randomUUID()});
test('verified legal owner can obtain authorization while automatic signing stays closed',async()=>{
 process.env.OWNER_AUTHORIZATION_ENABLED='true';process.env.OWNER_AUTO_SIGNING_ENABLED='false';
 let grant=await service.request(f.customer.id,f.owner.id,request());
 assert.equal(grant.status,'PENDING');assert.equal(grant.enabled,false);assert.match(grant.url,/before_authsign/);
 grant=await service.refresh(f.customer.id,f.owner.id,grant.id);assert.equal(grant.status,'AUTHORIZED');assert.equal(grant.enabled,false);
 await assert.rejects(service.setEnabled(f.customer.id,f.owner.id,grant.id,{enabled:true,revision:grant.revision,scopeHash:grant.scopeHash}),error('OWNER_AUTO_DISABLED'));
 assert.equal((await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:grant.id}})).enabled,false);
});
test('H5 separates authorization readiness from automatic execution readiness',async()=>{
 process.env.OWNER_AUTHORIZATION_ENABLED='true';process.env.OWNER_AUTO_SIGNING_ENABLED='false';
 const detail:any=await h5.detail(f.customer.id,f.owner.id);
 assert.equal(detail.readyForSigning,true);assert.equal(detail.certificationComplete,true);assert.equal(detail.authorizationEntryEnabled,true);assert.equal(detail.autoSigningExecutionEnabled,false);
 assert.equal(detail.capabilities.canRequestAuthority,true);assert.equal(detail.capabilities.canEnableAuthority,false);
 assert.ok(!detail.blockers.some((b:string)=>b.includes('授权入口尚未开放')));
});
test('an explicit closed authorization entry rejects new grants even when execution is enabled',async()=>{
 process.env.OWNER_AUTHORIZATION_ENABLED='false';process.env.OWNER_AUTO_SIGNING_ENABLED='true';
 const count=await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}});
 await assert.rejects(service.request(f.customer.id,f.owner.id,request()),error('OWNER_AUTHORIZATION_DISABLED'));
 assert.equal(await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}}),count);
 assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,false);
});
test('existing installations without the new flag preserve their explicit execution gate',async()=>{
 delete process.env.OWNER_AUTHORIZATION_ENABLED;process.env.OWNER_AUTO_SIGNING_ENABLED='true';
 const grant=await service.request(f.customer.id,f.owner.id,request());assert.equal(grant.enabled,false);
 assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,true);
});
test('readonly portal login excludes historical signing bodies while legacy internal options keep their template',async()=>{
 const legal=await new OwnerH5AuthController(db,{} as any).legal(),options=await h5.options(f.customer.id,f.owner.id);
 const template=legal.documents.find((d:any)=>d.id===options.template?.id);
 assert.equal(template,undefined);assert.deepEqual(legal.documents.map((d:any)=>d.type),['terms','privacy']);assert.ok(options.template?.id);for(const doc of legal.documents)assert.equal((doc as any).contentHash,hash(doc.content));
});
test('opening authorization does not bypass stale enterprise seal checks',async()=>{
 process.env.OWNER_AUTHORIZATION_ENABLED='true';process.env.OWNER_AUTO_SIGNING_ENABLED='false';
 await db.ownerSeal.update({where:{id:f.seal.id},data:{checkedAt:new Date(Date.now()-86400001)}});
 assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,false);
 await assert.rejects(service.request(f.customer.id,f.owner.id,request()),error('OWNER_SEAL_UNAVAILABLE'));
});
