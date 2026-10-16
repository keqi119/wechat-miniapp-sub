import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { text } from '../common/data';
import { ensure } from '../common/errors';
import { VERIFICATION_PROVIDER, VerificationProvider } from './config';
import { PaymentVerificationService } from './service';

@Controller()
export class PaymentVerificationController {
  constructor(@Inject(PaymentVerificationService) private service: PaymentVerificationService) {}
  @Post('admin/payment-verifications') create(@Body() body: unknown, @Req() request: any) {
    const input = z.object({ customerId: text, authorizationNote: z.string().trim().min(1).max(2000) }).strict().parse(body);
    return this.service.create(input.customerId, input.authorizationNote, request.admin.id);
  }
  @Get('admin/payment-verifications') list(@Query() query: unknown) {
    const input = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
      keyword: z.string().max(128).optional(), status: z.preprocess(value => value === '' ? undefined : value,
        z.enum(['AUTHORIZED','CREATING','PENDING','SUCCEEDED','CLOSED','FAILED','EXPIRED']).optional()) }).strict().parse(query);
    return this.service.list(undefined, input);
  }
  @Get('admin/payment-verifications/:id') detail(@Param('id') id: string) { return this.service.detail(id); }
  @Post('admin/payment-verifications/:id/close') close(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    z.object({}).strict().parse(body || {}); return this.service.close(id, request.admin.id);
  }
  @Get('customer/payment-verifications') customerList(@Req() request: any) { return this.service.list(request.customer.id); }
  @Post('customer/payment-verifications/:id/pay') pay(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    z.object({}).strict().parse(body || {}); return this.service.pay(id, request.customer.id);
  }
  @Post('customer/payment-verifications/:id/query') query(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    z.object({}).strict().parse(body || {}); return this.service.query(id, request.customer.id);
  }
}

@Controller('callbacks')
export class VerificationCallbackController {
  constructor(@Inject(PaymentVerificationService) private service: PaymentVerificationService, @Inject(VERIFICATION_PROVIDER) private provider: VerificationProvider) {}
  @Post('wechat-pay-verification') @HttpCode(204) async receive(@Req() request: any) {
    ensure(this.provider.enabled, 503, 'VERIFICATION_UNAVAILABLE', '支付验收入口尚未启用');
    ensure(Buffer.isBuffer(request.rawBody) && request.rawBody.length, 400, 'RAW_BODY_REQUIRED', '支付回调原始报文缺失');
    const raw = request.rawBody.toString('utf8');
    const event = this.provider.gateway.decodeNotification(raw, request.headers);
    ensure(event.kind === 'payment' && event.eventId.length <= 128, 400, 'PAYMENT_EVENT_INVALID', '仅接受支付成功通知');
    await this.service.settle(event.paymentId, event, { id: event.eventId, payloadHash: createHash('sha256').update(raw).digest('hex') });
  }
}
