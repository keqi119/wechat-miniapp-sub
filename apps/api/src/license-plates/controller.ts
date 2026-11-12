import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {LicensePlatesService} from './service';
import {plateTransaction} from './command';
@Controller('admin/license-plates')
export class LicensePlatesController{
 private readonly plates=new LicensePlatesService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.plates.list(tx,request.admin,query));}
 @Get('legacy-candidates')candidates(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.plates.candidates(tx,request.admin,query));}
 @Get('owner-options')ownerOptions(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.plates.ownerOptions(tx,request.admin,query));}
 @Get('owner-options/:ownerId')ownerOption(@Param('ownerId')ownerId:string,@Req()request:any){return this.db.serial(tx=>this.plates.ownerOption(tx,request.admin,ownerId));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.plates.detail(tx,request.admin,id));}
 @Post()create(@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.create(tx,request.admin,body));}
 @Patch(':id')update(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.update(tx,request.admin,id,body));}
 @Post(':id/ownership')ownership(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.ownership(tx,request.admin,id,body));}
 @Post(':id/bind')bind(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.bind(tx,request.admin,id,body));}
 @Post(':id/unbind')unbind(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.unbind(tx,request.admin,id,body));}
 @Post(':id/archive')archive(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.archive(tx,request.admin,id,body));}
 @Post(':id/clear-legacy')clearLegacy(@Param('id')id:string,@Body()body:unknown,@Req()request:any){return plateTransaction(this.db,tx=>this.plates.clearLegacy(tx,request.admin,id,body));}
}
