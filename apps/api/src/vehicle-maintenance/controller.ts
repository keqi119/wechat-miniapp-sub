import {Body,Controller,Get,Inject,Param,Patch,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {workOrderTransaction} from '../asset-work-orders/command';
import {MaintenanceService} from './service';
@Controller('admin/vehicle-maintenance')
export class VehicleMaintenanceController{
 private readonly service=new MaintenanceService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get(':vehicleId')detail(@Param('vehicleId')id:string,@Req()req:any){return this.db.serial(tx=>this.service.detail(tx,req.admin,id));}
 @Patch(':vehicleId')patch(@Param('vehicleId')id:string,@Body()body:unknown,@Req()req:any){return workOrderTransaction(this.db,tx=>this.service.patch(tx,req.admin,id,body));}
}
