import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {requireCurrentQualification} from '../customers/qualifications';
import {effectiveTerms} from '../order-changes/context';
import {requireEffectiveContractChain} from '../order-changes/agreement-readiness';
import {currentAssignment} from './assignments';
import {requireElectronicSwapChain} from './electronic-source';
import {currentSwapReceipt} from './swap-receipt';

/** Pure reads; mutation callers must already hold Order before any Vehicle lock. */
export async function requireOfflineSwapFacts(tx:any,order:any,change?:any,at=new Date(),allowReturned=false){
 ensure(['OFFLINE','ELECTRONIC'].includes(order.contractMode)&&order.status==='ACTIVE',409,'SWAP_STATE','须为有当前合同依据的实际用车订单');
 const chain=order.contractMode==='ELECTRONIC'?await requireElectronicSwapChain(tx,order):await requireEffectiveContractChain(tx,order.id),terms=await effectiveTerms(tx,order);
 if(change)ensure(change.kind==='VEHICLE_CHANGE'&&change.orderId===order.id&&change.customerId===order.customerId&&change.originalContractId===chain.original.contractId&&change.originalArchiveVersionId===chain.original.archiveVersionId&&(change.priorTermsVersionId??null)===chain.termsVersionId&&change.priorTermsHash===hash(terms)&&hash(change.priorTerms)===hash(terms),409,'AGREEMENT_PRIOR_TERMS_MISMATCH','原合同或当前有效条款已变化，请重新核对');
 const risk=terms.riskSnapshot;
 ensure(risk?.applicationId===order.applicationId&&risk.customerId===order.customerId&&typeof risk.reviewId==='string',409,'ORDER_RISK_SNAPSHOT_MISMATCH','原订单风险审核凭据缺失');
 const review=await tx.applicationRiskReview.findUnique({where:{id:risk.reviewId}});
 ensure(review?.decision==='APPROVED'&&review.identityChecked&&review.drivingQualificationChecked&&review.applicationId===order.applicationId&&review.customerId===order.customerId&&review.finalPlanId===risk.planId&&review.planRevision===risk.planRevision&&review.commercialHash===risk.commercialHash&&review.qualificationId===risk.qualificationId&&review.qualificationRevision===risk.qualificationRevision,409,'ORDER_RISK_SNAPSHOT_MISMATCH','原订单风险审核凭据不匹配');
 const qualification=await requireCurrentQualification(tx,order.customerId,undefined,at);
 ensure(qualification.revision>=risk.qualificationRevision&&qualification.profileHash===review.profileHash,409,'CUSTOMER_QUALIFICATION_REQUIRED','当前资格与已确认的客户主体不一致');
 const account=await tx.usageAccount.findUnique({where:{orderId:order.id}});let assignment=await currentAssignment(tx,order),returned=false;
 if(!assignment&&allowReturned&&change?.returnHandoverId&&!order.currentAssignmentId){
  const q=await tx.delayQuote.findUnique({where:{id:change.activeQuoteId}}),reference=q?.changeId===change.id?q.snapshot?.originalAssignmentId:null;
  assignment=typeof reference==='string'?await tx.vehicleAssignment.findUnique({where:{id:reference},include:{vehicle:true}}):null;
  const receipt=await tx.handover.findUnique({where:{id:change.returnHandoverId}});
  returned=!!(assignment?.status==='CLOSED'&&assignment.returnHandoverId===receipt?.id&&receipt?.type==='SWAP_RETURN'&&receipt.executionMode==='OFFLINE'&&receipt.status==='COMPLETED'&&receipt.orderId===order.id&&receipt.customerId===order.customerId&&receipt.changeId===change.id&&receipt.assignmentId===assignment.id&&receipt.vehicleId===assignment.vehicleId&&receipt.actualAt&&assignment.endAt&&new Date(receipt.actualAt).getTime()===new Date(assignment.endAt).getTime()&&receipt.readingKm===assignment.endReadingKm);
  if(order.contractMode==='ELECTRONIC'){const fact=await currentSwapReceipt(tx,change.id,true);returned=!!(fact&&fact.orderId===order.id&&fact.customerId===order.customerId&&fact.quoteId===q.id&&fact.assignmentId===assignment?.id&&fact.vehicleId===assignment.vehicleId&&fact.handoverId===receipt?.id&&fact.handoverRevision===receipt.revision&&fact.manifestHash===receipt.manifestHash&&assignment.status==='CLOSED'&&assignment.returnHandoverId===receipt.id&&assignment.endAt?.getTime()===fact.receivedAt.getTime()&&assignment.endReadingKm===fact.readingKm);}
 }
 ensure(account?.orderId===order.id&&account.customerId===order.customerId&&!account.returnedOn&&assignment?.orderId===order.id&&assignment.customerId===order.customerId&&assignment.vehicleId===order.vehicleId&&(!assignment.endAt||returned)&&typeof assignment.deliveryHandoverId==='string'&&assignment.deliveryHandoverId.length>0,409,'ASSIGNMENT_EVIDENCE_REQUIRED','缺少本客户本车当前实际交付分配或完整换车归还事实');
 const delivered=await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}});
 ensure(delivered?.orderId===order.id&&delivered.customerId===order.customerId&&delivered.vehicleId===assignment.vehicleId&&delivered.assignmentId===assignment.id&&['DELIVERY','SWAP_DELIVERY'].includes(delivered.type)&&delivered.executionMode===order.contractMode&&(order.contractMode!=='ELECTRONIC'||delivered.confirmationMode==='ONLINE_RECORD')&&delivered.status==='COMPLETED'&&delivered.actualAt&&new Date(delivered.actualAt).getTime()===new Date(assignment.startAt).getTime()&&delivered.readingKm===assignment.startReadingKm,409,'ASSIGNMENT_EVIDENCE_REQUIRED','实际交付事实与当前车辆分配不一致');
 if(delivered.type==='SWAP_DELIVERY'){
  const original=assignment.changeId?await tx.orderChange.findUnique({where:{id:assignment.changeId}}):null;
  ensure(original?.kind==='VEHICLE_CHANGE'&&original.status==='APPLIED'&&original.orderId===order.id&&original.customerId===order.customerId&&original.targetVehicleId===assignment.vehicleId&&original.deliveryHandoverId===delivered.id&&delivered.changeId===original.id,409,'ASSIGNMENT_EVIDENCE_REQUIRED','原换车交付缺少已生效的同单变更');
 }
 return{chain,terms,account,assignment,qualification};
}

export async function offlineSwapEligibility(tx:any,order:any,at=new Date()){
 try{const {chain}=await requireOfflineSwapFacts(tx,order,undefined,at);return{ready:true,blockers:[] as string[],contractId:chain.original.contractId,originalArchiveVersionId:chain.original.archiveVersionId,priorTermsVersionId:chain.termsVersionId};}
 catch(error){if(error instanceof HttpException&&error.getStatus()===409)return{ready:false,blockers:[(error.getResponse() as any).error?.code||'SWAP_FACTS_REQUIRED'],contractId:null,originalArchiveVersionId:null,priorTermsVersionId:null};throw error;}
}
