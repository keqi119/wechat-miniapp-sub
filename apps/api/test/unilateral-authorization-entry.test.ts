import './legacy-esign-mode';
import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {OwnerH5Service} from '../src/owner-h5/service';
import {ownerMobileHash} from '../src/owner-h5/legal-representative';
import {runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
const flags=['OWNER_AUTHORIZATION_METHOD','OWNER_AUTHORIZATION_SCOPE_VERSION','OWNER_AUTHORIZATION_ENABLED','OWNER_AUTO_SIGNING_ENABLED','OWNER_ONBOARDING_ENABLED','PLATFORM_LEGAL_ENTITY_NAME'];
const prior=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
let db:Db,f:any,service:OwnerAuthorizationService,h5:OwnerH5Service,letter:any,entries=0;
const content='# 合成单方授权书\n授权编号：{{authorityId}}\n授权人：{{ownerName}}\n代码：{{creditCode}}\n住所：{{ownerAddress}}\n法人：{{legalName}}\n被授权人：上海宁达信息科技有限公司\n期间：{{validFrom}} 至 {{validUntil}}\n仅用于合成测试，不用于真实授权。';
const request=()=>({...f.request,scope:{version:2,validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']},consents:[...f.request.consents,{documentId:letter.id,version:letter.version}],idempotencyKey:randomUUID()});
before(async()=>{
 const u=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(u.hostname)&&u.pathname.endsWith('_test'));
 db=new Db({datasourceUrl:u.href});f=await ownerAuthorityFixture(db);
 await db.vehicleOwner.update({where:{id:f.owner.id},data:{name:'上海晓浪网络科技有限公司'}});
 const oldNotice=f.docs.find((d:any)=>d.type==='owner-auto-sign');
 if(oldNotice.version<3){const notice=await db.legalDocument.create({data:{type:'owner-auto-sign',version:3,title:'Synthetic notice v3',content:'Synthetic separated permission notice',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});f.request.consents=f.request.consents.map((x:any)=>x.documentId===oldNotice.id?{documentId:notice.id,version:notice.version}:x);}
 const version=((await db.legalDocument.aggregate({where:{type:'owner-authorization-letter'},_max:{version:true}}))._max.version||0)+1;
 await db.legalDocument.updateMany({where:{type:'owner-authorization-letter',status:'PUBLISHED'},data:{status:'RETIRED'}});
 letter=await db.legalDocument.create({data:{type:'owner-authorization-letter',version,title:'Synthetic unilateral authorization',content,status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
 const mobile='137'+String(Date.now()).slice(-8),name='合成法人';await db.customer.update({where:{id:f.customer.id},data:{mobile}});
 await db.ownerLegalRepresentative.create({data:{ownerId:f.owner.id,name,mobileHash:ownerMobileHash(mobile),maskedMobile:'137****'+mobile.slice(-4),evidenceHash:'f'.repeat(64),createdBy:'fixture',updatedBy:'fixture'}});
 await db.ownerESignAccount.update({where:{ownerId:f.owner.id},data:{consentedAt:new Date(),consentSnapshot:{channel:'OWNER_LEGAL_H5',customerId:f.customer.id,legalRevision:1,legalName:name,legalMobileHash:ownerMobileHash(mobile)}}});
 const owners=new OwnerService(db);service=new OwnerAuthorizationService(db,owners,{createAuthorizationUrl(){throw Error('LEGACY_AUTO_GRANT_MUST_NOT_BE_USED');}} as any,{requestEntry:async()=>{entries++;return{url:'https://textapi17.fadada.com/api2/extsign.api?synthetic=1'};}} as any);
 h5=new OwnerH5Service(db,owners,{} as any,service,{enabled:true,accountRegisterEnabled:true,realNameVerifyEnabled:true} as any);
 Object.assign(process.env,{OWNER_AUTHORIZATION_METHOD:'UNILATERAL_LETTER',OWNER_AUTHORIZATION_SCOPE_VERSION:'2',OWNER_AUTHORIZATION_ENABLED:'true',OWNER_AUTO_SIGNING_ENABLED:'false',OWNER_ONBOARDING_ENABLED:'true',PLATFORM_LEGAL_ENTITY_NAME:'上海宁达信息科技有限公司'});
});
after(async()=>{for(const k of flags){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}await db?.$disconnect();});
test('new entry freezes the actual owner and fixed Ningda recipient, uses its own signed document and preserves idempotency',async()=>{
 const input=request();const a=await runOwnerH5(()=>service.request(f.customer.id,f.owner.id,input));
 assert.equal(a.method,'UNILATERAL_LETTER');assert.match(a.url,/extsign.api/);assert.equal(a.enabled,false);
 const row=await db.ownerAutoAuthority.findUniqueOrThrow({where:{id:a.id},include:{letter:true}}),s=row.letter!.snapshot as any;
 assert.equal(s.ownerName,'上海晓浪网络科技有限公司');assert.equal(s.grantee,'上海宁达信息科技有限公司');assert.equal(s.templateHash,hash(content));assert.equal(s.validUntil,input.scope.validUntil);assert.ok(row.letter!.bodyHash);assert.equal(row.status,'PENDING');
 assert.equal((await runOwnerH5(()=>service.request(f.customer.id,f.owner.id,input))).id,a.id);assert.equal(await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id,idempotencyKey:input.idempotencyKey}}),1);
 await assert.rejects(runOwnerH5(()=>service.request(f.customer.id,f.owner.id,{...input,scope:{...input.scope,validUntil:new Date(Date.now()+172800000).toISOString()}})),error('IDEMPOTENCY_CONFLICT'));
});
test('a new letter needs its own current template consent and cannot silently use an old generic notice',async()=>{
 const count=await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}}),before=entries;
 const input=request();await assert.rejects(runOwnerH5(()=>service.request(f.customer.id,f.owner.id,{...input,consents:f.request.consents})),error('CONSENT_VERSION'));
 await db.legalDocument.update({where:{id:letter.id},data:{confirmedBy:null}});
 try{assert.equal((await h5.detail(f.customer.id,f.owner.id)).capabilities.canRequestAuthority,false);await assert.rejects(runOwnerH5(()=>service.request(f.customer.id,f.owner.id,input)),error('OWNER_LETTER_TEMPLATE_REQUIRED'));}finally{await db.legalDocument.update({where:{id:letter.id},data:{confirmedBy:'fixture'}});}
 assert.equal(entries,before);assert.equal(await db.ownerAutoAuthority.count({where:{ownerId:f.owner.id}}),count);
});
test('server returns method and template binding and rejects creating a letter through the miniapp path',async()=>{
 const d:any=await h5.detail(f.customer.id,f.owner.id),o:any=await h5.options(f.customer.id,f.owner.id);
 assert.equal(d.authorizationMethod,'UNILATERAL_LETTER');assert.equal(o.authorizationMethod,'UNILATERAL_LETTER');assert.equal(o.authorizationLetterTemplate.id,letter.id);assert.equal(o.authorizationLetterTemplate.hash,hash(content));
 assert.equal(d.capabilities.canEnableAuthority,false);await assert.rejects(service.request(f.customer.id,f.owner.id,request()),error('OWNER_LEGAL_H5_REQUIRED'));
});
