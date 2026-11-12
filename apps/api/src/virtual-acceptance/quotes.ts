import {z} from 'zod';
import {ensure} from '../common/errors';
import {audit,hash,key} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {requireCurrentConsents} from '../auth/consents';
import {archiveCommand} from '../offline-documents/command';
import {requireCurrentVirtualScope,VIRTUAL_NOTICE} from './scope';
import {confirmVirtualProfile} from './profile';
import {snapshotProduct} from '../products/snapshot';
import {buildElectronicLessorSnapshot,assertAgreedFeeComponents} from '../electronic-documents/initial-terms';
import {leaseRange} from '../orders/business-gates';
import {shanghaiDay} from '../usage/rules';
import {dateOnly} from '../billing/rules';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {assertIndependentStaffReview} from '../partners/capabilities';
const command={revision:z.number().int().nonnegative(),idempotencyKey:key};
export function virtualRevenue(scope:any){return{schema:'VIRTUAL_NO_PAYOUT_V1',disposition:'NOT_APPLICABLE_NO_PAYOUT',scopeId:scope.id,configurationHash:scope.configurationHash,ownerId:scope.ownerId,vehicleId:scope.vehicleId};}
export function assertVirtualPrice(plan:any){ensure(plan.monthlyFeeAmount===100&&plan.depositAmount===100&&plan.months===12&&!plan.acceptancePricing&&!plan.creditVerificationId,409,'VIRTUAL_PRICE_CHANGED','虚拟测试固定12期每期100分、固定押金100分，不适用信用定价');}
export async function createVirtualQuote(tx:any,actor:any,applicationId:string,raw:unknown){
 const input=z.object({...command,referenceDate:z.iso.date().optional(),customerAddress:z.string().trim().min(1).max(1000)}).strict().parse(raw);await requireCurrentStaff(tx,actor,'applications');
 await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
 return archiveCommand(tx,actor,applicationId,'VIRTUAL_QUOTE',input,async()=>{
  const app=await tx.application.findUniqueOrThrow({where:{id:applicationId}}),scope=await requireCurrentVirtualScope(tx,{vehicleId:app.vehicleId,customerId:app.customerId,applicationId,action:'QUOTE'});ensure(scope,409,'VIRTUAL_SCOPE_REQUIRED','普通车辆须使用普通报价流程');ensure(app.revision===input.revision&&['IN_REVIEW','AWAITING_CONFIRMATION'].includes(app.status),409,'REVISION_CONFLICT','申请或方案版本已变化');
  await requireCurrentConsents(tx,app.customerId,['terms','privacy']);await confirmVirtualProfile(tx,app.customerId,app.vehicleId,(app.profile as any)?.customerProfileSnapshot);
  const productSnapshot=await snapshotProduct(tx,app.subscriptionPlanId),day=input.referenceDate??shanghaiDay(new Date()),startDate=dateOnly(day),lessorSnapshot=await buildElectronicLessorSnapshot(tx,app.vehicleId,leaseRange(startDate,12));
  const agreedFeeComponents=assertAgreedFeeComponents(productSnapshot,{monthlyFeeAmount:100});
  const fixed={contractMode:'ELECTRONIC',monthlyFeeAmount:100,depositAmount:100,months:12,mileagePerMonthKm:productSnapshot.mileagePerMonthKm,excessMileagePriceAmount:productSnapshot.excessMileagePriceAmount,energyDescription:productSnapshot.energyDescription,benefits:productSnapshot.benefits.map(b=>b.name),conditions:productSnapshot.conditions,productSnapshot,lessorSnapshot,revenueRuleSnapshot:virtualRevenue(scope),agreedFeeComponents,commercialTerms:{vehicleIdentification:'唯一虚拟流程验收车辆；VIN、登记权属和真实车况不适用',customerAddress:input.customerAddress,handoverArrangement:'无实际交付；报价日期仅为测试参考日'},usagePolicyVersion:'VIRTUAL_NO_DRIVING_V1',usagePolicy:{schema:'VIRTUAL_NO_DRIVING_V1',scopeId:scope.id,configurationHash:scope.configurationHash,notice:VIRTUAL_NOTICE},startDate,firstDueDate:startDate};
  const revision=app.revision+1,commercialHash=hash({...fixed,vehicleId:app.vehicleId,revision}),plan=await tx.finalPlan.create({data:{...fixed,applicationId,revision,commercialHash,reviewStatus:'DRAFT'}});
  await tx.application.update({where:{id:applicationId},data:{revision,status:'IN_REVIEW'}});await audit(tx,actor.id,'VIRTUAL_QUOTE','applications',applicationId,{planId:plan.id,revision,commercialHash,configurationHash:scope.configurationHash});return plan;
 });
}
export async function virtualQuoteFacts(tx:any,applicationId:string){
 const app=await tx.application.findUniqueOrThrow({where:{id:applicationId}}),plan=await tx.finalPlan.findFirst({where:{applicationId},orderBy:{revision:'desc'}});ensure(plan&&plan.contractMode==='ELECTRONIC',409,'VIRTUAL_QUOTE_REQUIRED','请先生成指定测试方案');
 const scope=await requireCurrentVirtualScope(tx,{vehicleId:app.vehicleId,customerId:app.customerId,applicationId,action:'QUOTE_REVIEW'});ensure(scope,409,'VIRTUAL_SCOPE_REQUIRED');assertVirtualPrice(plan);
 const profile=await confirmVirtualProfile(tx,app.customerId,app.vehicleId,(app.profile as any)?.customerProfileSnapshot),identity=await requireElectronicCustomerIdentity(tx,app.customerId);
 const {reviewStatus,createdAt,...input}=plan;
 return{app,plan,scope,facts:{schema:'VIRTUAL_QUOTE_REVIEW_V1',scopeId:scope.id,configurationHash:scope.configurationHash,applicationId,applicationRevision:app.revision,customerId:app.customerId,profileHash:profile.profileHash,applicationProfileHash:canonicalHash(app.profile),planId:plan.id,planRevision:plan.revision,commercialHash:plan.commercialHash,planInputHash:canonicalHash(input),identity:identity.snapshot,drivingQualification:'NOT_APPLICABLE',creditVerification:'NOT_APPLICABLE'}};
}
export async function reviewVirtualQuote(tx:any,actor:any,applicationId:string,raw:unknown){
 const input=z.object({...command,commercialHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);await requireCurrentStaff(tx,actor,'applications');await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
 return archiveCommand(tx,actor,applicationId,'VIRTUAL_QUOTE_REVIEW',input,async()=>{const {app,plan,facts}=await virtualQuoteFacts(tx,applicationId);ensure(['IN_REVIEW','AWAITING_CONFIRMATION'].includes(app.status)&&app.revision===input.revision&&plan.revision===input.revision&&plan.commercialHash===input.commercialHash,409,'REVISION_CONFLICT');
  await requireCurrentConsents(tx,app.customerId,['terms','privacy']);const creation=await tx.auditLog.findFirst({where:{action:'VIRTUAL_QUOTE',resourceType:'applications',resourceId:applicationId,data:{path:['planId'],equals:plan.id}},orderBy:{createdAt:'desc'}});ensure(creation,409,'VIRTUAL_QUOTE_REQUIRED');if(actor.role!=='ADMIN')await assertIndependentStaffReview(tx,actor.id,[creation.actorId],'VIRTUAL_SELF_REVIEW');
  const reviewedAt=new Date().toISOString(),record=await audit(tx,actor.id,'VIRTUAL_QUOTE_REVIEW','applications',applicationId,{facts,factsHash:canonicalHash(facts),reviewedBy:actor.id,reviewedAt,policy:actor.role==='ADMIN'?'ADMIN_EXCEPTION':'INDEPENDENT_PERSON'});
  await tx.finalPlan.update({where:{id:plan.id},data:{reviewStatus:'APPROVED'}});await tx.application.update({where:{id:applicationId},data:{status:'AWAITING_CONFIRMATION'}});
  return{kind:'VIRTUAL_QUOTE_REVIEW',id:record.id,status:'APPROVED',revision:plan.revision,label:'测试资料确认（驾驶资格、信用核验不适用）',reviewedAt};
 });
}
export async function requireVirtualQuoteReview(tx:any,applicationId:string,planRevision:number){
 const {app,plan,scope,facts}=await virtualQuoteFacts(tx,applicationId),record=await tx.auditLog.findFirst({where:{action:'VIRTUAL_QUOTE_REVIEW',resourceType:'applications',resourceId:applicationId},orderBy:{createdAt:'desc'}}),data=record?.data;
 ensure(app.status==='AWAITING_CONFIRMATION'&&plan.revision===planRevision&&plan.revision===app.revision&&plan.reviewStatus==='APPROVED'&&record?.actorType==='ADMIN'&&data?.reviewedBy===record.actorId&&data.factsHash===canonicalHash(data.facts)&&data.factsHash===canonicalHash(facts),409,'VIRTUAL_REVIEW_STALE','测试方案、资料或真实实名依据已变化，请重新完成测试资料确认');
 const productSnapshot=await snapshotProduct(tx,app.subscriptionPlanId),lessorSnapshot=await buildElectronicLessorSnapshot(tx,app.vehicleId,leaseRange(plan.startDate,12));ensure(canonicalHash(plan.productSnapshot)===canonicalHash(productSnapshot)&&canonicalHash(plan.lessorSnapshot)===canonicalHash(lessorSnapshot)&&canonicalHash(plan.revenueRuleSnapshot)===canonicalHash(virtualRevenue(scope)),409,'VIRTUAL_QUOTE_CHANGED','测试报价产品或合作来源已变化');
 return{riskSnapshot:{kind:'VIRTUAL_QUOTE_REVIEW' as const,reviewId:record.id,...facts,reviewedAt:data.reviewedAt},productSnapshot,lessorSnapshot,revenueRuleSnapshot:virtualRevenue(scope)};
}
export async function assertVirtualOrder(tx:any,order:any){
 const scope=await requireCurrentVirtualScope(tx,{vehicleId:order.vehicleId,customerId:order.customerId,applicationId:order.applicationId,orderId:order.id,action:'ORDER'});if(!scope)return null;
 const b=order.finalPlanSnapshot;assertVirtualPrice(b);ensure(order.contractMode==='ELECTRONIC'&&b.riskSnapshot?.kind==='VIRTUAL_QUOTE_REVIEW'&&b.riskSnapshot.configurationHash===scope.configurationHash&&b.riskSnapshot.applicationId===order.applicationId&&b.riskSnapshot.customerId===order.customerId,409,'VIRTUAL_REVIEW_STALE','订单未绑定真实测试资料确认');
 await confirmVirtualProfile(tx,order.customerId,order.vehicleId,b.customerProfileSnapshot);
 const identity=await requireElectronicCustomerIdentity(tx,order.customerId);ensure(canonicalHash(identity.snapshot)===canonicalHash(b.riskSnapshot.identity),409,'VIRTUAL_REVIEW_STALE','真实客户实名依据已变化');
 const current=await buildElectronicLessorSnapshot(tx,order.vehicleId,b.lessorSnapshot.leaseRange);ensure(canonicalHash(current)===canonicalHash(b.lessorSnapshot)&&canonicalHash(b.revenueRuleSnapshot)===canonicalHash(virtualRevenue(scope)),409,'VIRTUAL_QUOTE_CHANGED','测试合作或不分润事实已变化');return scope;
}
