import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {assetTransaction} from './command';
import {AssetCostPlansService} from './plans';
import {AssetCostsService} from './service';

@Controller('admin/asset-cost-plans')
export class AssetCostPlansController{
 private readonly plans=new AssetCostPlansService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.plans.list(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.plans.detail(tx,request.admin,id));}
 @Get(':id/reopen-preview')reopenPreview(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.plans.reopenPreview(tx,request.admin,id));}
 @Post(':id/void')void(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.plans.void(tx,request.admin,id,body));}
 @Post(':id/reopen')reopen(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.plans.reopen(tx,request.admin,id,body));}
}
@Controller('admin/asset-costs')
export class AssetCostsController{
 private readonly costs=new AssetCostsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.costs.list(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.costs.detail(tx,request.admin,id));}
 @Post('confirm')confirm(@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.costs.confirm(tx,request.admin,body));}
 @Post(':id/lock')lock(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.costs.lock(tx,request.admin,id,body));}
 @Post(':id/reverse')reverse(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.costs.reverse(tx,request.admin,id,body));}
 @Post(':id/manual-payment')payment(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.costs.manualPayment(tx,request.admin,id,body));}
 @Post(':id/manual-payments/:recordId/void')voidPayment(@Param('id')id:string,@Param('recordId')recordId:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.costs.voidPayment(tx,request.admin,id,recordId,body));}
}
