import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ResidualObservationsService} from './observations';
import {residualTransaction} from './observation-command';
@Controller('admin/residual-observations')
export class ResidualObservationsController{
 private readonly observations=new ResidualObservationsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()req:any){return this.db.serial(tx=>this.observations.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.observations.detail(tx,req.admin,id));}
 @Post()create(@Body()body:unknown,@Req()req:any){return residualTransaction(this.db,tx=>this.observations.create(tx,req.admin,body));}
 @Post(':id/ignore')ignore(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return residualTransaction(this.db,tx=>this.observations.transition(tx,req.admin,id,'ignore',body));}
 @Post(':id/restore')restore(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return residualTransaction(this.db,tx=>this.observations.transition(tx,req.admin,id,'restore',body));}
 @Post(':id/void')void(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return residualTransaction(this.db,tx=>this.observations.transition(tx,req.admin,id,'void',body));}
}
