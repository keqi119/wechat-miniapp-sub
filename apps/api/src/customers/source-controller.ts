import {Body,Controller,Get,Inject,Param,Patch,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {CustomerSourceService,customerSourceTransaction} from './source';

@Controller('admin/customers')
export class CustomerSourcesController{
 private readonly source=new CustomerSourceService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get(':id/source')read(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.source.read(tx,req.admin,id));}
 @Patch(':id/source')save(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return customerSourceTransaction(this.db,tx=>this.source.save(tx,req.admin,id,body));}
}
