import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { audit, fileIds, money, pagination, text } from '../common/data';
import { ensure, fail } from '../common/errors';
import { allowed } from '../auth/access';
import { passwordHash } from '../auth/auth.service';
import { applicationInclude, applicationView } from '../applications/applications';
export const delegates: Record<string, string> = { 'model-definitions': 'modelDefinition', vehicles: 'vehicle', plans: 'subscriptionPlan', customers: 'customer', applications: 'application', orders: 'order', contracts: 'contract', bills: 'bill', payments: 'payment', deposits: 'depositEntry', refunds: 'refund', handovers: 'handover', mileages: 'mileage', entitlements: 'entitlement', services: 'serviceRequest', notifications: 'notification', users: 'adminUser', 'audit-logs': 'auditLog', 'legal-documents': 'legalDocument' };
const vehicleDto = z.object({ modelDefinitionId: z.string().nullable().optional(), brand: text, model: text, title: text, vin:z.string().trim().min(1).max(100).nullable().optional(),plateNumber:z.string().trim().min(1).max(50).nullable().optional(), year: z.number().int().min(1990).max(2100), city: text, mileageKm: z.number().int().nonnegative(), batteryHealthPercent: z.number().int().min(0).max(100).nullable().optional(), description: z.string().max(5000).default(''), conditionDisclosure: z.string().max(10000).default(''), coverFileId: z.string().nullable().optional(), mediaFileIds: fileIds });
const planDto = z.object({ vehicleId: text, name: text, months: z.number().int().min(1).max(120), monthlyFeeAmount: money.positive(), mileagePerMonthKm: z.number().int().nonnegative(), excessMileagePriceAmount: money, energyDescription: text, benefits: z.array(text).max(50), conditions: text });
const schemas: Record<string, z.ZodObject<any>> = {
  'model-definitions': z.object({ brand: text, name: text, bodyType: z.string().max(100).default(''), description: z.string().max(5000).default('') }),
  vehicles: vehicleDto, plans: planDto,
  users: z.object({ username: z.string().min(3).max(100), password: z.string().min(16).max(256), name: text, role: z.enum(['ADMIN','OPERATIONS','FINANCE','SUPPORT']), active: z.boolean().default(true) }),
  'legal-documents': z.object({ type: z.enum(['application','privacy','terms','subscription','handover','credit-verification','mileage-pack','usage-policy','vehicle-change','delivery-delay-amendment','vehicle-change-amendment','technical-signing-verification','handover-location','owner-identity','owner-auto-sign','owner-data-sharing','owner-rental-contract','owner-delivery-delay','owner-vehicle-change','owner-handover']), version: z.number().int().positive(), title: text, content: z.string().min(1).max(100000), confirmedBy: z.string().min(1).optional(), confirmedAt: z.string().datetime().optional() }),
  entitlements: z.object({ orderId: text, title: text, description: text, status: z.enum(['PENDING','ACTIVE','EXPIRED']).default('PENDING') }),
  notifications: z.object({ customerId: text, title: text, content: z.string().min(1).max(5000), resourceType: text.optional(), resourceId: text.optional() }),
};
function withoutCredit(value:any):any {
  if(Array.isArray(value))return value.map(withoutCredit);
  if(!value||typeof value!=='object'||value instanceof Date)return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['creditBand','creditVerificationId','creditRevision','creditRuleVersion','standardDepositAmount'].includes(key)).map(([key,item])=>[key,withoutCredit(item)]));
}
function safe(resource: string, value: any, role?:string) { if (!value) return value; if(resource==='contracts'&&!['ADMIN','OPERATIONS'].includes(role||'')){const{body,sourceFileId,signedFileId,...summary}=value;return summary;} if (resource === 'users') { const { passwordHash: _, ...rest } = value; return rest; } if (resource === 'customers') { const { openId: _, providerCustomerId: __, ...rest } = value; return rest; } if(['applications','orders'].includes(resource)&&!['ADMIN','OPERATIONS'].includes(role||''))return withoutCredit(value); return value; }
@Controller('admin')
export class AdminController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('dashboard') async dashboard(@Req() request: any) {
    const [applications, contracts, bills, handovers, services, recentActivity, refunds] = await Promise.all([this.db.application.count({ where: { status: { in: ['SUBMITTED','IN_REVIEW','NEEDS_INFO'] } } }), this.db.contract.count({ where: { status: { in: ['DRAFT','PENDING'] } } }), this.db.bill.count({ where: { status: 'PENDING' } }), this.db.handover.count({ where: { status: { notIn: ['COMPLETED','SUPERSEDED'] } } }), this.db.serviceRequest.count({ where: { status: { in: ['SUBMITTED','ACCEPTED','ASSIGNED','IN_PROGRESS'] } } }), allowed(request.admin.role, 'audit-logs', false) ? this.db.auditLog.findMany({ take: 10, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]), this.db.refund.count({ where: { status: { in: ['PENDING_APPROVAL','PROCESSING'] } } })]);
    return { counts: { applications, contracts, bills, handovers, services, refunds }, recentActivity };
  }
  @Get(':resource') async list(@Param('resource') resource: string, @Query() query: any, @Req() request:any) {
    const delegate = delegates[resource]; ensure(delegate, 404, 'NOT_FOUND', '资源不存在'); const p = pagination(query); const where: any = {};
    if(resource==='legal-documents'&&query.type)where.type=String(query.type);
    if (query.status && !['customers','users','audit-logs','model-definitions','notifications','deposits'].includes(resource)) where.status = query.status;
    const searchFields: Record<string,string[]> = { vehicles: ['title','brand','model'], 'model-definitions': ['name','brand'], plans: ['name'], customers: ['name','mobile'], users: ['name','username'], 'legal-documents': ['title'], services: ['description','mobile'], notifications: ['title','content'] };
    if (query.keyword) where.OR = (searchFields[resource] || ['id']).map(field => ({ [field]: { contains: String(query.keyword), mode: 'insensitive' } }));
    const model = (this.db as any)[delegate]; const [items, total] = await Promise.all([model.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' }, ...(['applications','orders'].includes(resource) ? { include: { customer: { select: { id:true,name:true,mobile:true } },vehicle: { select: { id:true,title:true } } } } : {}) }), model.count({ where })]);
    return { items: items.map((i: any) => safe(resource, i, request.admin.role)), total, page: p.page, pageSize: p.pageSize };
  }
  @Get(':resource/:id') async detail(@Param('resource') resource: string, @Param('id') id: string, @Req() request:any) {
    ensure(delegates[resource], 404, 'NOT_FOUND', '资源不存在');
    const value = await (this.db as any)[delegates[resource]].findUnique({ where: { id }, ...(resource === 'applications' ? { include: applicationInclude } : {}) });
    ensure(value, 404, 'NOT_FOUND', '记录不存在'); return safe(resource, resource === 'applications' ? applicationView(value) : value, request.admin.role);
  }
  @Post(':resource') create(@Param('resource') resource: string, @Body() body: any, @Req() request: any) { return this.write(resource, undefined, body, request); }
  @Patch(':resource/:id') patch(@Param('resource') resource: string, @Param('id') id: string, @Body() body: any, @Req() request: any) { return this.write(resource, id, body, request); }
  private async write(resource: string, id: string | undefined, body: any, request: any) {
    const schema = schemas[resource]; ensure(schema, 405, 'ACTION_REQUIRED', '该资源只能通过专门业务动作变更');
    const data: any = (id ? schema.partial() : schema).strict().parse(body);
    if (resource === 'users' && data.password) { data.passwordHash = passwordHash(data.password); delete data.password; }
    if (data.confirmedAt) data.confirmedAt = new Date(data.confirmedAt);
    return this.db.serial(async tx => {
      const model = (tx as any)[delegates[resource]];
      if (id) { const previous = await model.findUnique({ where: { id } }); ensure(previous, 404, 'NOT_FOUND', '记录不存在'); if (resource === 'legal-documents') ensure(previous.status === 'DRAFT', 409, 'IMMUTABLE_DOCUMENT', '已发布协议不可修改，请新建版本'); if (resource === 'vehicles') ensure(!previous.reservedOrderId&&!previous.holdId, 409, 'VEHICLE_RESERVED', '订单占用中的车辆不可修改商业资料'); if (resource === 'users' && request.admin.id === id) ensure(data.active !== false && (!data.role || data.role === 'ADMIN'), 409, 'SELF_LOCKOUT', '不可停用或降级当前管理员'); }
      if (resource === 'vehicles') { const ids = [...(data.mediaFileIds || []), ...(data.coverFileId ? [data.coverFileId] : [])]; const count = await tx.storedFile.count({ where: { id: { in: ids }, customerId: null, purpose: 'vehicle' } }); ensure(count === new Set(ids).size, 400, 'FILE_PURPOSE', '车辆媒体须为后台上传的车辆公开素材'); }
      if (resource === 'entitlements') { const orderId = data.orderId || (id ? (await tx.entitlement.findUniqueOrThrow({ where: { id } })).orderId : undefined); const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null; ensure(order, 404, 'NOT_FOUND', '订单不存在'); data.customerId = order.customerId; }
      const value = id ? await model.update({ where: { id }, data }) : await model.create({ data });
      await audit(tx, request.admin.id, id ? 'UPDATE' : 'CREATE', resource, value.id, resource === 'users' ? { username: value.username, role: value.role, active: value.active } : data);
      if (resource === 'users' && id && (data.active === false || data.passwordHash || data.role)) await tx.adminSession.deleteMany({ where: { adminId: id } });
      return safe(resource, value);
    });
  }
  @Post('vehicles/:id/publish') publishVehicle(@Param('id') id: string, @Req() request: any) { return this.vehicleStatus(id, true, request); }
  @Post('vehicles/:id/unpublish') unpublishVehicle(@Param('id') id: string, @Req() request: any) { return this.vehicleStatus(id, false, request); }
  private vehicleStatus(id: string, publish: boolean, request: any) { return this.db.serial(async tx => { const v = await tx.vehicle.findUnique({ where: { id }, include: { plans: { where: { active: true } } } }); ensure(v, 404, 'NOT_FOUND', '车辆不存在'); ensure(!v.reservedOrderId&&!v.holdId, 409, 'VEHICLE_RESERVED', '车辆已被订单占用'); if (publish) ensure(v.plans.length && v.conditionDisclosure.trim(), 409, 'PUBLISH_REQUIREMENTS', '请先录入车况披露和有效套餐'); const item = await tx.vehicle.update({ where: { id }, data: { status: publish ? 'PUBLISHED' : 'UNPUBLISHED' } }); await audit(tx, request.admin.id, publish ? 'PUBLISH' : 'UNPUBLISH', 'vehicles', id); return item; }); }
  @Post('plans/:id/activate') activate(@Param('id') id: string, @Req() request: any) { return this.planStatus(id, true, request); }
  @Post('plans/:id/deactivate') deactivate(@Param('id') id: string, @Req() request: any) { return this.planStatus(id, false, request); }
  private planStatus(id: string, active: boolean, request: any) { return this.db.serial(async tx => { const item = await tx.subscriptionPlan.update({ where: { id }, data: { active } }); await audit(tx, request.admin.id, active ? 'ACTIVATE' : 'DEACTIVATE', 'plans', id); return item; }); }
  @Post('legal-documents/:id/publish') publishLegal(@Param('id') id: string, @Req() request: any) { return this.db.serial(async tx => { const doc = await tx.legalDocument.findUnique({ where: { id } }); ensure(doc?.confirmedBy && doc.confirmedAt, 409, 'LEGAL_UNCONFIRMED', '正式文案尚未确认'); ensure(doc.status === 'DRAFT', 409, 'STATE_CONFLICT', '协议不是草稿'); await tx.legalDocument.updateMany({ where: { type: doc.type, status: 'PUBLISHED' }, data: { status: 'RETIRED' } }); const item = await tx.legalDocument.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }); await audit(tx, request.admin.id, 'PUBLISH', 'legal-documents', id, { confirmedBy: doc.confirmedBy, confirmedAt: doc.confirmedAt }); return item; }); }
}
