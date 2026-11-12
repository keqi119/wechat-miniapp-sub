import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {VehicleValuationsService} from './service';
import {valuationTransaction} from './command';

@Controller('admin/vehicle-valuations')
export class VehicleValuationsController{
 private readonly valuations=new VehicleValuationsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.valuations.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.valuations.detail(tx,req.admin,id));}
 @Post()create(@Body()body:unknown,@Req()req:any){return valuationTransaction(this.db,tx=>this.valuations.create(tx,req.admin,body));}
 @Post(':id/approve')approve(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return valuationTransaction(this.db,tx=>this.valuations.approve(tx,req.admin,id,body));}
 @Post(':id/reject')reject(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return valuationTransaction(this.db,tx=>this.valuations.reject(tx,req.admin,id,body));}
 @Post(':id/cancel')cancel(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return valuationTransaction(this.db,tx=>this.valuations.cancel(tx,req.admin,id,body));}
}
