import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {shanghaiDay} from '../usage/rules';
import {requireElectronicCustomerIdentity} from '../electronic-documents/identities';
import {buildElectronicLessorSnapshot} from '../electronic-documents/initial-terms';
import {resolveV31SourceIds} from '../contract-terms/sources';
import {requireOfflineSwapFacts} from './offline-facts';
import {requireOfflineSwapTarget} from './offline-target';
import {requireElectronicSwapAgreement} from './electronic-archive';
import {currentSwapReceipt} from './swap-receipt';
import {readSwapCreditAvailability} from './credits';
import {assertOfflineSwapHandoverSource} from './offline-physical-source';

/** Inspection may precede monetary reconciliation. Assignment/rights need the completion gate. */
export async function guardElectronicSwapDelivery(tx:any,h:any){
 const change=await tx.orderChange.findUnique({where:{id:h.changeId}}),order=await tx.order.findUniqueOrThrow({where:{id:h.orderId}}),q=change?.activeQuoteId?await tx.delayQuote.findUnique({where:{id:change.activeQuoteId},include:{contract:true}}):null;
 ensure(order.contractMode==='ELECTRONIC'&&order.status==='ACTIVE'&&change?.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId&&h.customerId===order.customerId&&change.status==='SWAP_RETURNED'&&h.type==='SWAP_DELIVERY'&&h.vehicleId===change.targetVehicleId&&!h.assignmentId&&!order.currentAssignmentId&&q?.status==='CONFIRMED'&&(!change.deliveryHandoverId||change.deliveryHandoverId===h.id),409,'SWAP_STATE','须先保存本单旧车实际收回且使用当前新车交付版本');
 await requireElectronicSwapAgreement(tx,change,q);
 const receipt=await currentSwapReceipt(tx,change.id,true),latest=await currentSwapReceipt(tx,change.id);
 ensure(receipt&&latest?.id===receipt.id&&receipt.quoteId===q.id,409,'SWAP_RECEIPT_REVIEW_REQUIRED','收车来源尚待核验，不能依不一致事实交付');
 const at=h.actualAt?new Date(h.actualAt):new Date(q.snapshot.plannedDeliveryAt);
 if(h.actualAt)ensure(Number.isFinite(at.getTime())&&at<=new Date(Date.now()+300000)&&at>=receipt.receivedAt,409,'HANDOVER_DATE_REQUIRED','新车真实交付时间不得早于收车或超过时钟容差');
 const frozen=q.snapshot.electronicTerms.snapshot,actualDay=shanghaiDay(at);
 ensure(actualDay>=frozen.startDate&&actualDay<frozen.endDate,409,'SWAP_OUTSIDE_TERM');
 const facts=await requireOfflineSwapFacts(tx,order,change,at,true);await requireElectronicCustomerIdentity(tx,order.customerId);
 const target=await requireOfflineSwapTarget(tx,order,change,q,at,!!h.actualAt);
 const actualLessor=await buildElectronicLessorSnapshot(tx,h.vehicleId,{startDate:actualDay,endDate:q.snapshot.targetLessorSnapshot.leaseRange.endDate}),agreed=q.snapshot.targetLessorSnapshot;
 ensure(['ownerId','name','subjectType','creditCode','agreementId','agreementVersionId','agreementHash','partnerRateBps'].every(k=>actualLessor[k as keyof typeof actualLessor]===agreed[k]),409,'OWNER_LESSOR_CHANGED','本次真实车辆期间须仍由已签出租方及合作范围承接');
 const current=await resolveV31SourceIds(tx,{ownerId:agreed.ownerId,cooperationVersionId:agreed.agreementVersionId,vehicleId:h.vehicleId,productVersionId:q.snapshot.targetSource.product.productVersionId} as any),snapshot=current.snapshot as any,vehicle=snapshot.vehicles?.find((v:any)=>v.id===h.vehicleId),scope=vehicle?.content.scope;
 ensure(!current.missing.length&&scope?.validFrom<=actualDay&&scope?.validUntil>=agreed.leaseRange.endDate,409,'V31_ACTUAL_VEHICLE_AUTHORITY_REQUIRED','真实交付期间的企业及车辆授权资料须有效');
 const fixed=q.snapshot.v31Sources.snapshot.vehicles.find((v:any)=>v.id===h.vehicleId);
 ensure(fixed&&canonicalHash(vehicle.content.authorityEvidence)===canonicalHash(fixed.content.authorityEvidence)&&canonicalHash(vehicle.content.rightsEvidence)===canonicalHash(fixed.content.rightsEvidence)&&canonicalHash(scope.rightsRestrictions)===canonicalHash(fixed.content.scope.rightsRestrictions),409,'V31_ACTUAL_VEHICLE_AUTHORITY_REQUIRED','车辆出租权限或权利限制已变化，请核验原协议安排');
 if(h.actualAt)ensure(Number.isSafeInteger(h.readingKm)&&h.readingKm>=target.vehicle.mileageKm,409,'MILEAGE_REGRESSION','新车读数不得低于已确认记录');
 if(h.id)assertOfflineSwapHandoverSource(h,change,q);
 await readSwapCreditAvailability(tx,order,facts.account,change.id,at,h.vehicleId);
 return{change,order,q,receipt,target};
}
