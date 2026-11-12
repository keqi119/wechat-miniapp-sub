import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {workCostTransaction} from './command';
import {WorkOrderCostsService} from './service';
import {WorkOrderFinanceService} from './workflow';

@Controller('admin/asset-work-order-costs')
export class WorkOrderCostsController{
 private readonly costs=new WorkOrderCostsService();private readonly finance=new WorkOrderFinanceService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.costs.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.costs.detail(tx,req.admin,id));}
 @Post(':id/lines')create(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.costs.create(tx,req.admin,id,body));}
 @Post(':id/close')close(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.finance.close(tx,req.admin,id,body));}
 @Post(':id/reopen-cost-review')reopen(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.finance.reopen(tx,req.admin,id,body));}
 @Post(':id/recoveries')recovery(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.finance.recovery(tx,req.admin,id,body));}
 @Post(':id/recoveries/:recordId/void')voidRecovery(@Param('id')id:string,@Param('recordId')recordId:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.finance.voidRecovery(tx,req.admin,id,recordId,body));}
}
@Controller('admin/asset-work-order-cost-lines')
export class WorkOrderCostLinesController{
 private readonly costs=new WorkOrderCostsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.costs.listLines(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.costs.lineDetail(tx,req.admin,id));}
 @Patch(':id')update(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.costs.update(tx,req.admin,id,body));}
 @Post(':id/preview')preview(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.db.serial(tx=>this.costs.preview(tx,req.admin,id,body));}
 @Post(':id/prepare')prepare(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return workCostTransaction(this.db,tx=>this.costs.prepare(tx,req.admin,id,body));}
}
