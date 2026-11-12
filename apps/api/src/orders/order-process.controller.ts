import {Body,Controller,HttpException,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {audit,key} from '../common/data';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {archiveCommand} from '../offline-documents/command';
import {lockOrder} from '../offline-documents/readiness';
import {advanceToHandover} from './readiness';
import {loadOrderProcessFacts} from './order-process-facts';
import {orderProcess} from './order-process';

@Controller()
export class OrderProcessController {
 constructor(@Inject(Db)private db:Db){}
 @Post('admin/orders/:id/recheck-delivery') recheck(@Param('id')id:string,@Body()body:unknown,@Req()request:any){
  const input=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict().parse(body),actor=request.admin;
  return this.db.serial(async tx=>{
   await requireCurrentStaff(tx,actor,'orders');await lockOrder(tx,id);
   return archiveCommand(tx,actor,id,'RECHECK_DELIVERY',input,async()=>{
    const order=await tx.order.findUnique({where:{id}});ensure(order,404,'NOT_FOUND','订单不存在');
    ensure(['OFFLINE','ELECTRONIC'].includes(order.contractMode),409,'EXECUTION_MODE_MISMATCH','本次重核仅用于线下签约订单');
    ensure(order.revision===input.revision,409,'REVISION_CONFLICT','订单已变化，请刷新后核对');
    ensure(order.status==='AWAITING_PAYMENT',409,'ORDER_STATE','仅待支付订单可重新核对交付流转');
    if(order.effectiveTermsVersionId){const terms=await tx.orderTermsVersion.findUnique({where:{id:order.effectiveTermsVersionId}});ensure(terms?.orderId===order.id,409,'TERMS_MISSING','当前条款缺失或归属不符');(order as any).currentBusinessHash=terms.hash;}
    const f=await loadOrderProcessFacts(tx,order,actor),process=orderProcess(f);
    if(!f.contract.ready||!f.funding.ready||f.changes.length||!f.business.ready){
     const details=process.steps.find(s=>s.key==='DELIVERY')!.checks.filter(c=>c.state==='BLOCKED'&&!['DELIVERY_TASK','DELIVERY_FACTS','DELIVERY_CUSTOMER','DELIVERY_ARCHIVE','DELIVERY_COMPLETE'].includes(c.code));
     throw new HttpException({error:{code:'DELIVERY_NOT_READY',message:'尚不能进入待交付：'+details.map(c=>c.label).join('；'),details}},409);
    }
    // The existing command guard re-reads all contract, funding and delivery conditions under the order lock.
    await advanceToHandover(tx,id);
    const updated=await tx.order.findUniqueOrThrow({where:{id}});ensure(updated.status==='AWAITING_HANDOVER',409,'DELIVERY_NOT_READY','交付条件已变化，请重新核对');
    const result=await tx.order.update({where:{id},data:{revision:{increment:1}}});
    await audit(tx,actor.id,'RECHECK_DELIVERY','orders',id,{previousStatus:order.status,status:result.status,revision:result.revision});
    return{orderId:id,status:result.status,revision:result.revision,advanced:true,message:'交付条件已核对，订单已进入待交付。'};
   });
  });
 }
}
