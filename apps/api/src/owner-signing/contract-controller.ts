import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {requireCurrentConsents} from '../auth/consents';
import {requireNativeSigning,runNativeSigning} from '../esign/native-signing';
import {OwnerService} from './owner.service';
import {OwnerContractPreparation} from './contract';
import {OwnerContractAccess} from './contract-access';
import {OwnerContractGateway} from './gateway';
const reviewInput=z.object({sourceSha256:z.string().length(64),documentHash:z.string().length(64),accepted:z.literal(true)}).strict();
@Controller()
export class OwnerContractController {
 constructor(@Inject(Db)private db:Db,@Inject(OwnerService)private owners:OwnerService,@Inject(OwnerContractPreparation)private prepare:OwnerContractPreparation,@Inject(OwnerContractAccess)private access:OwnerContractAccess,@Inject(OwnerContractGateway)private gateway:OwnerContractGateway){}
 @Post('admin/vehicle-owners/:id/contact') contact(@Req()r:any,@Param('id')id:string,@Body()b:unknown){return this.owners.contact(r.admin.id,id,b);}
 @Get('admin/vehicle-owners/:id/vehicles') vehicles(@Req()r:any,@Param('id')id:string){return this.owners.vehicles(r.admin.id,id);}
 @Post('admin/vehicle-owners/:id/vehicles') bind(@Req()r:any,@Param('id')id:string,@Body()b:unknown){return this.owners.bindVehicle(r.admin.id,id,b);}
 @Get('admin/vehicle-owners/:id/contracts') async adminTasks(@Param('id')id:string){return this.db.ownerSigningTask.findMany({where:{ownerId:id},take:100,orderBy:{createdAt:'desc'},select:{id:true,resourceId:true,status:true,ownerMode:true,sourceFileId:true,sourceSha256:true,documentHash:true,reviewedAt:true,signedFileId:true,parties:{select:{role:true,status:true}}}});}
 @Get('admin/vehicle-owners/:id/pending-contracts') async pending(@Param('id')id:string){return this.db.contract.findMany({where:{OR:[{kind:'SUBSCRIPTION'},{kind:'AMENDMENT',delayQuote:{status:'CONFIRMED',change:{status:'AWAITING_SIGNATURE'}}}],status:'DRAFT',providerTaskId:null,order:{finalPlanSnapshot:{path:['lessorSnapshot','ownerId'],equals:id}}},take:100,orderBy:{createdAt:'desc'},select:{id:true,orderId:true,order:{select:{vehicle:{select:{title:true}},customer:{select:{name:true}}}}}});}
 @Post('admin/vehicle-owners/:id/contracts/:contractId/prepare') async preparation(@Req()r:any,@Param('id')id:string,@Param('contractId')contractId:string){const c=await this.db.contract.findUnique({where:{id:contractId},include:{order:true}});ensure((c?.order.finalPlanSnapshot as any)?.lessorSnapshot?.ownerId===id,404,'NOT_FOUND','本企业合同不存在');return this.prepare.prepare(r.admin.id,contractId);}
 @Post('admin/vehicle-owners/:id/tasks/:taskId/review') async review(@Req()r:any,@Param('id')id:string,@Param('taskId')taskId:string,@Body()b:unknown){ensure(await this.db.ownerSigningTask.count({where:{id:taskId,ownerId:id}}),404,'NOT_FOUND','本企业合同不存在');return this.prepare.review(r.admin.id,taskId,reviewInput.parse(b));}
 @Post('admin/vehicle-owners/:id/tasks/:taskId/sync') async adminSync(@Param('id')id:string,@Param('taskId')taskId:string){ensure(await this.db.ownerSigningTask.count({where:{id:taskId,ownerId:id}}),404,'NOT_FOUND','本企业合同不存在');return this.gateway.query(taskId,true);}
 @Get('customer/owners/:id/options') options(@Req()r:any,@Param('id')id:string){return this.owners.options(r.customer.id,id);}
 @Get('customer/owners/:id/contracts') list(@Req()r:any,@Param('id')id:string){return this.access.list(r.customer.id,id);}
 @Get('customer/owners/:id/contracts/:taskId') detail(@Req()r:any,@Param('id')id:string,@Param('taskId')taskId:string){return this.access.detail(r.customer.id,id,taskId);}
 @Get('customer/owners/:id/contracts/:taskId/files/:kind') async file(@Req()r:any,@Res()response:any,@Param('id')id:string,@Param('taskId')taskId:string,@Param('kind')kind:string){const bytes=await this.access.file(r.customer.id,id,taskId,kind);response.setHeader('Content-Type','application/pdf');response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');return response.send(bytes);}
 @Post('customer/owners/:id/contracts/:taskId/sign') async sign(@Req()r:any,@Param('id')id:string,@Param('taskId')taskId:string,@Body()b:unknown){requireNativeSigning();await requireCurrentConsents(this.db,r.customer.id,['terms','privacy']);const input=reviewInput.parse(b),t=await this.access.detail(r.customer.id,id,taskId);ensure(input.documentHash===t.documentHash&&input.sourceSha256===t.sourceSha256,409,'DOCUMENT_MISMATCH','请核对本份合同全文及PDF');return runNativeSigning(()=>this.gateway.ownerSign(r.customer.id,id,taskId));}
 @Post('customer/owners/:id/contracts/:taskId/manual') async manual(@Req()r:any,@Param('id')id:string,@Param('taskId')taskId:string){await this.access.detail(r.customer.id,id,taskId);return this.gateway.chooseManual(r.customer.id,id,taskId);}
 @Post('customer/owners/:id/contracts/:taskId/sync') async sync(@Req()r:any,@Param('id')id:string,@Param('taskId')taskId:string){await this.access.detail(r.customer.id,id,taskId);return this.gateway.query(taskId,true);}
 @Post('callbacks/fadada-owner-sign') callback(@Body()b:unknown){return this.gateway.callback(b);}
}
