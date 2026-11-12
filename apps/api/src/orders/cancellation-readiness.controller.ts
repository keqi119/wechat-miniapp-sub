import {cancellation04Readiness} from './cancellation04-gates';
import {Controller,Get,Inject,Param,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {cancellationOrderInclude,readCancellationFacts} from './cancellation-facts';
import {cancellationReadiness} from './cancellation-readiness';

@Controller()
export class OrderCancellationReadinessController{
 constructor(@Inject(Db)private db:Db){}
 @Get('admin/orders/:id/cancellation-readiness') readiness(@Param('id')id:string,@Req()request:any){
  const actor=request.admin;
  return this.db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   await requireCurrentStaff(tx,actor,'orders',false);ensure(['ADMIN','OPERATIONS','FINANCE'].includes(actor.role),403,'FORBIDDEN','当前岗位无取消办理工作区权限');
   const order=await tx.order.findUnique({where:{id},include:cancellationOrderInclude});ensure(order,404,'NOT_FOUND','订单不存在');
   if(order.contractMode==='ELECTRONIC')return cancellation04Readiness(tx,order,actor);
   ensure(order.contractMode==='OFFLINE',409,'EXECUTION_MODE_MISMATCH','此工作区用于线下签约订单的取消核实');
   return cancellationReadiness(tx,await readCancellationFacts(tx,order),actor);
  },{isolationLevel:'RepeatableRead',timeout:30000});
 }
}
