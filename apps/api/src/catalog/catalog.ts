import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { fen, pagination } from '../common/data';
export function vehicleView(v: any) {
  const prices = (v.plans || []).filter((p: any) => p.active).map((p: any) => p.monthlyFeeAmount);
  const minFeeAmount = prices.length ? Math.min(...prices) : null;
  return { ...v, name: v.title, registrationText: `${v.year} 年上牌`, mileageText: `${v.mileageKm.toLocaleString('zh-CN')} km`, rangeText: '', bodyType: v.modelDefinition?.bodyType || '', available: v.status === 'PUBLISHED' && !v.reservedOrderId&&!v.holdId && !!prices.length, statusText: v.status === 'PUBLISHED' && !v.reservedOrderId&&!v.holdId ? '可申请' : '暂不可申请', imageUrl: v.coverFileId ? `/api/public/media/${v.coverFileId}` : '', minFeeAmount, minFeeText: fen(minFeeAmount), tagline: v.description };
}
export function planView(p: any, available = true) { return { ...p, title: p.name, termMonths: p.months, monthlyFeeText: fen(p.monthlyFeeAmount), mileageText: `每月 ${p.mileagePerMonthKm} 公里`, energyText: p.energyDescription, depositText: '审核后确认', notes: p.conditions, available: available && p.active }; }
@Controller('public')
export class CatalogController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('vehicles') async vehicles(@Query() query: any) {
    const p = pagination(query); const where: any = { status: 'PUBLISHED' };
    if (query.brand && query.brand !== '全部') where.brand = query.brand;
    if (query.keyword) where.OR = ['title','brand','model','city'].map(k => ({ [k]: { contains: String(query.keyword), mode: 'insensitive' } }));
    const [items, total, brands] = await Promise.all([this.db.vehicle.findMany({ where, include: { plans: { where: { active: true } }, modelDefinition: true }, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' } }), this.db.vehicle.count({ where }), this.db.vehicle.findMany({ where: { status: 'PUBLISHED' }, distinct: ['brand'], select: { brand: true } })]);
    return { items: items.map(vehicleView), total, page: p.page, pageSize: p.pageSize, brands: brands.map(b => b.brand) };
  }
  @Get('vehicles/:id') async vehicle(@Param('id') id: string) {
    const v = await this.db.vehicle.findFirst({ where: { id, status: 'PUBLISHED' }, include: { plans: { where: { active: true } }, modelDefinition: true } }); ensure(v, 404, 'NOT_FOUND', '车辆不存在或已下架');
    const view = vehicleView(v);
    return { vehicle: view, plans: v.plans.map(p => planView(p, view.available)), report: { summary: '车辆披露资料', items: [{ label: '车况披露', value: v.conditionDisclosure }, { label: '最近里程', value: view.mileageText }, { label: '电池健康度', value: v.batteryHealthPercent == null ? '未提供' : `${v.batteryHealthPercent}%` }], notice: '最终交付车况以双方确认的交接记录为准。' } };
  }
  @Get('model-definitions') async models() { const items = await this.db.modelDefinition.findMany({ orderBy: { brand: 'asc' } }); return { items, total: items.length, page: 1, pageSize: items.length }; }
  @Get('legal/:type') async legal(@Param('type') type: string) { const doc = await this.db.legalDocument.findFirst({ where: { type, status: 'PUBLISHED' }, orderBy: { version: 'desc' } }); ensure(doc, 404, 'NOT_FOUND', '正式协议尚未发布'); return doc; }
}
