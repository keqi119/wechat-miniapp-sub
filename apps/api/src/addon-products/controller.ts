import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {USAGE_CLOCK} from '../usage/rules';
import {AddonProductsService} from './service';
import {customerAddonCatalog} from './catalog';
import {kindInput} from './policy';
import {key,text} from '../common/data';
import {requireAddonCustomer} from './customer';
@Controller()
export class AddonProductsController{
 private service=new AddonProductsService();
 constructor(@Inject(Db) private db:Db,@Inject(USAGE_CLOCK) private clock:()=>Date){}
 @Get('admin/addon-products') list(@Query()q:any,@Req()r:any){return this.db.serial(tx=>this.service.list(tx,r.admin,q));}
 @Get('admin/addon-products/:id') detail(@Param('id')id:string,@Req()r:any){return this.db.serial(tx=>this.service.detail(tx,r.admin,id));}
 @Post('admin/addon-products') create(@Body()b:any,@Req()r:any){return this.db.serial(tx=>this.service.save(tx,r.admin,b));}
 @Post('admin/addon-products/:id/versions') version(@Param('id')id:string,@Body()b:any,@Req()r:any){return this.db.serial(tx=>this.service.save(tx,r.admin,b,id));}
 @Patch('admin/addon-products/:id/versions/:versionId') update(@Param('id')id:string,@Param('versionId')versionId:string,@Body()b:any,@Req()r:any){return this.db.serial(tx=>this.service.save(tx,r.admin,b,id,versionId));}
 @Post('admin/addon-products/:id/publish') publish(@Param('id')id:string,@Body()b:any,@Req()r:any){const input=z.object({versionId:text,revision:z.number().int().nonnegative(),idempotencyKey:key}).strict().parse(b);return this.db.serial(tx=>this.service.action(tx,r.admin,id,input.versionId,'publish',{revision:input.revision,idempotencyKey:input.idempotencyKey}));}
 @Post('admin/addon-products/:id/versions/:versionId/:action') action(@Param('id')id:string,@Param('versionId')vid:string,@Param('action')action:string,@Body()b:any,@Req()r:any){z.enum(['suspend','resume','retire']).parse(action);return this.db.serial(tx=>this.service.action(tx,r.admin,id,vid,action,b));}
 @Get('customer/orders/:id/addon-products') catalog(@Param('id')id:string,@Query()q:any,@Req()r:any){const query=z.object({kind:kindInput,targetModelDefinitionId:text.optional()}).strict().parse(q);return this.db.serial(async tx=>{await requireAddonCustomer(tx,r.customer.id,r.session?.id);return customerAddonCatalog(tx,id,r.customer.id,query.kind,this.clock(),query.targetModelDefinitionId);});}
}
