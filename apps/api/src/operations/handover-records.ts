import {effectiveTerms} from '../order-changes/context';
import {guardSwapHandover} from '../vehicle-changes/handovers';
import {ensure} from '../common/errors';
import {audit,hash,notify} from '../common/data';
const factLabels:Record<string,string>={actualTimeAndPlace:'实际交接时间与地点',batteryLevel:'交接时电量',accessoriesChecklist:'随车物品核对',conditionChecklist:'车辆状况核对',openItems:'未结事项',resolutionPlan:'处理方案',staffName:'现场工作人员'};
export function handoverChecklistView(rows:any){return Array.isArray(rows)?rows.map(row=>({...row,factKey:row.label,label:factLabels[row.label]||row.label})):rows;}

export async function guardHandoverOrder(tx:any,order:any,type:string,readingKm:number) {
 ensure(order&&(type==='DELIVERY'?order.status==='AWAITING_HANDOVER':order.status==='ACTIVE'),409,'STATE_CONFLICT','订单状态不允许此次交接');
 await tx.order.update({where:{id:order.id},data:{revision:{increment:1}}});
 ensure(await tx.orderChange.count({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}})===0,409,type==='DELIVERY'?'DELIVERY_CHANGE_PENDING':'ORDER_CHANGE_PENDING','订单变更尚未完成，不可交接');
 if(type==='RETURN') {
  if(await tx.vehicleAssignment.count({where:{orderId:order.id}}))ensure(order.currentAssignmentId,409,'NO_CURRENT_VEHICLE','当前没有已交付车辆');
  const known=order.currentAssignmentId?await tx.usageSegment.aggregate({where:{assignmentId:order.currentAssignmentId},_max:{endReadingKm:true}}):await tx.usagePeriod.aggregate({where:{orderId:order.id},_max:{endReadingKm:true}});
  ensure(readingKm>=(known._max.endReadingKm||0),409,'RETURN_READING_CONFLICT','归还读数低于当前有效月读数，请先核对更正未结算证据');
 }
 const vehicle=await tx.vehicle.findUnique({where:{id:order.vehicleId}});
 ensure(vehicle?.reservedOrderId===order.id&&vehicle.status===(type==='DELIVERY'?'RESERVED':'IN_USE'),409,'VEHICLE_OWNERSHIP','车辆已不归属当前订单');
 ensure(readingKm>=Math.max(order.confirmedMileageKm,vehicle.mileageKm),409,'MILEAGE_REGRESSION','交接里程不可低于已确认里程');
}
async function checkFiles(tx:any,ids:string[],customerId:string,fieldTaskId?:string|null) {
 const where=fieldTaskId?{fieldTaskId}:{OR:[{customerId},{customerId:null}]};
 ensure(await tx.storedFile.count({where:{id:{in:ids},...where}})===new Set(ids).size,403,'FILE_OWNERSHIP','附件归属无效');
}
export async function createHandoverRecord(tx:any,input:any,actorId:string,fieldTaskId?:string) {
 const order=await tx.order.findUnique({where:{id:input.orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
 await guardHandoverOrder(tx,order,input.type,input.readingKm);
 ensure(!await tx.handover.count({where:{orderId:order.id,type:input.type,status:{not:'SUPERSEDED'}}}),409,'HANDOVER_EXISTS','已有进行中的交接单');
 await checkFiles(tx,input.fileIds,order.customerId,fieldTaskId);
 const terms=await effectiveTerms(tx,order);ensure(terms?.commercialTerms?.vehicleIdentification,409,'TERMS_MISSING','请先完整确认本单车辆身份');
 const facts={...input,vehicleId:order.vehicleId,assignmentId:order.currentAssignmentId,checklist:[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),{label:'车辆身份',value:terms.commercialTerms.vehicleIdentification}]};
 const item=await tx.handover.create({data:{...facts,fieldTaskId,actualAt:new Date(input.actualAt),customerId:order.customerId,manifestHash:hash(facts)}});
 await audit(tx,actorId,'CREATE','handovers',item.id);return item;
}
export async function reviseHandoverRecord(tx:any,id:string,input:any,actorId:string,requiredFieldTaskId?:string) {
 const old=await tx.handover.findUnique({where:{id},include:{order:true}});ensure(old?.status==='OBJECTION_SUBMITTED',409,'STATE_CONFLICT','仅异议交接单可修订');
 if(old.changeId)await guardSwapHandover(tx,{...old,...input,actualAt:new Date(input.actualAt)});else await guardHandoverOrder(tx,old.order,old.type,input.readingKm);
 await checkFiles(tx,input.fileIds,old.customerId,requiredFieldTaskId);
 const identity=(old.checklist as any[])?.find?.(x=>x.label==='车辆身份');const checklist=identity?[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),identity]:input.checklist;
 const facts={...input,checklist,vehicleId:old.vehicleId,assignmentId:old.assignmentId,changeId:old.changeId,previousHandoverId:old.id,revision:old.revision+1};
 const next=await tx.handover.create({data:{...facts,actualAt:new Date(input.actualAt),orderId:old.orderId,customerId:old.customerId,type:old.type,fieldTaskId:old.fieldTaskId,resolvedBy:actorId,manifestHash:hash(facts)}});
 await tx.handover.update({where:{id},data:{status:'SUPERSEDED'}});
 if(old.changeId)await tx.orderChange.update({where:{id:old.changeId},data:{[old.type==='SWAP_RETURN'?'returnHandoverId':'deliveryHandoverId']:next.id,revision:{increment:1}}});
 await audit(tx,actorId,'RESOLVE_OBJECTION','handovers',id,{nextHandoverId:next.id,resolutionNote:input.resolutionNote});return next;
}
export async function publishHandoverRecord(tx:any,id:string,actorId:string) {
 const item=await tx.handover.findUnique({where:{id}});ensure(item?.status==='DRAFT',409,'STATE_CONFLICT','交接单不可发布');
 const updated=await tx.handover.update({where:{id},data:{status:'PUBLISHED'}});
 await audit(tx,actorId,'PUBLISH','handovers',id);await notify(tx,item.customerId,'请核对交接事实','阅读交接证据，确认或提出异议。','handovers',id);return updated;
}
