import {requireOnlineConfirmation} from '../operations/online-handover';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {requireElectronicSwapChain} from '../vehicle-changes/electronic-source';
import {readServiceStage} from '../order-service-stages/readiness';
import {servicePeriods,remainingRentCents} from '../service-calendar/rules';
import {currentPhysicalReceipt} from '../offline-documents/vehicle-receipt';
import {currentSwapReceipt} from '../vehicle-changes/swap-receipt';
import {requireElectronicSwapAgreement} from '../vehicle-changes/electronic-archive';
import {cancellation04Source} from './cancellation04-source';

export async function terminationSource(tx:any,orderId:string):Promise<any>{
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order?.contractMode==='ELECTRONIC',404,'NOT_FOUND');
 if(!order.serviceAnchor){const s=await cancellation04Source(tx,orderId);return{...s,pin:{...s.pin,scope:'NEVER_DELIVERED',periods:[],monthlyFeeAmount:0},sourceHash:canonicalHash({...s.pin,scope:'NEVER_DELIVERED',periods:[],monthlyFeeAmount:0})};}
 const chain=await requireElectronicSwapChain(tx,order),original=await tx.contract.findUniqueOrThrow({where:{id:chain.original.contractId},include:{electronicTask:true}}),task=original.electronicTask;
 const terms=order.effectiveTermsVersionId?(await tx.orderTermsVersion.findUniqueOrThrow({where:{id:order.effectiveTermsVersionId}})).snapshot:order.finalPlanSnapshot;
 const rows=await tx.orderServiceStage.findMany({where:{orderId,status:{in:['ACTIVE','ENDED']}},orderBy:{sequence:'asc'}}),periods=[];
 for(const row of rows){const s=await readServiceStage(tx,order,row.id);for(const p of s.snapshot.billingSchedule)periods.push({sequence:p.sequence,startDate:p.startDate,endDate:p.endDate,amount:p.amount,stageId:row.id,stageKind:row.kind,stageHash:row.snapshotHash});}
 ensure(periods.length>0,409,'TERMINATION_PERIOD_SOURCE');
 const initial=rows.find((r:any)=>r.kind==='INITIAL'),assignment=initial?await tx.vehicleAssignment.findUnique({where:{id:initial.assignmentId}}):null,delivery=assignment?.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null;ensure(delivery?.type==='DELIVERY'&&delivery.status==='COMPLETED'&&delivery.orderId===order.id&&delivery.customerId===order.customerId&&delivery.assignmentId===assignment.id&&delivery.actualAt?.getTime()===assignment.startAt.getTime(),409,'TERMINATION_INITIAL_SOURCE');await requireOnlineConfirmation(tx,delivery);
 const calendar=servicePeriods(order.serviceAnchor,1,periods.length);ensure(periods.every((p,i)=>p.sequence===calendar[i].index&&p.startDate===calendar[i].startDay&&p.endDate===calendar[i].endDayExclusive),409,'TERMINATION_PERIOD_SOURCE');
 // Applied03 prices are frozen and effective only after actual replacement delivery.
 const versions=await tx.orderTermsVersion.findMany({where:{orderId},orderBy:{version:'asc'},include:{quote:{include:{change:true}}}});
 for(const v of versions.filter((v:any)=>v.quote.change.kind==='VEHICLE_CHANGE'&&v.quote.change.status==='APPLIED')){const at=new Date(v.effectiveAt.getTime()+8*3600000).toISOString().slice(0,10),stage=rows.find((r:any)=>r.startDate.toISOString().slice(0,10)<=at&&at<r.endDate.toISOString().slice(0,10));ensure(stage&&(!v.snapshot.serviceStageId||v.snapshot.serviceStageId===stage.id),409,'TERMINATION_PRICE_STAGE_SOURCE');for(const p of periods){if(p.stageId===stage.id&&Date.parse(p.endDate+'T00:00:00+08:00')>v.effectiveAt.getTime())p.amount=v.snapshot.monthlyFeeAmount;}}
 const partial=order.currentAssignmentId?null:await terminationCustody(tx,order),partialSwap=partial?.kind==='PARTIAL_SWAP'?{...partial,receivedAt:partial.receivedAt.toISOString(),agreement:await requireElectronicSwapAgreement(tx,await tx.orderChange.findUniqueOrThrow({where:{id:partial.changeId}}))}:null;
 const pin={partialSwap,serviceStartedAt:delivery.actualAt.toISOString(),scope:'ACTUAL_SERVICE',orderId,customerId:order.customerId,ownerId:task.ownerId,platformSubjectId:task.platformSubjectId,vehicleId:order.vehicleId,originalContractId:original.id,originalTaskId:task.id,originalArchiveVersionId:chain.original.archiveVersionId,chain,serviceAnchor:order.serviceAnchor,periods,monthlyFeeAmount:terms.monthlyFeeAmount,depositAmount:order.finalPlanSnapshot.depositAmount,termsHash:canonicalHash(terms),cooperationVersionId:terms.lessorSnapshot.agreementVersionId};
 ensure(Number.isSafeInteger(pin.monthlyFeeAmount)&&pin.monthlyFeeAmount>0,409,'TERMINATION_PRICE_SOURCE');
 return{order,contract:original,task,version:await tx.archiveVersion.findUniqueOrThrow({where:{id:pin.originalArchiveVersionId}}),pin,sourceHash:canonicalHash(pin)};
}
export async function terminationCustody(tx:any,order:any):Promise<any>{
 const ordinary=await currentPhysicalReceipt(tx,order.id);if(ordinary){ensure(ordinary.vehicleId===order.vehicleId,409,'TERMINATION_RECEIPT_SOURCE');return{kind:'RETURN',id:ordinary.id,revision:ordinary.revision,hash:ordinary.factHash??ordinary.requestHash,receivedAt:ordinary.receivedAt,readingKm:ordinary.readingKm,handoverId:ordinary.handoverId,assignmentId:ordinary.assignmentId};}
 if(order.currentAssignmentId)return null;
 const change=await tx.orderChange.findFirst({where:{orderId:order.id,kind:'VEHICLE_CHANGE',status:{in:['SWAP_RETURNED','CANCELLED']}},orderBy:{createdAt:'desc'}});if(!change)return null;
 if(change.status==='CANCELLED')ensure(await tx.terminationFact.findFirst({where:{kind:'DEPENDENCIES_RELEASED',payload:{path:['changeId'],equals:change.id}}}),409,'TERMINATION_PARTIAL_CHANGED');
 const event=await currentSwapReceipt(tx,change.id,true);ensure(event,409,'TERMINATION_RECEIPT_SOURCE');const a=await tx.vehicleAssignment.findUniqueOrThrow({where:{id:event.assignmentId}}),delivery=change.deliveryHandoverId?await tx.handover.findUnique({where:{id:change.deliveryHandoverId}}):null;
 await requireElectronicSwapAgreement(tx,change);
 ensure(a.orderId===order.id&&a.customerId===order.customerId&&a.vehicleId===order.vehicleId&&a.status==='CLOSED'&&a.endAt?.getTime()===event.receivedAt.getTime()&&a.returnHandoverId===event.handoverId&&(!delivery||delivery.status!=='COMPLETED'),409,'TERMINATION_RECEIPT_SOURCE');
 return{kind:'PARTIAL_SWAP',id:event.id,revision:event.revision,hash:event.factHash,receivedAt:event.receivedAt,readingKm:event.readingKm,handoverId:event.handoverId,assignmentId:a.id,changeId:change.id,quoteId:change.activeQuoteId,targetVehicleId:change.targetVehicleId};
}
export function terminationAmounts(pin:any,receivedAt:Date,reasonKind:string,earlierStopAt?:string){
 const periodEnd=new Date(pin.periods.at(-1).endDate+'T00:00:00+08:00'),stopAt=new Date(Math.min(receivedAt.getTime(),periodEnd.getTime(),earlierStopAt?Date.parse(earlierStopAt):Infinity));
 const periods=pin.periods.map((p:any)=>({index:p.sequence,startDay:p.startDate,endDayExclusive:p.endDate})),rates=pin.periods.map((p:any)=>p.amount);
 const remainingRentAmount=remainingRentCents(periods,rates,stopAt);
 return{stopAt:stopAt.toISOString(),originalEndAt:periodEnd.toISOString(),remainingRentAmount,compensationAmount:reasonKind==='PERSONAL'?Math.min(pin.monthlyFeeAmount,remainingRentAmount):0,actualReceiptAt:receivedAt.toISOString(),formula:'V31_EXACT_DURATION_SERVICE_MONTH',postExpiryOccupancyClaimRequired:receivedAt>periodEnd};
}
