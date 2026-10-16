export async function deliveryReady(tx: any, orderId: string) {
  if(await tx.orderChange.count({where:{orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}}))return false;
  const order=await tx.order.findUnique({where:{id:orderId}});
  if(order?.effectiveTermsVersionId){const first=await tx.serviceObligation.findFirst({where:{orderId,active:true,sequence:1},include:{allocations:{where:{releasedAt:null},include:{payment:{include:{refunds:true}}}}}});const deposits=await tx.bill.findMany({where:{orderId,type:'DEPOSIT'},include:{payments:{include:{refunds:true}}}});return !!first&&first.allocations.reduce((n:number,a:any)=>n+a.amount,0)===first.amount&&first.allocations.every((a:any)=>a.payment.status==='SUCCEEDED'&&a.payment.amount-a.payment.refunds.filter((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status)).reduce((n:number,r:any)=>n+r.amount,0)>=a.amount)&&deposits.every((b:any)=>b.status==='PAID'&&b.paidAmount===b.amount&&!b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status))));}
  const signed = await tx.contract.count({ where: { orderId, kind: 'SUBSCRIPTION', status: 'SIGNED' } });
  const bills = await tx.bill.findMany({ where: { orderId, OR: [{type:'DEPOSIT'}, {type:'SUBSCRIPTION',sequence:1}] }, include: { payments: { include: { refunds: true } } } });
  return signed > 0 && bills.some((b:any)=>b.type==='SUBSCRIPTION') && bills.every((b:any)=>b.status==='PAID' && b.paidAmount===b.amount && !b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status))));
}
export async function advanceToHandover(tx: any, orderId: string) {
  if (await deliveryReady(tx,orderId)) await tx.order.updateMany({where:{id:orderId,status:{in:['AWAITING_SIGNATURE','AWAITING_PAYMENT']}},data:{status:'AWAITING_HANDOVER'}});
}
