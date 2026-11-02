import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {ensure} from '../common/errors';
import {Db} from '../common/db';
import {requireCurrentConsents} from '../auth/consents';
import {ESIGN_SETTINGS} from '../esign/esign.controller';
import type {FadadaSettings} from '../esign/esign.settings';
import {ElectronicDocumentService} from './service';
import type {ElectronicActor} from './access';
const query=z.object({orderId:z.string().min(1).max(100).optional()}).strict();
const admin=(req:any):ElectronicActor=>({kind:'ADMIN',id:req.admin.id});
const customer=(req:any):ElectronicActor=>({kind:'CUSTOMER',id:req.customer.id});
const owner=(req:any,ownerId:string):ElectronicActor=>{ensure(req.ownerH5Customer,403,'PARTNER_READ_ONLY','资料查看账号不能办理签署，请由登记本人登录签署入口');return{kind:'OWNER',id:req.ownerH5Customer.id,ownerId};};
async function sendFile(service:ElectronicDocumentService,actor:ElectronicActor,id:string,variant:string,res:any){ensure(variant==='source'||variant==='signed',404,'NOT_FOUND','文件不存在');const file=await service.file(actor,id,variant);res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});return res.send(file.bytes);}
@Controller('admin/electronic-documents')
export class ElectronicAdminController{
 constructor(@Inject(ElectronicDocumentService)private service:ElectronicDocumentService){}
 @Get()list(@Req()req:any,@Query()raw:unknown){return this.service.list(admin(req),query.parse(raw).orderId);}
 @Get(':id')detail(@Req()req:any,@Param('id')id:string){return this.service.detail(admin(req),id);}
 @Get(':id/files/:variant')file(@Req()req:any,@Param('id')id:string,@Param('variant')variant:string,@Res()res:any){return sendFile(this.service,admin(req),id,variant,res);}
 @Post(':id/start')start(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.service.start(admin(req),id,body);}
 @Post(':id/sync')sync(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.service.sync(admin(req),id,body);}
 @Post(':id/withdraw')withdraw(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.service.withdraw(admin(req),id,body);}
}
@Controller('customer/electronic-documents')
export class ElectronicCustomerController{
 constructor(@Inject(ElectronicDocumentService)private service:ElectronicDocumentService,@Inject(Db)private db:Db){}
 @Get()list(@Req()req:any,@Query()raw:unknown){return this.service.list(customer(req),query.parse(raw).orderId);}
 @Get(':id')detail(@Req()req:any,@Param('id')id:string){return this.service.detail(customer(req),id);}
 @Get(':id/files/:variant')file(@Req()req:any,@Param('id')id:string,@Param('variant')variant:string,@Res()res:any){return sendFile(this.service,customer(req),id,variant,res);}
 @Post(':id/sign')async sign(@Req()req:any,@Param('id')id:string,@Body()body:unknown){await requireCurrentConsents(this.db,req.customer.id,['terms','privacy']);return this.service.sign(customer(req),id,body);}
 @Post(':id/sync')sync(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.service.sync(customer(req),id,body);}
}
@Controller('owner-h5/owners/:ownerId/electronic-documents')
export class ElectronicOwnerController{
 constructor(@Inject(ElectronicDocumentService)private service:ElectronicDocumentService){}
 @Get()list(@Req()req:any,@Param('ownerId')ownerId:string,@Query()raw:unknown){return this.service.list(owner(req,ownerId),query.parse(raw).orderId);}
 @Get(':id')detail(@Req()req:any,@Param('ownerId')ownerId:string,@Param('id')id:string){return this.service.detail(owner(req,ownerId),id);}
 @Get(':id/files/:variant')file(@Req()req:any,@Param('ownerId')ownerId:string,@Param('id')id:string,@Param('variant')variant:string,@Res()res:any){return sendFile(this.service,owner(req,ownerId),id,variant,res);}
 @Post(':id/sign')sign(@Req()req:any,@Param('ownerId')ownerId:string,@Param('id')id:string,@Body()body:unknown){return this.service.sign(owner(req,ownerId),id,body);}
 @Post(':id/sync')sync(@Req()req:any,@Param('ownerId')ownerId:string,@Param('id')id:string,@Body()body:unknown){return this.service.sync(owner(req,ownerId),id,body);}
}
@Controller('callbacks')
export class ElectronicCallbackController{
 constructor(@Inject(ElectronicDocumentService)private service:ElectronicDocumentService,@Inject(ESIGN_SETTINGS)private config:FadadaSettings){}
 @Post('fadada-electronic-sign')callback(@Body()body:unknown){ensure(this.config.enabled,503,'FADADA_DISABLED','电子签回调尚未配置');return this.service.callback(body,this.config);}
}
export const electronicControllers=[ElectronicAdminController,ElectronicCustomerController,ElectronicOwnerController,ElectronicCallbackController];
