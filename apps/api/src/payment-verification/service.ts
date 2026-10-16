import { HttpException, Inject, Injectable } from '@nestjs/common';
import { PaymentVerification, Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { requireCurrentConsents } from '../auth/consents';
import { Db } from '../common/db';
import { audit, pagination } from '../common/data';
import { ensure } from '../common/errors';
import { VERIFICATION_PROVIDER, VerificationProvider } from './config';

const active = ['AUTHORIZED', 'CREATING', 'PENDING'] as const;
const absenceGraceMs = 10 * 60_000;
const description = '微信支付接入验收0.01元，不订阅车辆';
type Transaction = { status: 'PENDING'|'SUCCEEDED'|'FAILED'|'CLOSED'; amount: number; transactionId?: string; payerOpenId?: string };
const code = (error: unknown) => error instanceof HttpException ? (error.getResponse() as any)?.error?.code : undefined;
const leased = (row: PaymentVerification) => !!row.leaseUntil && row.leaseUntil > new Date();
function fresh(parameters: any) {
  return parameters && ['timeStamp','nonceStr','package','signType','paySign'].every(key => typeof parameters[key] === 'string' && parameters[key])
    && parameters.signType === 'RSA' && Number(parameters.timeStamp) <= Date.now() / 1000 && Number(parameters.timeStamp) > Date.now() / 1000 - 110 * 60;
}

@Injectable()
export class PaymentVerificationService {
  constructor(@Inject(Db) private db: Db, @Inject(VERIFICATION_PROVIDER) private provider: VerificationProvider) {}
  private enabled() { ensure(this.provider.enabled, 503, 'VERIFICATION_UNAVAILABLE', '支付验收入口尚未启用'); }
  private async owned(id: string, customerId?: string) {
    const row = await this.db.paymentVerification.findFirst({ where: { id, ...(customerId ? { customerId } : {}) } });
    ensure(row, 404, 'NOT_FOUND', '支付验收记录不存在'); return row;
  }
  async view(row: PaymentVerification, admin = false) {
    let eligible = false;
    if (this.provider.enabled && active.includes(row.status as any) && row.expiresAt > new Date() && !leased(row)) {
      const customer = await this.db.customer.findUnique({ where: { id: row.customerId }, select: { openId: true } });
      if (customer?.openId && (!row.startedAt || (row.requestSnapshot as any)?.openId === customer.openId)
        && !(await this.db.paymentVerification.count({ where: { customerId: row.customerId, status: 'SUCCEEDED' } }))) {
        try { await requireCurrentConsents(this.db, row.customerId, ['terms', 'privacy']); eligible = true; }
        catch (error) { if (!['CONSENT_REQUIRED','LEGAL_UNAVAILABLE'].includes(code(error))) throw error; }
      }
    }
    return { id: row.id, amount: row.amount, currency: row.currency, status: row.status, title: '微信支付验收',
      expiresAt: row.expiresAt, createdAt: row.createdAt, paidAt: row.paidAt, canPay: eligible,
      manualReviewRequired: row.status === 'EXPIRED' && !!row.startedAt,
      statusMessage: row.status === 'EXPIRED' && row.startedAt ? '授权已到期，渠道暂未查到交易；需人工核对，不能据此认定未扣款或再次授权。' : '',
      canClose: active.includes(row.status as any) && !leased(row) && (!row.startedAt || this.provider.enabled),
      ...(admin ? { customerId: row.customerId, authorizationNote: row.authorizationNote } : {}) };
  }
  async create(customerId: string, authorizationNote: string, actorId: string) {
    try {
      const row = await this.db.serial(async tx => {
        ensure(await tx.customer.count({ where: { id: customerId } }), 404, 'NOT_FOUND', '客户不存在');
        ensure(!(await tx.paymentVerification.count({ where: { customerId, OR: [
          { status: { in: [...active, 'SUCCEEDED'] } }, { status: 'EXPIRED', startedAt: { not: null } },
        ] } })), 409, 'VERIFICATION_EXISTS', '该客户已有待处理、需人工核对或已成功的1分钱验收');
        const item = await tx.paymentVerification.create({ data: { customerId, authorizationNote, createdBy: actorId,
          tradeNo: `pv_${randomBytes(14).toString('hex')}`, expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 24 * 3600000) } });
        await audit(tx, actorId, 'AUTHORIZE_VERIFICATION', 'payment-verifications', item.id, { customerId, amount: 1, currency: 'CNY', expiresAt: item.expiresAt });
        return item;
      });
      return this.view(row, true);
    } catch (error: any) {
      if (error.code === 'P2002') ensure(false, 409, 'VERIFICATION_EXISTS', '该客户已有待处理的支付验收');
      throw error;
    }
  }
  async list(customerId?: string, query: any = {}) {
    const page = pagination(query);
    const where: Prisma.PaymentVerificationWhereInput = { ...(customerId ? { customerId } : {}),
      ...(!customerId && query.status ? { status: query.status } : {}),
      ...(!customerId && query.keyword ? { id: { contains: String(query.keyword) } } : {}) };
    const [rows, total] = await Promise.all([this.db.paymentVerification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: customerId ? undefined : page.skip, take: customerId ? undefined : page.take }), this.db.paymentVerification.count({ where })]);
    return { items: await Promise.all(rows.map(row => this.view(row, !customerId))), ...(!customerId ? { total, page: page.page, pageSize: page.pageSize } : {}) };
  }
  async detail(id: string) { return this.view(await this.owned(id), true); }
  async pay(id: string, customerId: string) {
    this.enabled();
    const claim = await this.db.serial(async tx => {
      const row = await tx.paymentVerification.findFirst({ where: { id, customerId } });
      ensure(row, 404, 'NOT_FOUND', '支付验收记录不存在');
      ensure(active.includes(row.status as any) && row.expiresAt > new Date(), 409, 'VERIFICATION_STATE', '本次验收已结束或授权已过期，请查询结果');
      ensure(!leased(row), 409, 'VERIFICATION_RECOVERING', '验收请求处理中，请稍后查询或继续本次验收');
      ensure(!(await tx.paymentVerification.count({ where: { customerId, status: 'SUCCEEDED' } })), 409, 'VERIFICATION_SUCCEEDED', '该客户已完成1分钱验收');
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      ensure(customer.openId, 409, 'WECHAT_REQUIRED', '请先绑定当前小程序微信身份');
      await requireCurrentConsents(tx, customerId, ['terms', 'privacy']);
      const snapshot = row.requestSnapshot as any;
      if (row.startedAt) ensure(snapshot?.openId === customer.openId && snapshot?.amount === 1, 409, 'VERIFICATION_IDENTITY_CHANGED', '微信身份已变化，请查询或关闭原验收单');
      if (row.status === 'PENDING' && fresh(row.clientParameters)) return { row, mode: 'CACHED' as const };
      const token = randomUUID();
      const claimed = await tx.paymentVerification.update({ where: { id }, data: { status: 'CREATING', startedAt: row.startedAt || new Date(),
        requestSnapshot: snapshot || { openId: customer.openId, amount: 1, description }, leaseToken: token, leaseUntil: new Date(Date.now() + 45000) } });
      await audit(tx, customerId, row.startedAt ? 'RECOVER_VERIFICATION' : 'START_VERIFICATION', 'payment-verifications', id, { amount: 1 }, 'CUSTOMER');
      return { row: claimed, mode: row.startedAt ? 'RECOVER' as const : 'NEW' as const };
    });
    if (claim.mode === 'CACHED') return { verification: await this.view(claim.row), paymentParams: claim.row.clientParameters };
    const row = claim.row;
    if (claim.mode === 'RECOVER') {
      try {
        const result = await this.provider.gateway.query(row.tradeNo);
        ensure(result.amount === 1, 409, 'VERIFICATION_AMOUNT', '验收金额不匹配');
        if (result.status !== 'PENDING') {
          await this.settle(row.tradeNo, result);
          ensure(false, 409, 'VERIFICATION_TERMINAL', '渠道状态已更新，请查询本次验收结果');
        }
      } catch (error) { if (code(error) !== 'PAYMENT_ORDER_NOT_EXIST') throw error; }
    }
    const current = await this.owned(id, customerId);
    ensure(current.status === 'CREATING' && current.leaseToken === row.leaseToken && leased(current), 409, 'VERIFICATION_RECOVERING', '验收请求已由其他操作接管，请查询结果');
    const parameters = await this.provider.gateway.create({ paymentId: row.tradeNo, amount: 1, openId: (row.requestSnapshot as any).openId, description,
      expiresAt: row.expiresAt.toISOString().replace('.000Z', '+00:00') });
    const saved = await this.db.paymentVerification.updateMany({ where: { id, status: 'CREATING', leaseToken: row.leaseToken, leaseUntil: { gt: new Date() } },
      data: { status: 'PENDING', clientParameters: parameters, leaseToken: null, leaseUntil: null } });
    ensure(saved.count === 1, 409, 'VERIFICATION_RECOVERING', '验收状态已更新，请查询结果');
    return { verification: await this.view(await this.owned(id, customerId)), paymentParams: parameters };
  }
  async query(id: string, customerId: string) {
    const row = await this.owned(id, customerId);
    if (!row.startedAt) {
      if (row.status === 'AUTHORIZED' && row.expiresAt <= new Date()) await this.db.paymentVerification.updateMany({ where: { id, status: 'AUTHORIZED', startedAt: null }, data: { status: 'EXPIRED' } });
      return this.view(await this.owned(id, customerId));
    }
    if (!active.includes(row.status as any)) return this.view(row);
    this.enabled();
    try { await this.settle(row.tradeNo, await this.provider.gateway.query(row.tradeNo)); }
    catch (error) { if (code(error) !== 'PAYMENT_ORDER_NOT_EXIST') throw error; /* Absence is not a terminal outcome for an uncertain create. */ }
    return this.view(await this.owned(id, customerId));
  }
  async close(id: string, actorId: string) {
    const row = await this.db.serial(async tx => {
      const item = await tx.paymentVerification.findUnique({ where: { id } }); ensure(item, 404, 'NOT_FOUND', '支付验收记录不存在');
      ensure(item.status !== 'SUCCEEDED', 409, 'VERIFICATION_PAID', '已到账验收不可关单，本入口不提供退款');
      if (!active.includes(item.status as any)) return item;
      ensure(!leased(item), 409, 'VERIFICATION_RECOVERING', '渠道请求处理中，请稍后查询或关闭');
      if (!item.startedAt) {
        const closed = await tx.paymentVerification.update({ where: { id }, data: { status: item.expiresAt <= new Date() ? 'EXPIRED' : 'CLOSED' } });
        await audit(tx, actorId, 'CLOSE_VERIFICATION', 'payment-verifications', id); return closed;
      }
      this.enabled();
      return tx.paymentVerification.update({ where: { id }, data: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 45000) } });
    });
    if (!active.includes(row.status as any)) return this.view(row, true);
    let state: Transaction;
    try { state = await this.provider.gateway.query(row.tradeNo); }
    catch (error) {
      // Expiry ends the authorization, not the uncertainty of a possibly delayed charge.
      // A started EXPIRED record still blocks further authorizations for this customer.
      if (code(error) !== 'PAYMENT_ORDER_NOT_EXIST' || Date.now() < row.expiresAt.getTime() + absenceGraceMs) throw error;
      return this.finishClose(row, 'EXPIRED', actorId);
    }
    ensure(state.amount === 1, 409, 'VERIFICATION_AMOUNT', '验收金额不匹配');
    if (state.status === 'SUCCEEDED') { await this.settle(row.tradeNo, state); return this.view(await this.owned(id), true); }
    if (state.status !== 'PENDING') return this.finishClose(row, state.status, actorId);
    const current = await this.owned(id);
    if (current.status === 'SUCCEEDED') return this.view(current, true);
    ensure(active.includes(current.status as any) && current.leaseToken === row.leaseToken && leased(current), 409, 'VERIFICATION_RECOVERING', '关单请求已由其他操作接管，请查询结果');
    // Do not mark closed on timeout or ORDER_NOT_EXIST. An uncertain channel order remains tracked.
    try { await this.provider.gateway.close(row.tradeNo); }
    catch (error) { if (code(error) !== 'PAYMENT_ALREADY_CLOSED') throw error; }
    return this.finishClose(row, 'CLOSED', actorId);
  }
  private async finishClose(claim: PaymentVerification, status: 'CLOSED'|'FAILED'|'EXPIRED', actorId: string) {
    const row = await this.db.serial(async tx => {
      const current = await tx.paymentVerification.findUniqueOrThrow({ where: { id: claim.id } });
      if (current.status === 'SUCCEEDED') return current;
      ensure(active.includes(current.status as any) && current.leaseToken === claim.leaseToken && leased(current),
        409, 'VERIFICATION_RECOVERING', '关单请求已由其他操作接管，请查询结果');
      const saved = await tx.paymentVerification.updateMany({ where: { id: claim.id, status: { in: [...active] }, leaseToken: claim.leaseToken, leaseUntil: { gt: new Date() } },
        data: { status, clientParameters: Prisma.DbNull, leaseToken: null, leaseUntil: null } });
      ensure(saved.count === 1, 409, 'VERIFICATION_RECOVERING', '关单租约已过期，请查询结果');
      await audit(tx, actorId, status === 'EXPIRED' ? 'EXPIRE_UNCONFIRMED_VERIFICATION' : 'CLOSE_VERIFICATION', 'payment-verifications', claim.id,
        status === 'EXPIRED' ? { reason: 'SIGNED_ORDER_NOT_EXIST_AFTER_EXPIRY_GRACE', manualReviewRequired: true } : { status });
      return tx.paymentVerification.findUniqueOrThrow({ where: { id: claim.id } });
    });
    return this.view(row, true);
  }
  async settle(tradeNo: string, result: Transaction, event?: { id: string; payloadHash: string }) {
    return this.db.serial(async tx => {
      const row = await tx.paymentVerification.findUnique({ where: { tradeNo } }); ensure(row, 404, 'NOT_FOUND', '支付验收单号未登记');
      ensure(row.startedAt && row.requestSnapshot, 409, 'VERIFICATION_NOT_STARTED', '验收尚未发起');
      ensure(row.amount === 1 && row.currency === 'CNY' && result.amount === 1, 409, 'VERIFICATION_AMOUNT', '验收金额不匹配');
      if (result.status === 'SUCCEEDED') ensure(result.transactionId && result.payerOpenId === (row.requestSnapshot as any).openId, 409, 'VERIFICATION_IDENTITY', '验收支付身份或凭据不匹配');
      if (event) {
        const previous = await tx.paymentVerificationEvent.findUnique({ where: { id: event.id } });
        ensure(!previous || (previous.verificationId === row.id && previous.payloadHash === event.payloadHash), 409, 'EVENT_CONFLICT', '支付回调标识冲突');
        if (previous) return row;
      }
      if (row.status === 'SUCCEEDED') {
        ensure(result.status !== 'SUCCEEDED' || row.providerTransactionId === result.transactionId, 409, 'VERIFICATION_TRANSACTION', '渠道交易号不匹配');
      } else if (result.status === 'SUCCEEDED') {
        await tx.paymentVerification.update({ where: { id: row.id }, data: { status: 'SUCCEEDED', providerTransactionId: result.transactionId, paidAt: new Date(), clientParameters: Prisma.DbNull, leaseToken: null, leaseUntil: null } });
        await audit(tx, 'wechat-pay-verification', 'PAYMENT_VERIFIED', 'payment-verifications', row.id, { amount: 1, currency: 'CNY' }, 'PROVIDER');
      } else if (active.includes(row.status as any)) {
        // A concurrent query must not release the lease of create/close still in flight.
        const terminal = result.status !== 'PENDING';
        await tx.paymentVerification.update({ where: { id: row.id }, data: { status: !terminal && leased(row) ? row.status : result.status,
          ...(terminal ? { clientParameters: Prisma.DbNull, leaseToken: null, leaseUntil: null } : {}) } });
      }
      if (event) await tx.paymentVerificationEvent.create({ data: { id: event.id, verificationId: row.id, payloadHash: event.payloadHash } });
      return tx.paymentVerification.findUniqueOrThrow({ where: { id: row.id } });
    });
  }
}
