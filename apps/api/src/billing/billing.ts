import {serviceBillSequences} from '../order-changes/obligations';
import { guardDelayPayment,allocateDelayPayment } from '../order-changes/finance';
import { guardPackRefund, settlePackRefund } from '../usage/refunds';
import { Body, Controller, Get, HttpException, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { advanceToHandover } from '../orders/readiness';
import { dateOnly } from './rules';
import { grantPaidPack, guardPackPayment } from '../usage/ledger';
import { z } from 'zod';
import { Db } from '../common/db';
import { PaymentGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { audit, fileIds, hash, key, money, notify, text } from '../common/data';
@Injectable()
export class BillingService {
  constructor(@Inject(Db) private db: Db, @Inject(PaymentGateway) private gateway: PaymentGateway) {}
  private code(error: unknown) { return error instanceof HttpException ? (error.getResponse() as any)?.error?.code : undefined; }
  private freshParameters(parameters: any) { const timestamp = Number(parameters?.timeStamp); return Number.isFinite(timestamp) && Date.now() / 1000 - timestamp >= 0 && Date.now() / 1000 - timestamp < 110 * 60; }
  async settleRefund(refundId: string, event: { status: 'PROCESSING'|'SUCCEEDED'|'FAILED'; providerRefundId?: string; paymentId: string; amount: number; totalAmount: number }) {
    return this.db.serial(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: { include: { bill: true } } } });
      ensure(refund && refund.paymentId === event.paymentId && refund.amount === event.amount && refund.payment.amount === event.totalAmount, 409, 'REFUND_MISMATCH', '退款归属或金额不匹配');
      ensure(['PROCESSING','SUCCEEDED'].includes(refund.status), 409, 'REFUND_STATE', '退款未获批准或已终止');
      if (refund.status === 'SUCCEEDED') { ensure(!event.providerRefundId || event.providerRefundId === refund.providerRefundId, 409, 'REFUND_MISMATCH', '退款渠道单号不匹配'); return refund; }
      const updated = await tx.refund.update({ where: { id: refundId }, data: { status: event.status, ...(event.providerRefundId ? { providerRefundId: event.providerRefundId } : {}) } });
      if (event.status === 'SUCCEEDED') {
        ensure(event.providerRefundId, 409, 'REFUND_MISMATCH', '渠道退款单号缺失');
        await settlePackRefund(tx,refund);
        if (['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(refund.payment.bill.type)) await tx.depositEntry.create({ data: { customerId: refund.customerId, orderId: refund.payment.bill.orderId, refundId, type: 'REFUND', amount: refund.amount } });
      }
      await audit(tx, 'payment-provider', 'REFUND_STATUS', 'refunds', refundId, { status: event.status, amount: event.amount }, 'PROVIDER');
      return updated;
    });
  }
  async settle(paymentId: string, event: { status: 'PENDING'|'SUCCEEDED'|'FAILED'|'CLOSED'; amount: number; transactionId?: string }) {
    return this.db.serial(async tx => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { bill: true } }); ensure(payment, 404, 'NOT_FOUND', '支付记录不存在');
      ensure(event.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
      if (payment.status === 'SUCCEEDED') { ensure(event.status !== 'SUCCEEDED' || event.transactionId === payment.providerTransactionId, 409, 'PAYMENT_MISMATCH', '支付交易号不匹配'); return payment; }
      if (payment.status === 'CLOSED' && event.status !== 'SUCCEEDED') return payment;
      if (event.status === 'SUCCEEDED') {
        ensure(event.transactionId, 409, 'PAYMENT_MISMATCH', '渠道交易号缺失');
        ensure(payment.bill.status === 'PENDING' && payment.bill.paidAmount === 0 && payment.amount === payment.bill.amount, 409, 'BILL_CONFLICT', '账单已处理，请人工核对支付');
        await tx.bill.update({ where: { id: payment.billId }, data: { paidAmount: payment.amount, status: 'PAID' } });
        await grantPaidPack(tx,payment.bill,payment.id); await allocateDelayPayment(tx,payment);
        if (['DEPOSIT','DEPOSIT_ADJUSTMENT'].includes(payment.bill.type)) await tx.depositEntry.create({ data: { customerId: payment.customerId, orderId: payment.bill.orderId, paymentId: payment.id, type: 'RECEIPT', amount: payment.amount } });
        await notify(tx, payment.customerId, '付款已确认', '渠道已核验付款到账。', 'payments', payment.id);
      }
      const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: event.status, ...(event.transactionId ? { providerTransactionId: event.transactionId } : {}) } });
      if (event.status === 'SUCCEEDED') await advanceToHandover(tx, payment.bill.orderId);
      await audit(tx, 'payment-provider', 'PAYMENT_STATUS', 'payments', paymentId, { status: event.status, amount: event.amount }, 'PROVIDER');
      return updated;
    });
  }
  async pay(customer: any, billId: string, idempotencyKey: string) {
    ensure(customer.openId, 409, 'WECHAT_REQUIRED', '支付前请绑定当前小程序微信身份');
    const claim = await this.db.serial(async tx => {
      const bill = await tx.bill.findFirst({ where: { id: billId, customerId: customer.id } }); ensure(bill, 404, 'NOT_FOUND', '账单不存在'); ensure(bill.status === 'PENDING' && bill.paidAmount === 0, 409, 'BILL_NOT_PAYABLE', '账单当前不可支付');
      await guardDelayPayment(tx,bill);
      const usage=await tx.usageAccount.findUnique({where:{orderId:bill.orderId}});
      if(usage){await tx.usageAccount.update({where:{id:usage.id},data:{revision:{increment:1}}});if(usage.returnedOn){const last=await tx.usagePeriod.aggregate({where:{accountId:usage.id,status:{not:'CANCELLED'}},_max:{sequence:true}});const sequence=(await serviceBillSequences(tx,bill.orderId)).get(bill.id);ensure(!sequence||sequence<=(last._max.sequence||0),409,'RETURN_FUTURE_BILL','车辆已交还，未来未履行月份须先结算，不可继续支付');}}
      await guardPackPayment(tx,bill);
      const existing = await tx.payment.findUnique({ where: { customerId_idempotencyKey: { customerId: customer.id, idempotencyKey } } });
      if (existing) ensure(existing.billId === billId, 409, 'IDEMPOTENCY_CONFLICT', '请求编号已用于其他账单');
      const payment = existing || await tx.payment.findFirst({ where: { billId, status: { in: ['CREATING','PENDING'] } }, orderBy: { createdAt: 'asc' } });
      if (payment) {
        ensure(['CREATING','PENDING'].includes(payment.status), 409, 'PAYMENT_STATE', '该付款请求已结束，请使用新的请求编号');
        if (payment.status === 'PENDING' && this.freshParameters(payment.clientParameters)) return { payment, mode: 'CACHED' as const };
        ensure(payment.updatedAt.getTime() <= Date.now() - 45000, 409, 'PAYMENT_RECOVERING', '支付处理中，请45秒后查询或重试');
        ensure(payment.requestSnapshot, 409, 'PAYMENT_RECOVERY_REVIEW', '原支付请求资料不完整，请联系后台关闭后重试');
        const claimed = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CREATING', updatedAt: new Date() } });
        return { payment: claimed, mode: 'RECOVER' as const };
      }
      const snapshot = { amount: bill.amount, openId: customer.openId, description: '纯电主义订阅账单' };
      const created = await tx.payment.create({ data: { billId, customerId: customer.id, amount: bill.amount, idempotencyKey, requestSnapshot: snapshot } });
      return { payment: created, mode: 'NEW' as const };
    });
    const payment = claim.payment;
    if (claim.mode === 'CACHED') return { paymentId: payment.id, ...(payment.clientParameters as any) };
    if (claim.mode === 'RECOVER') {
      try {
        const result = await this.gateway.query(payment.id);
        ensure(result.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
        if (result.status !== 'PENDING') { await this.settle(payment.id, result); ensure(false, 409, 'PAYMENT_TERMINAL', '支付状态已更新，请刷新账单'); }
      } catch (error) { if (this.code(error) !== 'PAYMENT_ORDER_NOT_EXIST') throw error; }
    }
    const current = await this.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    ensure(current.status === 'CREATING', 409, 'PAYMENT_TERMINAL', '付款状态已更新，请刷新账单');
    const snapshot = payment.requestSnapshot as { amount: number; openId: string; description: string };
    const parameters = await this.gateway.create({ paymentId: payment.id, ...snapshot });
    await this.db.payment.updateMany({ where: { id: payment.id, status: 'CREATING' }, data: { status: 'PENDING', clientParameters: parameters } });
    return { paymentId: payment.id, ...parameters };
  }
  async sync(paymentId: string) { return this.settle(paymentId, await this.gateway.query(paymentId)); }
  async close(paymentId: string, customerId?: string) {
    const payment = await this.db.payment.findFirst({ where: { id: paymentId, ...(customerId ? { customerId } : {}) } }); ensure(payment, 404, 'NOT_FOUND', '支付记录不存在');
    if (payment.status === 'CLOSED') return payment;
    ensure(['CREATING','PENDING'].includes(payment.status), 409, 'PAYMENT_STATE', '当前支付不可关闭');
    ensure(payment.status !== 'CREATING' || payment.updatedAt.getTime() <= Date.now() - 45000, 409, 'PAYMENT_RECOVERING', '支付请求处理中，请稍后关闭');
    const state = await this.gateway.query(paymentId);
    if (state.status !== 'PENDING') return this.settle(paymentId, state);
    ensure(state.amount === payment.amount, 409, 'PAYMENT_MISMATCH', '支付金额不匹配');
    try { await this.gateway.close(paymentId); } catch (error) { if (this.code(error) !== 'PAYMENT_ALREADY_CLOSED') throw error; }
    return this.settle(paymentId, { status: 'CLOSED', amount: payment.amount });
  }
  async syncRefund(refundId: string) { return this.settleRefund(refundId, await this.gateway.queryRefund(refundId)); }
  async retryRefund(refundId: string, actorId: string) {
    const refund = await this.db.serial(async tx => {
      const item = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
      ensure(item?.status === 'PROCESSING' && item.approvedBy && item.payment.status === 'SUCCEEDED', 409, 'REFUND_STATE', '仅已审批且原付款成功的处理中退款可恢复');
      ensure(item.updatedAt.getTime() <= Date.now() - 45000, 409, 'REFUND_RECOVERING', '退款处理中，请45秒后再查询或恢复');
      await tx.refund.update({ where: { id: refundId }, data: { updatedAt: new Date() } });
      await audit(tx, actorId, 'RECOVER', 'refunds', refundId); return item;
    });
    try { return await this.syncRefund(refundId); }
    catch (error) { if (this.code(error) !== 'REFUND_NOT_FOUND') throw error; }
    const result = await this.gateway.refund({ refundId, paymentId: refund.paymentId, amount: refund.amount, totalAmount: refund.payment.amount, reason: refund.reason });
    return this.settleRefund(refundId, { ...result, paymentId: refund.paymentId, amount: refund.amount, totalAmount: refund.payment.amount });
  }
}
@Controller()
export class BillingController {
  constructor(@Inject(Db) private db: Db, @Inject(BillingService) private billing: BillingService, @Inject(PaymentGateway) private gateway: PaymentGateway) {}
  @Post('customer/bills/:id/pay') pay(@Param('id') id: string, @Body() body: any, @Req() request: any) { return this.billing.pay(request.customer, id, z.object({ idempotencyKey: key }).parse(body).idempotencyKey); }
  @Get('customer/payments/:id') async getPayment(@Param('id') id: string, @Req() request: any) { const payment = await this.db.payment.findFirst({ where: { id, customerId: request.customer.id } }); ensure(payment, 404, 'NOT_FOUND', '支付记录不存在'); const current = ['CREATING','PENDING'].includes(payment.status) ? await this.billing.sync(id) : payment; const { clientParameters, requestSnapshot, ...safe } = current; return safe; }
  @Post('admin/payments/:id/sync') sync(@Param('id') id: string) { return this.billing.sync(id); }
  @Post('admin/payments/:id/close') async closeAdmin(@Param('id') id: string, @Req() request: any) { const payment = await this.billing.close(id); await audit(this.db, request.admin.id, 'CLOSE_REQUEST', 'payments', id, { status: payment.status }); return payment; }
  @Post('customer/payments/:id/close') async closeCustomer(@Param('id') id: string, @Req() request: any) { const { requestSnapshot, clientParameters, ...payment } = await this.billing.close(id, request.customer.id); await audit(this.db, request.customer.id, 'CLOSE_REQUEST', 'payments', id, { status: payment.status }, 'CUSTOMER'); return payment; }
  @Post('admin/refunds/:id/sync') syncRefund(@Param('id') id: string) { return this.billing.syncRefund(id); }
  @Post('admin/refunds/:id/retry') retryRefund(@Param('id') id: string, @Req() request: any) { return this.billing.retryRefund(id, request.admin.id); }
  @Post('admin/bills') createBill(@Body() body: any, @Req() request: any) {
    const input = z.object({ orderId: text, type: z.enum(['EXTRA_FEE','RETURN_SETTLEMENT']), amount: money.positive(), dueDate: z.string().refine(value => { try { dateOnly(value); return true; } catch { return false; } }, '日期无效'), description: text, fileIds, idempotencyKey: key }).parse(body); const dueDate = dateOnly(input.dueDate);
    return this.db.serial(async tx => {
      const old = await tx.bill.findUnique({ where: { orderId_idempotencyKey: { orderId: input.orderId, idempotencyKey: input.idempotencyKey } } });
      if (old) { ensure(old.type === input.type && old.amount === input.amount && old.description === input.description && old.dueDate.getTime() === dueDate.getTime() && hash(old.evidenceFileIds) === hash(input.fileIds), 409, 'IDEMPOTENCY_CONFLICT', '费用账单编号与内容冲突'); return old; }
      const order = await tx.order.findUnique({ where: { id: input.orderId } }); ensure(order && ['ACTIVE','SETTLING','COMPLETED'].includes(order.status), 409, 'ORDER_STATE', '仅用车中或已归还订单可产生附加费用');
      if (input.type === 'RETURN_SETTLEMENT') ensure(await tx.handover.count({ where: { orderId: order.id, type: 'RETURN', status: 'COMPLETED' } }), 409, 'RETURN_REQUIRED', '归还结算须先完成还车交接');
      ensure(await tx.storedFile.count({ where: { id: { in: input.fileIds }, customerId: null, purpose: 'evidence' } }) === new Set(input.fileIds).size, 403, 'FILE_OWNERSHIP', '请上传后台费用证据');
      const max = await tx.bill.aggregate({ where: { orderId: order.id, type: input.type }, _max: { sequence: true } });
      const {fileIds: evidenceFileIds, ...data} = input;
      const bill = await tx.bill.create({ data: { ...data, dueDate, evidenceFileIds, customerId: order.customerId, sequence: (max._max.sequence || 0) + 1, createdBy: request.admin.id } });
      await audit(tx, request.admin.id, 'CREATE_FEE', 'bills', bill.id, input); return bill;
    });
  }
  @Post('admin/bills/:id/review') reviewBill(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const input = z.object({ decision: z.enum(['APPROVED','REJECTED']), note: text }).parse(body);
    return this.db.serial(async tx => { const bill = await tx.bill.findUnique({ where: { id } }); ensure(bill?.status === 'DRAFT' && ['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS'].includes(bill.type), 409, 'STATE_CONFLICT', '仅附加费用草稿可复核'); ensure(bill.createdBy && bill.createdBy !== request.admin.id, 403, 'DUAL_APPROVAL', '费用须由另一名财务人员复核'); const updated = await tx.bill.update({ where: { id }, data: { status: input.decision === 'APPROVED' ? 'REVIEWED' : 'VOID', reviewedBy: request.admin.id, reviewedAt: new Date(), reviewNote: input.note } }); await audit(tx, request.admin.id, 'REVIEW_FEE', 'bills', id, input); return updated; });
  }
  @Post('admin/bills/:id/publish') publish(@Param('id') id: string, @Req() request: any) { return this.db.serial(async tx => { const bill = await tx.bill.findUnique({ where: { id } }); ensure(bill, 404, 'NOT_FOUND', '账单不存在'); ensure(bill.status === (['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS'].includes(bill.type) ? 'REVIEWED' : 'DRAFT'), 409, 'STATE_CONFLICT', '费用账单须完成独立复核后发布'); const order = await tx.order.findUniqueOrThrow({ where: { id: bill.orderId } }); ensure(order.status !== 'CANCELLED', 409, 'ORDER_STATE', '订单已取消'); const result = await tx.bill.update({ where: { id }, data: { status: 'PENDING' } }); await audit(tx, request.admin.id, 'PUBLISH', 'bills', id); await notify(tx, bill.customerId, '新账单待支付', '请核对账单并主动支付。', 'bills', id); return result; }); }
  @Post('admin/refunds') requestRefund(@Body() body: any, @Req() request: any) {
    const input = z.object({ paymentId: text, amount: money.positive(), reason: text, idempotencyKey: key }).parse(body);
    return this.db.serial(async tx => {
      const existing = await tx.refund.findUnique({ where: { requestedBy_idempotencyKey: { requestedBy: request.admin.id, idempotencyKey: input.idempotencyKey } } });
      if (existing) { ensure(existing.paymentId === input.paymentId && existing.amount === input.amount && existing.reason === input.reason, 409, 'IDEMPOTENCY_CONFLICT', '退款请求编号与内容冲突'); return existing; }
      const payment = await tx.payment.findUnique({ where: { id: input.paymentId } }); ensure(payment?.status === 'SUCCEEDED', 409, 'PAYMENT_STATE', '仅成功支付可申请退款');
      const bill=await tx.bill.findUniqueOrThrow({where:{id:payment.billId}});await tx.order.update({where:{id:bill.orderId},data:{revision:{increment:1}}});ensure(await tx.orderChange.count({where:{orderId:bill.orderId,status:{notIn:['APPLIED','CANCELLED','REJECTED']}}})===0,409,'CHANGE_REFUND_MANAGED','订单变更期间退款须使用已签补充协议生成的退款安排');
      await guardPackRefund(tx,payment,input.amount);
      const sum = await tx.refund.aggregate({ where: { paymentId: input.paymentId, status: { in: ['PENDING_APPROVAL','PROCESSING','SUCCEEDED'] } }, _sum: { amount: true } });
      ensure((sum._sum.amount || 0) + input.amount <= payment.amount, 409, 'REFUND_LIMIT', '退款累计金额不可超过实付');
      const refund = await tx.refund.create({ data: { ...input, customerId: payment.customerId, requestedBy: request.admin.id } }); await audit(tx, request.admin.id, 'REQUEST', 'refunds', refund.id, input); return refund;
    });
  }
  @Post('admin/refunds/:id/reject') reject(@Param('id') id: string, @Body() body: any, @Req() request: any) { const { reason } = z.object({ reason: text }).parse(body); return this.db.serial(async tx => { const refund = await tx.refund.findUnique({ where: { id } }); ensure(refund?.status === 'PENDING_APPROVAL', 409, 'STATE_CONFLICT', '退款请求已处理'); const updated = await tx.refund.update({ where: { id }, data: { status: 'REJECTED', reason } }); await audit(tx, request.admin.id, 'REJECT', 'refunds', id, { reason }); return updated; }); }
  @Post('admin/refunds/:id/approve') async approve(@Param('id') id: string, @Req() request: any) {
    const refund = await this.db.serial(async tx => { const item = await tx.refund.findUnique({ where: { id }, include: { payment: true } }); ensure(item?.status === 'PENDING_APPROVAL', 409, 'STATE_CONFLICT', '退款请求已处理'); ensure(item.requestedBy !== request.admin.id, 403, 'DUAL_APPROVAL', '退款须由另一名有权限人员复核'); await guardPackRefund(tx,item.payment,item.amount,true); const updated = await tx.refund.update({ where: { id }, data: { status: 'PROCESSING', approvedBy: request.admin.id }, include: { payment: true } }); await audit(tx, request.admin.id, 'APPROVE', 'refunds', id); return updated; });
    try {
      const result = await this.gateway.refund({ refundId: id, paymentId: refund.paymentId, amount: refund.amount, totalAmount: refund.payment.amount, reason: refund.reason });
      return this.billing.settleRefund(id, { ...result, paymentId: refund.paymentId, amount: refund.amount, totalAmount: refund.payment.amount });
    } catch (error) { throw error; }
  }
}
