import {persistLegacySigningResource} from './legacy-esign-mode';
import '../src/common/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {assertPlatformManualContinuation} from '../src/esign/platform-handover';
import {hashSigningPlanPayload} from '../src/esign/enterprise-seal/signing-plan-hash';
import {SignaturePolicyService} from '../src/esign/enterprise-seal/signature-policy.service';
const error=(code:string)=>(e:any)=>e.getResponse?.()?.error?.code===code;
const digest=(a:any)=>hashSigningPlanPayload({compiledPlan:a.plan,documentHash:a.documentHash,sourcePdfHash:a.sourcePdfHash,slotCoordinates:a.slotCoordinates});
function evidence(t:any,a:any){return{accepted:true,role:'PLATFORM',ownerRevision:1,ownerId:'owner',signerId:'legal',legalRevision:1,documentHash:t.documentHash,sourceFileId:t.sourceFileId,sourcePdfHash:t.sourcePdfHash,providerCustomerId:t.platformProviderId,providerEnvelopeId:t.providerEnvelopeId,platformTransactionId:t.platformTransactionId,providerSignatureId:'seal',certificateSerialNo:'cert',approvalId:a.id,planHash:a.planHash};}
test('continuation rejects changed file, seal, corrupt plan, wrong task and cyclic approval chains',async()=>{
 const t:any={id:'task',kind:'HANDOVER',platformSigningMode:'MANUAL',resourceId:'resource',customerId:'tenant',documentHash:'a',sourceFileId:'file',sourcePdfHash:'b',platformProviderId:'platform',providerEnvelopeId:'envelope',platformTransactionId:'transaction',platformManualRequestedAt:new Date(),platformManualSignerId:'legal',platformManualOwnerId:'owner'};
 const old:any={...t,id:'old',sealId:'seal-record',status:'APPROVED',approvedAt:new Date(),requesterId:'a',approverId:'b',plan:{},slotCoordinates:[]};old.planHash=digest(old);t.platformManualEvidence=evidence(t,old);
 const current:any={...old,id:'new',plan:{renewal:{taskId:t.id,priorApprovalId:old.id}}};current.planHash=digest(current);
 const rows=new Map([['old',old]]),db:any={eSignApproval:{findUnique:async({where}:any)=>rows.get(where.id)}};
 await assertPlatformManualContinuation(db,t,{...evidence(t,current),ownerRevision:2},current);
 for(const edit of [{sourcePdfHash:'different'},{sealId:'different'},{planHash:'corrupt'},{plan:{renewal:{taskId:'other',priorApprovalId:old.id}}},{requesterId:'b'}]){
  const changed={...current,...edit};if(!('planHash'in edit))changed.planHash=digest(changed);await assert.rejects(assertPlatformManualContinuation(db,t,evidence(t,changed),changed),error('PLATFORM_MANUAL_RENEWAL'));
 }
 const middle:any={...old,id:'middle',plan:{renewal:{taskId:t.id,priorApprovalId:current.id}}};middle.planHash=digest(middle);
 current.plan={renewal:{taskId:t.id,priorApprovalId:middle.id}};current.planHash=digest(current);rows.set(current.id,current);rows.set(middle.id,middle);
 await assert.rejects(assertPlatformManualContinuation(db,t,evidence(t,current),current),error('PLATFORM_MANUAL_RENEWAL'));
});
test('real two-person policy renewal preserves a manual handover transaction and validates its continuation chain',async()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432');assert.equal(url.pathname,'/chundian_test');process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 const db=new Db(),prefix='manual-renew-'+randomUUID();let policy:any,seal:any,actor:any,reviewer:any;
 try{
  actor=await db.adminUser.create({data:{username:prefix+'a',name:'A',role:'OPERATIONS',passwordHash:'fixture'}});reviewer=await db.adminUser.create({data:{username:prefix+'b',name:'B',role:'ADMIN',passwordHash:'fixture'}});
  seal=await db.enterpriseSeal.create({data:{sealName:'fixture',organizationName:'上海宁达信息科技有限公司',providerCustomerId:'Platform',providerSignatureId:'Seal',status:'ACTIVE',evidenceFileId:'fixture',confirmedBy:reviewer.id,confirmedAt:new Date()}});
  policy=await db.signaturePolicy.create({data:{policyCode:prefix,policyName:'fixture',kind:'HANDOVER',sealId:seal.id,status:'ACTIVE'}});
  for(const [subjectId,authorityType]of[[actor.id,'REQUEST_USE'],[reviewer.id,'APPROVE_USE']])await db.sealAuthority.create({data:{sealId:seal.id,subjectType:'USER',subjectId,authorityType}});
  const sourcePdfHash='b'.repeat(64),documentHash='a'.repeat(64),resource={id:prefix,customerId:prefix,orderId:prefix,status:'CUSTOMER_CONFIRMED',manifestHash:documentHash};
  await persistLegacySigningResource(db,{id:prefix,kind:'HANDOVER',documentHash});
  const writer:any={resource:async()=>resource,prepare:async()=>({resource,file:{id:'source',sha256:sourcePdfHash},slotCoordinates:[{slotId:'STAGE2_HANDOVER_PLATFORM',pageNumber:0,x:100,y:200}]}),readVerified:async()=>Buffer.from('%PDF-fixture')};
  const policies=new SignaturePolicyService(db,writer,{readiness:async()=>({readyForSigning:true,signingEligible:true,realNameStatus:'VERIFIED',state:'SIGNING_ENABLED'})} as any,{} as any);
  const draft=await policies.prepare('HANDOVER',prefix,policy.id,actor.id);await policies.approve(draft.id,reviewer.id,draft.planHash);
  const t=await db.fadadaTask.create({data:{kind:'HANDOVER',resourceId:prefix,customerId:prefix,documentHash,sourceFileId:'source',sourcePdfHash,approvalId:draft.id,providerEnvelopeId:prefix,platformProviderId:seal.providerCustomerId,customerProviderId:'Tenant',customerTransactionId:prefix+'c',platformTransactionId:prefix+'p',platformSigningMode:'MANUAL',status:'PENDING',uploadedAt:new Date(),platformManualRequestedAt:new Date(),platformManualSignerId:'legal',platformManualOwnerId:'owner'}});
  const oldEvidence=evidence(t,draft);await db.fadadaTask.update({where:{id:t.id},data:{platformManualEvidence:oldEvidence}});await db.eSignApproval.update({where:{id:draft.id},data:{expiresAt:new Date(0)}});
  const renewal=await policies.renew(draft.id,policy.id,actor.id);await assert.rejects(policies.approve(renewal.id,actor.id,renewal.planHash),error('TWO_PERSON_REQUIRED'));await policies.approve(renewal.id,reviewer.id,renewal.planHash);
  const current=await db.fadadaTask.findUniqueOrThrow({where:{id:t.id}}),approved=(await policies.approved('HANDOVER',prefix,documentHash,current.approvalId)).approval;
  await assertPlatformManualContinuation(db,current,evidence(current,approved),approved);assert.equal(current.platformSigningMode,'MANUAL');assert.equal(current.providerEnvelopeId,t.providerEnvelopeId);assert.equal(current.platformTransactionId,t.platformTransactionId);
  await db.sealAuthority.updateMany({where:{sealId:seal.id,authorityType:'APPROVE_USE'},data:{status:'DISABLED'}});await assert.rejects(policies.approved('HANDOVER',prefix,documentHash,current.approvalId),error('SEAL_APPROVER_AUTHORITY'));
 }finally{
  await db.fadadaTask.deleteMany({where:{resourceId:prefix}});await db.eSignApproval.deleteMany({where:{resourceId:prefix}});if(policy)await db.signaturePolicy.delete({where:{id:policy.id}});if(seal){await db.sealAuthority.deleteMany({where:{sealId:seal.id}});await db.enterpriseSeal.delete({where:{id:seal.id}});}await db.adminUser.deleteMany({where:{id:{in:[actor?.id,reviewer?.id].filter(Boolean)}}});await db.$disconnect();
 }
});
