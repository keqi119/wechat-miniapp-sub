import {cancellation04Status} from './cancellation04-gates';
import {ensure} from '../common/errors';
import {assertOfflineCancellationFacts,offlineCancellationBlockers,readOfflineCancellationFacts} from '../offline-documents/cancellation';

export const cancellationOrderInclude={contracts:true,bills:{include:{payments:{include:{refunds:true}}}},handovers:true} as const;
export const cancellableOrderStates=['AWAITING_CONTRACT_REVIEW','AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'];
export type CancellationBlocker={code:string;message:string;resource?:string;resourceId?:string};

/** Exact-order reads only. Callers performing a mutation must hold the order lock. */
export async function readCancellationFacts(tx:any,order:any){
 const resourceIds=[...order.contracts.map((c:any)=>c.id),...order.handovers.map((h:any)=>h.id)];
 const [paper,changes,vehicle,signingTasks,tasks,settlements]=await Promise.all([
  order.contractMode==='OFFLINE'?readOfflineCancellationFacts(tx,order):null,
  tx.orderChange.findMany({where:{orderId:order.id,status:{notIn:['APPLIED','CANCELLED','REJECTED']}},select:{id:true,orderId:true,kind:true,status:true,revision:true}}),
  tx.vehicle.findUnique({where:{id:order.vehicleId},select:{id:true,status:true,reservedOrderId:true}}),
  tx.fadadaTask.findMany({where:{resourceId:{in:resourceIds},status:{notIn:['SIGNED','REJECTED','EXPIRED','FAILED']}},select:{id:true,resourceId:true,status:true}}),
  tx.fieldHandoverTask.findMany({where:{orderId:order.id},select:{id:true,orderId:true,type:true,status:true,version:true,currentHandoverId:true}}),
  tx.returnSettlement.findMany({where:{orderId:order.id},select:{id:true,orderId:true,status:true,revision:true}})
 ]);
 const electronic=order.contractMode==='ELECTRONIC'?await cancellation04Status(tx,order):null;
 return{order,paper,changes,vehicle,signingTasks,tasks,settlements,electronic};
}
export type CancellationFacts=Awaited<ReturnType<typeof readCancellationFacts>>;
export function cancellationBusinessBlockers(f:CancellationFacts):CancellationBlocker[]{
 if(f.electronic)return f.electronic.blockers;
 const {order,vehicle}=f,blockers:CancellationBlocker[]=[];
 if(!cancellableOrderStates.includes(order.status))blockers.push({code:'ORDER_STATE',message:'仅交付前订单可取消'});
 for(const c of f.changes)blockers.push({code:'CHANGE_ACTIVE',message:'须先处理正在进行的订单变更',resource:'order-changes',resourceId:c.id});
 if(!vehicle||vehicle.reservedOrderId!==order.id||vehicle.status!=='RESERVED')blockers.push({code:'VEHICLE_OWNERSHIP',message:'车辆预留归属异常',resource:'vehicles',resourceId:order.vehicleId});
 const pending=[...order.contracts.filter((c:any)=>c.status==='PENDING').map((c:any)=>({resource:'contracts',id:c.id})),...order.handovers.filter((h:any)=>h.signatureStatus==='PENDING'||h.status==='COMPLETED').map((h:any)=>({resource:'handovers',id:h.id}))];
 for(const record of pending)blockers.push({code:'SIGNATURE_PENDING',message:'须先终止渠道签署，交付完成不可取消',resource:record.resource,resourceId:record.id});
 for(const task of f.signingTasks)blockers.push({code:'SIGNATURE_PENDING',message:'存在未结束的签署任务',resource:order.contracts.some((c:any)=>c.id===task.resourceId)?'contracts':'handovers',resourceId:task.resourceId});
 for(const bill of order.bills){
  for(const payment of bill.payments){
   if(['CREATING','PENDING'].includes(payment.status))blockers.push({code:'PAYMENT_PENDING',message:'请先核验并关闭未结束支付',resource:'payments',resourceId:payment.id});
  }
  for(const payment of bill.payments)for(const refund of payment.refunds)if(['PENDING_APPROVAL','PROCESSING'].includes(refund.status))blockers.push({code:'REFUND_PENDING',message:'尚有未核清退款，不能结束订单',resource:'refunds',resourceId:refund.id});
  const refunds=bill.payments.flatMap((p:any)=>p.refunds).filter((r:any)=>r.status==='SUCCEEDED').reduce((sum:number,r:any)=>sum+r.amount,0);
  const unrefunded=bill.payments.filter((p:any)=>p.status==='SUCCEEDED'&&p.refunds.filter((r:any)=>r.status==='SUCCEEDED').reduce((sum:number,r:any)=>sum+r.amount,0)<p.amount);
  for(const payment of unrefunded)blockers.push({code:'REFUND_REQUIRED',message:'实收款项须全部退款后才能取消',resource:'payments',resourceId:payment.id});
  if(refunds<bill.paidAmount&&!unrefunded.length)blockers.push({code:'REFUND_REQUIRED',message:'实收款项须全部退款后才能取消',resource:'bills',resourceId:bill.id});
 }
 return blockers;
}
export function cancellationBlockers(f:CancellationFacts):CancellationBlocker[]{return[...(f.paper?offlineCancellationBlockers(f.paper):[]),...cancellationBusinessBlockers(f)];}
/** Retains the final command's original paper → revision → business guard precedence. */
export function assertCancellationReady(f:CancellationFacts,expectedRevision?:number){
 if(f.electronic)ensure(f.order.revision===expectedRevision,409,'REVISION_CONFLICT');
 if(f.paper){assertOfflineCancellationFacts(f.paper);ensure(f.order.revision===expectedRevision,409,'REVISION_CONFLICT','订单已更新');}
 const blocker=cancellationBusinessBlockers(f)[0];ensure(!blocker,409,blocker?.code||'ORDER_STATE',blocker?.message||'当前订单不能取消');
}
