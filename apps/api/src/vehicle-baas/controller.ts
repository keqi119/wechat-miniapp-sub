import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {assetTransaction} from '../asset-costs/command';
import {BaasService} from './service';
@Controller('admin/baas-contracts')
export class VehicleBaasController{
 private readonly baas=new BaasService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.baas.list(tx,request.admin,query));}
 @Get('filter-options')filterOptions(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.baas.filterOptions(tx,request.admin,query));}
 @Get('registration-context')registrationContext(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.baas.registrationContext(tx,request.admin,query));}
 @Get('payer-options')payerOptions(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.baas.payerOptions(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.baas.detail(tx,request.admin,id));}
 @Post()create(@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.create(tx,request.admin,body));}
 @Patch(':id')update(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.update(tx,request.admin,id,body));}
 @Post(':id/activate')activate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.transition(tx,request.admin,id,'activate',body));}
 @Post(':id/suspend')suspend(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.transition(tx,request.admin,id,'suspend',body));}
 @Post(':id/resume')resume(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.transition(tx,request.admin,id,'resume',body));}
 @Post(':id/terminate')terminate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.transition(tx,request.admin,id,'terminate',body));}
 @Post(':id/archive')archive(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.transition(tx,request.admin,id,'archive',body));}
 @Get(':id/cost-preview')preview(@Param('id')id:string,@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.baas.preview(tx,request.admin,id,query));}
 @Post(':id/cost-plans')generate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.baas.generate(tx,request.admin,id,body));}
}
