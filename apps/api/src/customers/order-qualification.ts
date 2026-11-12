import {z} from 'zod';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {assertOrdinaryReview} from '../auth/ordinary-review';
import {archiveCommand} from '../offline-documents/command';
import {canonicalHash,requireRiskOperator,type ReviewActor} from './types';
import {requireCurrentQualification,qualificationEvidence,customerProfileHash} from './qualifications';
import {captureQualificationProfile,legacyQualificationProfile,profileContentHash,qualificationProfileReasons,parseQualificationProfile} from './qualification-profile';

const inputSchema=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key,qualificationId:z.string().min(1),qualificationRevision:z.number().int().positive(),profileHash:z.string().regex(/^[a-f0-9]{64}$/),originalScopeHash:z.string().regex(/^[a-f0-9]{64}$/),sameCustomerConfirmed:z.literal(true),reason:z.string().trim().min(2).max(500)}).strict();
const message=(e:any)=>e.getResponse?.()?.error?.message||'资格资料暂不可核对，请刷新后重试';
const editable=(o:any)=>o.contractMode==='OFFLINE'&&['AWAITING_CONTRACT_REVIEW','AWAITING_PAYMENT','AWAITING_HANDOVER','ACTIVE'].includes(o.status);
async function source(tx:any,o:any){
 let terms=o.finalPlanSnapshot;
 if(o.effectiveTermsVersionId){const current=await tx.orderTermsVersion.findUnique({where:{id:o.effectiveTermsVersionId}});ensure(current?.orderId===o.id,409,'TERMS_MISSING','当前有效条款缺失或不属于本单');terms=current.snapshot;}
 const risk=terms?.riskSnapshot,review=risk?.reviewId?await tx.applicationRiskReview.findUnique({where:{id:risk.reviewId}}):null;
 ensure(review&&review.customerId===o.customerId&&review.applicationId===o.applicationId&&risk.customerId===o.customerId&&risk.applicationId===o.applicationId&&review.decision==='APPROVED'&&review.finalPlanId===risk.planId&&review.planRevision===risk.planRevision&&review.commercialHash===risk.commercialHash&&review.qualificationId===risk.qualificationId&&review.qualificationRevision===risk.qualificationRevision,409,'ORDER_RISK_SNAPSHOT_MISMATCH','本单原风险审核凭据不完整或不匹配');
 const original=await tx.customerQualificationVersion.findUnique({where:{id:review.qualificationId}});
 ensure(original?.customerId===o.customerId&&original.revision===risk.qualificationRevision&&original.status==='APPROVED',409,'ORDER_RISK_SNAPSHOT_MISMATCH','本单原资格审核凭据不匹配');
 if(original.profileHash!==review.profileHash){
  const c=await tx.customer.findUnique({where:{id:o.customerId}});ensure(c,404,'NOT_FOUND','客户不存在');
  const qualified=original.profileSnapshot?parseQualificationProfile(original.profileSnapshot):await legacyQualificationProfile(tx,c,original),riskProfile=await legacyQualificationProfile(tx,c,{profileHash:review.profileHash});
  ensure(qualified&&qualified.profileHash===original.profileHash&&riskProfile&&profileContentHash(qualified)===profileContentHash(riskProfile),409,'ORDER_RISK_SNAPSHOT_MISMATCH','本单原资格与风险审核资料缺少一致性依据');
 }
 const originalScopeHash=canonicalHash({orderId:o.id,customerId:o.customerId,applicationId:o.applicationId,contractMode:o.contractMode,effectiveTermsVersionId:o.effectiveTermsVersionId||null,risk,originalProfile:o.finalPlanSnapshot?.customerProfileSnapshot||null});
 return{risk,review,original,originalScopeHash};
}
async function linkReviewerValid(tx:any,link:any,q:any){
 const reviewer=await tx.adminUser.findUnique({where:{id:link.reviewedBy}}),evidence=await qualificationEvidence(tx,q.customerId,q);
 if(!reviewer?.active||!['ADMIN','OPERATIONS'].includes(reviewer.role))return false;
 try{assertOrdinaryReview({id:link.reviewedBy,role:reviewer.role},[q.submittedBy,...evidence.files.map((f:any)=>f.adminId)]);return true;}catch{return false;}
}
export async function orderQualificationFacts(tx:any,o:any,at=new Date()){
 const anchor=await source(tx,o),c=await tx.customer.findUnique({where:{id:o.customerId}});
 ensure(c,404,'NOT_FOUND','客户不存在');
 const q=await requireCurrentQualification(tx,o.customerId,undefined,at);
 ensure(q.revision>=anchor.risk.qualificationRevision,409,'CUSTOMER_QUALIFICATION_REQUIRED','当前资格版本早于本单审核依据');
 const current=await captureQualificationProfile(tx,c),contentHash=profileContentHash(current);
 if(q.profileHash===anchor.review.profileHash)return{...anchor,q,c,current,contentHash,ready:true,canConfirm:false,confirmation:undefined};
 if(!(await qualificationProfileReasons(tx,c,anchor.original)).length)return{...anchor,q,c,current,contentHash,ready:true,canConfirm:false,confirmation:undefined};
 const baseline=anchor.original.profileSnapshot?parseQualificationProfile(anchor.original.profileSnapshot):await legacyQualificationProfile(tx,c,anchor.original);
 const sameSubject=baseline?.version===1&&baseline.profileHash===anchor.original.profileHash&&baseline.scalarHash===current.scalarHash;
 const link=await tx.orderQualificationConfirmation.findFirst({where:{orderId:o.id,customerId:o.customerId,qualificationId:q.id,qualificationRevision:q.revision,profileContentHash:contentHash,originalScopeHash:anchor.originalScopeHash,sameCustomerConfirmed:true},orderBy:{createdAt:'desc'}});
 const ready=!!(sameSubject&&link&&await linkReviewerValid(tx,link,q));
 return{...anchor,q,c,current,contentHash,ready,canConfirm:!!sameSubject&&!ready,confirmation:ready?link:undefined};
}
export async function requireOrderQualification(tx:any,o:any,at=new Date()){
 const f=await orderQualificationFacts(tx,o,at);
 ensure(f.ready,409,'CUSTOMER_QUALIFICATION_REQUIRED',f.canConfirm?'更新后的资格已通过，请在本单客户资料中完成证件更新核对':'当前身份资料与原签约主体不一致，须核对本单承租人，不能通过更换证件图片替换签约主体');
 return f.q;
}
export class OrderQualificationService {
 async context(tx:any,actor:ReviewActor,orderId:string){
  await requireRiskOperator(tx,actor);await requireCurrentStaff(tx,actor,'orders',false);
  const o=await tx.order.findUnique({where:{id:orderId}});ensure(o,404,'NOT_FOUND','订单不存在');
  const basic={orderId:o.id,customerId:o.customerId,revision:o.revision};
  try{const f=await orderQualificationFacts(tx,o),evidence=await qualificationEvidence(tx,o.customerId,f.q);let permitted=true;try{assertOrdinaryReview(actor,[f.q.submittedBy,...evidence.files.map((x:any)=>x.adminId)]);}catch{permitted=false;}
   return{...basic,ready:f.ready,canConfirm:editable(o)&&f.canConfirm&&permitted,qualificationId:f.q.id,qualificationRevision:f.q.revision,profileHash:customerProfileHash(f.c),originalScopeHash:f.originalScopeHash,confirmation:f.confirmation?{reviewedAt:f.confirmation.createdAt,reason:f.confirmation.reason}:null,messages:f.ready?[]:!f.canConfirm?['当前身份资料与原签约主体不一致，请核对本单承租人。']:!permitted?['需由未参与提交、上传的人员核对；管理员可按普通资料规则核对留痕。']:['更新后的资格已通过，请对照原签约资料确认仍为同一承租人。']};
  }catch(e:any){if(![403,409].includes(e.getStatus?.()))throw e;return{...basic,ready:false,canConfirm:false,messages:[message(e)]};}
 }
 async confirm(tx:any,actor:ReviewActor,orderId:string,body:unknown){
  const input=inputSchema.parse(body);await requireRiskOperator(tx,actor);await requireCurrentStaff(tx,actor,'orders');
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const o=await tx.order.findUnique({where:{id:orderId}});ensure(o,404,'NOT_FOUND','订单不存在');
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${o.customerId} FOR UPDATE`;
  return archiveCommand(tx,actor,`order-qualification:${orderId}`,'CONFIRM',input,async()=>{
   ensure(editable(o),409,'STATE_CONFLICT','当前订单不允许办理证件更新核对');
   ensure(o.revision===input.revision,409,'REVISION_CONFLICT','订单已变化，请刷新后核对');
   const f=await orderQualificationFacts(tx,o);
   ensure(f.q.id===input.qualificationId&&f.q.revision===input.qualificationRevision&&customerProfileHash(f.c)===input.profileHash&&f.originalScopeHash===input.originalScopeHash,409,'REVISION_CONFLICT','资格、客户资料或本单审核依据已变化，请重新核对');
   ensure(f.canConfirm,409,'QUALIFICATION_CONTINUITY_NOT_REQUIRED',f.ready?'本单当前资格已经有效，无需重复核对':'签约主体资料变化，不能通过证件更新核对放行');
   const evidence=await qualificationEvidence(tx,o.customerId,f.q);assertOrdinaryReview(actor,[f.q.submittedBy,...evidence.files.map((x:any)=>x.adminId)],'QUALIFICATION_SELF_REVIEW');
   const result=await tx.orderQualificationConfirmation.create({data:{orderId,customerId:o.customerId,qualificationId:f.q.id,qualificationRevision:f.q.revision,profileContentHash:f.contentHash,originalScopeHash:f.originalScopeHash,orderRevision:o.revision,reviewedBy:actor.id,reason:input.reason,sameCustomerConfirmed:true}});
   await audit(tx,actor.id,'ORDER_QUALIFICATION_CONFIRMED','orders',orderId,{confirmationId:result.id,qualificationId:f.q.id,qualificationRevision:f.q.revision,originalQualificationId:f.original.id,originalScopeHash:f.originalScopeHash,profileContentHash:f.contentHash,reason:input.reason});
   return{id:result.id,orderId,qualificationId:f.q.id,qualificationRevision:f.q.revision,reviewedAt:result.createdAt,reason:input.reason};
  });
 }
}
