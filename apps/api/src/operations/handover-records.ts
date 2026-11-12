import {newHandoverMode,isOnlineHandover,freezeOnlineRecord} from './online-handover';
import {requireVehicleUnrestricted} from '../vehicles/operational-restrictions';
import {assertNotAssetFiles} from '../files/asset-files';
import {deliveryReady} from '../orders/readiness';
import {lockOrder} from '../offline-documents/readiness';
import {effectiveTerms} from '../order-changes/context';
import {guardSwapHandover,offlineSwapRevisionFacts} from '../vehicle-changes/handovers';
import {ensure} from '../common/errors';
import {audit,hash,notify} from '../common/data';
export const handoverFileIds=(item:any):string[]=>[...new Set<string>([...(item.fileIds||[]),...(item.responseFileIds||[]),...(item.signedFileId?[item.signedFileId]:[])])];
const factLabels:Record<string,string>={actualTimeAndPlace:'实际交接时间与地点',batteryLevel:'交接时电量',accessoriesChecklist:'随车物品核对',conditionChecklist:'车辆状况核对',openItems:'未结事项',resolutionPlan:'处理方案',staffName:'现场工作人员'};
export function handoverChecklistView(rows:any){return Array.isArray(rows)?rows.map(row=>({...row,factKey:row.label,label:factLabels[row.label]||row.label})):rows;}

function handoverStateMessage(order:any,type:string){
 if(!order)return '订单不存在，请重新选择关联订单。';
 const labels:Record<string,string>={AWAITING_CONTRACT_REVIEW:'待合同审核',AWAITING_SIGNATURE:'待签约',AWAITING_PAYMENT:'待支付',AWAITING_HANDOVER:'待交付',ACTIVE:'用车中',SETTLING:'结算中',COMPLETED:'已完成',CANCELLED:'已取消'};
 const state=labels[order.status]||'不可办理交接';
 if(type==='DELIVERY'){
  if(order.status==='AWAITING_PAYMENT')return '当前订单待支付，暂不能办理交车。请先核对首期租金、约定押金及合同和保障条件，待订单进入“待交付”后再创建交车任务。';
  if(order.status==='ACTIVE')return '当前订单用车中，不能重复交车；归还车辆请选择“还车”任务。';
  return `当前订单${state}，仅“待交付”订单可办理交车。请在订单详情核对当前进度与办理条件。`;
 }
 if(['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status))return `当前订单${state}，尚未完成正式交车，不能办理还车。若不再用车，请在订单详情办理交付前取消。`;
 return `当前订单${state}，仅“用车中”订单可办理还车。请在订单详情核对交接及结算记录。`;
}

export async function guardHandoverOrder(tx:any,order:any,type:string,readingKm:number,physicalReturnOnly=false) {
 ensure(order&&(type==='DELIVERY'?order.status==='AWAITING_HANDOVER':order.status==='ACTIVE'),409,'STATE_CONFLICT',handoverStateMessage(order,type));
 await tx.order.update({where:{id:order.id},data:{revision:{increment:1}}});
 if(!(physicalReturnOnly&&type==='RETURN'&&order.contractMode==='ELECTRONIC'))ensure(await tx.orderChange.count({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}})===0,409,type==='DELIVERY'?'DELIVERY_CHANGE_PENDING':'ORDER_CHANGE_PENDING','订单变更尚未完成，不可交接');
 if(type==='RETURN') {
  if(await tx.vehicleAssignment.count({where:{orderId:order.id}}))ensure(order.currentAssignmentId,409,'NO_CURRENT_VEHICLE','当前没有已交付车辆');
  const known=order.currentAssignmentId?await tx.usageSegment.aggregate({where:{assignmentId:order.currentAssignmentId},_max:{endReadingKm:true}}):await tx.usagePeriod.aggregate({where:{orderId:order.id},_max:{endReadingKm:true}});
  ensure(readingKm>=(known._max.endReadingKm||0),409,'RETURN_READING_CONFLICT','归还读数低于当前有效月读数，请先核对更正未结算证据');
 }
 await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${order.vehicleId} FOR UPDATE`;
 const vehicle=await tx.vehicle.findUnique({where:{id:order.vehicleId}});
 ensure(vehicle?.reservedOrderId===order.id&&vehicle.status===(type==='DELIVERY'?'RESERVED':'IN_USE'),409,'VEHICLE_OWNERSHIP','车辆已不归属当前订单');
 if(type==='DELIVERY')await requireVehicleUnrestricted(tx,order.vehicleId,'DELIVERY');
 ensure(readingKm>=Math.max(order.confirmedMileageKm,vehicle.mileageKm),409,'MILEAGE_REGRESSION','交接里程不可低于已确认里程');
}
async function checkFiles(tx:any,ids:string[],customerId:string,fieldTaskId?:string|null) {
 const where=fieldTaskId?{fieldTaskId}:{OR:[{customerId},{customerId:null}]};
 ensure(await tx.storedFile.count({where:{id:{in:ids},...where}})===new Set(ids).size,403,'FILE_OWNERSHIP','附件归属无效');
 await assertNotAssetFiles(tx,ids);
}
export async function createHandoverRecord(tx:any,input:any,actorId:string,fieldTaskId?:string) {
 const order=await tx.order.findUnique({where:{id:input.orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
 await guardHandoverOrder(tx,order,input.type,input.readingKm,true);
 ensure(!await tx.handover.count({where:{orderId:order.id,type:input.type,status:{not:'SUPERSEDED'}}}),409,'HANDOVER_EXISTS','已有进行中的交接单');
 await checkFiles(tx,input.fileIds,order.customerId,fieldTaskId);
 const terms=await effectiveTerms(tx,order);ensure(terms?.commercialTerms?.vehicleIdentification,409,'TERMS_MISSING','请先完整确认本单车辆身份');
 const facts={...input,vehicleId:order.vehicleId,assignmentId:order.currentAssignmentId,checklist:[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),{label:'车辆身份',value:terms.commercialTerms.vehicleIdentification}]};
 const item=await tx.handover.create({data:{...facts,...await newHandoverMode(tx,order.contractMode),executionMode:order.contractMode,fieldTaskId,actualAt:new Date(input.actualAt),customerId:order.customerId,manifestHash:hash(facts)}});
 await audit(tx,actorId,'CREATE','handovers',item.id);return item;
}
export async function reviseHandoverRecord(tx:any,id:string,input:any,actorId:string,requiredFieldTaskId?:string) {
 const old=await tx.handover.findUnique({where:{id},include:{order:true}});ensure(old?.status==='OBJECTION_SUBMITTED',409,'STATE_CONFLICT','仅异议交接单可修订');
 await assertNotAssetFiles(tx,handoverFileIds(old));
 const swapRevision=old.changeId&&old.executionMode==='OFFLINE'?await offlineSwapRevisionFacts(tx,old,input,requiredFieldTaskId):null;
 if(!swapRevision){if(old.changeId)await guardSwapHandover(tx,{...old,...input,actualAt:new Date(input.actualAt)});else await guardHandoverOrder(tx,old.order,old.type,input.readingKm,true);}
 await checkFiles(tx,input.fileIds,old.customerId,requiredFieldTaskId);
 const identity=(old.checklist as any[])?.find?.(x=>x.label==='车辆身份');const checklist=swapRevision?.checklist??(identity?[...input.checklist.filter((x:any)=>x.label!=='车辆身份'),identity]:input.checklist);
 const facts={...input,checklist,vehicleId:old.vehicleId,assignmentId:old.assignmentId,changeId:old.changeId,previousHandoverId:old.id,revision:old.revision+1};
 const next=await tx.handover.create({data:{...facts,...(isOnlineHandover(old)?await newHandoverMode(tx,old.executionMode):{}),confirmationMode:old.confirmationMode,executionMode:old.executionMode,actualAt:new Date(input.actualAt),orderId:old.orderId,customerId:old.customerId,type:old.type,fieldTaskId:old.fieldTaskId,resolvedBy:actorId,manifestHash:swapRevision?.manifestHash??hash(facts)}});
 await tx.handover.update({where:{id},data:{status:'SUPERSEDED'}});
 if(old.changeId)await tx.orderChange.update({where:{id:old.changeId},data:{[old.type==='SWAP_RETURN'?'returnHandoverId':'deliveryHandoverId']:next.id,revision:{increment:1}}});
 await audit(tx,actorId,'RESOLVE_OBJECTION','handovers',id,{nextHandoverId:next.id,resolutionNote:input.resolutionNote});return next;
}
export async function publishHandoverRecord(tx:any,id:string,actorId:string) {
 const reference=await tx.handover.findUnique({where:{id}});ensure(reference,404,'NOT_FOUND','交接单不存在');await lockOrder(tx,reference.orderId);const item=await tx.handover.findUnique({where:{id}});ensure(item?.status==='DRAFT',409,'STATE_CONFLICT','交接单不可发布');
 await assertNotAssetFiles(tx,handoverFileIds(item));
 if(item.changeId&&isOnlineHandover(item))await guardSwapHandover(tx,item);
 if(['OFFLINE','ELECTRONIC'].includes(item.executionMode)&&item.type==='DELIVERY')ensure(await deliveryReady(tx,item.orderId,item.executionMode==='ELECTRONIC'?item.actualAt??undefined:undefined),409,'HANDOVER_NOT_READY','合同、资金或保障资料已变化，请处理后发布交车查验');
 const online=isOnlineHandover(item)?await freezeOnlineRecord(tx,item,actorId):{};
 const updated=await tx.handover.update({where:{id},data:{status:'PUBLISHED',...online}});
 await audit(tx,actorId,'PUBLISH','handovers',id);await notify(tx,item.customerId,'请核对交接事实','阅读交接证据，确认或提出异议。','handovers',id);return updated;
}
