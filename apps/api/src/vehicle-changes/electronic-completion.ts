import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {lockAccount} from '../usage/rules';
import {canonicalHash} from '../customers/types';
import {archiveOnlineCompletion,requireOnlineConfirmation} from '../operations/online-handover';
import {guardElectronicSwapDelivery} from './electronic-delivery';
import {requireSwapFieldCompletion} from './offline-physical-source';
import {swapFactFinanceView,requireSwapSettlement} from './fact-settlement';
import {consumeCredit} from './credits';
import {openSegments} from './assignments';
import {refreshSegmentPeriods} from './segments';

export function electronicSwapAppliedTerms(change:any,q:any,settlement:any,finance:any){
 const s=q.snapshot,prior=change.priorTerms,periods=finance.plan.result.periods,p=s.targetSource.product;
 return{...prior,vehicleId:s.targetVehicleId,currentVehicleProductSnapshot:p,currentVehicleCustomerBaas:p.customerBaas,lessorSnapshot:s.targetLessorSnapshot,revenueRuleSnapshot:s.targetRevenueRuleSnapshot,monthlyFeeAmount:s.newMonthlyFeeAmount,agreedFeeComponents:{baseFeeAmount:p.baseFeeAmount,mileageMonthlyFeeAmount:p.mileageMonthlyFeeAmount},depositAmount:prior.depositAmount,monthlyAmounts:periods.map((p:any)=>p.amount),billingSchedule:periods,commercialTerms:{...prior.commercialTerms,vehicleIdentification:s.targetVehicleIdentification,insuranceDetails:s.insuranceResponsibility},commercialHash:q.commercialHash,amendmentContractId:q.contract.id,swapFactSettlementId:settlement.id,swapFactSourceHash:settlement.sourceHash,swapFinancePlanHash:finance.planHash};
}
export async function completeElectronicSwapHandover(tx:any,h:any,actorId:string){
 ensure(h.actualAt&&h.type==='SWAP_DELIVERY'&&h.executionMode==='ELECTRONIC'&&h.confirmationMode==='ONLINE_RECORD'&&h.status==='CUSTOMER_CONFIRMED',409,'HANDOVER_NOT_READY','须由本人确认本版新车实际交付');
 const {order,change,q,target}=await guardElectronicSwapDelivery(tx,h);await requireOnlineConfirmation(tx,h);
 const financial=await swapFactFinanceView(tx,change);ensure(!financial.blockers.length,409,'FINANCE_UNRESOLVED',financial.blockers.join('；'));
 const posted=await tx.swapFactFinance.findUniqueOrThrow({where:{quoteId:q.id}}),{row,serviceStageScope:scope}=await requireSwapSettlement(tx,posted.settlementId,true);
 ensure(row.deliveryHandoverId===h.id&&row.deliveryManifestHash===h.manifestHash&&canonicalHash(posted.plan)===posted.planHash,409,'SWAP_FACT_SOURCE_CHANGED');
 const task=await requireSwapFieldCompletion(tx,h,change,q),account=await lockAccount(tx,order.id);
 await consumeCredit(tx,order,account,change.id,h.actualAt,h.vehicleId);
 const assignment=await tx.vehicleAssignment.create({data:{orderId:order.id,customerId:order.customerId,vehicleId:h.vehicleId,changeId:change.id,deliveryHandoverId:h.id,startAt:h.actualAt,startReadingKm:h.readingKm}});await openSegments(tx,assignment,false,scope?{serviceStageId:scope.serviceStageId,swapSettlementId:row.id}:undefined);
 const version=((await tx.orderTermsVersion.aggregate({where:{orderId:order.id},_max:{version:true}}))._max.version||0)+1,snapshot=electronicSwapAppliedTerms(change,q,row,posted);
 const terms=await tx.orderTermsVersion.create({data:{orderId:order.id,quoteId:q.id,version,snapshot,hash:q.commercialHash,effectiveAt:h.actualAt,offlineArchiveVersionId:q.approvedArchiveVersionId}});
 await tx.serviceObligation.updateMany({where:{orderId:order.id,active:true,serviceStageId:scope?.serviceStageId??null},data:{active:false}});await tx.serviceObligation.updateMany({where:{quoteId:q.id,swapSettlementId:row.id,serviceStageId:scope?.serviceStageId??null},data:{active:true}});
 await tx.vehicleHold.update({where:{id:target.hold.id},data:{status:'CONSUMED',releasedAt:new Date()}});await tx.vehicle.update({where:{id:h.vehicleId},data:{holdId:null,status:'IN_USE',reservedOrderId:order.id,mileageKm:h.readingKm}});
 await tx.order.update({where:{id:order.id},data:{vehicleId:h.vehicleId,currentAssignmentId:assignment.id,effectiveTermsVersionId:terms.id,confirmedMileageKm:h.readingKm}});
 await tx.orderChange.update({where:{id:change.id},data:{status:'APPLIED',actualCompletedAt:h.actualAt,appliedAt:new Date(),revision:{increment:1}}});
 const completedAt=new Date();await archiveOnlineCompletion(tx,h,actorId,completedAt);const done=await tx.handover.update({where:{id:h.id},data:{assignmentId:assignment.id,status:'COMPLETED',completedAt}});
 if(task){const updated=await tx.fieldHandoverTask.updateMany({where:{id:task.id,version:task.version,status:'ASSIGNED',currentHandoverId:h.id},data:{status:'COMPLETED',version:{increment:1},vehicleAssignmentId:assignment.id,updatedBy:actorId}});ensure(updated.count===1,409,'FIELD_SWAP_SOURCE_CHANGED');}
 await refreshSegmentPeriods(tx,order.id,scope?{serviceStageId:scope.serviceStageId}:undefined);await audit(tx,actorId,'COMPLETE_ELECTRONIC_SWAP','order-changes',change.id,{settlementId:row.id,sourceHash:row.sourceHash,financeId:posted.id,planHash:posted.planHash,assignmentId:assignment.id,termsVersionId:terms.id,actualAt:h.actualAt,coverageEvidence:{checkedAt:new Date(h.actualAt).toISOString(),vehicleId:h.vehicleId,productVersionId:q.snapshot.targetSource.product.productVersionId,policyVersionIds:target.coverage?.policyVersionIds,requirementIds:target.coverage?.requirementIds}});return done;
}
