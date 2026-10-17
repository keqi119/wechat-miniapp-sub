import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {OwnerService} from './owner.service';
import {OwnerIdentityService} from './identity';
import {requireNativeSigning} from '../esign/native-signing';

@Controller('admin/vehicle-owners')
export class OwnerAdminController {
 constructor(@Inject(OwnerService) private service:OwnerService){}
 @Get() list(@Req() req:any){return this.service.list(req.admin.id);}
 @Post() create(@Req() req:any,@Body() body:unknown){return this.service.create(req.admin.id,body);}
 @Get(':id') detail(@Param('id') id:string){return this.service.adminDetail(id);}
 @Post(':id/invitations') invite(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.invite(req.admin.id,id,body);}
 @Post(':id/members/:customerId/suspend') suspend(@Req() req:any,@Param('id') id:string,@Param('customerId') customerId:string){return this.service.suspendMember(req.admin.id,id,customerId);}
}
@Controller('customer/owners')
export class OwnerCustomerController {
 constructor(@Inject(OwnerService) private service:OwnerService,@Inject(OwnerIdentityService) private identity:OwnerIdentityService){}
 @Get() list(@Req() req:any){return this.service.memberships(req.customer.id);}
 @Post('claim') claim(@Req() req:any,@Body() body:unknown){return this.service.claim(req.customer.id,body);}
 @Get(':id') detail(@Req() req:any,@Param('id') id:string){return this.service.memberDetail(req.customer.id,id);}
 @Post(':id/verification') verify(@Req() req:any,@Param('id') id:string,@Body() body:unknown){requireNativeSigning();return this.identity.start(req.customer.id,id,body);}
 @Post(':id/refresh') refresh(@Req() req:any,@Param('id') id:string){return this.identity.refresh(req.customer.id,id);}
 @Get(':id/seals/:sealId/image') image(@Req() req:any,@Param('id') id:string,@Param('sealId') sealId:string){return this.identity.sealImage(req.customer.id,id,sealId);}
 @Post(':id/seal') seal(@Req() req:any,@Param('id') id:string,@Body() body:unknown){const input=z.object({sealId:z.string().min(1).max(100)}).strict().parse(body);return this.identity.selectSeal(req.customer.id,id,input.sealId);}
}
@Controller('callbacks')
export class OwnerCallbacksController {
 constructor(@Inject(OwnerIdentityService) private identity:OwnerIdentityService){}
 @Post('fadada-owner-identity') identityCallback(@Body() body:unknown){return this.identity.callback(body);}
}
