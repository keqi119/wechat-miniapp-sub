import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {requireCurrentStaff} from '../auth/staff-session';
import {EntitlementService} from './service';
import {EntitlementActor,EntitlementTx,consumeInput,reserveInput,releaseInput,reverseInput} from './types';

@Controller()
export class EntitlementsController {
 private service=new EntitlementService();
 constructor(@Inject(Db)private db:Db){}
 @Get('customer/orders/:id/entitlements') customer(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.service.list(tx,id,r.customer.id));}
 @Get('admin/orders/:id/entitlements') admin(@Param('id')id:string,@Req()r:any){return this.db.serial(async tx=>{await requireCurrentStaff(tx,r.admin,'entitlements',false);return this.service.list(tx,id);});}
 @Get('admin/orders/:id/entitlements/:entitlementId/ledger') ledger(@Param('id')id:string,@Param('entitlementId')entitlementId:string,@Req()r:any){return this.db.serial(async tx=>{await requireCurrentStaff(tx,r.admin,'entitlements',false);await this.scope(tx,id,entitlementId);return{reservations:await tx.entitlementReservation.findMany({where:{entitlementId,orderId:id},orderBy:{reservedAt:'asc'}}),entries:await tx.entitlementLedger.findMany({where:{entitlementId,orderId:id},orderBy:{createdAt:'asc'}})};});}
 @Post('admin/orders/:id/entitlement-reservations') reserve(@Param('id')id:string,@Body()raw:unknown,@Req()r:any){const {entitlementId,...input}=reserveInput.extend({entitlementId:z.string().min(1)}).strict().parse(raw);return this.run(id,entitlementId,r.admin,tx=>this.service.reserve(tx,r.admin,entitlementId,input));}
 @Post('admin/orders/:id/entitlement-uses') consume(@Param('id')id:string,@Body()raw:unknown,@Req()r:any){const {entitlementId,...input}=consumeInput.extend({entitlementId:z.string().min(1)}).strict().parse(raw);return this.run(id,entitlementId,r.admin,tx=>this.service.consume(tx,r.admin,entitlementId,input));}
 @Post('admin/orders/:id/entitlement-releases') release(@Param('id')id:string,@Body()raw:unknown,@Req()r:any){const {entitlementId,...input}=releaseInput.extend({entitlementId:z.string().min(1)}).strict().parse(raw);return this.run(id,entitlementId,r.admin,tx=>this.service.release(tx,r.admin,entitlementId,input));}
 @Post('admin/orders/:id/entitlement-reversals') reverse(@Param('id')id:string,@Body()raw:unknown,@Req()r:any){const {entitlementId,...input}=reverseInput.extend({entitlementId:z.string().min(1)}).strict().parse(raw);return this.run(id,entitlementId,r.admin,tx=>this.service.reverse(tx,r.admin,entitlementId,input));}
 private async scope(tx:EntitlementTx,orderId:string,entitlementId:string){ensure(await tx.entitlement.findFirst({where:{id:entitlementId,orderId}}),404,'NOT_FOUND','本订单权益不存在');}
 private run<T>(id:string,entitlementId:string,actor:EntitlementActor,operation:(tx:EntitlementTx)=>Promise<T>){const run=()=>this.db.serial(async tx=>{await requireCurrentStaff(tx,actor,'entitlements');await this.scope(tx,id,entitlementId);return operation(tx);});return run().catch((error:unknown)=>{if(error&&typeof error==='object'&&'code'in error&&error.code==='P2002')return run();throw error;});}
}
