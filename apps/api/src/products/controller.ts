import {Body,Controller,Delete,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {ProductService} from './service';
import {ensure} from '../common/errors';
@Controller('admin')
export class ProductsController {
 private readonly products=new ProductService();
 constructor(@Inject(Db) private readonly db:Db){}
 @Get('products') list(@Query() query:any,@Req() req:any){return this.db.serial(tx=>this.products.list(tx,req.admin,query));}
 @Get('products/:id') detail(@Param('id') id:string,@Req() req:any){return this.db.serial(tx=>this.products.detail(tx,req.admin,id));}
 @Get('products/:id/versions') versions(@Param('id') id:string,@Req() req:any){return this.db.serial(async tx=>{const p=await this.products.detail(tx,req.admin,id);return {items:p.versions,total:p.versions.length};});}
 @Post('products') create(@Body() input:any,@Req() req:any){return this.command(tx=>this.products.createDraft(tx,req.admin,input));}
 @Post('products/:id/versions') version(@Param('id') id:string,@Body() input:any,@Req() req:any){return this.command(tx=>this.products.createDraft(tx,req.admin,input,id));}
 @Patch('products/:id/versions/:versionId') update(@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:any,@Req() req:any){return this.command(async tx=>{await this.ownedVersion(tx,req,id,versionId);return this.products.updateDraft(tx,req.admin,versionId,input);});}
 @Delete('products/:id/versions/:versionId') remove(@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:any,@Req() req:any){return this.command(tx=>this.products.deleteDraft(tx,req.admin,versionId,input,id));}
 @Post('products/:id/publish') publish(@Param('id') id:string,@Body() input:any,@Req() req:any){return this.command(tx=>this.products.publish(tx,req.admin,id,input));}
 @Post('products/:id/versions/:versionId/retire') retire(@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:any,@Req() req:any){return this.command(async tx=>{await this.ownedVersion(tx,req,id,versionId);return this.products.retire(tx,req.admin,versionId,input);});}
 @Post('products/:id/versions/:versionId/suspend') suspend(@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:any,@Req() req:any){return this.command(async tx=>{await this.ownedVersion(tx,req,id,versionId);return this.products.suspend(tx,req.admin,versionId,input);});}
 @Post('products/:id/versions/:versionId/resume') resume(@Param('id') id:string,@Param('versionId') versionId:string,@Body() input:any,@Req() req:any){return this.command(async tx=>{await this.ownedVersion(tx,req,id,versionId);return this.products.resume(tx,req.admin,versionId,input);});}
 @Get('benefit-definitions') benefits(@Req() req:any){return this.db.serial(tx=>this.products.benefits(tx,req.admin));}
 @Get('benefit-definitions/:id') benefit(@Param('id') id:string,@Req() req:any){return this.db.serial(async tx=>{const all=await this.products.benefits(tx,req.admin);const value=all.items.find((i:any)=>i.id===id);ensure(value,404,'NOT_FOUND','权益定义不存在');return value;});}
 @Post('benefit-definitions') newBenefit(@Body() input:any,@Req() req:any){return this.command(tx=>this.products.createBenefitVersion(tx,req.admin,input));}
 @Post('benefit-definitions/:id/versions') benefitVersion(@Param('id') id:string,@Body() input:any,@Req() req:any){return this.command(tx=>this.products.createBenefitVersion(tx,req.admin,input,id));}
 private async command(operation:(tx:any)=>Promise<any>){try{return await this.db.serial(operation);}catch(error:any){if(error.code==='P2002')return this.db.serial(operation);throw error;}}
 private async ownedVersion(tx:any,req:any,id:string,versionId:string){const p=await this.products.detail(tx,req.admin,id);ensure(p.versions.some((v:any)=>v.id===versionId),404,'NOT_FOUND','产品版本不存在');}
}
