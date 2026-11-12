import {audit,notify} from '../common/data';
import {ensure} from '../common/errors';
import {archiveCommand} from '../offline-documents/command';
import {requireCurrentStaff} from '../auth/staff-session';
import {requireCurrentConsents} from '../auth/consents';
import {customerProfileHash,requireCurrentQualification} from '../customers/qualifications';
import {canonicalHash,requireRiskOperator,ReviewActor,RiskReviewView,riskReviewInput,RiskSnapshot,safeReviewProjection} from '../customers/types';
import {CREDIT_RULE,requireCredit} from './credit-review';
import {assertFinalPricing} from './acceptance-pricing';

export function riskPlanInputHash(plan:any){const{reviewStatus,createdAt,...input}=plan;return canonicalHash(input);}
export function riskVehicleInputHash(vehicle:any){return canonicalHash({id:vehicle.id,vin:vehicle.vin,plateNumber:vehicle.plateNumber,brand:vehicle.brand,model:vehicle.model,modelDefinitionId:vehicle.modelDefinitionId,year:vehicle.year,mileageKm:vehicle.mileageKm,batteryHealthPercent:vehicle.batteryHealthPercent,conditionDisclosure:vehicle.conditionDisclosure});}
function riskView(r:any):RiskReviewView{return{id:r.id,applicationId:r.applicationId,revision:r.revision,decision:r.decision,planRevision:r.planRevision,commercialHash:r.commercialHash,qualificationId:r.qualificationId,reasonCodes:r.reasonCodes,supplementaryInstructions:r.supplementaryInstructions,reviewedBy:r.reviewedBy,reviewedAt:r.reviewedAt};}
async function currentInputs(tx:any,applicationId:string){
 const app=await tx.application.findUnique({where:{id:applicationId}});ensure(app,404,'NOT_FOUND','申请不存在');
 const [plan,customer,vehicle]=await Promise.all([tx.finalPlan.findFirst({where:{applicationId},orderBy:{revision:'desc'}}),tx.customer.findUnique({where:{id:app.customerId}}),tx.vehicle.findUnique({where:{id:app.vehicleId}})]);
 ensure(plan&&customer&&vehicle&&plan.applicationId===app.id,409,'RISK_REVIEW_REQUIRED','请先生成本申请当前候选方案');return{app,plan,customer,vehicle};
}
async function creditInputs(tx:any,app:any,plan:any,verificationId:string){
 const credit=await requireCredit(tx,app,verificationId),verification=credit.verification;
 const consent=await tx.creditConsent.findUnique({where:{id:verification.consentId}});
 ensure(consent?.applicationId===app.id&&consent.customerId===app.customerId&&consent.status==='ACCEPTED'&&verification.applicationId===app.id&&plan.creditVerificationId===verification.id&&plan.creditRevision===app.creditRevision&&plan.creditBand===verification.band&&plan.creditRuleVersion===CREDIT_RULE,409,'CREDIT_REVIEW_REQUIRED','本申请信用授权、核验或候选方案已变化');
 assertFinalPricing(app,plan,plan.monthlyFeeAmount*credit.multiplier);return{verification,consent};
}
async function incompleteCreditSnapshot(tx:any,app:any,plan:any,verificationId:string){
 const verification=await tx.creditVerification.findFirst({where:{applicationId:app.id},orderBy:{revision:'desc'}}),consent=await tx.creditConsent.findFirst({where:{applicationId:app.id},orderBy:{revision:'desc'}});
 ensure(verification&&consent&&verification.id===verificationId&&verification.applicationId===app.id&&plan.creditVerificationId===verification.id&&consent.applicationId===app.id&&consent.customerId===app.customerId,409,'CREDIT_REVIEW_REQUIRED','请使用本申请最近的授权和核验记录');
 return{verification,consent};
}
export async function requireCurrentRisk(tx:any,applicationId:string,planRevision:number):Promise<RiskSnapshot>{
 const {app,plan,customer,vehicle}=await currentInputs(tx,applicationId),r=await tx.applicationRiskReview.findFirst({where:{applicationId},orderBy:{revision:'desc'}});
 ensure(r&&r.applicationId===app.id&&r.customerId===app.customerId&&r.decision==='APPROVED'&&r.identityChecked&&r.drivingQualificationChecked&&plan.reviewStatus==='APPROVED'&&r.finalPlanId===plan.id&&r.planRevision===planRevision&&plan.revision===planRevision&&r.applicationRevision===app.revision&&r.commercialHash===plan.commercialHash&&r.planInputHash===riskPlanInputHash(plan)&&r.profileHash===customerProfileHash(customer)&&r.applicationProfileHash===canonicalHash(app.profile)&&r.vehicleId===app.vehicleId&&r.vehicleInputHash===riskVehicleInputHash(vehicle),409,'RISK_REVIEW_REQUIRED','本申请当前资料、车辆或方案须重新风险审核');
 const q=await requireCurrentQualification(tx,app.customerId,r.qualificationId),{verification,consent}=await creditInputs(tx,app,plan,r.creditVerificationId);
 ensure(q.revision===r.qualificationRevision&&verification.revision===r.creditVerificationRevision&&consent.id===r.creditConsentId&&consent.revision===r.creditConsentRevision&&consent.version===r.creditConsentVersion&&app.creditRevision===r.creditRevision,409,'RISK_REVIEW_REQUIRED','资格、授权或核验版本已改变，请重新风险审核');
 return{reviewId:r.id,applicationId,customerId:app.customerId,qualificationId:q.id,qualificationRevision:q.revision,planId:plan.id,planRevision,commercialHash:plan.commercialHash,creditConsentId:consent.id,creditVerificationId:verification.id,reviewedAt:r.reviewedAt};
}
export class RiskReviewService {
 async assess(tx:any,ctx:ReviewActor,applicationId:string,body:unknown):Promise<RiskReviewView>{
  const input=riskReviewInput.parse(body);await requireRiskOperator(tx,ctx,'applications');
  await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
  return archiveCommand(tx,ctx,`application-risk:${applicationId}`,'ASSESS',input,async()=>{
   const {app,plan,customer,vehicle}=await currentInputs(tx,applicationId);
   ensure(['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'].includes(app.status),409,'STATE_CONFLICT','当前申请不可风险审核');
   ensure(input.revision===app.revision&&input.planRevision===plan.revision&&input.commercialHash===plan.commercialHash,409,'REVISION_CONFLICT','本次申请或候选方案已更新');
   ensure(['DRAFT','APPROVED','NEEDS_INFO','REJECTED'].includes(plan.reviewStatus),409,'RISK_CANDIDATE_REQUIRED','请生成本申请新的候选方案');
   const q=await tx.customerQualificationVersion.findFirst({where:{customerId:app.customerId},orderBy:{revision:'desc'}});
   ensure(q&&q.customerId===app.customerId&&q.id===input.qualificationId,409,'CUSTOMER_QUALIFICATION_REQUIRED','请选择本客户当前资格版本');
   const {verification,consent}=input.decision==='APPROVED'?await creditInputs(tx,app,plan,input.creditVerificationId):await incompleteCreditSnapshot(tx,app,plan,input.creditVerificationId);
   if(input.decision==='APPROVED'){
    ensure(input.identityChecked&&input.drivingQualificationChecked,409,'CUSTOMER_QUALIFICATION_REQUIRED','请确认本次身份与驾驶资格检查');
    await requireCurrentQualification(tx,app.customerId,input.qualificationId);
    await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
   }
   const latest=await tx.applicationRiskReview.findFirst({where:{applicationId},orderBy:{revision:'desc'}});
   const record=await tx.applicationRiskReview.create({data:{applicationId,customerId:app.customerId,revision:(latest?.revision||0)+1,applicationRevision:app.revision,profileHash:customerProfileHash(customer),applicationProfileHash:canonicalHash(app.profile),qualificationId:q.id,qualificationRevision:q.revision,finalPlanId:plan.id,planRevision:plan.revision,commercialHash:plan.commercialHash,planInputHash:riskPlanInputHash(plan),vehicleId:app.vehicleId,vehicleInputHash:riskVehicleInputHash(vehicle),creditConsentId:consent.id,creditConsentRevision:consent.revision,creditConsentVersion:consent.version,creditVerificationId:verification.id,creditVerificationRevision:verification.revision,creditRevision:app.creditRevision,decision:input.decision,reasonCodes:input.reasonCodes,supplementaryInstructions:input.supplementaryInstructions,identityChecked:input.identityChecked,drivingQualificationChecked:input.drivingQualificationChecked,reviewedBy:ctx.id,idempotencyKey:input.idempotencyKey,requestHash:canonicalHash(input)}});
   await tx.finalPlan.update({where:{id:plan.id},data:{reviewStatus:input.decision}});
   await tx.application.update({where:{id:applicationId},data:{status:input.decision==='APPROVED'?'AWAITING_CONFIRMATION':input.decision,note:input.decision==='NEEDS_INFO'?input.supplementaryInstructions:input.decision==='REJECTED'?'本次申请未通过审核，请联系运营了解处理结果。':''}});
   if(plan.contractMode==='ELECTRONIC'&&input.decision==='APPROVED')await notify(tx,app.customerId,'最终方案待确认','请核对已批准的车辆、价费组成、期限和计划交付事实。','applications',applicationId);
   await audit(tx,ctx.id,'APPLICATION_RISK_REVIEWED','applications',applicationId,{reviewId:record.id,revision:record.revision,planRevision:plan.revision,decision:input.decision,reasonCodes:input.reasonCodes});return riskView(record);
  });
 }
 async status(tx:any,applicationId:string,customerId?:string){
  const app=await tx.application.findUnique({where:{id:applicationId}});ensure(app&&(!customerId||app.customerId===customerId),404,'NOT_FOUND','申请不存在');
  const review=await tx.applicationRiskReview.findFirst({where:{applicationId},orderBy:{revision:'desc'}});
  if(review?.decision==='APPROVED'){try{await requireCurrentRisk(tx,applicationId,review.planRevision);}catch(error:any){if(error?.getStatus?.()!==409)throw error;return{status:'RECHECK_REQUIRED',supplementaryInstructions:''};}}
  return safeReviewProjection(review);
 }
 async detail(tx:any,ctx:ReviewActor,applicationId:string){
  await requireCurrentStaff(tx,ctx,'customers',false);if(ctx.role==='SUPPORT')return{applicationId,...await this.status(tx,applicationId)};
  await requireRiskOperator(tx,ctx,'applications');await currentInputs(tx,applicationId);const r=await tx.applicationRiskReview.findFirst({where:{applicationId},orderBy:{revision:'desc'}});
  return{applicationId,current:await this.status(tx,applicationId),review:r?riskView(r):null};
 }
}
