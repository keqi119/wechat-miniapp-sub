import {Controller,Get,Inject,Param,Query,Req} from '@nestjs/common';
import {Db} from '../common/db';
import {requireSimplePartnerOperator} from './simple-access';
import {requirePartnerReadAccess} from './portal-session';
import {readSimpleRevenue} from './simple-revenue';

@Controller()
export class SimplePartnerRevenueController {
 constructor(@Inject(Db)private db:Db){}
 @Get('admin/partners/:ownerId/revenue')
 admin(@Req()request:any,@Param('ownerId')ownerId:string,@Query()query:unknown){return this.db.serial(async tx=>{await requireSimplePartnerOperator(tx,request.admin);return readSimpleRevenue(tx,ownerId,query);});}
 @Get('owner-h5/owners/:ownerId/revenue')
 portal(@Req()request:any,@Param('ownerId')ownerId:string,@Query()query:unknown){return this.db.serial(async tx=>{await requirePartnerReadAccess(tx,request.partnerPortalSession,ownerId);return readSimpleRevenue(tx,ownerId,query);});}
}
