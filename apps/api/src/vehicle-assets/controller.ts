import {Body,Controller,Get,Inject,Param,Patch,Post,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {assetTransaction} from '../asset-costs/command';
import {VehicleAssetsService} from './service';

@Controller('admin/vehicle-assets')
export class VehicleAssetsController{
 private readonly assets=new VehicleAssetsService();
 constructor(@Inject(Db)private readonly db:Db){}
 @Get(':vehicleId')detail(@Param('vehicleId')vehicleId:string,@Req()request:any){return this.db.serial(tx=>this.assets.detail(tx,request.admin,vehicleId));}
 @Patch(':vehicleId')patch(@Param('vehicleId')vehicleId:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.assets.patch(tx,request.admin,vehicleId,body));}
 @Post(':vehicleId/mileage-correction')correctMileage(@Param('vehicleId')vehicleId:string,@Body()body:unknown,@Req()request:any){return assetTransaction(this.db,tx=>this.assets.correctMileage(tx,request.admin,vehicleId,body));}
}
