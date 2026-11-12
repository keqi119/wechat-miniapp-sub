import {safeRefund} from '../billing/refund-proof';
import {readAdminOrders} from '../orders/admin-query';
import {activateLegalTemplate,legalContentHash} from './legal-template';
import {v31TemplateTypes,validateV31Template,v31TemplateType} from '../contract-terms/template-map';
import {customerSourceFilter} from '../customers/source';
import {withAdminCustomerIdentity} from '../customers/admin-identity';
import {vehicleCommand,normalizeVin,guardedVehicles,validateVehicleIdentity} from '../vehicles/commands';
import {modelCommand} from '../vehicles/model-command';
import {readAdminVehicles,readAdminVehicle,readVehicleFilterOptions} from '../vehicles/admin-query';
import {readRecordCustomerProfile,readRecordCustomerProfileFile} from '../customers/profile-review';
import {streamFile} from '../files/storage';
import {assertNotAssetFiles} from '../files/asset-files';
import {buildWorkbenchSummary} from './workbench-summary';
import {requireCurrentStaff} from '../auth/staff-session';
import { StaffService } from '../auth/staff.service';
import {staffPassword} from '../auth/password-policy';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { audit, fileIds, money, pagination, text } from '../common/data';
import { ensure, fail } from '../common/errors';
import { allowed } from '../auth/access';
import { passwordHash } from '../auth/auth.service';
import { applicationInclude, applicationView } from '../applications/applications';
import {billPublicationView,withBillPublication} from '../billing/publication-view';
import {readVehiclePublicationReadiness,readVehicleActivationReadiness,requireVehicleActivationReady} from '../vehicles/publish-readiness';
import {readVehicleCatalogReadiness,setVehicleCatalogPublished} from '../vehicles/catalog-publication';
export const delegates: Record<string, string> = { 'model-definitions': 'modelDefinition', vehicles: 'vehicle', plans: 'subscriptionPlan', customers: 'customer', applications: 'application', orders: 'order', contracts: 'contract', bills: 'bill', payments: 'payment', deposits: 'depositEntry', refunds: 'refund', handovers: 'handover', mileages: 'mileage', entitlements: 'entitlement', services: 'serviceRequest', notifications: 'notification', users: 'adminUser', 'audit-logs': 'auditLog', 'legal-documents': 'legalDocument' };
const vehicleDto = z.object({ modelDefinitionId: z.string().nullable().optional(), brand: text, model: text, title: text, vin:z.string().trim().min(1).max(100).nullable().optional(),plateNumber:z.string().trim().min(1).max(50).nullable().optional(), year: z.number().int().min(1990).max(2100), city: text, mileageKm: z.number().int().nonnegative(), batteryHealthPercent: z.number().int().min(0).max(100).nullable().optional(), description: z.string().max(5000).default(''), conditionDisclosure: z.string().max(10000).default(''), coverFileId: z.string().nullable().optional(), mediaFileIds: fileIds });
const planDto = z.object({ vehicleId: text, name: text, months: z.number().int().min(1).max(120), monthlyFeeAmount: money.positive(), mileagePerMonthKm: z.number().int().nonnegative(), excessMileagePriceAmount: money, energyDescription: text, benefits: z.array(text).max(50), conditions: text });
const schemas: Record<string, z.ZodObject<any>> = {
  'model-definitions': z.object({ brand: text, name: text, modelYear:z.number().int().min(1900).max(2100).nullable().optional(), bodyType: z.string().max(100).default(''), description: z.string().max(5000).default('') }),
  vehicles: vehicleDto, plans: planDto,
  users: z.object({ username: z.string().min(3).max(100), password: staffPassword, name: text, role: z.enum(['ADMIN','OPERATIONS','FINANCE','SUPPORT','FIELD']), active: z.boolean().default(true) }),
  'legal-documents': z.object({ type: z.enum([...v31TemplateTypes,'application','privacy','terms','subscription','handover','credit-verification','mileage-pack','swap-credit-v2','usage-policy','usage-policy-v2','vehicle-change','delivery-delay-amendment','vehicle-change-amendment','technical-signing-verification','handover-location','owner-identity','owner-authorization-letter','owner-auto-sign','owner-data-sharing','owner-rental-contract','owner-delivery-delay','owner-vehicle-change','owner-handover','OFFLINE_OWNER_COOPERATION','OFFLINE_RENTAL','OFFLINE_DELIVERY_RECEIPT','OFFLINE_RETURN_RECEIPT','OFFLINE_TERMINATION','OFFLINE_ORDER_AMENDMENT','OFFLINE_RENEWAL_CANCELLATION','ONLINE_HANDOVER_TERMS']), version: z.number().int().positive(), title: text, content: z.string().min(1).max(100000), confirmedBy: z.string().min(1).optional(), confirmedAt: z.string().datetime().optional() }),
  entitlements: z.object({ orderId: text, title: text, description: text, status: z.enum(['PENDING','ACTIVE','EXPIRED']).default('PENDING') }),
  notifications: z.object({ customerId: text, title: text, content: z.string().min(1).max(5000), resourceType: text.optional(), resourceId: text.optional() }),
};
function withoutCredit(value:any):any {
  if(Array.isArray(value))return value.map(withoutCredit);
  if(!value||typeof value!=='object'||value instanceof Date)return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['creditBand','creditVerificationId','creditRevision','creditRuleVersion','standardDepositAmount','riskSnapshot','revenueRuleSnapshot','qualificationSnapshot','customerProfileSnapshot','profile','legalIdentityFileId'].includes(key)).map(([key,item])=>[key,withoutCredit(item)]));
}
function contractSigningView(value:any){
  const {order,...contract}=value,snapshot=order?.finalPlanSnapshot;
  // Older electronic rows may contain privately rendered text; generic JSON must not expose it.
  if(contract.executionMode==='ELECTRONIC')delete contract.body;
  const validSnapshot=snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot);
  const hasLessor=validSnapshot&&Object.prototype.hasOwnProperty.call(snapshot,'lessorSnapshot'),lessor=hasLessor?snapshot.lessorSnapshot:null;
  const validLessor=lessor&&typeof lessor==='object'&&!Array.isArray(lessor)&&typeof lessor.ownerId==='string'&&lessor.ownerId.trim()&&typeof lessor.name==='string'&&lessor.name.trim();
  const confirmedPlan=validSnapshot&&typeof snapshot.commercialHash==='string'&&/^[a-f0-9]{64}$/.test(snapshot.commercialHash)&&[snapshot.monthlyFeeAmount,snapshot.depositAmount].every(amount=>Number.isSafeInteger(amount)&&amount>=0&&amount<=2147483647)&&Number.isInteger(snapshot.months)&&snapshot.months>0&&snapshot.months<=120;
  return{...contract,signingFlow:validSnapshot?(hasLessor?(validLessor?'OWNER':'UNKNOWN'):(confirmedPlan?'PLATFORM':'UNKNOWN')):'UNKNOWN',ownerId:validLessor?lessor.ownerId:null,ownerName:validLessor?lessor.name:null};
}
function safe(resource: string, value: any, role?:string) { if (!value) return value; if(resource==='refunds')return safeRefund(value); if(resource==='legal-documents')return {...value,contentHash:legalContentHash(value)}; if(resource==='handovers'&&!['ADMIN','OPERATIONS'].includes(role||''))return Object.fromEntries(['id','orderId','customerId','type','status','revision','customerResponse','completedAt','createdAt','updatedAt'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])); if(resource==='contracts'){value=contractSigningView(value);if(!['ADMIN','OPERATIONS'].includes(role||'')){const{body,sourceFileId,signedFileId,...summary}=value;return summary;}} if (resource === 'users') { const { passwordHash: _, ...rest } = value; return rest; } if (resource === 'customers'&&!['ADMIN','OPERATIONS'].includes(role||'')) return {id:value.id,name:value.name,mobile:typeof value.mobile==='string'?value.mobile.replace(/^(\d{3})\d+(\d{4})$/,'$1****$2'):'',createdAt:value.createdAt,updatedAt:value.updatedAt}; if (resource === 'customers') { const { openId: _, providerCustomerId: __, ...rest } = value; return rest; } if(['applications','orders'].includes(resource)&&!['ADMIN','OPERATIONS'].includes(role||''))return withoutCredit(value); return value; }
@Controller('admin')
export class AdminController {
  constructor(@Inject(Db) private db: Db) {}
  @Get(':resource/:id/customer-profile') customerProfile(@Param('resource') resource:string,@Param('id') id:string,@Req() request:any){return this.db.serial(tx=>readRecordCustomerProfile(tx,resource,id,request.admin));}
  @Get(':resource/:id/customer-profile/files/:fileId') async customerProfileFile(@Param('resource') resource:string,@Param('id') id:string,@Param('fileId') fileId:string,@Req() request:any,@Res() response:any){const file=await this.db.serial(tx=>readRecordCustomerProfileFile(tx,resource,id,fileId,request.admin));return streamFile(file,response);}
  @Get('dashboard') async dashboard(@Req() request: any) {
    const role=request.admin.role,readCount=(resource:string,query:()=>Promise<number>)=>allowed(role,resource,false)?query():Promise.resolve(0);
    const [applications, contracts, bills, handovers, services, recentActivity, refunds, paymentExceptions,workbench] = await Promise.all([
      readCount('applications',()=>this.db.application.count({where:{status:{in:['SUBMITTED','IN_REVIEW','NEEDS_INFO']}}})),
      readCount('contracts',()=>this.db.contract.count({where:{status:{in:['DRAFT','PENDING']}}})),
      readCount('bills',()=>this.db.bill.count({where:{status:'PENDING'}})),
      readCount('handovers',()=>this.db.handover.count({where:{status:{notIn:['COMPLETED','SUPERSEDED']}}})),
      readCount('services',()=>this.db.serviceRequest.count({where:{status:{in:['SUBMITTED','ACCEPTED','ASSIGNED','IN_PROGRESS']}}})),
      allowed(role,'audit-logs',false)?this.db.auditLog.findMany({take:10,orderBy:{createdAt:'desc'}}):Promise.resolve([]),
      readCount('refunds',()=>this.db.refund.count({where:{status:{in:['PENDING_APPROVAL','PROCESSING']}}})),
      readCount('payments',()=>this.db.payment.count({where:{reconciliationRequired:true}})),buildWorkbenchSummary(this.db,role)
    ]);
    return { counts: { applications, contracts, bills, handovers, services, refunds, paymentExceptions }, recentActivity,workbench };
  }
  @Get('vehicles/filter-options') vehicleFilterOptions(@Query()query:any,@Req()request:any){return this.db.serial(tx=>readVehicleFilterOptions(tx,request.admin,query));}
  @Get(':resource') async list(@Param('resource') resource: string, @Query() query: any, @Req() request:any) {
    if(resource==='orders')return this.db.serial(tx=>readAdminOrders(tx,request.admin,query));
    if(resource==='vehicles')return this.db.serial(tx=>readAdminVehicles(tx,request.admin,query));
    if(resource==='users') return new StaffService(this.db).list(query,request.admin);
    const delegate = delegates[resource]; ensure(delegate, 404, 'NOT_FOUND', '资源不存在'); const p = pagination(query); const where: any = resource==='customers'?await customerSourceFilter(this.db,request.admin,query):{};
    if(resource==='legal-documents'&&query.type)where.type=String(query.type);
    if(resource==='payments'&&query.reconciliationRequired!==undefined){ensure(['true','false'].includes(String(query.reconciliationRequired)),400,'VALIDATION','请提供有效对账筛选');where.reconciliationRequired=String(query.reconciliationRequired)==='true';}
    if (query.status && !['customers','users','audit-logs','model-definitions','notifications','deposits'].includes(resource)) where.status = query.status;
    const searchFields: Record<string,string[]> = { vehicles: ['title','brand','model','vin','plateNumber'], 'model-definitions': ['name','brand'], plans: ['name'], customers: ['name','mobile'], users: ['name','username'], 'legal-documents': ['title'], services: ['description','mobile'], notifications: ['title','content'] };
    if (query.keyword) where.OR = (searchFields[resource] || ['id']).map(field => ({ [field]: { contains: String(query.keyword), mode: 'insensitive' } }));
    const model = (this.db as any)[delegate]; const [items, total] = await Promise.all([model.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' }, ...(['applications','orders'].includes(resource) ? { include: { customer: { select: { id:true,name:true,mobile:true } },vehicle: { select: { id:true,title:true } } } } : resource==='contracts'?{include:{order:{select:{finalPlanSnapshot:true}}}}:{}) }), model.count({ where })]);
    const projected=resource==='bills'?await withBillPublication(this.db,items):resource==='customers'?await withAdminCustomerIdentity(this.db,items,request.admin.role):items;
    return { items: projected.map((i: any) => safe(resource, i, request.admin.role)), total, page: p.page, pageSize: p.pageSize };
  }
  @Get(':resource/:id') async detail(@Param('resource') resource: string, @Param('id') id: string, @Req() request:any) {
    if(resource==='vehicles')return this.db.serial(tx=>readAdminVehicle(tx,request.admin,id));
    if(resource==='users') return new StaffService(this.db).detail(id,request.admin);
    ensure(delegates[resource], 404, 'NOT_FOUND', '资源不存在');
    const customerSelect={id:true,name:true,mobile:true};
    const value = await (this.db as any)[delegates[resource]].findUnique({ where: { id }, ...(resource === 'applications' ? { include: {...applicationInclude,customer:{select:customerSelect}} } :resource==='orders'?{include:{customer:{select:customerSelect}}}: resource==='contracts'?{include:{order:{select:{finalPlanSnapshot:true}}}}:{}) });
    ensure(value, 404, 'NOT_FOUND', '记录不存在');const staff=['ADMIN','OPERATIONS'].includes(request.admin.role),result=resource==='applications'?{...applicationView(value,staff),customer:value.customer,...(staff?{note:value.note||''}:{})}:value;
    if(['applications','orders'].includes(resource)&&staff)result.customerProfileUrl=`/api/admin/${resource}/${encodeURIComponent(id)}/customer-profile`;
    if(resource==='bills')result.publication=await billPublicationView(this.db,result);
    if(resource==='customers')return safe(resource,(await withAdminCustomerIdentity(this.db,[result],request.admin.role))[0],request.admin.role);
    return safe(resource,result,request.admin.role);
  }
  @Post(':resource') create(@Param('resource') resource: string, @Body() body: any, @Req() request: any) { return this.write(resource, undefined, body, request); }
  @Patch(':resource/:id') patch(@Param('resource') resource: string, @Param('id') id: string, @Body() body: any, @Req() request: any) { return this.write(resource, id, body, request); }
  private async write(resource: string, id: string | undefined, body: any, request: any) {
    ensure(resource!=='entitlements'&&!(resource==='plans'&&process.env.MVP_V2_ENABLED==='true'),405,'ACTION_REQUIRED','请通过产品版本或权益履约专用操作办理');
    if(resource==='users') return id ? new StaffService(this.db).rename(id,body,request.admin) : new StaffService(this.db).create(body,request.admin);
    const schema = schemas[resource]; ensure(schema, 405, 'ACTION_REQUIRED', '该资源只能通过专门业务动作变更');
    const payload=['vehicles','model-definitions'].includes(resource)?Object.fromEntries(Object.entries(body).filter(([k])=>!['revision','idempotencyKey'].includes(k))):body;
    const parsed = (id ? schema.partial() : schema).strict().parse(payload);
    // Zod defaults also run inside partial objects; omitted PATCH fields must not be written.
    const data: any = id ? Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.prototype.hasOwnProperty.call(payload,key))) : parsed;
    if(resource==='vehicles'&&data.vin)data.vin=normalizeVin(data.vin);
    if (resource === 'users' && data.password) { data.passwordHash = passwordHash(data.password); delete data.password; }
    if (data.confirmedAt) data.confirmedAt = new Date(data.confirmedAt);
    const operation=()=>this.db.serial(async tx => {
      await requireCurrentStaff(tx,request.admin,resource);const mutate=async()=>{
      const model = (tx as any)[delegates[resource]];
      const previous=id?await model.findUnique({where:{id}}):null;
      if(resource==='legal-documents'&&(data.type||previous?.type)?.startsWith('ELECTRONIC_V31_')){const body=validateV31Template(JSON.parse(data.content??previous?.content));ensure((data.type||previous?.type)===v31TemplateType(body.kind),409,'V31_TEMPLATE_INVALID','正文类型不匹配');}
      if (id) { ensure(previous, 404, 'NOT_FOUND', '记录不存在'); if (resource === 'legal-documents') ensure(previous.status === 'DRAFT', 409, 'IMMUTABLE_DOCUMENT', '已发布协议不可修改，请新建版本'); if (resource === 'vehicles') {if(guardedVehicles())validateVehicleIdentity(previous,data);else ensure(!previous.reservedOrderId&&!previous.holdId, 409, 'VEHICLE_RESERVED', '订单占用中的车辆不可修改商业资料');} if (resource === 'users' && request.admin.id === id) ensure(data.active !== false && (!data.role || data.role === 'ADMIN'), 409, 'SELF_LOCKOUT', '不可停用或降级当前管理员'); }
      if(resource==='vehicles'&&!id&&guardedVehicles())validateVehicleIdentity(null,data);
      if (resource === 'vehicles') { const ids = [...(data.mediaFileIds || []), ...(data.coverFileId ? [data.coverFileId] : [])]; await assertNotAssetFiles(tx,ids); const count = await tx.storedFile.count({ where: { id: { in: ids }, customerId: null, purpose: 'vehicle' } }); ensure(count === new Set(ids).size, 400, 'FILE_PURPOSE', '车辆媒体须为后台上传的车辆公开素材'); }
      if (resource === 'entitlements') { const orderId = data.orderId || (id ? (await tx.entitlement.findUniqueOrThrow({ where: { id } })).orderId : undefined); const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null; ensure(order, 404, 'NOT_FOUND', '订单不存在'); data.customerId = order.customerId; }
      const value = id ? await model.update({ where: { id }, data:{...data,...(['vehicles','model-definitions'].includes(resource)?{revision:{increment:1}}:{})} }) : await model.create({ data });
      if(resource==='vehicles'){if(guardedVehicles()&&value.status==='PUBLISHED')normalizeVin(value.vin||'');}
      await audit(tx, request.admin.id, id ? 'UPDATE' : 'CREATE', resource, value.id, resource === 'users' ? { username: value.username, role: value.role, active: value.active } :resource==='model-definitions'?{changes:data,modelYearBefore:previous?.modelYear??null,modelYearAfter:value.modelYear??null,revision:value.revision}:data);
      if (resource === 'users' && id && (data.active === false || data.passwordHash || data.role)) await tx.adminSession.deleteMany({ where: { adminId: id } });
      return safe(resource, value);};return resource==='vehicles'?vehicleCommand(tx,request.admin,id,id?'UPDATE':'CREATE',body,mutate):resource==='model-definitions'?modelCommand(tx,request.admin,id,id?'UPDATE':'CREATE',body,mutate):mutate();
    });
    try{return await operation();}catch(error:any){if(resource==='model-definitions'&&error.code==='P2002')return operation();throw error;}
  }
  @Get('vehicles/:id/publish-readiness')publishReadiness(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>readVehiclePublicationReadiness(tx,request.admin,id));}
  @Get('vehicles/:id/activation-readiness')activationReadiness(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>readVehicleActivationReadiness(tx,request.admin,id));}
  @Get('vehicles/:id/catalog/readiness')catalogReadiness(@Param('id')id:string,@Req()request:any){return this.db.serial(tx=>readVehicleCatalogReadiness(tx,request.admin,id));}
  @Post('vehicles/:id/catalog/publish')publishVehicleCatalog(@Param('id')id:string,@Req()request:any,@Body()body:unknown){return this.db.serial(tx=>setVehicleCatalogPublished(tx,request.admin,id,true,body));}
  @Post('vehicles/:id/catalog/withdraw')withdrawVehicleCatalog(@Param('id')id:string,@Req()request:any,@Body()body:unknown){return this.db.serial(tx=>setVehicleCatalogPublished(tx,request.admin,id,false,body));}
  @Post('vehicles/:id/publish') publishVehicle(@Param('id') id:string,@Req()request:any,@Body()body:any={}){return this.vehicleStatus(id,true,request,body);}
  @Post('vehicles/:id/unpublish') unpublishVehicle(@Param('id') id:string,@Req()request:any,@Body()body:any={}){return this.vehicleStatus(id,false,request,body);}
  private vehicleStatus(id:string,publish:boolean,request:any,body:any){return this.db.serial(tx=>vehicleCommand(tx,request.admin,id,publish?'PUBLISH':'UNPUBLISH',body,async()=>{
   const vehicle=await tx.vehicle.findUnique({where:{id}});ensure(vehicle,404,'NOT_FOUND','车辆不存在');
   ensure(publish||vehicle.catalogPublished!==true,409,'CATALOG_WITHDRAW_REQUIRED','请先在商品展示中下架商品，再停用车辆');
   ensure(publish?['DRAFT','UNPUBLISHED'].includes(vehicle.status):vehicle.status==='PUBLISHED',409,'VEHICLE_STATE',publish?'仅草稿或已停用车辆可激活':'仅已激活车辆可停用');
   ensure(!vehicle.reservedOrderId&&!vehicle.holdId,409,'VEHICLE_RESERVED','车辆已被订单占用');
   if(publish){if(guardedVehicles())normalizeVin(vehicle.vin||'');await requireVehicleActivationReady(tx,id);}
   const item=await tx.vehicle.update({where:{id},data:{status:publish?'PUBLISHED':'UNPUBLISHED',revision:{increment:1}}});await audit(tx,request.admin.id,publish?'PUBLISH':'UNPUBLISH','vehicles',id);return item;
  }));}
  @Post('plans/:id/activate') activate(@Param('id') id: string, @Req() request: any) { return this.planStatus(id, true, request); }
  @Post('plans/:id/deactivate') deactivate(@Param('id') id: string, @Req() request: any) { return this.planStatus(id, false, request); }
  private planStatus(id: string, active: boolean, request: any) { ensure(process.env.MVP_V2_ENABLED!=='true',405,'ACTION_REQUIRED','请通过产品版本发布或停用'); return this.db.serial(async tx => { const item = await tx.subscriptionPlan.update({ where: { id }, data: { active } }); await audit(tx, request.admin.id, active ? 'ACTIVATE' : 'DEACTIVATE', 'plans', id); return item; }); }
  @Post('legal-documents/:id/activate') activateLegal(@Param('id') id:string,@Body() body:unknown,@Req() request:any){return this.db.serial(tx=>activateLegalTemplate(tx,id,body,request.admin));}
  @Post('legal-documents/:id/publish') publishLegal(@Param('id') id:string,@Req() request:any){return this.db.serial(tx=>activateLegalTemplate(tx,id,request.body,request.admin));}
}

