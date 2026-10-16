import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { fileIds, key, pagination, text } from '../common/data';
import { ensure } from '../common/errors';
import { UsageService, periodView } from './usage.service';
import { returnAction, returnView } from './returns';
import { USAGE_CLOCK, shanghaiDay } from './rules';
const financial=(r:any)=>['ADMIN','FINANCE'].includes(r.admin?.role);
const operational=(r:any)=>['ADMIN','OPERATIONS'].includes(r.admin?.role);
const actionDto=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
@Controller()
export class UsageController {
  constructor(@Inject(Db)private db:Db,@Inject(UsageService)private usage:UsageService,@Inject(USAGE_CLOCK)private clock:()=>Date){}
  @Get('customer/orders/:id/usage-account') customer(@Param('id')id:string,@Req()r:any){return this.usage.account(id,r.customer.id);}
  @Get('admin/orders/:id/usage-account') admin(@Param('id')id:string,@Req()r:any){return this.usage.account(id,undefined,financial(r),operational(r));}
  @Post('customer/orders/:id/mileage-packs') purchase(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.usage.purchase(id,r.customer.id,z.object({productId:text,termsVersion:z.literal('MILEAGE_PACK_V1'),termsDocumentId:text,termsDocumentVersion:z.number().int().positive(),termsHash:z.string().length(64),accepted:z.literal(true),idempotencyKey:key}).strict().parse(body));}
  @Post('customer/usage-periods/:id/readings') reading(@Param('id')id:string,@Body()body:any,@Req()r:any){return this.usage.submit(id,r.customer.id,z.object({readingKm:z.number().int().nonnegative().max(2147483647),recordedAt:z.string().datetime({offset:true}),fileIds:fileIds.refine(ids=>ids.length>0,'请上传仪表照片'),idempotencyKey:key}).strict().parse(body));}
  @Get('admin/usage-periods') async periods(@Query()q:any,@Req()r:any){const p=pagination(q),where:any={...(q.keyword?{OR:[{id:{contains:String(q.keyword)}},{orderId:{contains:String(q.keyword)}}]}:{}),...(q.status?{AND:q.status==='AWAITING_READING'?[{OR:[{status:'AWAITING_READING'},{status:'OPEN',effectiveEndDate:{lte:new Date(shanghaiDay(this.clock()))}}]}]:q.status==='OPEN'?[{status:'OPEN',effectiveEndDate:{gt:new Date(shanghaiDay(this.clock()))}}]:[{status:q.status}]}:{})};const [items,total]=await Promise.all([this.db.usagePeriod.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'},include:{account:{include:{order:true}}}}),this.db.usagePeriod.count({where})]);return{items:items.map(i=>{const {account,...period}=i;return periodView(period,this.clock(),account.order.status,financial(r),operational(r));}),total,page:p.page,pageSize:p.pageSize};}
  @Get('admin/usage-periods/:id') async period(@Param('id')id:string,@Req()r:any){const p=await this.db.usagePeriod.findUnique({where:{id},include:{account:{include:{order:true}}}});ensure(p,404,'NOT_FOUND','订阅月不存在');const {account,...period}=p;return periodView(period,this.clock(),account.order.status,financial(r),operational(r));}
  @Post('admin/usage-periods/:id/request-evidence') requestEvidence(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(operational(r),403,'FORBIDDEN','仅运营人员可请求更正补证');return this.usage.requestEvidence(id,actionDto.extend({reason:text}).parse(body),r.admin.id);}
  @Post('admin/usage-periods/:id/settle') settle(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(financial(r),403,'FORBIDDEN','仅财务可结算');return this.usage.settle(id,actionDto.parse(body),r.admin.id);}
  @Get('admin/return-settlements') async returns(@Query()q:any,@Req()r:any){const p=pagination(q),where:any={...(q.status?{status:q.status}:{}),...(q.keyword?{OR:[{id:{contains:String(q.keyword)}},{orderId:{contains:String(q.keyword)}}]}:{})};const [items,total]=await Promise.all([this.db.returnSettlement.findMany({where,skip:p.skip,take:p.take,orderBy:{createdAt:'desc'}}),this.db.returnSettlement.count({where})]);return{items:await Promise.all(items.map(i=>returnView(this.db,i,financial(r)))),total,page:p.page,pageSize:p.pageSize};}
  private async record(id:string,customerId?:string){const row=await this.db.returnSettlement.findFirst({where:{id,...(customerId?{customerId}:{})}});ensure(row,404,'NOT_FOUND','归还结算不存在');return row;}
  @Get('customer/return-settlements/:id') async returnCustomer(@Param('id')id:string,@Req()r:any){return returnView(this.db,await this.record(id,r.customer.id));}
  @Get('admin/return-settlements/:id') async returnAdmin(@Param('id')id:string,@Req()r:any){return returnView(this.db,await this.record(id),financial(r));}
  @Post('customer/return-settlements/:id/dispute') async dispute(@Param('id')id:string,@Body()body:any,@Req()r:any){const input=z.object({reason:text,idempotencyKey:key}).strict().parse(body);await this.record(id,r.customer.id);return this.db.serial(async tx=>returnAction(tx,await tx.returnSettlement.findUniqueOrThrow({where:{id}}),'DISPUTE',input,r.customer.id));}
  @Post('admin/return-settlements/:id/resolve') resolve(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(financial(r),403,'FORBIDDEN','仅财务可处理结算');const input=actionDto.extend({resolutionNote:text}).parse(body);return this.db.serial(async tx=>returnAction(tx,await tx.returnSettlement.findUniqueOrThrow({where:{id}}),'RESOLVE',input,r.admin.id));}
  @Post('admin/return-settlements/:id/complete') complete(@Param('id')id:string,@Body()body:any,@Req()r:any){ensure(financial(r),403,'FORBIDDEN','仅财务可完成结算');const input=actionDto.parse(body);return this.db.serial(async tx=>returnAction(tx,await tx.returnSettlement.findUniqueOrThrow({where:{id}}),'COMPLETE',input,r.admin.id));}
}
