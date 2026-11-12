import {Controller,Get,Inject,Param,Query,Req} from '@nestjs/common';
import {OfflineWorkspaceService} from './workspace.service';
import {adminActor,customerActor,ownerActor} from './archive.controller';
@Controller()
export class OfflineWorkspaceController {
 constructor(@Inject(OfflineWorkspaceService) private service:OfflineWorkspaceService){}
 @Get('admin/workbench') admin(@Query()q:unknown,@Req()r:any){return this.service.workbench(q,adminActor(r));}
 @Get('admin/orders/:id/workspace') adminOrder(@Param('id')id:string,@Req()r:any){return this.service.order(id,adminActor(r));}
 @Get('customer/workbench') customer(@Query()q:unknown,@Req()r:any){return this.service.workbench(q,customerActor(r));}
 @Get('customer/orders/:id/workspace') customerOrder(@Param('id')id:string,@Req()r:any){return this.service.order(id,customerActor(r));}
 @Get('owner-h5/owners/:ownerId/workbench') owner(@Param('ownerId')o:string,@Query()q:unknown,@Req()r:any){return this.service.workbench(q,ownerActor(r,o));}
 @Get('owner-h5/owners/:ownerId/orders/:id/workspace') ownerOrder(@Param('ownerId')o:string,@Param('id')id:string,@Req()r:any){return this.service.order(id,ownerActor(r,o));}
}
