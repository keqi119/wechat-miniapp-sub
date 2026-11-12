import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {PortalAccessService} from './portal-access';
@Controller('admin/partners/:ownerId/portal-access')
export class PartnerPortalController{
 private service:PortalAccessService;
 constructor(@Inject(Db)db:Db){this.service=new PortalAccessService(db);}
 @Get()get(@Req()req:any,@Param('ownerId')ownerId:string){return this.service.get(req.admin,ownerId);}
 @Post()save(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.save(req.admin,ownerId,body);}
 @Post('submit')submit(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.submit(req.admin,ownerId,body);}
 @Post('review')review(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.review(req.admin,ownerId,body);}
 @Post('disable')disable(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.disable(req.admin,ownerId,body);}
}
