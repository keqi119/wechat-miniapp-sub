import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {requireFrozenSimpleAgreement} from '../partners/simple-agreements';
import {approvedPartner} from '../partners/types';
import {readOwnerCooperationReady} from '../offline-documents/readiness';
import {deliveryCoverageAt} from '../insurance/delivery-coverage';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {readSwapStageScope,parseSwapStageScope} from './stage-source';

export function assertOfflineSwapQuote(change:any,q:any,options:{historical?:boolean}={}){
 const s=q?.snapshot,p=s?.pricing;
 ensure((options.historical?typeof q?.id==='string':q?.id===change.activeQuoteId)&&q.changeId===change.id&&change.kind==='VEHICLE_CHANGE'&&s?.pricingVersion===2&&p?.pricingVersion===2&&s.pricingHash===canonicalHash(p)&&canonicalHash(s.targetSource)===canonicalHash(p.target)&&s.targetVehicleId===p.target?.vehicleId&&change.targetVehicleId===s.targetVehicleId&&s.newMonthlyFeeAmount===p.targetMonthlyFeeAmount&&s.handoverFeeAmount===0&&s.financialGate===(s.executionMode==='ELECTRONIC'?'BEFORE_DELIVERY':'BEFORE_RETURN')&&s.originalArchiveVersionId===change.originalArchiveVersionId&&(s.priorTermsVersionId??null)===(change.priorTermsVersionId??null)&&p.priorTermsHash===change.priorTermsHash,409,'SWAP_QUOTE_SOURCE_MISMATCH','冻结换车报价或自动计价依据不一致');
 const stage=Object.hasOwn(change.priorTerms??{},'serviceStageId');
 ensure(stage?!!s.serviceStageScope&&s.serviceStageScope.serviceStageId===change.priorTerms.serviceStageId&&canonicalHash(s.serviceStageScope)===canonicalHash(p.serviceStageScope):!Object.hasOwn(s,'serviceStageScope')&&!Object.hasOwn(p,'serviceStageScope'),409,'SWAP_QUOTE_SOURCE_MISMATCH','换车报价的服务段来源缺失或不一致');
 if(stage){const scope=parseSwapStageScope(s.serviceStageScope);ensure(scope.startDate===s.newStartDate&&scope.months===s.months&&p.periods.every((row:any,index:number)=>row.sequence===scope.firstPeriodSequence+index&&row.stageSequence===index+1),409,'SWAP_QUOTE_SOURCE_MISMATCH','续期换车期次不得重排或越界');}
 ensure(Array.isArray(s.periods)&&s.periods.length===p.periods.length&&s.periods.every((row:any,index:number)=>['sequence',...(stage?['stageSequence']:[]),'startDate','endDate','dueDate','amount','originalAmount','differenceAmount'].every(key=>row[key]===p.periods[index][key])),409,'SWAP_QUOTE_SOURCE_MISMATCH','逐期报价与自动计价依据不一致');
 return s;
}

/** Frozen commercial source; current catalog publication never rewrites an agreed price. */
export async function requireOfflineSwapTarget(tx:any,order:any,change:any,q:any,at:Date,coverage=false){
 const s=assertOfflineSwapQuote(change,q),vehicle=await tx.vehicle.findUnique({where:{id:s.targetVehicleId}}),hold=vehicle?.holdId?await tx.vehicleHold.findUnique({where:{id:vehicle.holdId}}):null;
 const scope=await readSwapStageScope(tx,order,change.priorTerms);ensure(canonicalHash(scope)===canonicalHash(s.serviceStageScope??null),409,'SWAP_STAGE_SOURCE','当前服务段与报价冻结来源不一致');
 const identity=vehicle&&`${vehicle.title}；VIN：${vehicle.vin||'未登记'}；车牌：${vehicle.plateNumber||'未登记'}；车况：${vehicle.conditionDisclosure||'未披露'}`;
 ensure(vehicle?.status==='PUBLISHED'&&!vehicle.reservedOrderId&&identity===s.targetVehicleIdentification&&(vehicle.vin||vehicle.plateNumber)&&hold?.status==='HELD'&&hold.changeId===change.id&&hold.orderId===order.id&&hold.quoteId===q.id,409,'VEHICLE_HOLD_MISMATCH','目标车真实身份或预留已变化，请重新核对');
 const lessor=s.targetLessorSnapshot,prior=change.priorTerms?.lessorSnapshot,owner=lessor?.ownerId?await tx.vehicleOwner.findUnique({where:{id:lessor.ownerId}}):null;
 ensure(owner&&owner.status!=='SUSPENDED'&&lessor.ownerId===prior?.ownerId&&lessor.vehicleId===vehicle.id&&owner.name===lessor.name&&owner.subjectType===lessor.subjectType&&owner.creditCode===lessor.creditCode,409,'OWNER_LESSOR_CHANGED','目标车辆实际出租方与原已确认主体不一致');
 if(lessor.mode==='SIMPLE_AGREEMENT')await requireFrozenSimpleAgreement(tx,vehicle.id,lessor,s.targetRevenueRuleSnapshot,lessor.leaseRange);
 else{
  const binding=await tx.ownerVehicle.findUnique({where:{vehicleId:vehicle.id}});ensure(binding?.ownerId===owner.id&&binding.status==='APPROVED'&&binding.reviewedBy&&binding.reviewedAt,409,'OWNER_LESSOR_CHANGED','目标车权属审核已变化');await approvedPartner(tx,owner);
  const ready=await readOwnerCooperationReady(tx,owner.id,vehicle.id,lessor.leaseRange.startDate,lessor.leaseRange.endDate);ensure(ready.ready,409,ready.blockers[0]||'OWNER_COOPERATION_REQUIRED','目标车辆合作范围未覆盖剩余服务期');
 }
 if(coverage){await requireVehicleUnrestricted(tx,vehicle.id,'DELIVERY');const result=await deliveryCoverageAt(tx,vehicle.id,s.targetSource.product.productVersionId,at);ensure(result.ready,409,result.blockers[0]?.code||'INSURANCE_COVERAGE_REQUIRED',result.blockers[0]?.label||'目标车辆实际交付时保险未就绪');return{vehicle,hold,coverage:result};}
 return{vehicle,hold,coverage:null};
}
