import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import {Db} from '../common/db';
import {ensure} from '../common/errors';
import {pagination} from '../common/data';
import {mutation} from './rules';
import {TechnicalAcceptanceService} from './service';
import {TechnicalAcceptanceSigning} from './signing';
import {TechnicalAcceptanceRetention} from './retention';
@Controller()
export class TechnicalAcceptanceController{
 constructor(@Inject(Db)private db:Db,@Inject(TechnicalAcceptanceService)private service:TechnicalAcceptanceService,@Inject(TechnicalAcceptanceSigning)private signing:TechnicalAcceptanceSigning,@Inject(TechnicalAcceptanceRetention)private retention:TechnicalAcceptanceRetention){}
 @Get('admin/technical-acceptances')async list(@Req()r:any){const p=pagination(r.query),where:any={};if(r.query.keyword)where.id={contains:String(r.query.keyword).slice(0,200)};const rows=await this.db.technicalAcceptance.findMany({where,orderBy:{createdAt:'desc'}});let items=await Promise.all(rows.map(row=>this.service.view(row.id,true,undefined,true)));if(r.query.status)items=items.filter(i=>i.status===r.query.status);return{items:items.slice(p.skip,p.skip+p.take),total:items.length,page:p.page,pageSize:p.pageSize};}
 @Get('admin/technical-acceptances/:id')detail(@Param('id')id:string){return this.service.view(id,true);}
 @Post('admin/technical-acceptances')create(@Req()r:any,@Body()body:any){return this.service.create(body,r.admin.id);}
 @Post('admin/technical-acceptances/:id/prepare-signature')prepare(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.service.prepare(id,r.admin.id,mutation.extend({policyId:z.string().min(1)}).parse(body));}
 @Post('admin/technical-acceptances/:id/stop')stop(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.service.stop(id,r.admin.id,mutation.parse(body));}
 @Post('admin/technical-acceptances/:id/retention-review')review(@Param('id')id:string,@Req()r:any,@Body()body:any){ensure(r.admin.role==='ADMIN',403,'FORBIDDEN','仅管理员可复核保留期限');return this.retention.review(id,r.admin.id,mutation.extend({legalHold:z.boolean(),reason:z.string().trim().min(1).max(500)}).parse(body));}
 @Post('admin/technical-acceptances/:id/purge')purge(@Param('id')id:string,@Req()r:any,@Body()body:any){ensure(r.admin.role==='ADMIN',403,'FORBIDDEN','仅管理员可清理资料');return this.retention.purge(id,r.admin.id,mutation.extend({reason:z.string().trim().min(1).max(500)}).parse(body));}
 @Get('customer/technical-acceptances')async mine(@Req()r:any){const rows=await this.db.technicalAcceptance.findMany({where:{customerId:r.customer.id},orderBy:{createdAt:'desc'}});return{items:await Promise.all(rows.map(row=>this.service.view(row.id,false,r.customer.id,true)))};}
 @Get('customer/technical-acceptances/:id')customerDetail(@Param('id')id:string,@Req()r:any){return this.service.view(id,false,r.customer.id);}
 @Get('customer/technical-acceptances/:id/sign-status')status(@Param('id')id:string,@Req()r:any){return this.service.view(id,false,r.customer.id);}
 @Post('customer/technical-acceptances/:id/confirm')confirm(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.service.confirm(id,r.customer.id,body);}
 @Post('customer/technical-acceptances/:id/sign')sign(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.signing.sign(id,r.customer.id,mutation.parse(body));}
 @Post('customer/technical-acceptances/:id/sync')sync(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.signing.sync(id,r.customer.id,mutation.parse(body));}
 @Post('customer/technical-acceptances/:id/stop')customerStop(@Param('id')id:string,@Req()r:any,@Body()body:any){return this.service.stop(id,r.customer.id,mutation.parse(body),r.customer.id);}
}
