import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { StaffService } from './staff.service';
@Controller('admin/users')
export class StaffController {
 constructor(@Inject(StaffService) private staff:StaffService){}
 @Post(':id/partner-capabilities') capabilities(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.staff.setPartnerCapabilities(id,body,req.admin);}
 @Post(':id/staff-person') person(@Param('id')id:string,@Body()body:unknown,@Req()req:any){return this.staff.setStaffPerson(id,body,req.admin);}
 @Post(':id/role') role(@Param('id') id:string,@Body() body:unknown,@Req() req:any){return this.staff.changeRole(id,body,req.admin);}
 @Post(':id/disable') disable(@Param('id') id:string,@Body() body:unknown,@Req() req:any){return this.staff.setActive(id,false,body,req.admin);}
 @Post(':id/enable') enable(@Param('id') id:string,@Body() body:unknown,@Req() req:any){return this.staff.setActive(id,true,body,req.admin);}
 @Post(':id/reset-password') reset(@Param('id') id:string,@Body() body:unknown,@Req() req:any){return this.staff.resetPassword(id,body,req.admin);}
 @Post(':id/revoke-sessions') revoke(@Param('id') id:string,@Body() body:unknown,@Req() req:any){return this.staff.revokeSessions(id,body,req.admin);}
}
