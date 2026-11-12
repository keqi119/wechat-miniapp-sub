import {ensure} from '../common/errors';
import {audit} from '../common/data';
import {assertNeverDelivered04} from './cancellation04-source';
/** Business withdrawal of an unformed subscription; never a legal04 EFFECTIVE fact. */
export async function unsignedCancellationStatus(tx:any,order:any){
 const blockers:any[]=[];const block=(code:string,message:string)=>blockers.push({code,message});
 try{await assertNeverDelivered04(tx,order);}catch(e:any){const b=e.getResponse?.().error;if(!b)throw e;block(b.code,b.message);}
 const contracts=await tx.contract.findMany({where:{orderId:order.id}}),tasks=await tx.electronicSigningTask.findMany({where:{orderId:order.id},include:{parties:true}}),vehicle=await tx.vehicle.findUnique({where:{id:order.vehicleId}});
 if(contracts.some((c:any)=>c.status==='SIGNED'))block('CANCELLATION_04_REQUIRED','已有签署事实，须核对04或有效解除依据');
 else if(contracts.some((c:any)=>c.status!=='DRAFT')||tasks.some((t:any)=>t.kind!=='SUBSCRIPTION'||t.status!=='PREPARED'||t.uploadStatus!=='NOT_STARTED'||t.parties.some((p:any)=>p.attemptedAt||p.status!=='PENDING'))||await tx.fadadaTask.count({where:{resourceId:{in:contracts.map((c:any)=>c.id)}}}))block('ELECTRONIC_STOP_REVIEW_REQUIRED','存在已接受、部分或未知签署，须核验原渠道结果及安全处置');
 if(await tx.orderPreDeliveryCancellation.count({where:{orderId:order.id}}))block('CANCELLATION_04_REQUIRED','已存在真实取消事实来源，须沿原案办理');
 if(!['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status))block('ORDER_STATE','当前订单不能撤回未成立订阅');
 if(!vehicle||vehicle.status!=='RESERVED'||vehicle.reservedOrderId!==order.id)block('VEHICLE_OWNERSHIP','车辆预留归属须核对');
 if(await tx.orderChange.count({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}}))block('CHANGE_ACTIVE','须先处理本单变更依赖');
 const bills=await tx.bill.findMany({where:{orderId:order.id},include:{payments:true}});
 if(bills.some((b:any)=>b.paidAmount>0||b.payments.some((p:any)=>['CREATING','PENDING','SUCCEEDED'].includes(p.status))))block('CANCELLATION_UNSIGNED_FUNDS_REVIEW','已有实际或未核清资金，须核对原付款而非零资金撤销');
 return{eligible:!blockers.length,blockers,tasks};
}
export async function withdrawUnsignedSubscription(tx:any,order:any,reason:string,actorId:string){
 const status=await unsignedCancellationStatus(tx,order);const blocker=status.blockers[0];ensure(!blocker,409,blocker?.code??'CANCELLATION_04_REQUIRED',blocker?.message);
 for(const task of status.tasks)await tx.electronicSigningTask.update({where:{id:task.id},data:{status:'WITHDRAWN',withdrawnAt:new Date(),stopStatus:'STOPPED_LOCAL_ONLY',revision:{increment:1}}});
 await tx.bill.updateMany({where:{orderId:order.id,paidAmount:0,status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
 await tx.entitlement.updateMany({where:{orderId:order.id,status:'PENDING'},data:{status:'EXPIRED'}});
 await tx.handover.updateMany({where:{orderId:order.id,status:{in:['DRAFT','PUBLISHED']}},data:{status:'SUPERSEDED'}});
 await tx.vehicle.update({where:{id:order.vehicleId},data:{status:'UNPUBLISHED',reservedOrderId:null}});
 const result=await tx.order.update({where:{id:order.id},data:{status:'CANCELLED',cancelledAt:new Date(),cancellationReason:reason,revision:{increment:1}}});await audit(tx,actorId,'UNFORMED_SUBSCRIPTION_WITHDRAWN','orders',order.id,{taskIds:status.tasks.map((t:any)=>t.id),reason});return result;
}
