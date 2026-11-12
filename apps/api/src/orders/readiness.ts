import {deliveryBusinessReady} from './business-gates';
import {isVirtualVehicle} from '../virtual-acceptance/scope';
import {contractReady} from '../offline-documents/readiness';
import {billFundsReady,receiptState} from '../billing/receipt-state';
/** Read-only funding view; excludes unrelated fee/test bills by construction. */
export async function readDeliveryFunding(tx:any,order:any){
 const bills=await tx.bill.findMany({where:{orderId:order.id,OR:[{type:'DEPOSIT'},{type:'SUBSCRIPTION',sequence:1}]},include:{payments:{include:{refunds:true}}}});
 let first:any=null;
 if(order.effectiveTermsVersionId)first=await tx.serviceObligation.findFirst({where:{orderId:order.id,active:true,sequence:1},include:{allocations:{where:{releasedAt:null},include:{payment:{include:{refunds:true}}}}}});
 const firstReady=order.effectiveTermsVersionId?!!first&&first.allocations.reduce((n:number,a:any)=>n+a.amount,0)===first.amount&&first.allocations.every((a:any)=>{const funds=receiptState(a.payment);return a.payment.status==='SUCCEEDED'&&!a.payment.reconciliationRequired&&funds.valid&&!funds.pending&&funds.retained>=a.amount;}):bills.some((b:any)=>b.type==='SUBSCRIPTION')&&bills.filter((b:any)=>b.type==='SUBSCRIPTION').every(billFundsReady);
 return{ready:firstReady&&bills.filter((b:any)=>b.type==='DEPOSIT').every(billFundsReady),firstReady,first,bills};
}
export async function deliveryReady(tx: any, orderId: string,actualAt?:Date) {
  if(await tx.orderChange.count({where:{orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}}))return false;
  const order=await tx.order.findUnique({where:{id:orderId}});
  if(order&&await isVirtualVehicle(tx,order.vehicleId))return false;
  if(['OFFLINE','ELECTRONIC'].includes(order?.contractMode) && !(await contractReady(tx,orderId,'DELIVERY')).ready)return false;
  if(['OFFLINE','ELECTRONIC'].includes(order?.contractMode)&&!(await deliveryBusinessReady(tx,orderId,actualAt)).ready)return false;
  if(order?.effectiveTermsVersionId)return (await readDeliveryFunding(tx,order)).ready;
  const signed = ['OFFLINE','ELECTRONIC'].includes(order?.contractMode) ? 1 : await tx.contract.count({ where: { orderId, kind: 'SUBSCRIPTION', status: 'SIGNED' } });
  const bills = await tx.bill.findMany({ where: { orderId, OR: [{type:'DEPOSIT'}, {type:'SUBSCRIPTION',sequence:1}] }, include: { payments: { include: { refunds: true } } } });
  return signed > 0 && bills.some((b:any)=>b.type==='SUBSCRIPTION') && bills.every(billFundsReady);
}
export async function advanceToHandover(tx: any, orderId: string) {
  const order=await tx.order.findUnique({where:{id:orderId}});
  if(!order||!['AWAITING_SIGNATURE','AWAITING_PAYMENT'].includes(order.status))return;
  if (await deliveryReady(tx,orderId)) await tx.order.updateMany({where:{id:orderId,status:{in:['AWAITING_SIGNATURE','AWAITING_PAYMENT']}},data:{status:'AWAITING_HANDOVER'}});
}
