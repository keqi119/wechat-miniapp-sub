import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {CompanyAdminService} from './company-admin';

@Controller('admin/partners/:ownerId/company-admin')
export class PartnerCompanyAdminController {
 private readonly service:CompanyAdminService;
 constructor(@Inject(Db)db:Db){this.service=new CompanyAdminService(db);}
 @Get()get(@Req()req:any,@Param('ownerId')ownerId:string){return this.service.get(req.admin,ownerId);}
 @Post('invitation')invite(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.invite(req.admin,ownerId,body);}
 @Post('disable')disable(@Req()req:any,@Param('ownerId')ownerId:string,@Body()body:unknown){return this.service.disable(req.admin,ownerId,body);}
}
