import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
export const workDay=(now:Date)=>new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
export const iso=(value:any)=>value?new Date(value).toISOString():null;
export const date=(value:any)=>value?new Date(value).toISOString().slice(0,10):null;
const sameTime=(left:any,right:any)=>left&&right&&new Date(left).getTime()===new Date(right).getTime();
const sourceVerified=(condition:unknown,message:string)=>ensure(condition,409,'SERVICE_SOURCE_UNVERIFIED',message);
const completedFor=(handover:any,assignment:any)=>handover&&handover.status==='COMPLETED'&&handover.orderId===assignment.orderId&&handover.customerId===assignment.customerId&&handover.vehicleId===assignment.vehicleId&&handover.assignmentId===assignment.id;
async function swapChangeFor(tx:any,handover:any){
 const change=handover.changeId?await tx.orderChange.findUnique({where:{id:handover.changeId}}):null;
 sourceVerified(change?.kind==='VEHICLE_CHANGE'&&change.orderId===handover.orderId&&change.customerId===handover.customerId,'换车事实缺少同单同人的真实换车来源');
 return change;
}
async function verifySwapReturn(tx:any,returned:any,assignment:any){
 sourceVerified(completedFor(returned,assignment)&&returned.type==='SWAP_RETURN'&&assignment.status==='CLOSED'&&assignment.returnHandoverId===returned.id&&sameTime(returned.actualAt,assignment.endAt)&&returned.readingKm===assignment.endReadingKm,'换出归还与原车辆归属不一致');
 const change=await swapChangeFor(tx,returned);
 sourceVerified(['SWAP_RETURNED','APPLIED'].includes(change.status)&&change.returnHandoverId===returned.id,'换出归还不是该换车的有效完成事实');
 return change;
}
async function verifySourceDelivery(tx:any,delivery:any,assignment:any){
 sourceVerified(completedFor(delivery,assignment)&&sameTime(delivery.actualAt,assignment.startAt)&&delivery.readingKm===assignment.startReadingKm,'原交车事实与车辆归属不一致');
 if(delivery.type==='DELIVERY'){
  sourceVerified(assignment.changeId==null&&delivery.changeId==null,'初次交车不得冒认换车归属');return;
 }
 sourceVerified(delivery.type==='SWAP_DELIVERY'&&!!assignment.changeId&&assignment.changeId===delivery.changeId,'换入交车缺少对应的换车归属');
 const change=await swapChangeFor(tx,delivery);
 sourceVerified(change.status==='APPLIED'&&change.targetVehicleId===assignment.vehicleId&&change.deliveryHandoverId===delivery.id&&sameTime(change.actualCompletedAt,delivery.actualAt),'换入交车不是该换车的有效完成事实');
 const returned=change.returnHandoverId?await tx.handover.findUnique({where:{id:change.returnHandoverId}}):null;
 const old=returned?.assignmentId?await tx.vehicleAssignment.findUnique({where:{id:returned.assignmentId}}):null;
 sourceVerified(old&&returned.changeId===change.id&&old.orderId===assignment.orderId&&old.customerId===assignment.customerId&&returned.actualAt<=delivery.actualAt,'换入交车缺少先前同单同人的换出事实');
 await verifySwapReturn(tx,returned,old);
}
export async function serviceSourceSnapshot(tx:any,sourceId:string|null,vehicleId:string,eventAt:Date){
 if(sourceId===null)return null;
 const source=await tx.serviceRequest.findUnique({where:{id:sourceId}});ensure(source,404,'NOT_FOUND','来源客户服务不存在');
 const order=await tx.order.findUnique({where:{id:source.orderId}});ensure(order&&order.customerId===source.customerId,409,'SERVICE_SOURCE_UNVERIFIED','服务来源客户及订单不一致');
 const assignments=await tx.vehicleAssignment.findMany({where:{orderId:source.orderId,customerId:source.customerId,startAt:{lte:eventAt},OR:[{endAt:null},{endAt:{gt:eventAt}}]}});
 ensure(assignments.length===1&&assignments[0].vehicleId===vehicleId,409,'SERVICE_SOURCE_UNVERIFIED','事件时点缺少本车唯一有效交接归属，核实前可独立建工单');
 const assignment=assignments[0],delivery=assignment.deliveryHandoverId?await tx.handover.findUnique({where:{id:assignment.deliveryHandoverId}}):null;
 await verifySourceDelivery(tx,delivery,assignment);
 if(assignment.status==='CLOSED'){
  const returned=assignment.returnHandoverId?await tx.handover.findUnique({where:{id:assignment.returnHandoverId}}):null;
  ensure(assignment.endAt&&completedFor(returned,assignment)&&sameTime(returned.actualAt,assignment.endAt)&&returned.readingKm===assignment.endReadingKm,409,'SERVICE_SOURCE_UNVERIFIED','历史归属缺少完整还车事实');
  if(returned.type==='SWAP_RETURN')await verifySwapReturn(tx,returned,assignment);
  else sourceVerified(returned.type==='RETURN'&&returned.changeId==null,'历史归属还车类型或来源不一致');
 }else ensure(assignment.status==='ACTIVE'&&assignment.endAt===null&&assignment.returnHandoverId===null,409,'SERVICE_SOURCE_UNVERIFIED','车辆分配状态不完整');
 return{serviceRequestId:source.id,orderId:order.id,customerId:source.customerId,assignmentId:assignment.id,vehicleId,eventAt:eventAt.toISOString(),assignmentStartAt:iso(assignment.startAt),assignmentEndAt:iso(assignment.endAt),deliveryHandoverId:delivery.id,returnHandoverId:assignment.returnHandoverId};
}
/** Read trusted per-vehicle facts, never copy a reading into customer usage. */
export async function trustedVehicleReading(tx:any,vehicle:any,now:Date){
 let readingKm=vehicle.mileageKm,readingAsOf=iso(vehicle.updatedAt)||now.toISOString();
 ensure(Number.isInteger(readingKm)&&readingKm>=0,409,'MILEAGE_SOURCE_INVALID','车辆当前里程事实无效');
 const consider=(amount:any,at:any)=>{if(Number.isInteger(amount)&&amount>=readingKm&&at&&new Date(at)<=now){readingKm=amount;readingAsOf=iso(at)!;}};
 const handovers=await tx.handover.findMany({where:{vehicleId:vehicle.id,status:'COMPLETED',actualAt:{lte:now}}});
 for(const handover of handovers)consider(handover.readingKm,handover.actualAt);
 const assignments=await tx.vehicleAssignment.findMany({where:{vehicleId:vehicle.id}});
 if(assignments.length){const approved=await tx.mileage.findMany({where:{status:'APPROVED',recordedAt:{lte:now},OR:assignments.map((assignment:any)=>({assignmentId:assignment.id,orderId:assignment.orderId,customerId:assignment.customerId}))}});for(const item of approved)consider(item.readingKm,item.recordedAt);}
 const schedule=await tx.vehicleMaintenanceSchedule.findUnique({where:{vehicleId:vehicle.id}});if(schedule?.lastCompletedOn)consider(schedule.lastMileageKm,schedule.lastCompletedOn);
 return{readingKm,readingAsOf};
}
export async function financialWorkOrderState(tx:any,workOrderId:string){
 const lines=await tx.assetWorkOrderCost.findMany({where:{workOrderId},select:{id:true,status:true}});
 const plans=lines.length?await tx.assetCostPlan.findMany({where:{sourceKind:'WORK_ORDER',workOrderCostId:{in:lines.map((line:any)=>line.id)}},select:{id:true,status:true}}):[];
 const entries=plans.length?await tx.assetCostEntry.findMany({where:{planId:{in:plans.map((plan:any)=>plan.id)}},select:{id:true,effect:true,reversalOfId:true}}):[];
 const reversed=new Set(entries.filter((entry:any)=>entry.effect==='REVERSAL').map((entry:any)=>entry.reversalOfId));
 return{hasAny:lines.length>0,pending:lines.some((line:any)=>line.status==='DRAFT')||plans.some((plan:any)=>plan.status==='SCHEDULED'),effective:entries.some((entry:any)=>entry.effect==='COST'&&!reversed.has(entry.id))};
}
export function assertFrozenEvidence(actual:any[],expected:unknown){ensure(Array.isArray(expected)&&canonicalHash(actual)===canonicalHash(expected),409,'WORK_ORDER_EVIDENCE_CHANGED','原提交证据已变化，请退回处理并重新提交');}
