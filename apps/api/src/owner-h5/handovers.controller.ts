import {Body,Controller,Get,Inject,Param,Post,Req,Res} from '@nestjs/common';
import {OwnerH5HandoversService} from './handovers.service';
@Controller('owner-h5/owners/:id/handovers')
export class OwnerH5HandoversController {
 constructor(@Inject(OwnerH5HandoversService)private service:OwnerH5HandoversService){}
 @Get() list(@Req()req:any,@Param('id')id:string){return this.service.list(req.ownerH5Customer.id,id);}
 @Get(':taskId') detail(@Req()req:any,@Param('id')id:string,@Param('taskId')taskId:string){return this.service.detail(req.ownerH5Customer.id,id,taskId);}
 @Get(':taskId/files/:variant') async file(@Req()req:any,@Res()res:any,@Param('id')id:string,@Param('taskId')taskId:string,@Param('variant')variant:string){
  const bytes=await this.service.file(req.ownerH5Customer.id,id,taskId,variant);
  res.set({'Content-Type':'application/pdf','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="platform-handover-${variant}.pdf"`});return res.send(bytes);
 }
 @Post(':taskId/sign') sign(@Req()req:any,@Param('id')id:string,@Param('taskId')taskId:string,@Body()body:unknown){return this.service.sign(req.ownerH5Customer.id,id,taskId,body);}
 @Post(':taskId/sync') sync(@Req()req:any,@Param('id')id:string,@Param('taskId')taskId:string,@Body()body:unknown){return this.service.sync(req.ownerH5Customer.id,id,taskId,body);}
}
