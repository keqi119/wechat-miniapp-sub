import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ResidualImportsService} from './imports';
import {residualTransaction} from './observation-command';
@Controller('admin/residual-imports')
export class ResidualImportsController{
 private readonly imports=new ResidualImportsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Post('preview')preview(@Body()body:unknown,@Req()req:any){return this.db.serial(tx=>this.imports.preview(tx,req.admin,body));}
 @Post()commit(@Body()body:unknown,@Req()req:any){return residualTransaction(this.db,tx=>this.imports.commit(tx,req.admin,body));}
 @Get()list(@Query()query:any,@Req()req:any){return this.db.serial(tx=>this.imports.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.imports.detail(tx,req.admin,id));}
}
