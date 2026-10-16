export async function deliveryReady(tx: any, orderId: string) {
  const signed = await tx.contract.count({ where: { orderId, kind: 'SUBSCRIPTION', status: 'SIGNED' } });
  const bills = await tx.bill.findMany({ where: { orderId, OR: [{type:'DEPOSIT'}, {type:'SUBSCRIPTION',sequence:1}] }, include: { payments: { include: { refunds: true } } } });
  return signed > 0 && bills.some((b:any)=>b.type==='SUBSCRIPTION') && bills.every((b:any)=>b.status==='PAID' && b.paidAmount===b.amount && !b.payments.some((p:any)=>p.refunds.some((r:any)=>['PENDING_APPROVAL','PROCESSING','SUCCEEDED'].includes(r.status))));
}
export async function advanceToHandover(tx: any, orderId: string) {
  if (await deliveryReady(tx,orderId)) await tx.order.updateMany({where:{id:orderId,status:{in:['AWAITING_SIGNATURE','AWAITING_PAYMENT']}},data:{status:'AWAITING_HANDOVER'}});
}
