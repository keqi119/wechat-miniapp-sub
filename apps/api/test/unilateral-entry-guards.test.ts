import {fileReadStore} from './file-store-fixture';
import './legacy-esign-mode';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FadadaOwnerClient,runOwnerH5} from '../src/owner-signing/fadada-owner.client';
import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
import {FilesController} from '../src/files/files';
import {AdminController} from '../src/operations/admin';
import {hash} from '../src/common/data';
import {MINIAPP_PROVIDER_API} from '../src/esign/native-signing';
import {projectRoot} from '../src/common/config';
import {resolve} from 'node:path';
import {evaluateOwnerSigning} from '../src/owner-signing/rules';
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
test('approved unilateral letter templates use the normal audited legal document creation path',async()=>{
 let saved:any;let audited=false;
 const db:any={serial:async(fn:any)=>fn({adminUser:{findUnique:async()=>({id:'synthetic-admin',role:'ADMIN',active:true,authVersion:0})},legalDocument:{create:async({data}:any)=>{saved={...data,id:'letter-template',status:'DRAFT'};return saved;}},auditLog:{create:async()=>{audited=true;}}})};
 const controller=new AdminController(db),content={type:'owner-authorization-letter',version:1,title:'单方授权书',content:'被授权人：上海宁达信息科技有限公司',confirmedBy:'Synthetic reviewer',confirmedAt:'2026-10-21T00:00:00.000Z'};
 const result=await controller.create('legal-documents',content,{admin:{id:'synthetic-admin',role:'ADMIN'}});
 assert.equal(result.type,'owner-authorization-letter');assert.equal(result.status,'DRAFT');assert.equal(audited,true);assert.equal(saved.confirmedAt.toISOString(),content.confirmedAt);
});
test('unilateral authorization signs the uploaded owner document through the dedicated authorization callback',()=>{
 const client=new FadadaOwnerClient({enabled:true,appId:'syntheticApp',appSecret:'syntheticSecret',baseUrl:MINIAPP_PROVIDER_API,apiVersion:'2.0',requestTimeoutMs:1000} as any);
 assert.equal(typeof (client as any).createAuthorityDocumentSignUrl,'function');
 const entry=runOwnerH5(()=>(client as any).createAuthorityDocumentSignUrl({customerId:'ActualOwner',signatureId:'OwnerSeal',contractId:'FrozenLetter',transactionId:'LetterTransaction',title:'企业车主单方用印授权书',positions:[{pagenum:1,x:230,y:420}]}));
 const u=new URL(entry.url);assert.equal(u.pathname,'/api2/extsign.api');assert.equal(u.searchParams.get('customer_id'),'ActualOwner');assert.equal(u.searchParams.get('contract_id'),'FrozenLetter');assert.equal(u.searchParams.get('signature_id'),'OwnerSeal');assert.equal(u.searchParams.get('auth_type'),null);assert.ok(u.searchParams.get('notify_url')?.endsWith('/callbacks/fadada-owner-authorization'));assert.ok(u.searchParams.get('return_url')?.endsWith('/owner/return/'));
});
test('a unilateral signed letter never enables automatic execution even when a global gate is accidentally opened',async()=>{
 const prior=process.env.OWNER_AUTO_SIGNING_ENABLED,priorName=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.OWNER_AUTO_SIGNING_ENABLED='true';process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 const scope={version:2,validFrom:'2026-10-01T00:00:00.000Z',validUntil:'2027-10-01T00:00:00.000Z',delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']};
 let providerCalls=0;
 const a={id:'letter',ownerId:'owner',method:'UNILATERAL_LETTER',status:'SIGNED',requestedBy:'actor',revision:1,scope,scopeHash:hash(scope)};
 const owners={member:async()=>{},requireLegalSigningMember:async()=>{},requireSigningMember:async()=>{},usesLegalPolicy:async()=>false};
 const service=new OwnerAuthorizationService({ownerAutoAuthority:{findFirst:async()=>a}} as any,owners as any,{queryAuthorization:async()=>{providerCalls++;throw Error('NO_TECHNICAL_GRANT');}} as any);
 try{let rejected:any;try{await service.setEnabled('actor','owner','letter',{enabled:true,revision:1,scopeHash:a.scopeHash});}catch(e){rejected=e;}assert.equal(providerCalls,0,'a signed business letter must not enter the legacy provider authorization flow');assert.ok(error('OWNER_CHANNEL_AUTH_REQUIRED')(rejected));}finally{if(prior===undefined)delete process.env.OWNER_AUTO_SIGNING_ENABLED;else process.env.OWNER_AUTO_SIGNING_ENABLED=prior;if(priorName===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=priorName;}
});
test('generic customer file access cannot bypass the current legal-representative check for authorization PDFs',async()=>{
 let streamed=false;const file={id:'pdf',purpose:'owner-authorization',customerId:'prior-legal',storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic.pdf'),name:'synthetic.pdf',mimeType:'application/pdf'};
 const controller=new FilesController({storedFile:{findUnique:async()=>file}} as any);
 await assert.rejects(controller.customerRead('pdf',{customer:{id:'prior-legal'}},{setHeader(){},sendFile(){streamed=true;}}),error('OWNER_LEGAL_H5_REQUIRED'));assert.equal(streamed,false);
});

test('resuming a pending letter is an explicit H5-only operation on the original authority ID',async()=>{
 const prior=process.env.OWNER_AUTHORIZATION_ENABLED;process.env.OWNER_AUTHORIZATION_ENABLED='true';
 let called=0;const row={id:'original',ownerId:'owner',method:'UNILATERAL_LETTER',status:'PENDING'};
 const service=new OwnerAuthorizationService({ownerAutoAuthority:{findFirst:async()=>row}} as any,{member:async()=>{},requireLegalSigningMember:async()=>{}} as any,{} as any,{requestEntry:async(c:string,o:string,id:string)=>{assert.deepEqual([c,o,id],['actor','owner','original']);called++;return{url:'https://textapi17.fadada.com/api2/extsign.api?original=1'};}} as any);
 try{
  assert.equal(typeof (service as any).resume,'function');
  await assert.rejects((service as any).resume('actor','owner','original'),error('OWNER_LEGAL_H5_REQUIRED'));
  const result=await runOwnerH5(()=>(service as any).resume('actor','owner','original'));assert.equal(result.id,'original');assert.equal(called,1);
  process.env.OWNER_AUTHORIZATION_ENABLED='false';await assert.rejects(runOwnerH5(()=>(service as any).resume('actor','owner','original')),error('OWNER_AUTHORIZATION_DISABLED'));assert.equal(called,1);
  process.env.OWNER_AUTHORIZATION_ENABLED='true';row.method='PROVIDER_AUTO_GRANT';await assert.rejects(runOwnerH5(()=>(service as any).resume('actor','owner','original')),error('OWNER_LETTER_NOT_FOUND'));assert.equal(called,1);
 }finally{if(prior===undefined)delete process.env.OWNER_AUTHORIZATION_ENABLED;else process.env.OWNER_AUTHORIZATION_ENABLED=prior;}
});
test('legacy account revocation leaves unilateral signed and pending letters unchanged',async()=>{
 const rows=[
  {id:'legacy',ownerId:'owner',providerCustomerId:'account',method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,revision:1},
  {id:'legacy-enabled',ownerId:'owner',providerCustomerId:'other-account',method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,revision:2},
  {id:'signed-letter',ownerId:'owner',providerCustomerId:'account',method:'UNILATERAL_LETTER',status:'SIGNED',enabled:false,revision:3},
  {id:'pending-letter',ownerId:'owner',providerCustomerId:'account',method:'UNILATERAL_LETTER',status:'PENDING',enabled:false,revision:4},
  {id:'other-owner',ownerId:'other-owner',providerCustomerId:'account',method:'PROVIDER_AUTO_GRANT',status:'AUTHORIZED',enabled:true,revision:5},
 ];
 const protectedRows=structuredClone(rows.slice(2));
 const matches=(row:any,where:any):boolean=>Object.entries(where).every(([field,value]:any)=>field==='OR'?value.some((clause:any)=>matches(row,clause)):field==='AND'?(Array.isArray(value)?value:[value]).every((clause:any)=>matches(row,clause)):row[field]===value);
 const table={findFirst:async({where}:any)=>rows.find(row=>matches(row,where)),findUniqueOrThrow:async({where}:any)=>rows.find(row=>matches(row,where)),updateMany:async({where,data}:any)=>{const affected=rows.filter(row=>matches(row,where));for(const row of affected)Object.assign(row,data,{revision:row.revision+data.revision.increment});return{count:affected.length};}};
 const tx={ownerAutoAuthority:table,vehicleOwner:{update:async()=>({})},auditLog:{create:async()=>({})}};
 const db={...tx,serial:async(fn:any)=>fn(tx)};
 const owners={member:async()=>{},requireLegalSigningMember:async()=>{}};
 const service=new OwnerAuthorizationService(db as any,owners as any,{createRevocationUrl:()=>({url:'https://synthetic.invalid/revoke'})} as any);
 await service.revoke('legal','owner','legacy');
 assert.equal(rows[0].status,'REVOKING');assert.equal(rows[0].enabled,false);assert.equal(rows[1].status,'REVOKING');
 assert.deepEqual(rows.slice(2),protectedRows,'channel-level revocation must not mutate unilateral business letters or another owner');
});
test('execution rejects a unilateral letter even if every legacy authorization flag is forged ready',()=>{
 const now=new Date('2026-10-21T12:00:00.000Z'),templateHash='a'.repeat(64);
 const facts={ownerId:'owner',sealId:'seal',certificateSerialNo:'certificate',ownerVerified:true,memberVerified:true,certificateValid:true,sealCurrent:true,identityCheckedAt:now,kind:'SUBSCRIPTION',vehicleId:'vehicle',templateId:'template',templateVersion:1,templateHash,monthlyFeeAmount:10000,depositAmount:20000,months:12,customerSigned:true,reviewed:true,authority:{ownerId:'owner',sealId:'seal',certificateSerialNo:'certificate',method:'PROVIDER_AUTO_GRANT',enabled:true,status:'AUTHORIZED',providerAuthorized:true,providerCheckedAt:now,scope:{version:1,vehicleIds:['vehicle'],templateId:'template',templateVersion:1,templateHash,validFrom:'2026-10-01T00:00:00.000Z',validUntil:'2027-10-01T00:00:00.000Z',minMonthlyFeeAmount:10000,maxMonthlyFeeAmount:10000,minDepositAmount:20000,maxDepositAmount:20000,minMonths:12,maxMonths:12}}};
 assert.deepEqual(evaluateOwnerSigning(facts,now),{decision:'AUTO_ALLOWED',reason:'WITHIN_VERIFIED_SCOPE'},'fixture must otherwise qualify for legacy automatic signing');
 facts.authority.method='UNILATERAL_LETTER';
 assert.deepEqual(evaluateOwnerSigning(facts,now),{decision:'MANUAL_REQUIRED',reason:'CHANNEL_AUTHORIZATION_REQUIRED'});
});
for(const role of ['FIELD','FINANCE','SUPPORT'])test(`${role} cannot download owner authorization PDFs through the generic admin file endpoint`,async()=>{
 let streamed=false;const file={id:'letter-pdf',purpose:'owner-authorization',storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic-letter.pdf'),name:'synthetic-letter.pdf',mimeType:'application/pdf'};
 const controller=new FilesController(fileReadStore({storedFile:{findUnique:async()=>file},paymentReconciliation:{count:async()=>0},customerQualificationVersion:{count:async()=>0},partnerIdentityBinding:{count:async()=>0},partnerVerification:{count:async()=>0},partnerVehicleBindingProposal:{count:async()=>0},ownerVehicle:{count:async()=>0},partnerVehicleBindingHistory:{count:async()=>0},offlineCancellationReview:{count:async()=>0},contract:{count:async()=>0},ownerSigningTask:{count:async()=>0}}) as any);
 await assert.rejects(controller.adminRead(file.id,{admin:{id:'staff',role}},{setHeader(){},sendFile(){streamed=true;}}),(e:any)=>e.getStatus?.()===403);
 assert.equal(streamed,false);
});
