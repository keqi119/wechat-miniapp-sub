import {persistLegacySigningResource} from './legacy-esign-mode';
import {platformLegalEntity} from '../src/common/platform-legal-entity';
import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { SignaturePolicyService } from '../src/esign/enterprise-seal/signature-policy.service';
import { hashSigningPlanPayload } from '../src/esign/enterprise-seal/signing-plan-hash';
let db:Db, policies:SignaturePolicyService, prefix:string, actor:any, reviewer:any, seal:any, policy:any,prepares=0;
const documentHash='a'.repeat(64), sourcePdfHash='b'.repeat(64);
const signingSettings:any={};
before(async()=>{
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;db=new Db();prefix='esign-'+randomUUID();
  await persistLegacySigningResource(db,{id:prefix,documentHash});
  actor=await db.adminUser.create({data:{username:prefix+'-requester',name:'Requester',role:'OPERATIONS',passwordHash:'not-login-fixture'}});
  reviewer=await db.adminUser.create({data:{username:prefix+'-reviewer',name:'Reviewer',role:'ADMIN',passwordHash:'not-login-fixture'}});
  seal=await db.enterpriseSeal.create({data:{sealName:prefix,organizationName:'上海宁达信息科技有限公司',providerCustomerId:'platform-fixture',providerSignatureId:'seal-fixture',status:'ACTIVE',evidenceFileId:'synthetic-evidence',confirmedBy:reviewer.id,confirmedAt:new Date()}});
  policy=await db.signaturePolicy.create({data:{policyCode:prefix,policyName:'Synthetic signing policy',kind:'SUBSCRIPTION',sealId:seal.id,status:'ACTIVE'}});
  for(const [subjectId,authorityType]of[[actor.id,'REQUEST_USE'],[actor.id,'APPROVE_USE'],[reviewer.id,'APPROVE_USE']])await db.sealAuthority.create({data:{sealId:seal.id,subjectType:'USER',subjectId,authorityType}});
  const writer:any={resource:async()=>({id:prefix,customerId:prefix,orderId:prefix,status:'PENDING',documentHash,body:'甲方：'+platformLegalEntity()}),prepare:async()=>{prepares++;return{resource:{id:prefix,customerId:prefix,orderId:prefix,status:'DRAFT',documentHash},file:{id:'synthetic-source',sha256:sourcePdfHash},slotCoordinates:[{slotId:'STAGE1_BODY_CUSTOMER',pageNumber:0,x:100,y:200}],documentHash};},readVerified:async()=>Buffer.from('%PDF-test-only')};
  const accounts:any={readiness:async()=>({signingEligible:true,readyForSigning:true,realNameStatus:'VERIFIED',state:'SIGNING_ENABLED'})};
  policies=new SignaturePolicyService(db,writer,accounts,signingSettings);
});
after(async()=>{if(db){await db.fadadaTask.deleteMany({where:{resourceId:prefix}});await db.eSignApproval.deleteMany({where:{resourceId:prefix}});await db.signaturePolicy.deleteMany({where:{id:policy?.id}});await db.sealAuthority.deleteMany({where:{sealId:seal?.id}});await db.enterpriseSeal.deleteMany({where:{id:seal?.id}});await db.adminUser.deleteMany({where:{id:{in:[actor?.id,reviewer?.id].filter(Boolean)}}});await db.$disconnect();}});
test('a retained legacy seal cannot authorize a new legal entity or survive a changed provider mapping',async()=>{
 const previous=process.env.PLATFORM_LEGAL_ENTITY_NAME;
 process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 try{
  await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海晓浪网络科技有限公司'}});
  await assert.rejects(policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id),(e:any)=>e.getResponse?.().error?.code==='ENTERPRISE_SEAL');
  await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
  await assert.rejects(policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id),(e:any)=>e.getResponse?.().error?.code==='SEAL_PROVIDER_MAPPING');
 }finally{
  if(previous===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=previous;
  await db.eSignApproval.deleteMany({where:{resourceId:prefix}});
  await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
 }
});
test('old approval and PDF reuse cannot acquire a new company identity through changed deployment settings',async()=>{
 const previous=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME='上海晓浪网络科技有限公司';
 Object.assign(signingSettings,{platformCustomerId:seal.providerCustomerId,platformSignatureId:seal.providerSignatureId});
 await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海晓浪网络科技有限公司'}});
 const old=await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id);await policies.approve(old.id,reviewer.id,old.planHash);
 process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 Object.assign(signingSettings,{platformCustomerId:seal.providerCustomerId,platformSignatureId:seal.providerSignatureId});
 await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
 try{
  await assert.rejects(policies.approved('SUBSCRIPTION',prefix,documentHash,old.id),(e:any)=>e.getResponse?.().error?.code==='LEGAL_ENTITY_MISMATCH');
  await db.eSignApproval.update({where:{id:old.id},data:{status:'PENDING',approverId:null,approvedAt:null}});
  await assert.rejects(policies.approve(old.id,reviewer.id,old.planHash),(e:any)=>e.getResponse?.().error?.code==='LEGAL_ENTITY_MISMATCH');
  await db.eSignApproval.update({where:{id:old.id},data:{status:'APPROVED',approverId:reviewer.id,approvedAt:new Date(),expiresAt:new Date(0)}});
  await db.fadadaTask.create({data:{kind:'SUBSCRIPTION',resourceId:prefix,customerId:prefix,documentHash,sourcePdfHash,sourceFileId:old.sourceFileId,approvalId:old.id,providerEnvelopeId:prefix+'-entity-envelope',customerProviderId:prefix+'-entity-customer',platformProviderId:seal.providerCustomerId,customerTransactionId:prefix+'-entity-customer-tx',platformTransactionId:prefix+'-entity-platform-tx',status:'PENDING'}});
  await assert.rejects(policies.renew(old.id,policy.id,actor.id),(e:any)=>e.getResponse?.().error?.code==='LEGAL_ENTITY_MISMATCH');
 }finally{
  await db.fadadaTask.deleteMany({where:{resourceId:prefix}});await db.eSignApproval.deleteMany({where:{resourceId:prefix}});
  await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
  delete signingSettings.platformCustomerId;delete signingSettings.platformSignatureId;
  if(previous===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=previous;
 }
});
test('a newly prepared current-company plan keeps dual approval and rejects later entity-marker tampering',async()=>{
 const previous=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME='上海宁达信息科技有限公司';
 Object.assign(signingSettings,{platformCustomerId:seal.providerCustomerId,platformSignatureId:seal.providerSignatureId});
 await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
 try{
  const draft=await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id);
  assert.equal((draft.plan as any).platformLegalEntityName,'上海宁达信息科技有限公司');
  await assert.rejects(policies.approve(draft.id,actor.id,draft.planHash),(e:any)=>e.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  await policies.approve(draft.id,reviewer.id,draft.planHash);
  assert.equal((await policies.approved('SUBSCRIPTION',prefix,documentHash,draft.id)).approval.id,draft.id);
  await db.eSignApproval.update({where:{id:draft.id},data:{plan:{...(draft.plan as any),platformLegalEntityName:'上海晓浪网络科技有限公司'}}});
  await assert.rejects(policies.approved('SUBSCRIPTION',prefix,documentHash,draft.id),(e:any)=>e.getResponse?.().error?.code==='LEGAL_ENTITY_MISMATCH');
 }finally{
  await db.eSignApproval.deleteMany({where:{resourceId:prefix}});await db.enterpriseSeal.update({where:{id:seal.id},data:{organizationName:'上海宁达信息科技有限公司'}});
  delete signingSettings.platformCustomerId;delete signingSettings.platformSignatureId;
  if(previous===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=previous;
 }
});
test('document and immutable plan require a different authorized reviewer; revoked authority invalidates approval',async()=>{
  const draft=await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id);
  assert.equal(draft.status,'PENDING');
  await assert.rejects(policies.approve(draft.id,actor.id,draft.planHash),(e:any)=>e.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  await policies.approve(draft.id,reviewer.id,draft.planHash);
  assert.equal((await policies.approved('SUBSCRIPTION',prefix,documentHash)).approval.status,'APPROVED');
  await db.eSignApproval.update({where:{id:draft.id},data:{sourcePdfHash:'c'.repeat(64)}});
  await assert.rejects(policies.approved('SUBSCRIPTION',prefix,documentHash),(e:any)=>e.getResponse?.().error?.code==='SIGNING_PLAN_CHANGED');
  await db.eSignApproval.update({where:{id:draft.id},data:{sourcePdfHash}});
  await db.sealAuthority.updateMany({where:{sealId:seal.id,subjectId:reviewer.id,authorityType:'APPROVE_USE'},data:{status:'DISABLED'}});
  await assert.rejects(policies.approved('SUBSCRIPTION',prefix,documentHash),(e:any)=>e.getResponse?.().error?.code==='SEAL_APPROVER_AUTHORITY');
});
test('expired and rejected approvals remain immutable history and allow a fresh idempotent review attempt',async()=>{
  await db.sealAuthority.updateMany({where:{sealId:seal.id},data:{status:'ACTIVE'}});
  const old=await db.eSignApproval.findFirstOrThrow({where:{resourceId:prefix}});
  await db.eSignApproval.update({where:{id:old.id},data:{expiresAt:new Date(0)}});
  const fresh=await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id);
  assert.notEqual(fresh.id,old.id);assert.equal(fresh.status,'PENDING');
  assert.equal((await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id)).id,fresh.id);
  await assert.rejects(policies.reject(fresh.id,actor.id,'资料需更正'),(e:any)=>e.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  await policies.reject(fresh.id,reviewer.id,'资料需更正');
  const again=await policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id);
  assert.notEqual(again.id,fresh.id);assert.equal((await db.eSignApproval.findUniqueOrThrow({where:{id:fresh.id}})).status,'REJECTED');
  assert.equal((await db.eSignApproval.findUniqueOrThrow({where:{id:old.id}})).expiresAt.getTime(),0);
  assert.equal(await db.eSignApproval.count({where:{resourceId:prefix}}),3);
  await db.eSignApproval.update({where:{id:again.id},data:{expiresAt:new Date(0)}});
  const parallel=await Promise.all([policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id),policies.prepare('SUBSCRIPTION',prefix,policy.id,actor.id)]);
  assert.equal(parallel[0].id,parallel[1].id);assert.notEqual(parallel[0].id,again.id);assert.equal(await db.eSignApproval.count({where:{resourceId:prefix}}),4);
});
test('expired in-flight approval is renewed by two people for the exact same PDF/task without renderer or provider recreation',async()=>{
  const old=await db.eSignApproval.findFirstOrThrow({where:{resourceId:prefix,status:'PENDING',expiresAt:{gt:new Date()}}});await policies.approve(old.id,reviewer.id,old.planHash);
  await db.eSignApproval.update({where:{id:old.id},data:{expiresAt:new Date(0)}});
  const task=await db.fadadaTask.create({data:{kind:'SUBSCRIPTION',resourceId:prefix,customerId:prefix,documentHash,sourcePdfHash,sourceFileId:old.sourceFileId,approvalId:old.id,providerEnvelopeId:prefix+'-envelope',customerProviderId:prefix+'-customer',platformProviderId:seal.providerCustomerId,customerTransactionId:prefix+'-customer-tx',platformTransactionId:prefix+'-platform-tx',status:'PENDING',uploadedAt:new Date()}});
  assert.equal((await policies.renewalEligibility(old.id)).eligible,true);
  const before=prepares;const renewal=await policies.renew(old.id,policy.id,actor.id);assert.equal(prepares,before);assert.notEqual(renewal.id,old.id);assert.equal(renewal.sourcePdfHash,old.sourcePdfHash);assert.equal(renewal.sourceFileId,old.sourceFileId);assert.deepEqual(renewal.slotCoordinates,old.slotCoordinates);
  assert.equal((await policies.renew(old.id,policy.id,actor.id)).id,renewal.id);
  await assert.rejects(policies.approve(renewal.id,actor.id,renewal.planHash),(e:any)=>e.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  await policies.approve(renewal.id,reviewer.id,renewal.planHash);
  const after=await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(after.approvalId,renewal.id);assert.equal(after.providerEnvelopeId,task.providerEnvelopeId);assert.equal(after.customerTransactionId,task.customerTransactionId);assert.equal(after.platformTransactionId,task.platformTransactionId);assert.equal(after.sourcePdfHash,task.sourcePdfHash);
  assert.equal((await policies.approved('SUBSCRIPTION',prefix,documentHash,after.approvalId)).approval.id,renewal.id);
  assert.equal(await db.fadadaTask.count({where:{resourceId:prefix}}),1);assert.equal((await db.eSignApproval.findUniqueOrThrow({where:{id:old.id}})).expiresAt.getTime(),0);
  await assert.rejects(policies.renew(old.id,policy.id,actor.id),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_STATE');
});
test('renewal cannot change frozen document or switch a task during a worker lease; failed approval does not alter either record',async()=>{
  const task=await db.fadadaTask.findFirstOrThrow({where:{resourceId:prefix}});await db.eSignApproval.update({where:{id:task.approvalId},data:{expiresAt:new Date(0)}});
  const draft=await policies.renew(task.approvalId,policy.id,actor.id);
  await db.eSignApproval.update({where:{id:draft.id},data:{sourcePdfHash:'c'.repeat(64)}});
  await assert.rejects(policies.approve(draft.id,reviewer.id,draft.planHash),(e:any)=>e.getResponse?.().error?.code==='APPROVAL_STATE');
  await db.eSignApproval.update({where:{id:draft.id},data:{sourcePdfHash}});
  await db.fadadaTask.update({where:{id:task.id},data:{processingUntil:new Date(Date.now()+60000)}});
  await assert.rejects(policies.approve(draft.id,reviewer.id,draft.planHash),(e:any)=>e.getResponse?.().error?.code==='RENEWAL_STATE');
  assert.equal((await db.eSignApproval.findUniqueOrThrow({where:{id:draft.id}})).status,'PENDING');assert.equal((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).approvalId,task.approvalId);
  await db.fadadaTask.update({where:{id:task.id},data:{processingUntil:null}});
  await policies.approve(draft.id,reviewer.id,draft.planHash);await db.fadadaTask.update({where:{id:task.id},data:{status:'SIGNED'}});
  await db.eSignApproval.update({where:{id:draft.id},data:{expiresAt:new Date(0)}});assert.equal((await policies.renewalEligibility(draft.id)).eligible,false);
});

// Actual synthetic renderHandover coordinates: integer-only fixtures miss the
// Prisma JSON persistence conversion that changes these IEEE-754 values.
const floatingSlots=[
 {slotId:'STAGE2_HANDOVER_CUSTOMER',pageNumber:2,x:228.46391614030375,y:195.7073726971457,width:241.90297003090984,height:107.47247265082137,pdfPageWidth:595.28,pdfPageHeight:841.89,coordinateSource:'PDFKIT_RENDERER',coordinateSystem:'FADADA_800_1131_TOP_LEFT'},
 {slotId:'STAGE2_HANDOVER_PLATFORM',pageNumber:2,x:228.46391614030375,y:417.27262231407906,width:241.90297003090984,height:201.51088622029005,pdfPageWidth:595.28,pdfPageHeight:841.89,coordinateSource:'PDFKIT_RENDERER',coordinateSystem:'FADADA_800_1131_TOP_LEFT'}
];
function persistedReviewHash(row:any){return hashSigningPlanPayload({compiledPlan:row.plan,documentHash:row.documentHash,sourcePdfHash:row.sourcePdfHash,slotCoordinates:row.slotCoordinates});}
async function withFloatingHandover(run:(fixture:any)=>Promise<void>){
 const resourceId=prefix+'-float-'+randomUUID();
 await persistLegacySigningResource(db,{id:resourceId,kind:'HANDOVER',documentHash});
 const floatingPolicy=await db.signaturePolicy.create({data:{policyCode:resourceId,policyName:'Synthetic floating handover',kind:'HANDOVER',sealId:seal.id,status:'ACTIVE'}});
 const writer:any={resource:async()=>({id:resourceId,customerId:resourceId,orderId:resourceId,status:'CUSTOMER_CONFIRMED',signatureStatus:'DRAFT',manifestHash:documentHash,order:{status:'AWAITING_HANDOVER'}}),prepare:async()=>({file:{id:'synthetic-floating-source',sha256:sourcePdfHash},slotCoordinates:structuredClone(floatingSlots)}),readVerified:async()=>Buffer.from('%PDF-synthetic-existing-artifact')};
 const accounts:any={readiness:async()=>({signingEligible:true,readyForSigning:true,realNameStatus:'VERIFIED',state:'SIGNING_ENABLED'})};
 const service=new SignaturePolicyService(db,writer,accounts,signingSettings);
 try{await run({resourceId,floatingPolicy,writer,accounts,service});}
 finally{const approvals=await db.eSignApproval.findMany({where:{resourceId},select:{id:true}});await db.fadadaTask.deleteMany({where:{resourceId}});await db.auditLog.deleteMany({where:{resourceId:{in:approvals.map(row=>row.id)}}});await db.eSignApproval.deleteMany({where:{resourceId}});await db.signaturePolicy.delete({where:{id:floatingPolicy.id}});}
}
test('real handover floating coordinates survive persistence with final review hash, idempotent prepare and independent approval',async()=>{
 await withFloatingHandover(async({resourceId,floatingPolicy,service})=>{
  const prepared=await service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id);
  const stored=await db.eSignApproval.findUniqueOrThrow({where:{id:prepared.id}});
  assert.equal(stored.planHash,persistedReviewHash(stored));
  assert.equal(prepared.planHash,stored.planHash);
  assert.deepEqual(prepared.slotCoordinates,stored.slotCoordinates);
  const event=await db.auditLog.findFirstOrThrow({where:{resourceId:stored.id,action:'SIGNATURE_REVIEW_REQUESTED'}});
  assert.equal((event.data as any).planHash,stored.planHash);
  assert.equal((await service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id)).id,stored.id);
  await assert.rejects(service.approve(stored.id,actor.id,stored.planHash),(error:any)=>error.getResponse?.().error?.code==='TWO_PERSON_REQUIRED');
  await service.approve(stored.id,reviewer.id,stored.planHash);
  assert.equal((await service.approved('HANDOVER',resourceId,documentHash,stored.id)).approval.status,'APPROVED');
 });
});
test('failure to finalize a new approval hash rolls back its new row and request audit',async()=>{
 await withFloatingHandover(async({resourceId,floatingPolicy,writer,accounts})=>{
  const failure=new Error('SYNTHETIC_FINAL_HASH_WRITE_FAILED');
  const failingDb=new Proxy(db,{get(target,key){if(key==='serial')return(operation:any)=>db.serial(tx=>operation(new Proxy(tx,{get(transaction,txKey){if(txKey==='eSignApproval')return new Proxy(transaction.eSignApproval,{get(delegate,method){return method==='update'?async()=>{throw failure;}:Reflect.get(delegate,method);}});return Reflect.get(transaction,txKey);}})));return Reflect.get(target,key);}});
  const service=new SignaturePolicyService(failingDb,writer,accounts,signingSettings);
  const auditCount=await db.auditLog.count({where:{actorId:actor.id,action:'SIGNATURE_REVIEW_REQUESTED'}});
  await assert.rejects(service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id),error=>error===failure);
  assert.equal(await db.eSignApproval.count({where:{resourceId}}),0);
  assert.equal(await db.auditLog.count({where:{actorId:actor.id,action:'SIGNATURE_REVIEW_REQUESTED'}}),auditCount);
 });
});
test('persisted handover binding mutations and a historical wrong hash remain rejected without silently repairing history',async()=>{
 await withFloatingHandover(async({resourceId,floatingPolicy,service})=>{
  const prepared=await service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id);
  const stored=await db.eSignApproval.findUniqueOrThrow({where:{id:prepared.id}});
  // First establish the normal baseline before testing each changed binding.
  assert.equal(stored.planHash,persistedReviewHash(stored));
  const rejects=(operation:Promise<unknown>,code='APPROVAL_STATE')=>assert.rejects(operation,(error:any)=>error.getResponse?.().error?.code===code);
  await rejects(service.approve(stored.id,reviewer.id,'sha256:'+'0'.repeat(64)));
  for(const data of [{sourcePdfHash:'c'.repeat(64)},{documentHash:'d'.repeat(64)},{slotCoordinates:[{...floatingSlots[0],x:999},floatingSlots[1]]}]){
   await db.eSignApproval.update({where:{id:stored.id},data});
   await rejects(service.approve(stored.id,reviewer.id,stored.planHash));
   await db.eSignApproval.update({where:{id:stored.id},data:{sourcePdfHash:stored.sourcePdfHash,documentHash:stored.documentHash,slotCoordinates:stored.slotCoordinates as any}});
  }
  await db.signaturePolicy.update({where:{id:floatingPolicy.id},data:{executionMode:floatingPolicy.executionMode==='SEQUENTIAL'?'PARALLEL':'SEQUENTIAL'}});
  await rejects(service.approve(stored.id,reviewer.id,stored.planHash));
  await db.signaturePolicy.update({where:{id:floatingPolicy.id},data:{executionMode:floatingPolicy.executionMode}});
  const oldWrongHash='sha256:'+'1'.repeat(64);
  await db.eSignApproval.update({where:{id:stored.id},data:{planHash:oldWrongHash}});
  await rejects(service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id),'PLAN_CHANGED');
  await rejects(service.approve(stored.id,reviewer.id,oldWrongHash));
  assert.equal((await db.eSignApproval.findUniqueOrThrow({where:{id:stored.id}})).planHash,oldWrongHash);
  assert.equal(await db.eSignApproval.count({where:{resourceId}}),1);
 });
});
test('renewal finalizes its new persisted hash while preserving old PDF, approval and task until independent approval',async()=>{
 await withFloatingHandover(async({resourceId,floatingPolicy,service})=>{
  const prepared=await service.prepare('HANDOVER',resourceId,floatingPolicy.id,actor.id);
  await service.approve(prepared.id,reviewer.id,prepared.planHash);
  const old=await db.eSignApproval.update({where:{id:prepared.id},data:{expiresAt:new Date(0)}});
  const task=await db.fadadaTask.create({data:{kind:'HANDOVER',resourceId,customerId:resourceId,documentHash,sourcePdfHash,sourceFileId:old.sourceFileId,approvalId:old.id,providerEnvelopeId:resourceId+'-envelope',customerProviderId:resourceId+'-customer',platformProviderId:seal.providerCustomerId,customerTransactionId:resourceId+'-customer-tx',platformTransactionId:resourceId+'-platform-tx',status:'PENDING'}});
  const next=await service.renew(old.id,floatingPolicy.id,actor.id);
  const stored=await db.eSignApproval.findUniqueOrThrow({where:{id:next.id}});
  assert.equal(stored.planHash,persistedReviewHash(stored));
  assert.equal(next.planHash,stored.planHash);
  assert.equal(stored.sourceFileId,old.sourceFileId);assert.equal(stored.sourcePdfHash,old.sourcePdfHash);assert.deepEqual(stored.slotCoordinates,old.slotCoordinates);
  assert.deepEqual(await db.eSignApproval.findUniqueOrThrow({where:{id:old.id}}),old);
  assert.deepEqual(await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}}),task);
  const event=await db.auditLog.findFirstOrThrow({where:{resourceId:stored.id,action:'SIGNATURE_REAUTHORIZATION_REQUESTED'}});
  assert.equal((event.data as any).planHash,stored.planHash);
  await service.approve(stored.id,reviewer.id,stored.planHash);
  assert.equal((await db.fadadaTask.findUniqueOrThrow({where:{id:task.id}})).approvalId,stored.id);
  assert.equal((await service.approved('HANDOVER',resourceId,documentHash,stored.id)).approval.id,stored.id);
 });
});
