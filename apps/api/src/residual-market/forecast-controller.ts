import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ResidualForecastsService} from './forecasts';
import {residualForecastTransaction} from './forecast-command';

@Controller('admin/residual-forecasts')
export class ResidualForecastsController{
 private readonly forecasts=new ResidualForecastsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Post('preview')preview(@Body()body:unknown,@Req()req:any){return this.db.serial(tx=>this.forecasts.preview(tx,req.admin,body));}
 @Post()create(@Body()body:unknown,@Req()req:any){return residualForecastTransaction(this.db,tx=>this.forecasts.create(tx,req.admin,body));}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.forecasts.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.forecasts.detail(tx,req.admin,id));}
 @Post(':id/points/:pointId/adopt')adopt(@Param('id')id:string,@Param('pointId')pointId:string,@Body()body:unknown,@Req()req:any){return residualForecastTransaction(this.db,tx=>this.forecasts.adopt(tx,req.admin,id,pointId,body));}
 @Post(':id/archive')archive(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return residualForecastTransaction(this.db,tx=>this.forecasts.archive(tx,req.admin,id,body));}
 @Post(':id/void')void(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return residualForecastTransaction(this.db,tx=>this.forecasts.void(tx,req.admin,id,body));}
}
