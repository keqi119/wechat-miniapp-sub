import { locationInput, resolveLocation } from './handover-location';
import { snapshotUsagePolicy, usagePolicyAppendix } from '../usage/policy';
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { ensure } from '../common/errors';
import { audit, fen, hash, key, money, notify, text } from '../common/data';
import { acceptConsents, requireCurrentConsents } from '../auth/consents';
import { commercialTermsInput } from './commercial-terms';
import { billSchedule, dateOnly } from '../billing/rules';
import { CREDIT_RULE, requireCredit } from './credit-review';
import { finalPlanPricing, assertFinalPricing, acceptancePricingDescription } from './acceptance-pricing';
export const applicationInclude = { vehicle: { include: { plans: true } }, subscriptionPlan: true, finalPlans: { orderBy: { revision: 'desc' as const }, take: 1 }, order: true };
const statusNames: Record<string, string> = { SUBMITTED: '已提交', IN_REVIEW: '审核中', NEEDS_INFO: '待补充资料', REJECTED: '已拒绝', CANCELLED: '已取消', AWAITING_CONFIRMATION: '待确认最终方案', FINAL_PLAN_CONFIRMED: '方案已确认' };
export function applicationView(a: any) {
  const plan = a.finalPlans?.[0];
  return { ...a, type: 'applications', title: a.vehicle?.title || '订阅申请', subtitle: a.subscriptionPlan?.name || '', statusText: statusNames[a.status], vehicleName: a.vehicle?.title, planName: a.subscriptionPlan?.name, plan: a.subscriptionPlan, finalPlan: plan ? { ...plan, pricingMode: plan.acceptancePricing ? 'V1_ONE_FEN' : 'STANDARD', pricingDescription: acceptancePricingDescription(plan), monthlyFeeText: fen(plan.monthlyFeeAmount), depositText: fen(plan.depositAmount), termMonths: plan.months, mileageText: `每月 ${plan.mileagePerMonthKm} 公里`, energyText: plan.energyDescription, vehicleName: a.vehicle?.title, title: a.subscriptionPlan?.name } : null, commercialHash: plan?.commercialHash, nextAction: a.status === 'AWAITING_CONFIRMATION' ? '请核对并确认最终方案' : a.note || statusNames[a.status], details: [{ label: '申请编号', value: a.id }, { label: '审核说明', value: a.note || '等待审核' }], documents: [], timeline: [{ title: '提交申请', description: '申请已记录', done: true }, { title: '资料与方案审核', description: a.note || '等待审核', done: a.revision > 0 }, { title: '确认最终方案', description: '确认后建立订单', done: a.status === 'FINAL_PLAN_CONFIRMED' }], actions: a.status === 'AWAITING_CONFIRMATION' ? [{ id: 'confirm', label: '确认最终方案' }, { id: 'reject', label: '拒绝方案' }] : ['SUBMITTED','IN_REVIEW','NEEDS_INFO'].includes(a.status) ? [{ id: 'cancel', label: '取消申请' }] : [] };
}
const finalInput = z.object({ pricingMode: z.enum(['STANDARD','V1_ONE_FEN']).default('STANDARD'), creditVerificationId:text, commercialTerms: commercialTermsInput, revision: z.number().int().nonnegative(), monthlyFeeAmount: money.positive(), depositAmount: money.optional(), months: z.number().int().min(12).max(120), mileagePerMonthKm: z.literal(1500), excessMileagePriceAmount: z.literal(150), energyDescription: text, benefits: z.array(text).max(50), conditions: text, startDate: z.string(), firstDueDate: z.string() }).strict();
@Controller()
export class ApplicationsController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('customer/applications') async submit(@Body() body: any, @Req() request: any) {
    const input = z.object({ vehicleId: text, subscriptionPlanId: text, profile: z.object({ name: z.string().trim().min(1).max(40), drivingYears: z.number().int().min(0).max(70).optional(), fileIds: z.array(z.string()).default([]), mobile: z.string().max(20).optional(), handoverLocation: locationInput }).strict(), consents: z.array(z.object({ documentId: text, version: z.number().int().positive() })).min(1), idempotencyKey: key }).parse(body);
    const customerId = request.customer.id; const requestHash = hash(input);
    const operation = () => this.db.serial(async tx => {
      const existing = await tx.application.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: input.idempotencyKey } }, include: applicationInclude });
      if (existing) { ensure(existing.requestHash === requestHash, 409, 'IDEMPOTENCY_CONFLICT', '相同请求编号不可修改内容'); return applicationView(existing); }
      const vehicle = await tx.vehicle.findUnique({ where: { id: input.vehicleId } }); ensure(vehicle?.status === 'PUBLISHED' && !vehicle.reservedOrderId&&!vehicle.holdId, 409, 'VEHICLE_UNAVAILABLE', '车辆当前不可申请');
      const plan = await tx.subscriptionPlan.findFirst({ where: { id: input.subscriptionPlanId, vehicleId: input.vehicleId, active: true } }); ensure(plan, 409, 'PLAN_UNAVAILABLE', '套餐不可用');
      await requireCurrentConsents(tx, customerId, ['terms','privacy']);
      await acceptConsents(tx, customerId, input.consents, ['application'], 'APPLICATION');
      const count = await tx.storedFile.count({ where: { id: { in: input.profile.fileIds }, customerId } }); ensure(count === new Set(input.profile.fileIds).size, 403, 'FILE_OWNERSHIP', '附件不属于当前客户');
      const open = await tx.application.count({ where: { customerId, status: { in: ['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'] } } }); ensure(open === 0, 409, 'ACTIVE_APPLICATION', '已有进行中的申请');
      const handoverLocation = await resolveLocation(tx, input.profile.handoverLocation, customerId);
      const application = await tx.application.create({ data: { ...input, profile: JSON.parse(JSON.stringify({ ...input.profile, handoverLocation })), customerId, requestHash }, include: applicationInclude });
      await tx.customer.update({ where: { id: customerId }, data: { name: input.profile.name, ...(input.profile.drivingYears == null ? {} : { drivingYears: input.profile.drivingYears }) } });
      await audit(tx, customerId, 'SUBMIT', 'applications', application.id, {}, 'CUSTOMER');
      return applicationView(application);
    });
    try { return await operation(); } catch (error: any) { if (error.code === 'P2002') return operation(); throw error; }
  }
  @Post('customer/applications/:id/amend') amend(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ profile: z.object({ name: z.string().trim().min(1).max(40), drivingYears: z.number().int().min(0).max(70).optional(), fileIds: z.array(text).max(20).default([]), handoverLocation: locationInput }).strict(), note: z.string().max(2000).default(''), idempotencyKey: key }).parse(body);
    return this.db.serial(async tx => {
      const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(app, 404, 'NOT_FOUND', '申请不存在');
      const prior = await tx.auditLog.findFirst({ where: { resourceId: id, action: 'AMEND', data: { path: ['idempotencyKey'], equals: input.idempotencyKey } } });
      if (prior) { ensure((prior.data as any).requestHash === hash(input), 409, 'IDEMPOTENCY_CONFLICT', '补件请求编号与内容冲突'); return applicationView(app); }
      ensure(app.status === 'NEEDS_INFO', 409, 'STATE_CONFLICT', '申请当前不可补件');
      ensure(await tx.storedFile.count({ where: { id: { in: input.profile.fileIds }, customerId: request.customer.id, purpose: { not: 'vehicle' } } }) === new Set(input.profile.fileIds).size, 403, 'FILE_OWNERSHIP', '附件不属于当前客户');
      if (input.profile.handoverLocation != null) await requireCurrentConsents(tx, request.customer.id, ['privacy']);
      const handoverLocation = await resolveLocation(tx, input.profile.handoverLocation, request.customer.id, (app.profile as any)?.handoverLocation);
      const profile = JSON.parse(JSON.stringify({ ...input.profile, handoverLocation }));
      const updated = await tx.application.update({ where: { id }, data: { profile, note: input.note, status: 'IN_REVIEW' }, include: applicationInclude });
      await audit(tx, request.customer.id, 'AMEND', 'applications', id, { previousProfile: app.profile, profile, note: input.note, idempotencyKey: input.idempotencyKey, requestHash: hash(input) }, 'CUSTOMER'); return applicationView(updated);
    });
  }
  @Get('customer/applications/:id') async get(@Param('id') id: string, @Req() request: any) { const item = await this.db.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(item, 404, 'NOT_FOUND', '申请不存在'); return applicationView(item); }
  @Post('admin/applications/:id/review') async review(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ decision: z.enum(['IN_REVIEW','NEEDS_INFO','REJECTED']), note: z.string().max(2000).default('') }).parse(body);
    return this.db.serial(async tx => { const app = await tx.application.findUnique({ where: { id } }); ensure(app && ['SUBMITTED','IN_REVIEW','NEEDS_INFO'].includes(app.status), 409, 'STATE_CONFLICT', '申请当前状态不可审核'); const item = await tx.application.update({ where: { id }, data: { status: input.decision, note: input.note }, include: applicationInclude }); await audit(tx, request.admin.id, 'REVIEW', 'applications', id, input); await notify(tx, app.customerId, '申请审核更新', input.note || statusNames[input.decision], 'applications', id); return applicationView(item); });
  }
  @Post('admin/applications/:id/final-plan') async finalPlan(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = finalInput.parse(body); let startDate: Date, firstDueDate: Date;
    try { startDate = dateOnly(input.startDate); firstDueDate = dateOnly(input.firstDueDate); } catch { ensure(false, 400, 'VALIDATION', '起租日或付款日无效'); }
    return this.db.serial(async tx => {
      const app = await tx.application.findUnique({ where: { id } }); ensure(app, 404, 'NOT_FOUND', '申请不存在');
      ensure(app.revision === input.revision, 409, 'REVISION_CONFLICT', '最终方案已更新，请刷新');
      ensure(['IN_REVIEW','AWAITING_CONFIRMATION'].includes(app.status), 409, 'STATE_CONFLICT', '请先完成审核');
      await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
      const credit=await requireCredit(tx,app,input.creditVerificationId),standardDeposit=money.parse(input.monthlyFeeAmount*credit.multiplier);
      const pricing=finalPlanPricing(app,input,standardDeposit,request.admin);
      const {pricingMode,...proposal}=input;
      const usagePolicy=await snapshotUsagePolicy(tx);
      const fixed={...proposal,...pricing,usagePolicyVersion:'USAGE_V1',usagePolicy,creditBand:credit.verification.band,creditRuleVersion:CREDIT_RULE,creditRevision:app.creditRevision};
      const revision = app.revision + 1; const commercialHash = hash({ ...fixed, vehicleId: app.vehicleId, revision });
      await tx.finalPlan.create({ data: { ...fixed, applicationId: id, revision, commercialHash, startDate, firstDueDate } });
      const updated = await tx.application.update({ where: { id }, data: { revision, status: 'AWAITING_CONFIRMATION' }, include: applicationInclude });
      await audit(tx, request.admin.id, 'FINAL_PLAN', 'applications', id, { revision, commercialHash });
      await notify(tx, app.customerId, '最终方案待确认', '请核对车辆、费用、期限和条款。', 'applications', id);
      return applicationView(updated);
    });
  }
  @Post('customer/applications/:id/confirm') async confirm(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ revision: z.number().int().nonnegative(), commercialHash: z.string().length(64) }).parse(body);
    return this.db.serial(async tx => {
      const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id }, include: applicationInclude }); ensure(app, 404, 'NOT_FOUND', '申请不存在');
      const final = app.finalPlans[0]; ensure(final && input.revision === app.revision && input.commercialHash === final.commercialHash, 409, 'REVISION_CONFLICT', '最终方案已更新，请重新阅读');
      if (app.order && app.status === 'FINAL_PLAN_CONFIRMED') return app.order;
      ensure(app.status === 'AWAITING_CONFIRMATION', 409, 'STATE_CONFLICT', '当前申请不能确认');
      await requireCurrentConsents(tx,app.customerId,['terms','privacy']);
      const credit=await requireCredit(tx,app,final.creditVerificationId||'');
      ensure(final.creditRevision===app.creditRevision&&final.creditRuleVersion===CREDIT_RULE&&final.creditBand===credit.verification.band,409,'CREDIT_REVIEW_REQUIRED','核验或押金规则已更新，请重新确认最终方案');
      assertFinalPricing(app,final,final.monthlyFeeAmount*credit.multiplier);
      ensure(commercialTermsInput.safeParse(final.commercialTerms).success, 409, 'COMMERCIAL_TERMS_REQUIRED', '最终方案条款不完整，请后台重新出具完整方案');
      usagePolicyAppendix(final.usagePolicy);
      const claim = await tx.vehicle.updateMany({ where: { id: app.vehicleId, reservedOrderId: null, holdId:null, status: 'PUBLISHED' }, data: { status: 'RESERVED' } }); ensure(claim.count === 1, 409, 'VEHICLE_UNAVAILABLE', '该车已被其他订单占用');
      const order = await tx.order.create({ data: { applicationId: id, customerId: request.customer.id, vehicleId: app.vehicleId, confirmedMileageKm: app.vehicle.mileageKm, finalPlanSnapshot: JSON.parse(JSON.stringify(final)) } });
      await tx.vehicle.update({ where: { id: app.vehicleId }, data: { reservedOrderId: order.id } });
      await tx.application.update({ where: { id }, data: { status: 'FINAL_PLAN_CONFIRMED' } });
      await tx.contract.create({ data: { orderId: order.id, customerId: order.customerId, documentHash: final.commercialHash } });
      const schedule = billSchedule(final.firstDueDate.toISOString().slice(0, 10), final.months, final.monthlyFeeAmount);
      await tx.bill.createMany({ data: schedule.map(b => ({ orderId: order.id, customerId: order.customerId, type: 'SUBSCRIPTION', sequence: b.sequence, amount: b.amount, dueDate: dateOnly(b.dueDate) })) });
      if (final.depositAmount > 0) await tx.bill.create({ data: { orderId: order.id, customerId: order.customerId, type: 'DEPOSIT', sequence: 0, amount: final.depositAmount, dueDate: final.firstDueDate } });
      await tx.entitlement.createMany({ data: final.benefits.map(title => ({ orderId: order.id, customerId: order.customerId, title, description: '以签署合同和最终方案约定为准', status: 'PENDING' })) });
      await audit(tx, order.customerId, 'CONFIRM', 'applications', id, { orderId: order.id, revision: input.revision, commercialHash: input.commercialHash }, 'CUSTOMER');
      await notify(tx, order.customerId, '方案已确认', '订单已建立，请等待合同准备。', 'orders', order.id);
      return order;
    });
  }
  @Post('customer/applications/:id/cancel') cancel(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.close(id, body, request, false); }
  @Post('customer/applications/:id/reject') reject(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.close(id, body, request, true); }
  private async close(id: string, body: any, request: any, reject: boolean) {
    const input = z.object({ reason: z.string().max(1000).default(''), revision: z.number().int().optional() }).parse(body);
    return this.db.serial(async tx => { const app = await tx.application.findFirst({ where: { id, customerId: request.customer.id } }); ensure(app, 404, 'NOT_FOUND', '申请不存在'); ensure(['SUBMITTED','IN_REVIEW','NEEDS_INFO','AWAITING_CONFIRMATION'].includes(app.status), 409, 'STATE_CONFLICT', '当前申请不可取消或拒绝'); if (reject) ensure(app.status === 'AWAITING_CONFIRMATION' && input.revision === app.revision && input.reason.trim(), 409, 'REVISION_CONFLICT', '请填写原因并核对最新方案版本'); const updated = await tx.application.update({ where: { id }, data: { status: reject ? 'REJECTED' : 'CANCELLED', note: input.reason }, include: applicationInclude }); await audit(tx, request.customer.id, reject ? 'REJECT' : 'CANCEL', 'applications', id, input, 'CUSTOMER'); return applicationView(updated); });
  }
}
