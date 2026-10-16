import {submitSegment,requestSegmentEvidence} from './segments';
import {fileIds} from '../common/data';
import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {key,text} from '../common/data';
import {ensure} from '../common/errors';
import {VehicleChangesService} from './service';
@Controller()
export class VehicleChangesController {
 constructor(@Inject(VehicleChangesService)private service:VehicleChangesService){}
 @Post('customer/usage-segments/:id/readings') reading(@Param('id')id:string,@Body()body:any,@Req()r:any){const input=z.object({readingKm:z.number().int().nonnegative().max(2147483647),recordedAt:z.string().datetime({offset:true}),fileIds:fileIds.refine(ids=>ids.length>0),idempotencyKey:key}).strict().parse(body);return this.service.db.serial(tx=>submitSegment(tx,id,r.customer.id,input,this.service.clock()));}
 @Post('admin/usage-segments/:id/request-evidence') evidence(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(['ADMIN','OPERATIONS'].includes(r.admin.role),403,'FORBIDDEN','仅运营可请求补证');const input=z.object({revision:z.number().int().nonnegative(),reason:text,idempotencyKey:key}).strict().parse(body);return this.service.db.serial(tx=>requestSegmentEvidence(tx,id,input,r.admin.id,this.service.clock()));}
 @Get('customer/orders/:id/swap-account') account(@Param('id')id:string,@Req()r:any){return this.service.db.serial(tx=>this.service.account(tx,id,r.customer.id));}
 @Get('admin/orders/:id/vehicle-change-context') context(@Param('id')id:string){return this.service.db.serial(tx=>this.service.context(tx,id));}
 @Post('customer/orders/:id/vehicle-changes') request(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.service.create(id,z.object({reason:text,idempotencyKey:key}).strict().parse(body),undefined,r.customer.id);}
 @Post('admin/orders/:id/vehicle-changes') create(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(['ADMIN','OPERATIONS'].includes(r.admin.role),403,'FORBIDDEN','仅运营可发起换车');return this.service.create(id,z.object({reason:text,idempotencyKey:key,expectedOrderRevision:z.number().int().nonnegative(),priorTermsHash:z.string().length(64)}).strict().parse(body),r.admin);}
}
