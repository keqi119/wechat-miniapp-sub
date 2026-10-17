import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {hash} from '../src/common/data';
import {encryptIdentity} from '../src/esign/fadada/fadada-safety';
import {recordFadadaQuery} from '../src/esign/fadada-query-binding';
import {MINIAPP_PROVIDER_API} from '../src/esign/native-signing';
import {ContractPdfArtifactWriterService} from '../src/contract/contract-pdf-artifact-writer.service';
import {commercialTermKeys} from '../src/contract/contract-template';
import {ownerAuthorityFixture} from './owner-authority-fixtures';
import {lessorIdentityHash} from '../src/owner-signing/lessor';
import {OwnerService} from '../src/owner-signing/owner.service';
import {OwnerSigningTasks} from '../src/owner-signing/tasks';
import {OwnerContractPreparation} from '../src/owner-signing/contract';
import {OwnerContractGateway} from '../src/owner-signing/gateway';
import {SignatureService} from '../src/orders/signature.service';
import {FadadaOwnerClient} from '../src/owner-signing/fadada-owner.client';
import {resolveDelayTemplate} from '../src/contract/delay-template';
let db:Db,writer:ContractPdfArtifactWriterService,prepare:OwnerContractPreparation,gateway:OwnerContractGateway,admin:any,f:any,tenant:any,contract:any,task:any;
const settings:any={enabled:true,signingEnabled:true,baseUrl:MINIAPP_PROVIDER_API,apiVersion:'2.0',appId:'synthetic',appSecret:'syntheticSecret',identityEncryptionKey:Buffer.alloc(32,8).toString('base64'),cjkFontPath:'C:/Windows/Fonts/simhei.ttf',requestTimeoutMs:1000};
let uploads=0,seals=0,downloadSource=false,badProof=false;const remote=new Map<string,boolean>(),pdfs=new Map<string,Buffer>();
const api:any={uploadDocs:async(i:any)=>{uploads++;pdfs.set(i.contractId,i.pdf);return{raw:{code:1}};},createExternalSignUrl:async(i:any)=>({signUrl:MINIAPP_PROVIDER_API+'extsign.api?transaction_id='+i.transactionId}),querySignResult:async(i:any)=>{const raw:any=remote.has(i.transactionId)?{code:1,data:{result:remote.get(i.transactionId)?'3000':'9999'}}:{code:1201,data:null,msg:'签署记录为空'};recordFadadaQuery(raw,badProof?{...i,customerId:'OtherAccount'}:i);return{raw,status:remote.get(i.transactionId)?'SIGNED':'UNKNOWN',...(remote.has(i.transactionId)?{resultCode:remote.get(i.transactionId)?'3000':'9999'}:{})};},autoSealContract:async(i:any)=>{seals++;remote.set(i.transactionId,true);return{resultCode:'1'};},downloadSignedContract:async(i:any)=>({buffer:downloadSource?pdfs.get(i.contractId)!:Buffer.concat([pdfs.get(i.contractId)!,Buffer.from('\n% synthetic signed revision\n')])})};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
before(async()=>{
 assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});process.env.OWNER_CONTRACTS_ENABLED='true';f=await ownerAuthorityFixture(db);
 admin=await db.adminUser.create({data:{username:randomUUID(),name:'Synthetic review',passwordHash:'unused',role:'OPERATIONS'}});tenant=await db.customer.create({data:{mobile:'synthetic-tenant-'+randomUUID(),name:'合成承租人'}});
 const ciphertext=encryptIdentity({name:tenant.name,idCardNo:'SYNTHETIC-ONLY'},tenant.id,settings.identityEncryptionKey);await db.eSignAccount.create({data:{customerId:tenant.id,providerCustomerId:'Tenant'+randomUUID().replaceAll('-',''),registrationStatus:'REGISTERED',realNameStatus:'VERIFIED',identityCiphertext:ciphertext,verifiedIdentityHash:createHash('sha256').update(ciphertext).digest('hex'),verifiedSerialNo:'SyntheticSerial',verificationTransactionNo:'Verify'+randomUUID(),verificationSource:'QUERY',certStatus:'BOUND',certSerialNo:'SyntheticCert',checkedAt:new Date(),verifiedAt:new Date()}});
 const template=f.docs.find((d:any)=>d.type==='owner-rental-contract');await db.legalDocument.update({where:{id:template.id},data:{content:'甲方出租方：{{lessorName}}，{{lessorCreditCode}}，{{lessorAddress}}，{{lessorPhone}}。乙方：{{customerName}}。本文件仅供合成自动化测试，不产生实际租赁。'}});template.content=(await db.legalDocument.findUniqueOrThrow({where:{id:template.id}})).content;
 const notice={id:'synthetic-notice',version:1,content:'Synthetic customer sharing',contentHash:hash('Synthetic customer sharing')},lessor={ownerId:f.owner.id,name:f.owner.name,creditCode:f.owner.creditCode,address:f.owner.address,phone:f.owner.contactPhone,vehicleId:f.vehicle.id,bindingId:'synthetic',bindingRevision:0,evidenceHash:'a'.repeat(64),templateId:template.id,templateVersion:template.version,templateHash:hash(template.content),sharingNotice:notice};
 const plan=await db.subscriptionPlan.create({data:{vehicleId:f.vehicle.id,name:'Synthetic',months:12,monthlyFeeAmount:1,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'客户自费',benefits:[],conditions:'合成条件'}});
 const app=await db.application.create({data:{customerId:tenant.id,vehicleId:f.vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'synthetic',status:'FINAL_PLAN_CONFIRMED'}});
 const order=await db.order.create({data:{applicationId:app.id,customerId:tenant.id,vehicleId:f.vehicle.id,confirmedMileageKm:100,finalPlanSnapshot:{lessorSnapshot:lessor,ownerDataConsent:{ownerId:f.owner.id,customerId:tenant.id,lessorHash:lessorIdentityHash(lessor),notice},revision:1,commercialHash:'a'.repeat(64),months:12,monthlyFeeAmount:1,depositAmount:1,mileagePerMonthKm:1500,excessMileagePriceAmount:150,startDate:'2026-10-17',firstDueDate:'2026-10-17',energyDescription:'客户自费',benefits:[],conditions:'合成条件',commercialTerms:Object.fromEntries(commercialTermKeys.map(k=>[k,'合成说明 '+k]))}}});contract=await db.contract.create({data:{orderId:order.id,customerId:tenant.id,documentHash:'a'.repeat(64),documentId:template.id,templateVersion:template.version}});
 writer=new ContractPdfArtifactWriterService(db);prepare=new OwnerContractPreparation(db,settings,writer);const owners=new OwnerService(db);gateway=new OwnerContractGateway(db,settings,api,new FadadaOwnerClient(settings),writer,new OwnerSigningTasks(db,owners),{refresh:async()=>{}} as any,{refresh:async()=>{}} as any);
});
after(async()=>{delete process.env.OWNER_CONTRACTS_ENABLED;await db?.$disconnect();});
test('preparation binds actual enterprise and tenant, preserves source bytes and requires PDF review before upload',async()=>{
 task=await prepare.prepare(admin.id,contract.id);assert.equal(task.status,'PREPARED');assert.equal(uploads,0);assert.equal((await prepare.prepare(admin.id,contract.id)).sourceFileId,task.sourceFileId);
 const stored=await db.ownerSigningTask.findUniqueOrThrow({where:{id:task.id},include:{parties:true}});assert.equal(stored.parties.find(p=>p.role==='OWNER')?.providerCustomerId,f.seal.providerCustomerId);assert.notEqual(stored.parties[0].providerCustomerId,stored.parties[1].providerCustomerId);
 await assert.rejects(gateway.customerSign(tenant.id,contract.id),code('OWNER_REVIEW_REQUIRED'));assert.equal(uploads,0);
 await prepare.review(admin.id,task.id,{sourceSha256:task.sourceSha256,documentHash:task.documentHash,accepted:true});
});
test('tenant entry uploads one immutable file and queries cannot use another signer receipt',async()=>{
 const result=await gateway.customerSign(tenant.id,contract.id);assert.ok(result.url);assert.equal(uploads,1);await gateway.customerSign(tenant.id,contract.id);assert.equal(uploads,1);
 const parties=await db.ownerSigningParty.findMany({where:{taskId:task.id}});remote.set(parties.find(p=>p.role==='CUSTOMER')!.transactionId,true);badProof=true;await assert.rejects(gateway.query(task.id),code('PROVIDER_IDENTITY_MISMATCH'));badProof=false;
 assert.equal((await gateway.query(task.id)).status,'PENDING');assert.equal(seals,0);
});
test('owner manually signs its own transaction; neither tenant-only nor source-only PDF completes contract',async()=>{
 const result=await gateway.ownerSign(f.customer.id,f.owner.id,task.id);assert.ok(result.url);assert.equal(new URL(result.url!).searchParams.get('customer_id'),f.seal.providerCustomerId);assert.equal(new URL(result.url!).searchParams.get('signature_id'),f.seal.providerSignatureId);
 assert.equal((await gateway.query(task.id)).status,'PENDING');const party=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:task.id,role:'OWNER'}}});remote.set(party.transactionId,true);downloadSource=true;await assert.rejects(gateway.query(task.id),code('OWNER_SIGNED_PDF_REQUIRED'));downloadSource=false;
 const finished=await gateway.query(task.id);assert.equal(finished.status,'SIGNED');assert.ok(finished.signedFileId);assert.equal(seals,0);
 const replay=await gateway.query(task.id);assert.equal(replay.signedFileId,finished.signedFileId);assert.equal((await db.contract.findUniqueOrThrow({where:{id:contract.id}})).status,'SIGNED');
});
async function freshTask(){
 const original=await db.ownerSigningTask.findUniqueOrThrow({where:{id:task.id}});const c=await db.contract.create({data:{orderId:contract.orderId,customerId:tenant.id,documentHash:hash(randomUUID()),sourceFileId:original.sourceFileId,status:'PENDING'}});
 const t=await db.ownerSigningTask.create({data:{ownerId:f.owner.id,customerId:tenant.id,kind:'SUBSCRIPTION',resourceId:c.id,documentHash:c.documentHash,sourceFileId:original.sourceFileId,sourceSha256:original.sourceSha256,providerContractId:randomUUID().replaceAll('-',''),snapshot:original.snapshot!,ownerSealId:f.seal.id,reviewedBy:admin.id,reviewedAt:new Date(),uploadedAt:new Date(),status:'READY',parties:{create:[{role:'OWNER',providerCustomerId:f.seal.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,transactionId:randomUUID().replaceAll('-','')},{role:'CUSTOMER',providerCustomerId:(await db.eSignAccount.findUniqueOrThrow({where:{customerId:tenant.id}})).providerCustomerId!,transactionId:randomUUID().replaceAll('-',''),attemptedAt:new Date(),status:'SUBMITTING'}]}}});await db.contract.update({where:{id:c.id},data:{providerTaskId:t.id}});await db.order.update({where:{id:c.orderId},data:{status:'AWAITING_SIGNATURE'}});pdfs.set(t.providerContractId,await writer.readVerified(t.sourceFileId,t.sourceSha256));return{t,c};
}
test('generic file settlement cannot bypass actual owner signature proof',async()=>{
 const {t,c}=await freshTask(),file=await db.storedFile.findUniqueOrThrow({where:{id:task.sourceFileId}});await assert.rejects(new SignatureService(db).settleContract(c.id,{status:'SIGNED',documentHash:c.documentHash,taskId:t.id,signedFileId:file.id}),code('OWNER_ARCHIVE_PROOF'));
});
test('unknown automatic signature outcome retains one owner transaction and recovers by query without re-sealing',async()=>{
 process.env.OWNER_AUTO_SIGNING_ENABLED='true';const {t}=await freshTask(),snapshot=t.snapshot as any,cp=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:t.id,role:'CUSTOMER'}}});remote.set(cp.transactionId,true);
 const scope={...f.scope,templateId:snapshot.template.id,templateVersion:snapshot.template.version,templateHash:snapshot.template.hash};await db.ownerAutoAuthority.create({data:{ownerId:f.owner.id,sealId:f.seal.id,providerCustomerId:f.seal.providerCustomerId,providerSignatureId:f.seal.providerSignatureId,certificateSerialNo:snapshot.lessor.certificateSerialNo,providerContractId:randomUUID(),providerTransactionId:randomUUID(),requestedBy:f.customer.id,idempotencyKey:randomUUID(),requestHash:hash(scope),scope,scopeHash:hash(scope),consentSnapshot:{synthetic:true},status:'AUTHORIZED',enabled:true,checkedAt:new Date()}});
 const saved=api.autoSealContract;let attempted=0;api.autoSealContract=async(i:any)=>{attempted++;remote.set(i.transactionId,true);throw new Error('synthetic transport timeout after provider acceptance');};
 try{await assert.rejects(gateway.query(t.id,true),/synthetic transport timeout/);const stored=await db.ownerSigningTask.findUniqueOrThrow({where:{id:t.id}});assert.ok(stored.ownerDispatchAt);assert.equal(stored.ownerMode,'AUTO');const result=await gateway.query(t.id,true);assert.equal(result.status,'SIGNED');assert.equal(attempted,1);}finally{api.autoSealContract=saved;delete process.env.OWNER_AUTO_SIGNING_ENABLED;await db.ownerAutoAuthority.updateMany({where:{ownerId:f.owner.id},data:{enabled:false}});}
});
test('unknown upload is recovered by matching existing remote source instead of a second upload',async()=>{
 const {t,c}=await freshTask();await db.ownerSigningTask.update({where:{id:t.id},data:{uploadedAt:null,status:'PREPARED'}});const cp=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:t.id,role:'CUSTOMER'}}});await db.ownerSigningParty.update({where:{id:cp.id},data:{attemptedAt:null}});
 const saved=api.uploadDocs;let attempted=0;api.uploadDocs=async(i:any)=>{attempted++;pdfs.set(i.contractId,i.pdf);throw new Error('synthetic upload timeout');};try{await assert.rejects(gateway.customerSign(tenant.id,c.id),/synthetic upload timeout/);assert.equal((await db.ownerSigningTask.findUniqueOrThrow({where:{id:t.id}})).status,'UPLOAD_UNKNOWN');downloadSource=true;assert.ok((await gateway.customerSign(tenant.id,c.id)).url);assert.equal(attempted,1);}finally{downloadSource=false;api.uploadDocs=saved;}
});
test('owner amendment pins the separately confirmed text and requires manual actual-owner signing',async()=>{
 const order=await db.order.update({where:{id:contract.orderId},data:{status:'AWAITING_HANDOVER'}}),prior=order.finalPlanSnapshot as any;
 const legal=await db.legalDocument.create({data:{type:'owner-delivery-delay',version:Date.now()%1000000000,title:'合成延期协议',content:'实际出租方：{{lessorName}}，信用代码{{lessorCreditCode}}。客户{{customerName}}。原合同{{originalContractNo}}；原文件{{originalContractHash}}。延期{{newStartDate}}至{{newEndDate}}。{{periodSchedule}}。{{financialSchedule}}。{{ownerSignatureSlot}}',status:'PUBLISHED',confirmedBy:admin.id,confirmedAt:new Date()}});
 const ch=await db.orderChange.create({data:{orderId:order.id,customerId:tenant.id,priorTerms:prior,priorTermsHash:hash(prior),originalContractId:contract.id,reason:'合成延期',createdBy:admin.id,idempotencyKey:randomUUID(),requestHash:randomUUID(),status:'AWAITING_SIGNATURE'}});
 const snap={newStartDate:'2026-10-18',newEndDate:'2027-10-17',periods:[{sequence:1,startDate:'2026-10-18',endDate:'2026-11-18',amount:1,dueDate:'2026-10-18',netPaidAmount:1,carryAmount:1,chargeAmount:0,refundAmount:0,calculationBasis:'合成报价'}],reason:'合成延期',settlementExplanation:'无差额',handoverArrangement:'合成交接',cancellationTerms:'依法处理',document:{id:legal.id,type:legal.type,version:legal.version,templateHash:hash(legal.content)}};
 const q=await db.delayQuote.create({data:{changeId:ch.id,revision:1,status:'CONFIRMED',commercialHash:hash(randomUUID()),snapshot:snap,fundsSnapshot:[],createdBy:admin.id,confirmedAt:new Date()}});await db.orderChange.update({where:{id:ch.id},data:{activeQuoteId:q.id}});
 const original=await db.contract.findUniqueOrThrow({where:{id:contract.id}}),archive=await db.storedFile.findUniqueOrThrow({where:{id:original.signedFileId!}}),id=randomUUID();
 const body=resolveDelayTemplate(legal.content,{id,orderId:order.id,order:{...order,customer:tenant},originalContractHash:archive.sha256,delayQuote:{...q,snapshot:snap,change:{...ch,activeQuoteId:q.id}}},{name:tenant.name,idCardNo:'SYNTHETIC-ONLY'});
 assert.ok(body.includes(f.owner.name));await db.delayQuote.update({where:{id:q.id},data:{snapshot:{...snap,document:{...snap.document,bodyHash:hash(body),content:body}}}});
 const c=await db.contract.create({data:{id,kind:'AMENDMENT',orderId:order.id,customerId:tenant.id,delayQuoteId:q.id,documentId:legal.id,templateVersion:legal.version,documentHash:q.commercialHash,body}});
 const t=await prepare.prepare(admin.id,c.id);assert.equal((await db.ownerSigningTask.findUniqueOrThrow({where:{id:t.id}})).kind,'AMENDMENT');await prepare.review(admin.id,t.id,{accepted:true,sourceSha256:t.sourceSha256,documentHash:t.documentHash});await gateway.customerSign(tenant.id,c.id);
 const cp=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:t.id,role:'CUSTOMER'}}});remote.set(cp.transactionId,true);process.env.OWNER_AUTO_SIGNING_ENABLED='true';const before=seals;await gateway.query(t.id,true);assert.equal(seals,before);
 const entry=await gateway.ownerSign(f.customer.id,f.owner.id,t.id);assert.equal(new URL(entry.url!).searchParams.get('customer_id'),f.seal.providerCustomerId);const op=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:t.id,role:'OWNER'}}});remote.set(op.transactionId,true);assert.equal((await gateway.query(t.id)).status,'SIGNED');assert.equal((await db.orderChange.findUniqueOrThrow({where:{id:ch.id}})).status,'AWAITING_FINANCE');delete process.env.OWNER_AUTO_SIGNING_ENABLED;
});
test('verified rejection terminates only its existing task and never dispatches the owner seal',async()=>{
 const {t,c}=await freshTask(),saved=api.querySignResult;const cp=await db.ownerSigningParty.findUniqueOrThrow({where:{taskId_role:{taskId:t.id,role:'CUSTOMER'}}});remote.set(cp.transactionId,false);api.querySignResult=async(i:any)=>{if(i.transactionId!==cp.transactionId)return saved(i);const raw={code:1,data:{result:'3001'}};recordFadadaQuery(raw,i);return{raw,status:'FAILED',resultCode:'3001'};};const before=seals;
 try{assert.equal((await gateway.query(t.id,true)).status,'REJECTED');assert.equal((await db.contract.findUniqueOrThrow({where:{id:c.id}})).status,'REJECTED');assert.equal(seals,before);await assert.rejects(gateway.customerSign(tenant.id,c.id),code('SIGNATURE_STATE'));}finally{api.querySignResult=saved;}
});
