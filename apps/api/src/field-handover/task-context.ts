import {currentSwapReceipt} from '../vehicle-changes/swap-receipt';
import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import type {StaffActor} from '../auth/staff.types';
import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
import {deriveFieldHandoverBatch,fieldBatchInput,fieldBatchOccupancy,legacyFieldTaskBatch,type FieldBatchFacts,type FieldHandoverBatch} from './batches';

export type FieldActor=StaffActor|string;
export const fieldId=z.string().trim().min(1).max(128).refine(v=>!v.includes('\0'),'编号不得含空字符');
export const fieldNote=z.string().trim().max(500).refine(v=>!v.includes('\0'),'说明不得含空字符');
export const assignmentInput=fieldBatchInput.safeExtend({assigneeId:fieldId,note:fieldNote.default('')});
/** Internal ID-only callers are reloaded explicitly; HTTP controllers always pass the session principal. */
export async function fieldActor(tx:any,actor:FieldActor,field:boolean,write=true){
 ensure(actor,403,'STAFF_SESSION_CHANGED','请重新登录');
 const supplied=typeof actor==='string'?await tx.adminUser.findUnique({where:{id:actor}}):actor;
 ensure(supplied?.id&&supplied.role,403,'STAFF_SESSION_CHANGED','人员权限已变化，请重新登录');
 const current=await requireCurrentStaff(tx,supplied,field?'field-tasks':'handover-tasks',write);
 ensure(!field||current.role==='FIELD',403,'FORBIDDEN','仅现场账号可访问本人任务');return current;
}
export async function lockFieldOrder(tx:any,orderId:string){await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;}
export async function lockFieldTask(tx:any,id:string){
 const initial=await tx.fieldHandoverTask.findUnique({where:{id}});ensure(initial,404,'NOT_FOUND','任务不存在');
 await lockFieldOrder(tx,initial.orderId);await tx.$queryRaw`SELECT id FROM "FieldHandoverTask" WHERE id=${id} FOR UPDATE`;
 const task=await tx.fieldHandoverTask.findUnique({where:{id}});ensure(task&&task.orderId===initial.orderId,409,'VERSION_CONFLICT','任务已变化');return task;
}
export async function loadFieldFacts(tx:any,orderId:string):Promise<FieldBatchFacts>{
 const order=await tx.order.findUnique({where:{id:orderId}});ensure(order,404,'NOT_FOUND','订单不存在');
 const [termsVersions,changes,quotes,assignments,handovers,tasks]=await Promise.all([
  tx.orderTermsVersion.findMany({where:{orderId}}),tx.orderChange.findMany({where:{orderId}}),tx.delayQuote.findMany({where:{change:{orderId}}}),
  tx.vehicleAssignment.findMany({where:{orderId}}),tx.handover.findMany({where:{orderId}}),tx.fieldHandoverTask.findMany({where:{orderId}})
 ]);const swapReceipts=order.contractMode==='ELECTRONIC'?(await Promise.all(changes.filter((c:any)=>c.kind==='VEHICLE_CHANGE').map((c:any)=>currentSwapReceipt(tx,c.id,true)))).filter(Boolean):[];return{order,termsVersions,changes,quotes,assignments,handovers,tasks,swapReceipts};
}
export function taskHandover(task:any,facts:FieldBatchFacts){
 if(!task.currentHandoverId)return null;
 const h=facts.handovers.find(row=>row.id===task.currentHandoverId);
 ensure(h&&h.orderId===task.orderId&&h.customerId===facts.order.customerId&&h.vehicleId===task.vehicleId&&h.type===task.type&&(h.changeId??null)===(task.changeId??null)&&h.fieldTaskId===task.id,409,'FIELD_TASK_FACTS_MISMATCH','原交接事实与任务归属不一致，请由运营核对');return h;
}
export function taskSource(task:any,facts:FieldBatchFacts){
 taskHandover(task,facts);
 const legacy=!task.batchKey||task.batchKey.startsWith('LEGACY:');
 if(!fieldBatchInput.safeParse({orderId:task.orderId,type:task.type,changeId:task.changeId??null}).success)return{batch:null,contextChanged:true,blockers:['FIELD_BATCH_SOURCE_INVALID']};
 try{
  const batch=deriveFieldHandoverBatch({orderId:task.orderId,type:task.type,changeId:task.changeId??null},facts);
  if(legacy){const old=legacyFieldTaskBatch(task,facts);if(!old.resolved||old.batchKey!==batch.batchKey||task.type==='RETURN'&&!task.vehicleAssignmentId)return{batch,contextChanged:true,blockers:['FIELD_BATCH_LEGACY_REVIEW_REQUIRED']};}
  const same=(legacy||task.batchKey===batch.batchKey)&&task.vehicleId===batch.vehicleId&&(task.vehicleAssignmentId??null)===batch.vehicleAssignmentId&&(task.changeId??null)===batch.changeId&&(task.quoteId??null)===batch.quoteId&&(task.termsVersionId??null)===batch.termsVersionId;
  const handoverMatches=(task.currentHandoverId??null)===batch.currentHandoverId;
  return{batch,contextChanged:!same||!handoverMatches,blockers:same&&handoverMatches?[]:['FIELD_BATCH_SOURCE_CHANGED']};
 }catch(error){
  const code=error instanceof HttpException?(error.getResponse() as any)?.error?.code:null;
  if(typeof code==='string'&&code.startsWith('FIELD_BATCH_'))return{batch:null,contextChanged:true,blockers:[code]};throw error;
 }
}
export function unoccupiedTaskBatch(batch:FieldHandoverBatch,facts:FieldBatchFacts,task?:any){
 const result=fieldBatchOccupancy(batch,{...facts,tasks:facts.tasks.filter(t=>t.id!==task?.id),handovers:facts.handovers.filter(h=>h.id!==task?.currentHandoverId)});
 ensure(!result.existingTaskIds.length,409,'TASK_EXISTS','该交接批次已有任务，请核对原任务');
 ensure(!result.blockers.length,409,'HANDOVER_EXISTS','已有交接事实或历史批次来源尚未核清，请核对原记录');return result;
}
export async function taskMinimumReading(tx:any,task:any,order:any,vehicle:any){
 const own=task.vehicleAssignmentId?await tx.vehicleAssignment.findUnique({where:{id:task.vehicleAssignmentId}}):null;
 const known=own&&own.orderId===task.orderId&&own.vehicleId===task.vehicleId?await tx.usageSegment.aggregate({where:{assignmentId:own.id},_max:{endReadingKm:true}}):null;
 const initial=task.type==='DELIVERY'&&order.vehicleId===task.vehicleId&&!order.currentAssignmentId?order.confirmedMileageKm:0;
 return Math.max(vehicle.mileageKm||0,initial||0,own?.vehicleId===task.vehicleId?own.startReadingKm||0:0,known?._max.endReadingKm||0);
}
