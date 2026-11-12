import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {assetTransaction} from '../asset-costs/command';
import {DepreciationService} from './service';
@Controller('admin/depreciation-policies')
export class VehicleDepreciationController{
 private readonly service=new DepreciationService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.service.list(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.service.detail(tx,request.admin,id));}
 @Post()create(@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.service.create(tx,request.admin,body));}
 @Patch(':id')update(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.service.update(tx,request.admin,id,body));}
 @Post(':id/activate')activate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.service.activate(tx,request.admin,id,body));}
 @Post(':id/archive')archive(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.service.archive(tx,request.admin,id,body));}
 @Post(':id/cost-preview')preview(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return this.db.serial(tx=>this.service.preview(tx,request.admin,id,body));}
 @Post(':id/cost-plans')generate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.service.generate(tx,request.admin,id,body));}
}
