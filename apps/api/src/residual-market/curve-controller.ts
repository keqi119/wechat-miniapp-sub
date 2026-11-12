import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ResidualCurvesService} from './curves';
import {residualCurveTransaction} from './curve-command';

@Controller('admin/residual-curves')
export class ResidualCurvesController{
 private readonly curves=new ResidualCurvesService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Post('preview')preview(@Body()body:unknown,@Req()request:any){return this.db.serial(tx=>this.curves.preview(tx,request.admin,body));}
 @Post()create(@Body()body:unknown,@Req()request:any){return residualCurveTransaction(this.db,tx=>this.curves.create(tx,request.admin,body));}
 @Get()list(@Query()query:unknown,@Req()request:any){return this.db.serial(tx=>this.curves.list(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.curves.detail(tx,request.admin,id));}
 @Post(':id/activate')activate(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return residualCurveTransaction(this.db,tx=>this.curves.activate(tx,request.admin,id,body));}
 @Post(':id/archive')archive(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return residualCurveTransaction(this.db,tx=>this.curves.archive(tx,request.admin,id,body));}
}
