import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { ensure, fail } from '../common/errors';
import { tokenHash } from './auth.service';
import {h5Access} from '../h5-sign/access';
import {H5_ENTRY} from '../h5-sign/config';
export const resources = ['model-definitions','vehicles','plans','customers','applications','orders','contracts','bills','payments','deposits','refunds','handovers','mileages','entitlements','services','notifications','users','audit-logs','legal-documents','files','enterprise-seals','seal-authorities','signature-policies','esign-approvals','payment-verifications','usage-periods','return-settlements','order-changes'];
export function allowed(role: string, resource: string, write: boolean) {
  if (role === 'ADMIN') return true;
  if (['users', 'audit-logs', 'payment-verifications'].includes(resource)) return false;
  if (['enterprise-seals','seal-authorities','signature-policies'].includes(resource)) return !write && role === 'OPERATIONS';
  if (resource === 'esign-approvals') return role === 'OPERATIONS';
  if (!write) return true;
  if (['usage-periods','order-changes'].includes(resource)) return ['OPERATIONS','FINANCE'].includes(role);
  if (resource === 'files') return ['OPERATIONS','SUPPORT','FINANCE'].includes(role);
  if (['bills', 'payments', 'deposits', 'refunds', 'usage-periods', 'return-settlements'].includes(resource)) return role === 'FINANCE';
  if (['services', 'notifications', 'files'].includes(resource)) return ['OPERATIONS', 'SUPPORT'].includes(role);
  return role === 'OPERATIONS';
}
export function permissions(role: string) { return resources.flatMap(resource => ['read','write'].filter(action => allowed(role, resource, action === 'write')).map(action => `${resource}.${action}`)); }
export function adminOrigin(request: any) {
  const allowedOrigins = (process.env.ADMIN_ORIGIN || 'http://localhost:3100').split(',').map(v => v.trim());
  ensure(typeof request.headers.origin === 'string' && allowedOrigins.includes(request.headers.origin), 403, 'ORIGIN_DENIED', '请求来源不允许');
}
@Injectable()
export class Access implements CanActivate {
  constructor(@Inject(Db) private readonly db: Db) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const path = request.path.replace(/^\/api/, '');
    if(path.startsWith('/h5-sign/'))return h5Access(this.db,request,context.switchToHttp().getResponse(),path);
    if (request.method === 'POST' && ['/callbacks/wechat-pay', '/callbacks/wechat-refund', '/callbacks/fadada-sign', '/callbacks/fadada-identity', '/callbacks/wechat-pay-verification'].includes(path)) return true;
    if (path.startsWith('/public/') || path === '/health') return true;
    if (path === '/admin/auth/login') { adminOrigin(request); return true; }
    if (['/customer/auth/wechat','/customer/auth/sms/request','/customer/auth/sms/login'].includes(path)) return true;
    if (path.startsWith('/admin/')) {
      const raw = request.cookies?.admin_session;
      if (!raw) fail(401, 'UNAUTHENTICATED', '请登录后台');
      const session = await this.db.adminSession.findUnique({ where: { id: tokenHash(raw) }, include: { admin: true } });
      ensure(session && session.expiresAt > new Date() && session.admin.active, 401, 'SESSION_EXPIRED', '会话已失效');
      const write = !['GET','HEAD','OPTIONS'].includes(request.method);
      if (write) { adminOrigin(request); ensure(request.headers['x-csrf-token'] === session.csrfToken, 403, 'CSRF_DENIED', '请求校验失败'); }
      const resource = path.split('/')[2];
      ensure(resource === 'auth' || allowed(session.admin.role, resource, write), 403, 'FORBIDDEN', '当前角色无权执行此操作');
      request.admin = session.admin; request.session = session;
      return true;
    }
    if (path.startsWith('/customer/')) {
      const raw = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '')?.[1];
      ensure(raw, 401, 'UNAUTHENTICATED', '请先登录');
      const session = await this.db.customerSession.findUnique({ where: { id: tokenHash(raw) }, include: { customer: true } });
      ensure(session && session.expiresAt > new Date(), 401, 'SESSION_EXPIRED', '登录已过期');
      if(request.method==='POST'&&/^\/customer\/(?:esign\/(?:register|verify|refresh)|(?:contracts|handovers|order-changes)\/[^/]+\/sign)$/i.test(path.replace(/\/+$/,'')))fail(409,'H5_SIGNING_REQUIRED',`请通过服务号签约中心完成实名与签署：${H5_ENTRY}`);
      request.customer = session.customer; request.session = session;
      return true;
    }
    return false;
  }
}
