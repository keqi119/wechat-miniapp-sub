import {requireCurrentStaff} from '../auth/staff-session';
import {ensure} from '../common/errors';
export type SwapFieldContext={taskId:string;quoteId:string};

/** Called inside the handover transaction after the Order lock; never allocates or completes a task. */
export async function bindSwapFieldTask(tx:any,context:SwapFieldContext,change:any,quote:any,facts:any,actor:any){
 await requireCurrentStaff(tx,actor,'field-tasks',true);
 await tx.$queryRaw`SELECT id FROM "FieldHandoverTask" WHERE id=${context.taskId} FOR UPDATE`;
 const task=await tx.fieldHandoverTask.findUnique({where:{id:context.taskId}}),side=facts.type==='SWAP_RETURN'?'RETURN':facts.type==='SWAP_DELIVERY'?'DELIVERY':null;
 ensure(task&&task.status==='ASSIGNED'&&task.assigneeId===actor.id,403,'FIELD_TASK_UNAVAILABLE','现场任务已改派、取消或完成');
 ensure(side&&quote.id===context.quoteId&&change.activeQuoteId===quote.id&&quote.changeId===change.id&&facts.changeId===change.id&&facts.orderId===change.orderId&&facts.customerId===change.customerId&&task.orderId===change.orderId&&task.changeId===change.id&&task.quoteId===quote.id&&task.termsVersionId===null&&task.batchKey===`CHANGE:${change.id}:${side}`&&task.type===facts.type&&task.vehicleId===facts.vehicleId&&task.vehicleAssignmentId===facts.assignmentId&&!task.currentHandoverId&&(side==='RETURN'?facts.assignmentId===quote.snapshot.originalAssignmentId:facts.assignmentId===null),409,'FIELD_SWAP_SOURCE_CHANGED','任务批次、报价或车辆来源已变化，请重新核对现场材料');
 ensure(await tx.storedFile.count({where:{fieldTaskId:task.id,fieldTaskGeneration:task.materialGeneration,id:{in:facts.fileIds}}})===new Set(facts.fileIds).size,403,'FILE_OWNERSHIP','只能使用该任务当前批次的现场材料');
 return{fieldTaskId:task.id};
}
