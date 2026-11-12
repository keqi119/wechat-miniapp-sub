import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {GoodsService} from './service';
import {readGoodsPublicationReadiness} from '../vehicles/publish-readiness';
@Controller('admin/goods')
export class GoodsController {
 private readonly goods=new GoodsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get()list(@Query()query:any,@Req()request:any){return this.db.serial(tx=>this.goods.list(tx,request.admin,query));}
 @Get(':id')detail(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.goods.detail(tx,request.admin,id));}
 @Get(':id/app-preview')preview(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>this.goods.appPreview(tx,request.admin,id));}
 @Patch(':id/presentation')presentation(@Param('id')id:string,@Body()input:unknown,@Req()request:any){return this.command(tx=>this.goods.updatePresentation(tx,request.admin,id,input));}
 @Get(':id/publish-readiness')readiness(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>readGoodsPublicationReadiness(tx,request.admin,id));}
 @Post()create(@Body()input:unknown,@Req()request:any){return this.command(tx=>this.goods.create(tx,request.admin,input));}
 @Patch(':id')update(@Param('id')id:string,@Body()input:unknown,@Req()request:any){return this.command(tx=>this.goods.update(tx,request.admin,id,input));}
 @Post(':id/publish')publish(@Param('id')id:string,@Body()input:unknown,@Req()request:any){return this.command(tx=>this.goods.publish(tx,request.admin,id,input));}
 @Post(':id/withdraw')withdraw(@Param('id')id:string,@Body()input:unknown,@Req()request:any){return this.command(tx=>this.goods.withdraw(tx,request.admin,id,input));}
 private async command(operation:(tx:any)=>Promise<any>){try{return await this.db.serial(operation);}catch(error:any){if(error.code==='P2002')return this.db.serial(operation);throw error;}}
}
