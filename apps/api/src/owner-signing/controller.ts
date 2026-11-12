import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {z} from 'zod';
import {OwnerService} from './owner.service';
import {OwnerIdentityService} from './identity';
import {requireNativeSigning} from '../esign/native-signing';
import {OwnerAuthorizationService} from './authorization';
import {ensure} from '../common/errors';
export function requireOwnerMiniappWrite(){ensure(process.env.OWNER_LEGAL_H5_ONLY!=='true',409,'OWNER_H5_REQUIRED','企业车主业务已迁至法人中心，请由法人本人通过服务号进入办理');}

@Controller('admin/vehicle-owners')
export class OwnerAdminController {
 constructor(@Inject(OwnerService) private service:OwnerService,@Inject(OwnerAuthorizationService) private authority:OwnerAuthorizationService){}
 @Get() list(@Req() req:any){return this.service.list(req.admin.id);}
 @Post() create(@Req() req:any,@Body() body:unknown){return this.service.create(req.admin.id,body);}
 @Get(':id') detail(@Param('id') id:string){return this.service.adminDetail(id);}
 @Post(':id/legal-representative') legal(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.setLegalRepresentative(req.admin.id,id,body);}
 @Post(':id/invitations') invite(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.invite(req.admin.id,id,body);}
 @Post(':id/members/:customerId/suspend') suspend(@Req() req:any,@Param('id') id:string,@Param('customerId') customerId:string){return this.service.suspendMember(req.admin.id,id,customerId);}
 @Post(':id/authorities/:authorityId/pause') pause(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){return this.authority.pause(req.admin.id,id,authorityId);}
 @Post(':id/authorities/:authorityId/review-platform-scope') reviewPlatformScope(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string,@Body() body:unknown){return this.authority.reviewPlatformScope(req.admin.id,id,authorityId,body);}
 @Post(':id/authorities/:authorityId/refresh-platform-scope') refreshPlatformScope(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){return this.authority.refreshPlatformScope(req.admin.id,id,authorityId);}
 @Get(':id/authorities/:authorityId/platform-document')async platformDocument(@Req()req:any,@Param('id')id:string,@Param('authorityId')authorityId:string,@Res()res:any){const file=await this.authority.platformDocument(req.admin.id,id,authorityId);res.set({'Content-Type':'application/pdf','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`});return res.send(file.buffer);}
}
@Controller('customer/owners')
export class OwnerCustomerController {
 constructor(@Inject(OwnerService) private service:OwnerService,@Inject(OwnerIdentityService) private identity:OwnerIdentityService,@Inject(OwnerAuthorizationService) private authority:OwnerAuthorizationService){}
 @Get() list(@Req() req:any){return this.service.memberships(req.customer.id);}
 @Post('claim') claim(@Req() req:any,@Body() body:unknown){requireOwnerMiniappWrite();return this.service.claim(req.customer.id,body);}
 @Get(':id') detail(@Req() req:any,@Param('id') id:string){return this.service.memberDetail(req.customer.id,id);}
 @Post(':id/verification') verify(@Req() req:any,@Param('id') id:string,@Body() body:unknown){requireOwnerMiniappWrite();requireNativeSigning();return this.identity.start(req.customer.id,id,body);}
 @Post(':id/refresh') refresh(@Req() req:any,@Param('id') id:string){requireOwnerMiniappWrite();return this.identity.refresh(req.customer.id,id);}
 @Get(':id/seals/:sealId/image') image(@Req() req:any,@Param('id') id:string,@Param('sealId') sealId:string){return this.identity.sealImage(req.customer.id,id,sealId);}
 @Post(':id/seal') seal(@Req() req:any,@Param('id') id:string,@Body() body:unknown){requireOwnerMiniappWrite();const input=z.object({sealId:z.string().min(1).max(100)}).strict().parse(body);return this.identity.selectSeal(req.customer.id,id,input.sealId);}
 @Get(':id/authorities') authorities(@Req() req:any,@Param('id') id:string){return this.authority.list(req.customer.id,id);}
 @Post(':id/authorities') requestAuthority(@Req() req:any,@Param('id') id:string,@Body() body:unknown){requireOwnerMiniappWrite();requireNativeSigning();return this.authority.request(req.customer.id,id,body);}
 @Post(':id/authorities/:authorityId/refresh') refreshAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){requireOwnerMiniappWrite();return this.authority.refresh(req.customer.id,id,authorityId);}
 @Post(':id/authorities/:authorityId/switch') switchAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string,@Body() body:unknown){requireOwnerMiniappWrite();return this.authority.setEnabled(req.customer.id,id,authorityId,body);}
 @Post(':id/authorities/:authorityId/revoke') revokeAuthority(@Req() req:any,@Param('id') id:string,@Param('authorityId') authorityId:string){requireOwnerMiniappWrite();return this.authority.revoke(req.customer.id,id,authorityId);}
}
@Controller('callbacks')
export class OwnerCallbacksController {
 constructor(@Inject(OwnerIdentityService) private identity:OwnerIdentityService,@Inject(OwnerAuthorizationService)private authority:OwnerAuthorizationService){}
 @Post('fadada-owner-authorization') authorityCallback(@Body() body:unknown){return this.authority.callback(body);}
 @Post('fadada-owner-identity') identityCallback(@Body() body:unknown){return this.identity.callback(body);}
}
