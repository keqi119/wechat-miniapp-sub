import {readVirtualScope} from '../virtual-acceptance/scope';
import {requireVirtualQuoteReview} from '../virtual-acceptance/quotes';
import {guardCancellation04Delivery} from './cancellation04-gates';
import {buildElectronicLessorSnapshot,assertAgreedFeeComponents} from '../electronic-documents/initial-terms';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {servicePeriods,validTermMonths} from '../service-calendar/rules';
import {shanghaiDay} from '../usage/rules';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import type {GateResult} from '../mvp-domain-types';
import type {RiskSnapshot} from '../customers/types';
import type {ProductSnapshot} from '../products/types';
import {canonicalHash} from '../customers/types';
import {requireCurrentRisk} from '../applications/risk-review';
import {requireOrderQualification} from '../customers/order-qualification';
import {snapshotProduct,assertProductQuote} from '../products/snapshot';
import {buildOfflineLessorSnapshot,lessorIdentityHash} from '../owner-signing/lessor';
import {snapshotRevenueRule} from '../partners/revenue-rules';
import {approvedPartner} from '../partners/types';
import {ownerCooperationReady,readOwnerCooperationReady,lockOrder} from '../offline-documents/readiness';
import {deliveryCoverageAt} from '../insurance/delivery-coverage';
import {periods} from '../usage/rules';
import {requireFrozenSimpleAgreement} from '../partners/simple-agreements';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {readCurrentOfflineVehicleSource} from '../vehicle-changes/offline-effective';
import {readCurrentRenewalVehicleSource} from '../order-renewals/effective';

type OrdinaryQuoteSnapshots={riskSnapshot:RiskSnapshot;productSnapshot:ProductSnapshot;lessorSnapshot:Awaited<ReturnType<typeof buildOfflineLessorSnapshot>>;revenueRuleSnapshot:Awaited<ReturnType<typeof snapshotRevenueRule>>};
type QuoteSnapshots=OrdinaryQuoteSnapshots|Awaited<ReturnType<typeof requireVirtualQuoteReview>>;
export type QuoteGate=GateResult&{snapshots?:QuoteSnapshots};
export type DeliveryBusinessGate=GateResult&{coverageEvidence?:{checkedAt:string;vehicleId:string;productVersionId:string;policyVersionIds:string[];requirementIds:string[]}};
type Blocker=GateResult['blockers'][number];
const obj=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const hasText=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function gateError(error:unknown,resourceType:string,resourceId:string):Blocker{
 if(error instanceof HttpException&&[400,403,404,409].includes(error.getStatus())){
  const payload=error.getResponse() as {error?:{code?:string;message?:string}};
  return{code:payload.error?.code||'BUSINESS_REVIEW_REQUIRED',label:payload.error?.message||'当前资料须重新核对',resourceType,resourceId};
 }
 throw error;
}
export function leaseRange(start:Date|string,months:number){
 const day=start instanceof Date?start.toISOString().slice(0,10):start.slice(0,10),schedule=periods(day,months);
 return{startDate:day,endDate:new Date(schedule.at(-1)!.endDate.getTime()-86400000).toISOString().slice(0,10)};
}
/** This gate is evaluated after risk approval, never while creating a candidate. */
export async function quoteReady(tx:any,applicationId:string,planRevision:number):Promise<QuoteGate>{
 const blockers:Blocker[]=[];
 await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
 const app=await tx.application.findUnique({where:{id:applicationId}}),plan=await tx.finalPlan.findFirst({where:{applicationId},orderBy:{revision:'desc'}});
 if(!app||!plan||plan.revision!==planRevision||app.revision!==planRevision||!['OFFLINE','ELECTRONIC'].includes(plan.contractMode))return{ready:false,blockers:[{code:'REVISION_CONFLICT',label:'当前线下方案已更新或缺失',resourceType:'applications',resourceId:applicationId}]};
 if(await readVirtualScope(tx,app.vehicleId)){try{return{ready:true,blockers:[],snapshots:await requireVirtualQuoteReview(tx,applicationId,planRevision)};}catch(error){return{ready:false,blockers:[gateError(error,'applications',applicationId)]};}}
 let riskSnapshot:RiskSnapshot|undefined,productSnapshot:ProductSnapshot|undefined,lessorSnapshot:OrdinaryQuoteSnapshots['lessorSnapshot']|undefined,revenueRuleSnapshot:OrdinaryQuoteSnapshots['revenueRuleSnapshot']|undefined;
 try{ensure(app.status==='AWAITING_CONFIRMATION',409,'RISK_REVIEW_REQUIRED','候选方案须通过本申请风险审核后再确认');riskSnapshot=await requireCurrentRisk(tx,applicationId,planRevision);}catch(error){blockers.push(gateError(error,'applications',applicationId));}
 try{
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${app.vehicleId} FOR UPDATE`;
  const vehicle=await tx.vehicle.findUnique({where:{id:app.vehicleId}});ensure(vehicle?.status==='PUBLISHED'&&!vehicle.reservedOrderId&&!vehicle.holdId,409,'VEHICLE_UNAVAILABLE','车辆已被占用或不可申请');
  await requireVehicleUnrestricted(tx,app.vehicleId,'ALLOCATION');
  productSnapshot=await snapshotProduct(tx,app.subscriptionPlanId);
  ensure(plan.productSnapshot&&canonicalHash(plan.productSnapshot)===canonicalHash(productSnapshot),409,'PRODUCT_VERSION_CHANGED','产品版本或适用范围已变化，请重新出具方案');
  if(!plan.acceptancePricing)assertProductQuote(productSnapshot,plan);if(plan.contractMode==='ELECTRONIC'){ensure(plan.months===productSnapshot.months&&productSnapshot.minimumTermMonths!=null&&validTermMonths(plan.months,productSnapshot.minimumTermMonths),409,'PRODUCT_TERMS_CHANGED','实际期限须满足最短期限');assertAgreedFeeComponents(productSnapshot,plan);}
 }catch(error){blockers.push(gateError(error,'products',obj(plan.productSnapshot).productId||app.subscriptionPlanId));}
 try{
  const range=leaseRange(plan.startDate,plan.months);lessorSnapshot=plan.contractMode==='ELECTRONIC'?await buildElectronicLessorSnapshot(tx,app.vehicleId,range):await buildOfflineLessorSnapshot(tx,app.vehicleId,range);
  ensure(plan.lessorSnapshot&&lessorIdentityHash(plan.lessorSnapshot)===lessorIdentityHash(lessorSnapshot),409,'OWNER_LESSOR_CHANGED','出租方资格、合作范围或告知已变化，请重新出具方案');
  revenueRuleSnapshot=await snapshotRevenueRule(tx,lessorSnapshot.ownerId,app.vehicleId,range.startDate,range.endDate);
  ensure(plan.revenueRuleSnapshot&&plan.revenueRuleSnapshot.versionId===revenueRuleSnapshot.versionId&&plan.revenueRuleSnapshot.contentHash===revenueRuleSnapshot.contentHash,409,'REVENUE_RULE_CHANGED','适用合作约定已变化，请重新出具方案');
 }catch(error){blockers.push(gateError(error,'partners',obj(plan.lessorSnapshot).ownerId||app.vehicleId));}
 return blockers.length||!riskSnapshot||!productSnapshot||!lessorSnapshot||!revenueRuleSnapshot?{ready:false,blockers}:{ready:true,blockers:[],snapshots:{riskSnapshot,productSnapshot,lessorSnapshot,revenueRuleSnapshot}};
}
/** Separate from contract/payment/inspection gates; call all gates in the same delivery transaction. */
export async function deliveryBusinessReady(tx:any,orderId:string,at:Date=new Date()):Promise<DeliveryBusinessGate>{
 await lockOrder(tx,orderId);return inspectDeliveryBusiness(tx,orderId,at,true);
}
/** Same checks as the command guard, without acquiring write locks. */
export async function readDeliveryBusinessReady(tx:any,orderId:string,at:Date=new Date()):Promise<DeliveryBusinessGate>{return inspectDeliveryBusiness(tx,orderId,at,false);}
async function inspectDeliveryBusiness(tx:any,orderId:string,at:Date,locking:boolean):Promise<DeliveryBusinessGate>{
 const order=await tx.order.findUnique({where:{id:orderId}});
 ensure(order,404,'NOT_FOUND','订单不存在');
 if(await (await import('../virtual-acceptance/scope')).isVirtualVehicle(tx,order.vehicleId))return{ready:false,blockers:[{code:'VIRTUAL_DELIVERY_FORBIDDEN',label:'本测试到此结束，无需车辆交付',resourceType:'orders',resourceId:order.id}]};
 const blockers:Blocker[]=[];
 if(locking)await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${order.customerId} FOR UPDATE`;
 if(locking)await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${order.vehicleId} FOR UPDATE`;
 try{await requireVehicleUnrestricted(tx,order.vehicleId,'DELIVERY');}catch(error){blockers.push(gateError(error,'vehicles',order.vehicleId));}
 if(!['OFFLINE','ELECTRONIC'].includes(order.contractMode))return{ready:blockers.length===0,blockers};
 if(order.contractMode==='ELECTRONIC'&&!order.serviceAnchor)try{await guardCancellation04Delivery(tx,orderId);}catch(error){blockers.push(gateError(error,'orders',orderId));}
 const original=obj(order.finalPlanSnapshot);let terms=original,currentTerms:any=null;
 if(order.effectiveTermsVersionId){const current=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});if(!current||current.orderId!==order.id)return{ready:false,blockers:[{code:'TERMS_MISSING',label:'当前有效条款缺失或归属不符',resourceType:'orders',resourceId:orderId}]};terms=obj(current.snapshot);currentTerms=current;}
 const swapped=Object.hasOwn(terms,'currentVehicleProductSnapshot'),risk=obj(terms.riskSnapshot),lessor=obj(terms.lessorSnapshot);let product=swapped?{}:obj(terms.productSnapshot),currentRange:{startDate:string;endDate:string}|null=null;
 try{
  if(swapped){const source=await readCurrentRenewalVehicleSource(tx,order,currentTerms)??await readCurrentOfflineVehicleSource(tx,order,currentTerms);product=obj(source.product);currentRange=source.range;}
  ensure(hasText(product.productVersionId)&&Array.isArray(product.benefits)&&hasText(risk.reviewId)&&risk.applicationId===order.applicationId&&risk.customerId===order.customerId&&hasText(risk.qualificationId),409,'ORDER_BUSINESS_SNAPSHOT_REQUIRED','已确认订单缺少产品或风险审核凭据');
  const review=await tx.applicationRiskReview.findUnique({where:{id:risk.reviewId}});
  ensure(review?.applicationId===order.applicationId&&review.customerId===order.customerId&&review.decision==='APPROVED'&&review.finalPlanId===risk.planId&&review.planRevision===risk.planRevision&&review.commercialHash===risk.commercialHash&&review.qualificationId===risk.qualificationId&&review.qualificationRevision===risk.qualificationRevision,409,'ORDER_RISK_SNAPSHOT_MISMATCH','订单风险审核凭据不匹配');
  await requireOrderQualification(tx,order,at);if(order.contractMode==='ELECTRONIC')await requireElectronicCustomerIdentity(tx,order.customerId);
 }catch(error){blockers.push(gateError(error,'customers',order.customerId));}
 try{
  ensure(!swapped||currentRange,409,'CURRENT_VEHICLE_SOURCE_INVALID','须先核对当前车辆的实际服务范围');
  ensure(lessor.executionMode===order.contractMode&&hasText(lessor.ownerId)&&lessor.vehicleId===order.vehicleId,409,'OWNER_LESSOR_REQUIRED','订单实际出租方凭据缺失');
  if(lessor.mode==='SIMPLE_AGREEMENT'){
   const actual=shanghaiDay(at),anchor=order.serviceAnchor??{firstStartDay:actual,anchorDay:Number(actual.slice(-2)),ruleVersion:'V31'},end=servicePeriods(anchor,1,terms.months).at(-1)!.endDayExclusive;
   const range=currentRange??(order.contractMode==='ELECTRONIC'?{startDate:anchor.firstStartDay,endDate:new Date(new Date(end+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10)}:leaseRange(terms.startDate,terms.months));
   const version=await requireFrozenSimpleAgreement(tx,order.vehicleId,lessor,obj(terms.revenueRuleSnapshot),range);
   if(order.contractMode==='ELECTRONIC'){
    const binding=await tx.partnerAgreementVehicle.findUnique({where:{vehicleId:order.vehicleId}}),agreement=await tx.partnerAgreement.findUnique({where:{id:version.agreementId}}),owner=await tx.vehicleOwner.findUnique({where:{id:lessor.ownerId}});
    ensure(owner&&owner.status!=='SUSPENDED'&&owner.name===lessor.name&&owner.subjectType===lessor.subjectType&&owner.creditCode===lessor.creditCode,409,'OWNER_LESSOR_CHANGED','实际出租主体已变化或停止合作');
    ensure(binding?.ownerId===lessor.ownerId&&binding.agreementVersionId===version.id&&agreement?.status==='ACTIVE'&&agreement.currentVersionId===version.id,409,'ELECTRONIC_DELIVERY_SCOPE_REQUIRED','当前有效合作协议与车辆关联已变化');
    // Historical paper evidence was checked above; electronic cooperation retains its additional signed scope checks.
    if(version.executionMode==='ELECTRONIC'){
     const scope=version.electronicTerms?.v31Sources?.vehicleScopes?.find((s:any)=>s.vehicleId===order.vehicleId),evidenceIds=scope?.authorityEvidenceFileIds??[];
     ensure(evidenceIds.length>0&&await tx.storedFile.count({where:{id:{in:evidenceIds},adminId:{not:null},customerId:null}})===new Set(evidenceIds).size,409,'ELECTRONIC_DELIVERY_SCOPE_REQUIRED','当前出租授权证据不完整');
     ensure(scope&&scope.validFrom<=range.startDate&&scope.validUntil>=range.endDate&&scope.rightsRestrictions?.status!=='UNKNOWN',409,'ELECTRONIC_DELIVERY_SCOPE_REQUIRED','实际完整服务期间不在当前出租授权及合作车辆范围内');
    }
   }
  }else{
  if(locking)await tx.$queryRaw`SELECT id FROM "VehicleOwner" WHERE id = ${lessor.ownerId} FOR UPDATE`;
  const owner=await tx.vehicleOwner.findUnique({where:{id:lessor.ownerId}}),binding=await tx.ownerVehicle.findUnique({where:{vehicleId:order.vehicleId}});
  ensure(owner&&binding?.ownerId===owner.id&&binding.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt&&owner.subjectType===lessor.subjectType&&owner.name===lessor.name&&owner.creditCode===lessor.creditCode,409,'OWNER_LESSOR_CHANGED','实际出租方或已审核车辆归属已变化');
  await approvedPartner(tx,owner);
  const range=currentRange??leaseRange(terms.startDate,terms.months),cooperation=await (locking?ownerCooperationReady:readOwnerCooperationReady)(tx,owner.id,order.vehicleId,range.startDate,range.endDate);
  ensure(cooperation.ready,409,cooperation.blockers[0]||'OWNER_COOPERATION_REQUIRED','当前合作协议未覆盖本车辆及完整租期');
  }
 }catch(error){blockers.push(gateError(error,'partners',lessor.ownerId||order.vehicleId));}
 let coverageEvidence:DeliveryBusinessGate['coverageEvidence'];
 if(hasText(product.productVersionId)){
  const coverage=await deliveryCoverageAt(tx,order.vehicleId,product.productVersionId,at);blockers.push(...coverage.blockers);
  if(coverage.ready)coverageEvidence={checkedAt:at.toISOString(),vehicleId:order.vehicleId,productVersionId:product.productVersionId,policyVersionIds:coverage.policyVersionIds,requirementIds:coverage.requirementIds};
 }
 return{ready:blockers.length===0,blockers,...(coverageEvidence?{coverageEvidence}:{})};
}
