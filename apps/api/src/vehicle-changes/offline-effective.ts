import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {requireEffectiveContractChain} from '../order-changes/agreement-readiness';
import {periods,day,shanghaiDay} from '../usage/rules';
import {assertOfflineSwapQuote} from './offline-target';
import {assertOfflineSwapHandoverSource} from './offline-physical-source';
import {readSwapStageScope} from './stage-source';

/** Current vehicle facts are proved by the actual applied swap, never by arbitrary JSON leaseRange. */
export async function readCurrentOfflineVehicleSource(tx:any,order:any,terms:any){
 const snapshot=terms?.snapshot,product=snapshot?.currentVehicleProductSnapshot;
 if(order.contractMode==='ELECTRONIC'){
  const chain=await requireEffectiveContractChain(tx,order.id);ensure(terms?.id===chain.termsVersionId&&terms.orderId===order.id&&product,409,'CURRENT_VEHICLE_SOURCE_INVALID');
  const q=await tx.delayQuote.findUniqueOrThrow({where:{id:terms.quoteId}}),assignment=await tx.vehicleAssignment.findUnique({where:{id:order.currentAssignmentId??''}}),settlement=await tx.swapFactSettlement.findUnique({where:{id:snapshot.swapFactSettlementId}});
  ensure(assignment?.status==='ACTIVE'&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===order.vehicleId&&settlement?.quoteId===q.id&&settlement.sourceHash===snapshot.swapFactSourceHash,409,'CURRENT_VEHICLE_SOURCE_INVALID');
  return{product,range:{startDate:shanghaiDay(assignment.startAt),endDate:q.snapshot.newEndDate},assignment,quote:q};
 }

 ensure(order.contractMode==='OFFLINE'&&terms?.id===order.effectiveTermsVersionId&&terms.orderId===order.id&&product&&typeof product==='object'&&!Array.isArray(product)&&typeof product.productVersionId==='string',409,'CURRENT_VEHICLE_SOURCE_INVALID','换入车辆产品来源缺失或不明确');
 await requireEffectiveContractChain(tx,order.id);
 const assignment=order.currentAssignmentId?await tx.vehicleAssignment.findUnique({where:{id:order.currentAssignmentId}}):null;
 ensure(assignment?.status==='ACTIVE'&&!assignment.endAt&&assignment.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===order.vehicleId&&assignment.changeId&&assignment.deliveryHandoverId,409,'CURRENT_VEHICLE_SOURCE_INVALID','当前换入车真实交付分配缺失或归属不符');
 const change=await tx.orderChange.findUnique({where:{id:assignment.changeId}}),q=terms.quoteId?await tx.delayQuote.findUnique({where:{id:terms.quoteId}}):null;
 ensure(change?.status==='APPLIED'&&change.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId&&change.targetVehicleId===order.vehicleId&&change.activeQuoteId===q?.id&&change.deliveryHandoverId===assignment.deliveryHandoverId&&terms.hash===q?.commercialHash&&terms.offlineArchiveVersionId===q?.approvedArchiveVersionId,409,'CURRENT_VEHICLE_SOURCE_INVALID','当前条款与真实已生效换车不一致');
 const s=assertOfflineSwapQuote(change,q),h=await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}});
 ensure(h?.status==='COMPLETED'&&h.type==='SWAP_DELIVERY'&&h.assignmentId===assignment.id&&h.vehicleId===assignment.vehicleId&&h.actualAt&&new Date(h.actualAt).getTime()===new Date(assignment.startAt).getTime()&&h.readingKm===assignment.startReadingKm&&new Date(terms.effectiveAt).getTime()===new Date(h.actualAt).getTime(),409,'CURRENT_VEHICLE_SOURCE_INVALID','换车实际交付与条款生效时间不一致');
 assertOfflineSwapHandoverSource(h,change,q);
 const stageScope=await readSwapStageScope(tx,order,snapshot,{historical:true});ensure(canonicalHash(stageScope)===canonicalHash(s.serviceStageScope??null),409,'SWAP_STAGE_SOURCE','当前车辆换车不得更换服务段来源');
 const schedule=periods(String(change.priorTerms.startDate).slice(0,10),change.priorTerms.months),range={startDate:shanghaiDay(new Date(h.actualAt)),endDate:day(new Date(schedule.at(-1)!.endDate.getTime()-86400000))};
 ensure(range.startDate===s.pricing.pricing.deliveryDate&&range.endDate===s.newEndDate&&snapshot.vehicleId===order.vehicleId&&canonicalHash(product)===canonicalHash(s.targetSource.product)&&canonicalHash(snapshot.lessorSnapshot)===canonicalHash(s.targetLessorSnapshot)&&canonicalHash(snapshot.revenueRuleSnapshot)===canonicalHash(s.targetRevenueRuleSnapshot)&&canonicalHash(s.targetLessorSnapshot.leaseRange)===canonicalHash(range)&&snapshot.commercialTerms?.vehicleIdentification===s.targetVehicleIdentification,409,'CURRENT_VEHICLE_SOURCE_INVALID','当前车辆产品、主体或剩余服务范围与真实换车事实不一致');
 return{product,range,assignment,quote:q};
}
