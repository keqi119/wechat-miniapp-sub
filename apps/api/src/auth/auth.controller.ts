import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { Db } from '../common/db';
import { IdentityGateway } from '../common/gateways';
import { ensure } from '../common/errors';
import { mobile, audit } from '../common/data';
import { passwordMatches, token, tokenHash } from './auth.service';
import { acceptConsents, consentInput } from './consents';
import { permissions } from './access';
@Controller()
export class AuthController {
  private failures = new Map<string, { count: number; until: number }>();
  constructor(@Inject(Db) private db: Db, @Inject(IdentityGateway) private identity: IdentityGateway) {}
  private user(user: any) { return { id: user.id, name: user.name, username: user.username, role: user.role, permissions: permissions(user.role) }; }
  @Post('admin/auth/login') async adminLogin(@Body() body: any, @Req() request: any, @Res({ passthrough: true }) response: any) {
    const input = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) }).parse(body);
    const throttleKey = `${request.ip}:${input.username}`; const attempts = this.failures.get(throttleKey);
    ensure(!attempts || attempts.until < Date.now() || attempts.count < 10, 429, 'RATE_LIMITED', '登录尝试过多，请稍后再试');
    const user = await this.db.adminUser.findUnique({ where: { username: input.username } });
    if (!user || !user.active || !passwordMatches(input.password, user.passwordHash)) { this.failures.set(throttleKey, { count: (attempts?.count || 0) + 1, until: Date.now() + 15 * 60_000 }); ensure(false, 401, 'INVALID_CREDENTIALS', '账号或密码无效'); }
    this.failures.delete(throttleKey);
    const raw = token(); const csrfToken = token(); const expiresAt = new Date(Date.now() + 8 * 3600_000);
    await this.db.adminSession.create({ data: { id: tokenHash(raw), adminId: user.id, csrfToken, expiresAt } });
    response.cookie('admin_session', raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/admin', expires: expiresAt });
    await audit(this.db, user.id, 'LOGIN', 'users', user.id);
    return { user: this.user(user), csrfToken };
  }
  @Get('admin/auth/me') adminMe(@Req() request: any) { return { user: this.user(request.admin), csrfToken: request.session.csrfToken }; }
  @Post('admin/auth/logout') async adminLogout(@Req() request: any, @Res({ passthrough: true }) response: any) { await this.db.adminSession.delete({ where: { id: request.session.id } }); response.clearCookie('admin_session', { path: '/api/admin' }); return { success: true }; }
  private async login(identity: { mobile: string; openId?: string }, consents: {documentId:string;version:number}[]) {
    mobile.parse(identity.mobile);
    return this.db.serial(async tx => {
      const existing = await tx.customer.findUnique({ where: { mobile: identity.mobile } });
      ensure(!existing?.openId || !identity.openId || existing.openId === identity.openId, 409, 'IDENTITY_CONFLICT', '手机号与微信身份不匹配');
      const customer = await tx.customer.upsert({ where: { mobile: identity.mobile }, update: identity.openId ? { openId: identity.openId } : {}, create: identity });
      await acceptConsents(tx, customer.id, consents, ['terms','privacy'], 'LOGIN');
      const raw = token(); const expiresAt = new Date(Date.now() + 30 * 86400_000);
      await tx.customerSession.create({ data: { id: tokenHash(raw), customerId: customer.id, expiresAt } });
      return { token: raw, expiresAt, customer: { id: customer.id, mobile: customer.mobile, name: customer.name, drivingYears: customer.drivingYears, wechatBound: !!customer.openId } };
    });
  }
  @Post('customer/auth/wechat') async wechat(@Body() body: any) { const input = z.object({ loginCode: z.string().min(1), phoneCode: z.string().min(1), consents: consentInput }).parse(body); return this.login(await this.identity.wechat(input), input.consents); }
  @Post('customer/auth/sms/request') async sms(@Body() body: any) { const input = z.object({ mobile }).parse(body); await this.identity.requestSms(input.mobile); return { sent: true }; }
  @Post('customer/auth/sms/login') async smsLogin(@Body() body: any) { const input = z.object({ mobile, code: z.string().min(4).max(10), loginCode: z.string().optional(), consents: consentInput }).parse(body); return this.login(await this.identity.verifySms(input), input.consents); }
  @Post('customer/consents') accept(@Body() body: any, @Req() request: any) { const input = z.object({consents: consentInput}).parse(body); return this.db.serial(async tx => { await acceptConsents(tx, request.customer.id, input.consents, ['terms','privacy'], 'UPDATE'); return {accepted:true}; }); }
  @Post('customer/auth/bind-wechat') async bind(@Body() body: any, @Req() request: any) { const identity = await this.identity.wechat(z.object({ loginCode: z.string().min(1), phoneCode: z.string().min(1) }).parse(body)); ensure(identity.mobile === request.customer.mobile, 409, 'IDENTITY_CONFLICT', '请使用当前账号手机号授权'); await this.db.customer.update({ where: { id: request.customer.id }, data: { openId: identity.openId } }); return { wechatBound: true }; }
  @Post('customer/auth/logout') async logout(@Req() request: any) { await this.db.customerSession.delete({ where: { id: request.session.id } }); return { success: true }; }
}
