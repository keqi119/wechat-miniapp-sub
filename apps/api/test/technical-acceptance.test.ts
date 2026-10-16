import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../src/esign/native-fadada-adapter';
import {FadadaESignGateway} from '../src/esign/fadada/fadada-esign.provider';
import {SignaturePolicyService} from '../src/esign/enterprise-seal/signature-policy.service';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {TechnicalAcceptanceSigning} from '../src/technical-acceptance/signing';
import {buildFadadaMsgDigest} from '../src/esign/fadada/fadada-digest';
import {Db} from '../src/common/db';
import {createApp} from '../src/app';
import {tokenHash} from '../src/auth/auth.service';
import {listenForHttpTests} from './http-listener';
let db:Db,app:any,base:string,customer:any,other:any;
let realGateway:FadadaESignGateway,admin:any,reviewer:any,policy:any,privacy:any,record:any;
const dbErrors:string[]=[];
let customerSigned=false,platformSigned=false,downloadFail=false,seals=0,uploads=0;
const identityKey=Buffer.alloc(32,13).toString('base64');
const token=randomUUID(),otherToken=randomUUID(),adminToken=randomUUID(),csrf=randomUUID();
async function request(path:string,method='GET',body?:any,actor='customer'){
 const headers:any={'Content-Type':'application/json',Origin:'http://localhost:3100'};
 if(actor==='admin'){headers.Cookie='admin_session='+adminToken;headers['X-CSRF-Token']=csrf;}else headers.Authorization='Bearer '+(actor==='customer'?token:otherToken);
 const r=await fetch(base+'/api/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json() as any};
}
before(async()=>{
 const u=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(u.hostname));u.pathname='/technical_acceptance_test';process.env.DATABASE_URL=u.href;process.env.NODE_ENV='test';process.env.ADMIN_ORIGIN='http://localhost:3100';
 db=new Db();const serial=db.serial.bind(db);db.serial=(async(op:any)=>{try{return await serial(op);}catch(e:any){dbErrors.push(String(e.code)+':'+String(e.meta?.code));throw e;}}) as any;customer=await db.customer.create({data:{mobile:'ta-'+randomUUID()}});other=await db.customer.create({data:{mobile:'ta-'+randomUUID()}});
 process.env.ESIGN_IDENTITY_ENCRYPTION_KEY=identityKey;process.env.FADADA_CJK_FONT_PATH='C:/Windows/Fonts/simhei.ttf';process.env.FADADA_ENABLED='false';process.env.FADADA_SIGNING_ENABLED='false';process.env.MINIAPP_SIGNING_ENABLED='true';process.env.FADADA_BASE_URL='https://textapi17.fadada.com/api2/';process.env.MINIAPP_SIGNING_PROVIDER_HOSTS='textapi17.fadada.com,realnameverify16.fadada.com';process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='false';
 await db.customer.update({where:{id:customer.id},data:{mobile:'139'+String(Date.now()).slice(-8)}});customer=await db.customer.findUniqueOrThrow({where:{id:customer.id}});
 admin=await db.adminUser.create({data:{username:'ta-'+randomUUID(),passwordHash:'unused',name:'Synthetic reviewer',role:'ADMIN'}});
 await db.adminSession.create({data:{id:tokenHash(adminToken),adminId:admin.id,csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
 for(const[c,t]of[[customer,token],[other,otherToken]])await db.customerSession.create({data:{id:tokenHash(t),customerId:c.id,expiresAt:new Date(Date.now()+3600000)}});
 const proxy:any={create:(i:any)=>realGateway.create(i),query:(i:any)=>realGateway.query(i),callback:(...args:any[])=>(realGateway.callback as any)(...args)};
 app=await createApp({db,esign:proxy,extraProviders:[{provide:FadadaESignGateway,useValue:proxy}]});base=await listenForHttpTests(app);
 const writer=app.get(ContractPdfArtifactWriterService),policies=app.get(SignaturePolicyService);
 const settings:any={enabled:true,signingEnabled:false,identityEncryptionKey:identityKey,signNotifyUrl:'https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-sign',signReturnUrl:'https://mini-api.subauto.keybox.cloud/api/public/esign-return',signUrlValidityMinutes:30,appId:'synthetic',appSecret:'synthetic'};
 const queryConfig:any={enabled:true,appId:'synthetic',appSecret:'synthetic',apiVersion:'2.0',requestTimeoutMs:1000,baseUrl:'https://textapi17.fadada.com/api2/'};
 const queryClient=new NativeAwareFadadaClient(queryConfig,new NativeAwareFadadaHttp(queryConfig,async request=>{const platform=new URLSearchParams(String(request.body)).get('customer_id')==='synthetic-platform',signed=platform?platformSigned:customerSigned;return{status:200,headers:{},bodyText:JSON.stringify(platform&&!signed?{code:1201,data:null,msg:'签署记录为空'}:{code:1,data:{result:signed?'3000':'9999',result_desc:signed?'签章成功':'待签署'},msg:'success'})};}));
 const api:any={uploadDocs:async()=>{uploads++;return{raw:{code:'1'}};},createExternalSignUrl:async()=>({signUrl:'https://textapi17.fadada.com/sign?opaque=a%2Fb'}),querySignResult:(i:any)=>queryClient.querySignResult(i),autoSealContract:async()=>{seals++;platformSigned=true;return{resultCode:'3000'};},downloadSignedContract:async(i:any)=>{if(downloadFail)throw Error('synthetic download failure');const t=await db.fadadaTask.findUniqueOrThrow({where:{providerEnvelopeId:i.contractId}});return{buffer:await writer.readVerified(t.sourceFileId,t.sourcePdfHash)};}};
 realGateway=new FadadaESignGateway(db,settings,api,writer,policies);
});
test('published approved text produces an immutable standalone PDF; consent and two people are required',async()=>{
 const ciphertext=encryptIdentity({name:'合成验收参与者',idCardNo:'110101199001010000'},customer.id,identityKey);
 await db.eSignAccount.create({data:{customerId:customer.id,providerCustomerId:'synthetic-'+customer.id,registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',verificationSource:'QUERY',verifiedAt:new Date(),checkedAt:new Date(),certStatus:'BOUND',certSerialNo:'synthetic-cert',identityCiphertext:ciphertext,verifiedIdentityHash:createHash('sha256').update(ciphertext).digest('hex'),verifiedSerialNo:'synthetic-serial',verificationTransactionNo:'synthetic-verification-'+customer.id}});
 for(const type of ['terms','privacy']){let d=await db.legalDocument.findFirst({where:{type,status:'PUBLISHED'},orderBy:{version:'desc'}});if(!d)d=await db.legalDocument.create({data:{type,version:1,title:type,content:'Synthetic consent',status:'PUBLISHED',confirmedBy:'synthetic',confirmedAt:new Date()}});if(type==='privacy')privacy=d;await db.customerConsent.create({data:{customerId:customer.id,documentId:d.id,version:d.version,type,source:'SYNTHETIC'}});}
 let legal=await db.legalDocument.findFirst({where:{type:'technical-signing-verification',status:'PUBLISHED'}});if(!legal)legal=await db.legalDocument.create({data:{type:'technical-signing-verification',version:1,title:'合成技术验收',content:await readFile('../../docs/legal/versions/technical-signing/technical-signing-verification-v1.md','utf8'),status:'PUBLISHED',confirmedBy:'synthetic',confirmedAt:new Date()}});
 const counts=await Promise.all([db.order.count(),db.bill.count(),db.payment.count(),db.usageAccount.count()]);
 const input={customerId:customer.id,documentId:legal.id,idempotencyKey:randomUUID()};const created=await request('admin/technical-acceptances','POST',input,'admin');assert.equal(created.status,201,JSON.stringify(created.data));record=created.data;assert.ok(record.sourceFileId);assert.ok(record.document.content.includes('合成验收参与者'));assert.ok(!record.document.content.includes('110101199001010000'));assert.ok(!record.document.content.includes(customer.mobile));assert.equal(record.enabled,false);assert.equal((await request('admin/technical-acceptances','POST',input,'admin')).data.id,record.id);
 assert.equal((await request('customer/technical-acceptances/'+record.id,'GET',undefined,'other')).status,404);
 assert.equal((await request('customer/technical-acceptances/'+record.id+'/confirm','POST',{revision:record.revision,idempotencyKey:randomUUID()})).status,400);
 const payload={revision:record.revision,idempotencyKey:randomUUID(),...Object.fromEntries(['documentHash','bodyHash','templateHash'].map(k=>[k,record.document[k]])),consent:{accepted:true,disclosureVersion:'1',privacyDocumentId:privacy.id,privacyVersion:privacy.version}};
 const confirmed=await request('customer/technical-acceptances/'+record.id+'/confirm','POST',payload);assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));record=confirmed.data;
 assert.equal((await request('customer/technical-acceptances/'+record.id+'/confirm','POST',payload)).data.revision,record.revision);
 process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';assert.equal((await request('customer/technical-acceptances/'+record.id+'/sign','POST',{revision:record.revision,idempotencyKey:randomUUID()})).status,409);assert.equal(uploads,0);
 reviewer=await db.adminUser.create({data:{username:'ta-'+randomUUID(),passwordHash:'unused',name:'Other synthetic reviewer',role:'ADMIN'}});
 const seal=await db.enterpriseSeal.create({data:{evidenceFileId:'synthetic-evidence',sealName:'Synthetic seal',organizationName:'上海晓浪网络科技有限公司',providerCustomerId:'synthetic-platform',providerSignatureId:'synthetic-seal',status:'ACTIVE',confirmedBy:reviewer.id,confirmedAt:new Date()}});
 for(const[id,type]of[[admin.id,'REQUEST_USE'],[reviewer.id,'APPROVE_USE']])await db.sealAuthority.create({data:{sealId:seal.id,subjectType:'USER',subjectId:id,authorityType:type,status:'ACTIVE',requiresTwoPersonApproval:true}});
 policy=await db.signaturePolicy.create({data:{policyCode:randomUUID(),policyName:'Synthetic acceptance',kind:'TECHNICAL_ACCEPTANCE',sealId:seal.id,status:'ACTIVE',executionMode:'SEQUENTIAL'}});
 const prepared=await request('admin/technical-acceptances/'+record.id+'/prepare-signature','POST',{revision:record.revision,policyId:policy.id,idempotencyKey:randomUUID()},'admin');assert.equal(prepared.status,201,JSON.stringify(prepared.data));
 const policies=app.get(SignaturePolicyService);await assert.rejects(policies.approve(prepared.data.approval.id,admin.id,prepared.data.approval.planHash));await policies.approve(prepared.data.approval.id,reviewer.id,prepared.data.approval.planHash);
 const signed=await request('customer/technical-acceptances/'+record.id+'/sign','POST',{revision:record.revision,idempotencyKey:randomUUID()});assert.equal(signed.status,201,JSON.stringify(signed.data));assert.equal(uploads,1);assert.equal(seals,0);
 assert.deepEqual(await Promise.all([db.order.count(),db.bill.count(),db.payment.count(),db.usageAccount.count()]),counts);
});
test('technical query while independent flag closed never creates an enterprise seal, and GET status is local',async()=>{
 assert.ok(record);customerSigned=true;process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='false';
 const r=await request('customer/technical-acceptances/'+record.id+'/sign-status');assert.equal(r.status,200);assert.equal(seals,0);
 const sync=await request('customer/technical-acceptances/'+record.id+'/sync','POST',{revision:r.data.revision,idempotencyKey:randomUUID()});assert.equal(sync.status,201,JSON.stringify(sync.data));assert.equal(sync.data.signatureStatus,'PENDING');assert.equal(seals,0);
 process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';
 const current=(await request('customer/technical-acceptances/'+record.id)).data;
 assert.equal(current.canSign,false);assert.match(current.statusMessage,/本人.*签署/);
 const repeat=await request('customer/technical-acceptances/'+record.id+'/sign','POST',{revision:current.revision,idempotencyKey:randomUUID()});
 assert.equal(repeat.status,409);assert.equal(repeat.data.error.code,'SIGNER_ALREADY_SIGNED');assert.equal(seals,0);
 process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='false';
});
test('stopping a pending technical record blocks new seals while preserving late trustworthy archival',async()=>{
 let r=(await request('customer/technical-acceptances/'+record.id)).data;
 const stop={revision:r.revision,idempotencyKey:randomUUID()};const stopped=await request('customer/technical-acceptances/'+record.id+'/stop','POST',stop);assert.equal(stopped.status,201);assert.equal(stopped.data.status,'STOPPED');assert.equal((await request('customer/technical-acceptances/'+record.id+'/stop','POST',stop)).data.revision,stopped.data.revision);
 process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';
 const sync=await request('customer/technical-acceptances/'+record.id+'/sync','POST',{revision:stopped.data.revision,idempotencyKey:randomUUID()});assert.equal(sync.status,201);assert.equal(seals,0);assert.equal(sync.data.signatureStatus,'PENDING');
 assert.equal((await request('customer/technical-acceptances/'+record.id+'/sign','POST',{revision:stopped.data.revision,idempotencyKey:randomUUID()})).status,409);
 // Synthetic provider task models a dispatch that already happened before stop; never real signing.
 const task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:record.id}});await db.fadadaTask.update({where:{id:task.id},data:{sealRequestedAt:new Date(Date.now()-1000)}});platformSigned=true;downloadFail=true;
 await assert.rejects(realGateway.query(task.id),/synthetic download failure/);assert.notEqual((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).status,'SIGNED');
 downloadFail=false;process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='false';const event=await realGateway.query(task.id);assert.equal(event.status,'SIGNED');await app.get(TechnicalAcceptanceSigning).settle(record.id,{...event,taskId:task.id});await app.get(TechnicalAcceptanceSigning).settle(record.id,{...event,taskId:task.id});
 r=(await request('customer/technical-acceptances/'+record.id)).data;assert.equal(r.status,'STOPPED');assert.equal(r.signatureStatus,'SIGNED');assert.ok(r.signedFileId);assert.equal(r.canSign,false);assert.equal(seals,0);assert.ok(Date.parse(r.retentionDueAt)>=Date.parse(r.completedAt)+180*86400000,'late completion retains evidence for 180 days from latest terminal fact');
 const invalid={...event,taskId:'wrong'};await assert.rejects(app.get(TechnicalAcceptanceSigning).settle(record.id,invalid));
});
test('retention requires an explicit due review, preserves shared identity, clears consent and denies restored file metadata',async()=>{
 let r=(await request('admin/technical-acceptances/'+record.id,'GET',undefined,'admin')).data;
 assert.equal((await request('admin/technical-acceptances/'+record.id+'/purge','POST',{revision:r.revision,idempotencyKey:randomUUID(),reason:'Synthetic cleanup'},'admin')).status,409);
 await db.technicalAcceptance.update({where:{id:record.id},data:{retentionDueAt:new Date(Date.now()-1000)}});
 r=(await request('admin/technical-acceptances/'+record.id+'/retention-review','POST',{revision:r.revision,idempotencyKey:randomUUID(),legalHold:true,reason:'Synthetic unresolved dispute'},'admin')).data;assert.equal(r.legalHold,true);
 assert.equal((await request('admin/technical-acceptances/'+record.id+'/purge','POST',{revision:r.revision,idempotencyKey:randomUUID(),reason:'Synthetic cleanup'},'admin')).status,409);
 r=(await request('admin/technical-acceptances/'+record.id+'/retention-review','POST',{revision:r.revision,idempotencyKey:randomUUID(),legalHold:false,reason:'Synthetic dispute resolved'},'admin')).data;
 const original=await db.storedFile.findUniqueOrThrow({where:{id:r.sourceFileId}});const shared=await db.storedFile.create({data:{customerId:customer.id,purpose:'contract',name:'Other resource shared storage',storagePath:original.storagePath,size:original.size,sha256:original.sha256,mimeType:original.mimeType}});
 const own=await db.technicalAcceptance.findUniqueOrThrow({where:{id:record.id}});const sharedRecord=await db.technicalAcceptance.create({data:{customerId:customer.id,createdBy:admin.id,documentId:own.documentId,templateVersion:own.templateVersion,templateHash:own.templateHash,body:'Synthetic separate document',bodyHash:own.bodyHash,documentHash:randomUUID(),sourceFileId:own.signedFileId,stoppedAt:new Date()}});
 const orphan=await app.get(ContractPdfArtifactWriterService).persistPdf(Buffer.concat([await readFile(original.storagePath),Buffer.from('\n% synthetic crash orphan')]),{customerId:customer.id,purpose:'technical-acceptance',name:record.id+'-signed.pdf'});
 const input={revision:r.revision,idempotencyKey:randomUUID(),reason:'Synthetic expiry review and deletion'};const purged=await request('admin/technical-acceptances/'+record.id+'/purge','POST',input,'admin');assert.equal(purged.status,201,JSON.stringify(purged.data));assert.equal(purged.data.status,'PURGED');assert.equal((await request('admin/technical-acceptances/'+record.id+'/purge','POST',input,'admin')).status,201);
 const stored=await db.technicalAcceptance.findUniqueOrThrow({where:{id:record.id}});assert.equal(stored.body,'');assert.equal(stored.consentSnapshot,null);assert.equal(stored.customerId,null);assert.equal(stored.slotCoordinates,null);assert.ok(await db.eSignAccount.findUnique({where:{customerId:customer.id}}));assert.ok((await readFile(shared.storagePath)).length>50);
 assert.ok(await db.storedFile.findUnique({where:{id:sharedRecord.sourceFileId!}}),'same file ID owned by another technical record must survive');
 assert.equal(await db.storedFile.findUnique({where:{id:orphan.id}}),null);await assert.rejects(readFile(orphan.storagePath));
 await db.storedFile.create({data:original});assert.equal((await request('customer/files/'+original.id)).status,404);assert.equal((await request('admin/files/'+original.id,'GET',undefined,'admin')).status,404);
});
after(async()=>{await app?.close();await db?.$disconnect();});
test('independent acceptance list is authenticated and does not create commercial records',async()=>{
 const before=await Promise.all([db.order.count(),db.bill.count(),db.payment.count(),db.usageAccount.count()]);
 const r=await request('customer/technical-acceptances');assert.equal(r.status,200);assert.ok(Array.isArray(r.data.items));
 assert.deepEqual(await Promise.all([db.order.count(),db.bill.count(),db.payment.count(),db.usageAccount.count()]),before);
});
test('creation cannot use an unpublished template or caller supplied identity',async()=>{
 const legal=await db.legalDocument.create({data:{type:'technical-signing-verification',version:Date.now()%100000000,title:'Synthetic',content:'test'}});
 const r=await request('admin/technical-acceptances','POST',{customerId:customer.id,documentId:legal.id,idempotencyKey:randomUUID()},'admin');assert.equal(r.status,409);
 assert.equal((await request('admin/technical-acceptances','POST',{customerId:customer.id,documentId:legal.id,idempotencyKey:randomUUID(),participantName:'forged'},'admin')).status,400);
});
async function freshConfirmed(){
 const legal=await db.legalDocument.findFirstOrThrow({where:{type:'technical-signing-verification',status:'PUBLISHED'}});
 const created=await request('admin/technical-acceptances','POST',{customerId:customer.id,documentId:legal.id,idempotencyKey:randomUUID()},'admin');assert.equal(created.status,201,JSON.stringify(created.data));const r=created.data;
 const confirmed=await request('customer/technical-acceptances/'+r.id+'/confirm','POST',{revision:r.revision,idempotencyKey:randomUUID(),...Object.fromEntries(['documentHash','bodyHash','templateHash'].map(k=>[k,r.document[k]])),consent:{accepted:true,disclosureVersion:'1',privacyDocumentId:privacy.id,privacyVersion:privacy.version}});assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));return confirmed.data;
}
test('changed bound identity cannot sign a previously confirmed participant document',async()=>{
 const r=await freshConfirmed();const original=customer.mobile;await db.customer.update({where:{id:customer.id},data:{mobile:'138'+String(Date.now()).slice(-8)}});
 const result=await request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',{revision:r.revision,policyId:policy.id,idempotencyKey:randomUUID()},'admin');assert.equal(result.status,409);assert.equal(result.data.error.code,'ACCEPTANCE_IDENTITY_CHANGED');
 await db.customer.update({where:{id:customer.id},data:{mobile:original}});await request('customer/technical-acceptances/'+r.id+'/stop','POST',{revision:r.revision,idempotencyKey:randomUUID()});
});
test('concurrent signing reuses one envelope and partial/archive failure cannot report success; callback replay is idempotent',async()=>{
 const r=await freshConfirmed();process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';customerSigned=false;platformSigned=false;const previousUploads=uploads,previousSeals=seals;
 const prepare={revision:r.revision,policyId:policy.id,idempotencyKey:randomUUID()};const [a,b]=await Promise.all([request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',prepare,'admin'),request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',prepare,'admin')]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.approval.id,b.data.approval.id);
 await app.get(SignaturePolicyService).approve(a.data.approval.id,reviewer.id,a.data.approval.planHash);
 const input={revision:r.revision,idempotencyKey:randomUUID()};const results=await Promise.all([request('customer/technical-acceptances/'+r.id+'/sign','POST',input),request('customer/technical-acceptances/'+r.id+'/sign','POST',input)]);assert.ok(results.some(x=>x.status===201));assert.ok(results.every(x=>[201,409].includes(x.status)),JSON.stringify(results.map(x=>({status:x.status,error:x.data.error})))+JSON.stringify(dbErrors));assert.equal(uploads,previousUploads+1);assert.equal(await db.fadadaTask.count({where:{resourceId:r.id}}),1);
 const task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:r.id}});assert.equal((await realGateway.query(task.id)).status,'PENDING');assert.equal(seals,previousSeals);
 customerSigned=true;downloadFail=true;await assert.rejects(realGateway.query(task.id));assert.equal(seals,previousSeals+1);assert.equal((await request('customer/technical-acceptances/'+r.id)).data.signatureStatus,'PENDING');downloadFail=false;
 const payload={transaction_id:task.customerTransactionId,contract_id:task.providerEnvelopeId,timestamp:'20261016190000',result_code:'3000'},digest=buildFadadaMsgDigest({appId:'synthetic',appSecret:'synthetic',timestamp:payload.timestamp,businessParams:payload,explicitSortString:payload.transaction_id});
 const first=await request('callbacks/fadada-sign','POST',{...payload,msg_digest:digest});assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.replayed,false);const again=await request('callbacks/fadada-sign','POST',{...payload,msg_digest:digest});assert.equal(again.data.replayed,true);assert.equal(seals,previousSeals+1);const complete=(await request('customer/technical-acceptances/'+r.id)).data;assert.equal(complete.signatureStatus,'SIGNED');assert.ok(complete.signedFileId);
 assert.equal((await request('callbacks/fadada-sign','POST',{...payload,msg_digest:'wrong'})).status,401);
});
test('a stop racing after approval evaluation wins before atomic seal dispatch',async()=>{
 const r=await freshConfirmed();customerSigned=false;platformSigned=false;process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';const prep=await request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',{revision:r.revision,policyId:policy.id,idempotencyKey:randomUUID()},'admin');await app.get(SignaturePolicyService).approve(prep.data.approval.id,reviewer.id,prep.data.approval.planHash);assert.equal((await request('customer/technical-acceptances/'+r.id+'/sign','POST',{revision:r.revision,idempotencyKey:randomUUID()})).status,201);
 const task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:r.id}}),policies=app.get(SignaturePolicyService),original=policies.approved.bind(policies),previousSeals=seals;customerSigned=true;
 policies.approved=async(...args:any[])=>{const result=await original(...args);await request('customer/technical-acceptances/'+r.id+'/stop','POST',{revision:r.revision,idempotencyKey:randomUUID()});return result;};
 try{assert.equal((await realGateway.query(task.id)).status,'PENDING');assert.equal(seals,previousSeals);assert.equal((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).sealRequestedAt,null);}finally{policies.approved=original;}
 const current=(await request('admin/technical-acceptances/'+r.id,'GET',undefined,'admin')).data;await db.technicalAcceptance.update({where:{id:r.id},data:{retentionDueAt:new Date(Date.now()-1000)}});const reviewed=await request('admin/technical-acceptances/'+r.id+'/retention-review','POST',{revision:current.revision,idempotencyKey:randomUUID(),legalHold:false,reason:'Synthetic review'},'admin');assert.equal((await request('admin/technical-acceptances/'+r.id+'/purge','POST',{revision:reviewed.data.revision,idempotencyKey:randomUUID(),reason:'Synthetic attempted purge'},'admin')).status,409);
});
test('stale general privacy consent requires explicit existing consent flow before separate technical consent',async()=>{
 const legal=await db.legalDocument.findFirstOrThrow({where:{type:'technical-signing-verification',status:'PUBLISHED'}});const r=(await request('admin/technical-acceptances','POST',{customerId:customer.id,documentId:legal.id,idempotencyKey:randomUUID()},'admin')).data;
 privacy=await db.legalDocument.create({data:{type:'privacy',version:privacy.version+1,title:'Synthetic updated privacy',content:'Synthetic updated',status:'PUBLISHED',confirmedAt:new Date(),confirmedBy:'synthetic'}});
 const view=(await request('customer/technical-acceptances/'+r.id)).data;assert.equal(view.consentRequirementsMet,false);assert.equal(view.canConfirm,false);
 const payload={revision:r.revision,idempotencyKey:randomUUID(),...Object.fromEntries(['documentHash','bodyHash','templateHash'].map(k=>[k,r.document[k]])),consent:{accepted:true,disclosureVersion:'1',privacyDocumentId:privacy.id,privacyVersion:privacy.version}};assert.equal((await request('customer/technical-acceptances/'+r.id+'/confirm','POST',payload)).status,409);
 const terms=await db.legalDocument.findFirstOrThrow({where:{type:'terms',status:'PUBLISHED'},orderBy:{version:'desc'}});assert.equal((await request('customer/consents','POST',{consents:[{documentId:terms.id,version:terms.version},{documentId:privacy.id,version:privacy.version}]})).status,201);assert.equal((await request('customer/technical-acceptances/'+r.id+'/confirm','POST',payload)).status,201);
});
test('finance/support cannot access technical records, approvals or PDF and admin CSRF remains required',async()=>{
 const row=await db.technicalAcceptance.findFirstOrThrow({where:{customerId:customer.id,stoppedAt:null}});
 for(const role of ['FINANCE','SUPPORT']){const a=await db.adminUser.create({data:{username:randomUUID(),name:'Synthetic forbidden role',role:role as any,passwordHash:'unused'}}),session=randomUUID();await db.adminSession.create({data:{id:tokenHash(session),adminId:a.id,csrfToken:'synthetic',expiresAt:new Date(Date.now()+3600000)}});
 for(const path of ['admin/technical-acceptances','admin/technical-acceptances/'+row.id,'admin/files/'+row.sourceFileId,'admin/esign-approvals']){const r=await fetch(base+'/api/'+path,{headers:{Cookie:'admin_session='+session}});assert.equal(r.status,403,path);}}
 const missing=await fetch(base+'/api/admin/technical-acceptances/'+row.id+'/stop',{method:'POST',headers:{Cookie:'admin_session='+adminToken,Origin:'http://localhost:3100','Content-Type':'application/json'},body:JSON.stringify({revision:row.revision,idempotencyKey:randomUUID()})});assert.equal(missing.status,403);
 const none=await fetch(base+'/api/customer/technical-acceptances');assert.equal(none.status,401);
});
test('stop committed during pre-dispatch audit prevents the actual seal call and clears only the unsent marker',async()=>{
 const previous=await db.technicalAcceptance.findFirst({where:{customerId:customer.id,stoppedAt:null,status:{in:['DRAFT','PENDING']}}});if(previous)await request('customer/technical-acceptances/'+previous.id+'/stop','POST',{revision:previous.revision,idempotencyKey:randomUUID()});
 const r=await freshConfirmed();process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';customerSigned=false;platformSigned=false;
 const prep=await request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',{revision:r.revision,policyId:policy.id,idempotencyKey:randomUUID()},'admin');await app.get(SignaturePolicyService).approve(prep.data.approval.id,reviewer.id,prep.data.approval.planHash);assert.equal((await request('customer/technical-acceptances/'+r.id+'/sign','POST',{revision:r.revision,idempotencyKey:randomUUID()})).status,201);
 customerSigned=true;const previousSeals=seals,task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:r.id}}),original=db.auditLog.create.bind(db.auditLog);
 db.auditLog.create=(async(input:any)=>{if(input.data.action==='ENTERPRISE_SEAL_EXECUTION'){assert.equal((await request('customer/technical-acceptances/'+r.id+'/stop','POST',{revision:r.revision,idempotencyKey:randomUUID()})).status,201);process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='false';}return original(input);})as any;
 try{assert.equal((await realGateway.query(task.id)).status,'PENDING');assert.equal(seals,previousSeals);assert.equal((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).sealRequestedAt,null);}finally{db.auditLog.create=original;}
});
test('lost archive lease discards the unpublished PDF without changing the winner or signed state',async()=>{
 const r=await db.technicalAcceptance.findFirstOrThrow({where:{customerId:customer.id,status:'PENDING',stoppedAt:{not:null}},orderBy:{createdAt:'desc'}});const task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:r.id}});await db.fadadaTask.update({where:{id:task.id},data:{sealRequestedAt:new Date()}});customerSigned=true;platformSigned=true;
 const writer=app.get(ContractPdfArtifactWriterService),original=writer.persistPdf.bind(writer);let orphanId:string|undefined;
 writer.persistPdf=async(...args:any[])=>{const file=await original(...args);orphanId=file.id;await db.fadadaTask.update({where:{id:task.id},data:{processingUntil:new Date(Date.now()+120000)}});return file;};
 try{await assert.rejects(realGateway.query(task.id),(e:any)=>e.getResponse?.().error?.code==='SIGNATURE_LEASE_LOST');assert.ok(orphanId);assert.equal(await db.storedFile.findUnique({where:{id:orphanId}}),null);assert.equal((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).signedFileId,null);}finally{writer.persistPdf=original;}
});

async function readyDispatch(){
 const r=await freshConfirmed();process.env.TECHNICAL_ACCEPTANCE_SIGNING_ENABLED='true';customerSigned=false;platformSigned=false;
 const prep=await request('admin/technical-acceptances/'+r.id+'/prepare-signature','POST',{revision:r.revision,policyId:policy.id,idempotencyKey:randomUUID()},'admin');assert.equal(prep.status,201,JSON.stringify(prep.data));await app.get(SignaturePolicyService).approve(prep.data.approval.id,reviewer.id,prep.data.approval.planHash);
 assert.equal((await request('customer/technical-acceptances/'+r.id+'/sign','POST',{revision:r.revision,idempotencyKey:randomUUID()})).status,201);customerSigned=true;return{r,task:await db.fadadaTask.findFirstOrThrow({where:{resourceId:r.id}})};
}
test('dispatch already in progress holds stop until the supplier call ends without a second seal',async()=>{
 const {r,task}=await readyDispatch(),api=(realGateway as any).api,original=api.autoSealContract,previousSeals=seals;let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 api.autoSealContract=async(i:any)=>{entered();await gate;return original(i);};
 const pending=realGateway.query(task.id);await started;let stopped=false;const stopping=request('customer/technical-acceptances/'+r.id+'/stop','POST',{revision:r.revision,idempotencyKey:randomUUID()}).then(x=>{stopped=true;return x;});
 try{await new Promise(resolve=>setTimeout(resolve,100));assert.equal(stopped,false);assert.equal((await db.technicalAcceptance.findUniqueOrThrow({where:{id:r.id}})).stoppedAt,null);release();await pending;const result=await stopping;assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.status,'STOPPED');assert.equal(seals,previousSeals+1);assert.equal((await realGateway.query(task.id)).status,'SIGNED');assert.equal(seals,previousSeals+1);}finally{release();api.autoSealContract=original;}
});
test('transaction failure after the supplier call preserves durable intent and never retries a seal',async()=>{
 const {r,task}=await readyDispatch(),original=db.$transaction.bind(db),previousSeals=seals;
 (db as any).$transaction=(action:any,options:any)=>original(options?.isolationLevel==='ReadCommitted'?async(tx:any)=>{await action(tx);throw Error('synthetic post-dispatch transaction failure');}:action,options);
 try{await assert.rejects(realGateway.query(task.id),/synthetic post-dispatch transaction failure/);assert.equal(seals,previousSeals+1);assert.ok((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).sealRequestedAt);}finally{(db as any).$transaction=original;}
 assert.equal((await realGateway.query(task.id)).status,'SIGNED');assert.equal(seals,previousSeals+1);await request('customer/technical-acceptances/'+r.id+'/stop','POST',{revision:r.revision,idempotencyKey:randomUUID()});
});
