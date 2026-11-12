import {z} from 'zod';
import {audit,hash,key,notify,text} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {lockOrder} from '../offline-documents/readiness';
import {EntitlementService} from './service';
import type {EntitlementActor,EntitlementTx} from './types';
const command={revision:z.number().int().nonnegative().optional(),idempotencyKey:key.optional()};
const statusInput=z.object({...command,status:z.enum(['ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED']),note:text}).strict();
const assignInput=z.object({...command,assigneeId:text.optional(),providerName:text,contact:text,note:z.string().max(2000).default('')}).strict();
const transitions:Record<string,string[]>={SUBMITTED:['ACCEPTED','CANCELLED'],ACCEPTED:['CANCELLED'],ASSIGNED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED','CANCELLED']};
export async function changeService(tx:EntitlementTx,actor:EntitlementActor,id:string,raw:unknown,assign=false){
 await requireCurrentStaff(tx,actor,'services');
 const input=assign?assignInput.parse(raw):statusInput.parse(raw),reference=await tx.serviceRequest.findUnique({where:{id}});ensure(reference,404,'NOT_FOUND','工单不存在');await lockOrder(tx,reference.orderId);
 const item=await tx.serviceRequest.findUniqueOrThrow({where:{id}});
 if(item.entitlementId||process.env.MVP_V2_ENABLED==='true')ensure(input.revision!==undefined&&input.idempotencyKey,400,'SERVICE_COMMAND_REQUIRED','请刷新工单版本后提交');
 const action=assign?'ASSIGN':'STATUS';
 const perform=async()=>{
  if(input.revision!==undefined)ensure(input.revision===item.revision,409,'REVISION_CONFLICT','工单已变化，请刷新后核对');
  const next=assign?'ASSIGNED':(input as z.infer<typeof statusInput>).status;
  ensure(assign?['SUBMITTED','ACCEPTED','ASSIGNED'].includes(item.status):transitions[item.status]?.includes(next),409,'STATE_CONFLICT','工单当前不能执行此动作');
  const right=item.entitlementId?await tx.entitlement.findUniqueOrThrow({where:{id:item.entitlementId}}):null;
  if(right)ensure(right.customerId===item.customerId&&right.orderId===item.orderId,409,'ENTITLEMENT_SERVICE_SCOPE','权益不属于本客户本订单');
  if(right?.kind==='COUNT'&&['COMPLETED','CANCELLED'].includes(next))ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'ENTITLEMENT_OPERATOR_REQUIRED','次数权益的履约核销或释放请转运营办理');
  const {revision,idempotencyKey,...fields}=input;
  if('assigneeId'in fields&&fields.assigneeId)ensure(await tx.adminUser.count({where:{id:fields.assigneeId,active:true}}),400,'ASSIGNEE','处理人员不可用');
  const updated=await tx.serviceRequest.update({where:{id},data:{...fields,status:next,revision:{increment:1}}});
  if(right?.kind==='COUNT'){
   const service=new EntitlementService(),reservation=await tx.entitlementReservation.findUnique({where:{serviceRequestId:id}}),ctx={revision:right.revision,serviceRequestId:id,idempotencyKey:hash({id,action,next,key:input.idempotencyKey})};
   if(next==='COMPLETED'){ensure(reservation,409,'ENTITLEMENT_RESERVATION_REQUIRED','请先核对并预占本工单服务次数');await service.consume(tx,actor,right.id,{...ctx,reservationId:reservation.id});}
   else if(next==='CANCELLED'&&reservation?.status==='RESERVED')await service.release(tx,actor,right.id,{...ctx,reservationId:reservation.id,reason:input.note});
   else if(['ACCEPTED','ASSIGNED','IN_PROGRESS'].includes(next)&&!reservation&&['ADMIN','OPERATIONS'].includes(actor.role))await service.reserve(tx,actor,right.id,{...ctx,quantity:1});
  }
  await audit(tx,actor.id,action,'services',id,{status:next,revision:updated.revision});await notify(tx,item.customerId,'工单进度更新',input.note||'服务已安排','services',id);return updated;
 };
 return input.idempotencyKey?archiveCommand(tx,actor,`service:${id}`,action,{...input,idempotencyKey:input.idempotencyKey},perform):perform();
}
