import {hash,audit} from '../common/data';
import {ensure} from '../common/errors';
import {buildOfflineSwapQuoteSource} from './offline-quote-preview';
import {reserveCredit} from './credits';
import {assertOfflineSwapQuote} from './offline-target';
/** Existing command owner checks authority/idempotency/CAS; source is recomputed under its locks. */
export async function createOfflineSwapQuote(tx:any,change:any,raw:unknown,actor:any){
 const built=await buildOfflineSwapQuoteSource(tx,change,raw,actor),{input,order,active,repricing,previousHolds,completedReturn,target,funds}=built;
 ensure(input.previewHash===undefined||input.previewHash===built.previewHash,409,'SWAP_PREVIEW_CHANGED','报价来源或已核对的输入已变化，请保留内容并重新预览');
 const snapshot={...built.snapshot,...(input.previewHash?{previewHash:built.previewHash}:{})},expires=new Date(input.expiresAt);
 const revision=((await tx.delayQuote.aggregate({where:{changeId:change.id},_max:{revision:true}}))._max.revision||0)+1;
 // Only this change's genuine v2 quote may reuse/reselect its reserved capacity.
 // Unknown/legacy reservations still require explicit recovery, never silent release.
 const reservations=await tx.swapReservation.findMany({where:{changeId:change.id,status:'RESERVED'}});
 if(reservations.length){
  ensure(reservations.length===1&&active?.changeId===change.id&&active.snapshot?.pricingVersion===2&&reservations.every((r:any)=>r.changeId===change.id&&r.orderId===order.id),409,'OFFLINE_SWAP_REPRICE_REQUIRED','原换车次数预占缺少本单唯一新版报价依据，请先核对原流程');
  assertOfflineSwapQuote(change,active);
 }
 if(repricing)for(const id of [change.returnHandoverId,change.deliveryHandoverId].filter(Boolean)){const h=await tx.handover.findUnique({where:{id}});ensure(h&&h.changeId===change.id&&h.orderId===order.id&&h.customerId===order.customerId,409,'SWAP_OWNERSHIP','原交接归属不一致');if(h.status==='COMPLETED'){ensure(h.type==='SWAP_RETURN',409,'PHYSICAL_FACT_IMMUTABLE','已经完成的新车交付不得重报');continue;}ensure(h.executionMode==='OFFLINE'&&h.signatureStatus==='DRAFT'&&!h.providerTaskId&&!h.signingLeaseUntil&&['DRAFT','OBJECTION_SUBMITTED','SUPERSEDED'].includes(h.status),409,'HANDOVER_IN_FLIGHT','已确认或归档中的交接须先核对，不可直接重报');if(h.status!=='SUPERSEDED'){await tx.handover.update({where:{id},data:{status:'SUPERSEDED'}});await audit(tx,actor.id,'SUPERSEDED_BY_OFFLINE_SWAP_REPRICE','handovers',id,{changeId:change.id,quoteId:active.id,manifestHash:h.manifestHash});}}
 for(const hold of previousHolds){await tx.vehicle.updateMany({where:{id:hold.vehicleId,holdId:hold.id},data:{holdId:null}});await tx.vehicleHold.update({where:{id:hold.id},data:{status:'RELEASED',releasedAt:new Date()}});}
 if(active)await tx.delayQuote.update({where:{id:active.id},data:{status:'SUPERSEDED'}});
 const quote=await tx.delayQuote.create({data:{changeId:change.id,revision,commercialHash:hash({priorTermsHash:change.priorTermsHash,snapshot}),snapshot,fundsSnapshot:funds.rows,createdBy:actor.id}});
 const hold=await tx.vehicleHold.create({data:{vehicleId:target.id,orderId:order.id,changeId:change.id,quoteId:quote.id,expiresAt:expires}});await tx.vehicle.update({where:{id:target.id},data:{holdId:hold.id,updatedAt:new Date()}});
 await reserveCredit(tx,order,await tx.usageAccount.findUniqueOrThrow({where:{orderId:order.id}}),change.id,new Date(input.plannedDeliveryAt),target.id);
 await tx.orderChange.update({where:{id:change.id},data:{activeQuoteId:quote.id,targetVehicleId:target.id,status:'REVIEW_PENDING',...(repricing?{returnHandoverId:completedReturn?.status==='COMPLETED'?completedReturn.id:null,deliveryHandoverId:null}:{})}});
}
