import { Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Db } from '../common/db';
import { PaymentGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { BillingService } from '../billing/billing';
import { WechatPaymentGateway } from './wechat-payment';

@Controller('callbacks')
export class PaymentCallbacksController {
  constructor(@Inject(Db) private db: Db, @Inject(PaymentGateway) private gateway: PaymentGateway, @Inject(BillingService) private billing: BillingService) {}
  private async handle(request: any, expectedKind: 'payment' | 'refund') {
    ensure(Buffer.isBuffer(request.rawBody) && request.rawBody.length > 0, 400, 'RAW_BODY_REQUIRED', '支付回调原始报文缺失');
    ensure(this.gateway instanceof WechatPaymentGateway, 503, 'PAYMENT_UNAVAILABLE', '支付回调服务未配置');
    const raw = request.rawBody.toString('utf8'), event = this.gateway.decodeNotification(raw, request.headers);
    ensure(event.kind === expectedKind && event.eventId.length <= 128, 400, 'PAYMENT_EVENT_INVALID', '支付回调类型无效');
    const payloadHash = createHash('sha256').update(raw).digest('hex'), resourceId = event.kind === 'payment' ? event.paymentId : event.refundId;
    const record = await this.db.providerEvent.upsert({ where: { provider_eventId: { provider: 'WECHAT_PAY', eventId: event.eventId } }, update: {}, create: { provider: 'WECHAT_PAY', eventId: event.eventId, resourceId, payloadHash, status: 'RECEIVED' } });
    ensure(record.payloadHash === payloadHash && record.resourceId === resourceId, 409, 'EVENT_CONFLICT', '支付回调标识冲突');
    if (record.status === 'PROCESSED') return;
    // Domain settlement is transactional and idempotent. A crash before the final update
    // leaves RECEIVED so a provider retry can safely finish processing.
    if (event.kind === 'payment') await this.billing.settle(event.paymentId, event);
    else await this.billing.settleRefund(event.refundId, event);
    await this.db.providerEvent.update({ where: { id: record.id }, data: { status: 'PROCESSED' } });
  }
  @Post('wechat-pay') @HttpCode(204) payment(@Req() request: any) { return this.handle(request, 'payment'); }
  @Post('wechat-refund') @HttpCode(204) refund(@Req() request: any) { return this.handle(request, 'refund'); }
}
