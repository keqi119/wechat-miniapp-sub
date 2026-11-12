import {completeCancellation04} from './cancellation04-gates';
import { assertCancellationReady, cancellationOrderInclude, readCancellationFacts } from './cancellation-facts';
import {assertNotInspectionFiles} from '../vehicle-inspections/service';
import { lockOrder } from '../offline-documents/readiness';
import { archiveCommand } from '../offline-documents/command';
import { requireCurrentStaff } from '../auth/staff-session';
import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, notify, text } from '../common/data';
@Controller()
export class OrderActionsController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('admin/orders/:id/cancel') cancel(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({reason: text, terminationFileId: text.optional(),revision:z.number().int().nonnegative().optional(),idempotencyKey:z.string().min(8).max(128).optional()}).strict().parse(body);
    return this.db.serial(async tx => {
      await lockOrder(tx,id);await requireCurrentStaff(tx,request.admin,'orders');
      const order = await tx.order.findUnique({where:{id},include:cancellationOrderInclude});
      ensure(order,404,'NOT_FOUND','订单不存在');
      await assertNotInspectionFiles(tx,input.terminationFileId?[input.terminationFileId]:[]);
      if(['OFFLINE','ELECTRONIC'].includes(order.contractMode))ensure(input.revision!==undefined&&input.idempotencyKey,400,'COMMAND_REQUIRED','取消须提供当前订单版本和请求编号');
      const operation=async()=>{
      if(order.contractMode==='ELECTRONIC'){const result=await completeCancellation04(tx,order,input.revision,input.reason,request.admin.id);await audit(tx,request.admin.id,'CANCEL','orders',id,{reason:input.reason,revision:input.revision});return result;}
      assertCancellationReady(await readCancellationFacts(tx,order),input.revision);
      if(order.contractMode!=='OFFLINE'&&(order.contracts.some(c=>c.status==='SIGNED')||order.handovers.some(h=>h.signatureStatus==='SIGNED'))) ensure(input.terminationFileId && await tx.storedFile.count({where:{id:input.terminationFileId,customerId:null,mimeType:'application/pdf',purpose:'evidence'}}),409,'TERMINATION_REQUIRED','已签署订单须归档双方签署的终止协议PDF');
      await tx.bill.updateMany({where:{orderId:id,status:{in:['DRAFT','REVIEWED','PENDING']}},data:{status:'VOID'}});
      await tx.entitlement.updateMany({where:{orderId:id},data:{status:'EXPIRED'}});
      await tx.handover.updateMany({where:{orderId:id,status:{not:'COMPLETED'}},data:{status:'SUPERSEDED'}});
      await tx.vehicle.update({where:{id:order.vehicleId},data:{status:'UNPUBLISHED',reservedOrderId:null}});
      const result=await tx.order.update({where:{id},data:{status:'CANCELLED',cancellationReason:input.reason,terminationFileId:input.terminationFileId,cancelledAt:new Date(),revision:{increment:1}}});
      await audit(tx,request.admin.id,'CANCEL','orders',id,input); await notify(tx,order.customerId,'订单已取消',input.reason,'orders',id);return result;
      };
      const result=await(['OFFLINE','ELECTRONIC'].includes(order.contractMode)?archiveCommand(tx,request.admin,id,order.contractMode==='ELECTRONIC'?'ELECTRONIC_CANCEL':'OFFLINE_CANCEL',input,operation):operation());
      await assertNotInspectionFiles(tx,result.terminationFileId?[result.terminationFileId]:[]);return result;
    });
  }
}
