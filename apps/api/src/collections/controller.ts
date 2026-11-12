import {Body,Controller,Get,Inject,Param,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {collectionTransaction} from './command';
import {CollectionsService} from './service';
import {OverdueBillsService} from './overdue';

@Controller('admin/overdue-bills')
export class OverdueBillsController{
 private readonly service=new OverdueBillsService();constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.service.list(tx,req.admin,query));}
}
@Controller('admin/collection-cases')
export class CollectionCasesController{
 private readonly service=new CollectionsService();constructor(@Inject(Db)private readonly db:Db){}
 @Post('preview')preview(@Body()body:unknown,@Req()req:any){return this.db.serial(tx=>this.service.preview(tx,req.admin,body));}
 @Get()list(@Query()query:unknown,@Req()req:any){return this.db.serial(tx=>this.service.list(tx,req.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()req:any){return this.db.serial(tx=>this.service.detail(tx,req.admin,id));}
 @Post()create(@Body()body:unknown,@Req()req:any){return collectionTransaction(this.db,tx=>this.service.create(tx,req.admin,body));}
 @Post(':id/refresh')refresh(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return collectionTransaction(this.db,tx=>this.service.refresh(tx,req.admin,id,body));}
 @Post(':id/actions')contact(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return collectionTransaction(this.db,tx=>this.service.contact(tx,req.admin,id,body));}
 @Post(':id/close')close(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return collectionTransaction(this.db,tx=>this.service.close(tx,req.admin,id,body));}
}
