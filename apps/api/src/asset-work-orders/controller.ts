import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {workOrderTransaction} from './command';
import {WorkOrdersService} from './service';
import {ServiceSourceOptionsService} from './service-source-options';
@Controller('admin/asset-work-orders')
export class AssetWorkOrdersController{
 private readonly service=new WorkOrdersService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()req:any){return this.db.serial(tx=>this.service.list(tx,req.admin,query));}
 @Get('assignee-options')assignees(@Query()query:any,@Req()req:any){return this.db.serial(tx=>this.service.assigneeOptions(tx,req.admin,query));}
 @Get('service-source-options')sourceOptions(@Query()query:any,@Req()req:any){return this.db.serial(tx=>new ServiceSourceOptionsService().list(tx,req.admin,query));}
 @Get('service-source-options/:sourceId')sourceOption(@Param('sourceId')id:string,@Query()query:any,@Req()req:any){return this.db.serial(tx=>new ServiceSourceOptionsService().detail(tx,req.admin,id,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.service.detail(tx,req.admin,id));}
 @Post()create(@Body()body:unknown,@Req()req:any){return workOrderTransaction(this.db,tx=>this.service.create(tx,req.admin,body));}
 @Patch(':id')patch(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workOrderTransaction(this.db,tx=>this.service.patch(tx,req.admin,id,body));}
 private action(id:string,action:string,body:unknown,req:any){return workOrderTransaction(this.db,tx=>this.service.action(tx,req.admin,id,action,body));}
 @Post(':id/assign')assign(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'assign',body,req);}
 @Post(':id/start')start(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'start',body,req);}
 @Post(':id/wait')wait(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'wait',body,req);}
 @Post(':id/resume')resume(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'resume',body,req);}
 @Post(':id/submit-acceptance')submit(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'submit-acceptance',body,req);}
 @Post(':id/accept')accept(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'accept',body,req);}
 @Post(':id/return-for-work')returnForWork(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'return-for-work',body,req);}
 @Post(':id/cancel')cancel(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'cancel',body,req);}
 @Post(':id/notes')notes(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'notes',body,req);}
 @Post(':id/claim')claim(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.action(id,'claim',body,req);}
 @Post(':id/restrictions')restrict(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workOrderTransaction(this.db,tx=>this.service.restrict(tx,req.admin,id,body));}
 @Post(':id/restrictions/:restrictionId/release')release(@Param('id')id:string,@Param('restrictionId')restrictionId:string,@Body()body:unknown,@Req()req:any){return workOrderTransaction(this.db,tx=>this.service.release(tx,req.admin,id,restrictionId,body));}
}
