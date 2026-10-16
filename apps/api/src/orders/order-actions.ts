import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, notify, text } from '../common/data';
@Controller()
export class OrderActionsController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('admin/orders/:id/cancel') cancel(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({reason: text, terminationFileId: text.optional()}).parse(body);
    return this.db.serial(async tx => {
      const order = await tx.order.findUnique({where:{id},include:{contracts:true,bills:{include:{payments:{include:{refunds:true}}}},handovers:true}});
      ensure(order && ['AWAITING_SIGNATURE','AWAITING_PAYMENT','AWAITING_HANDOVER'].includes(order.status),409,'ORDER_STATE','仅交付前订单可取消');
      const vehicle = await tx.vehicle.findUniqueOrThrow({where:{id:order.vehicleId}});
      ensure(vehicle.reservedOrderId === id && vehicle.status === 'RESERVED',409,'VEHICLE_OWNERSHIP','车辆预留归属异常');
      ensure(!order.contracts.some(c=>c.status==='PENDING') && !order.handovers.some(h=>h.signatureStatus==='PENDING'||h.status==='COMPLETED'),409,'SIGNATURE_PENDING','须先终止渠道签署，交付完成不可取消');
      const resourceIds=[...order.contracts.map(c=>c.id),...order.handovers.map(h=>h.id)];
      ensure(await tx.fadadaTask.count({where:{resourceId:{in:resourceIds},status:{notIn:['SIGNED','REJECTED','EXPIRED','FAILED']}}})===0,409,'SIGNATURE_PENDING','存在未结束的签署任务');
      for(const bill of order.bills){
        ensure(!bill.payments.some(p=>['CREATING','PENDING'].includes(p.status)),409,'PAYMENT_PENDING','请先核验并关闭未结束支付');
        const refunds=bill.payments.flatMap(p=>p.refunds).filter(r=>r.status==='SUCCEEDED').reduce((sum,r)=>sum+r.amount,0);
        ensure(refunds>=bill.paidAmount && bill.payments.every(p=>p.status!=='SUCCEEDED'||p.refunds.filter(r=>r.status==='SUCCEEDED').reduce((sum,r)=>sum+r.amount,0)>=p.amount),409,'REFUND_REQUIRED','实收款项须全部退款后才能取消');
      }
      if(order.contracts.some(c=>c.status==='SIGNED')||order.handovers.some(h=>h.signatureStatus==='SIGNED')) ensure(input.terminationFileId && await tx.storedFile.count({where:{id:input.terminationFileId,customerId:null,mimeType:'application/pdf',purpose:'evidence'}}),409,'TERMINATION_REQUIRED','已签署订单须归档双方签署的终止协议PDF');
      await tx.bill.updateMany({where:{orderId:id,status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
      await tx.entitlement.updateMany({where:{orderId:id},data:{status:'EXPIRED'}});
      await tx.handover.updateMany({where:{orderId:id,status:{not:'COMPLETED'}},data:{status:'SUPERSEDED'}});
      await tx.vehicle.update({where:{id:order.vehicleId},data:{status:'UNPUBLISHED',reservedOrderId:null}});
      const result=await tx.order.update({where:{id},data:{status:'CANCELLED',cancellationReason:input.reason,terminationFileId:input.terminationFileId,cancelledAt:new Date()}});
      await audit(tx,request.admin.id,'CANCEL','orders',id,input); await notify(tx,order.customerId,'订单已取消',input.reason,'orders',id);return result;
    });
  }
}
