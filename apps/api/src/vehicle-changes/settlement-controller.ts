import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {audit,key} from '../common/data';
import {canonicalHash} from '../customers/types';
import {requireCurrentStaff} from '../auth/staff-session';
import {settleSwapFacts,swapSettlementAmounts,respondSwapSettlement} from './fact-settlement';
const id=z.string().trim().min(1).max(128),digest=z.string().regex(/^[a-f0-9]{64}$/);
@Controller()
export class SwapSettlementController{
 constructor(@Inject(Db)readonly db:Db){}
 @Post('admin/order-changes/:id/fact-settlements')prepare(@Param('id')changeId:string,@Body()raw:any,@Req()request:any){
  const input=z.object({revision:z.number().int().nonnegative(),receiptEventId:id,deliveryHandoverId:id,idempotencyKey:key}).strict().parse(raw);
  return this.db.serial(async tx=>{
   const actor=await requireCurrentStaff(tx,request.admin,'order-changes');ensure(['ADMIN','OPERATIONS'].includes(actor.role),403,'FORBIDDEN');
   const change=await tx.orderChange.findUnique({where:{id:changeId}});ensure(change,404,'NOT_FOUND');await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${change.orderId} FOR UPDATE`;
   const action='SWAP_FACT_PREPARE_'+input.idempotencyKey,requestHash=canonicalHash(input),old=await tx.auditLog.findFirst({where:{actorId:actor.id,resourceType:'order-changes',resourceId:changeId,action}});
   if(old){ensure((old.data as any).requestHash===requestHash,409,'IDEMPOTENCY_CONFLICT');return tx.swapFactSettlement.findUniqueOrThrow({where:{id:(old.data as any).settlementId}});}
   ensure(change.revision===input.revision,409,'VERSION_CONFLICT');const result=await settleSwapFacts(tx,changeId,input.receiptEventId,input.deliveryHandoverId,actor.id);
   await audit(tx,actor.id,action,'order-changes',changeId,{requestHash,settlementId:result.id});return result;
  });
 }
 @Get('admin/swap-fact-settlements/:id')admin(@Param('id')settlementId:string,@Req()r:any){return this.db.serial(async tx=>{await requireCurrentStaff(tx,r.admin,'order-changes',false);return swapSettlementAmounts(tx,settlementId);});}
 @Get('customer/swap-fact-settlements/:id')customer(@Param('id')settlementId:string,@Req()r:any){return this.db.serial(async tx=>{ensure(await tx.swapFactSettlement.findFirst({where:{id:settlementId,customerId:r.customer.id}}),404,'NOT_FOUND');return swapSettlementAmounts(tx,settlementId);});}
 @Post('customer/swap-fact-settlements/:id/respond')respond(@Param('id')settlementId:string,@Body()raw:any,@Req()r:any){ensure(r.customer?.id,401,'UNAUTHENTICATED');const input=z.object({sourceHash:digest,fundsHash:digest,amountHash:digest,responseRevision:z.number().int().nonnegative(),previousResponseId:id.nullable(),decision:z.enum(['CONFIRM','OBJECT']),reason:z.string().trim().max(2000).default(''),idempotencyKey:key}).strict().parse(raw);return this.db.serial(tx=>respondSwapSettlement(tx,settlementId,r.customer.id,input));}
}
