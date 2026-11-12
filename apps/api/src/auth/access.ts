import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Db } from '../common/db';
import { ensure, fail } from '../common/errors';
import { tokenHash } from './auth.service';
import {h5Access} from '../h5-sign/access';
import {ownerH5Access} from '../owner-h5/access';
import {requireNativeSigning} from '../esign/native-signing';
import {requireCurrentConsents} from './consents';
import { allowed } from './role-policy';
import {partnerRouteAllowed} from './partner-route-access';
import {residualPreviewAllowed} from './residual-preview-access';
import {assertCustomerRecordVisible} from '../customers/record-visibility';
export { allowed, permissions, resources } from './role-policy';
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
    if (/^\/(?:admin\/vehicle-owners|customer\/owners)(?:\/|$)/i.test(path)) {
      ensure(process.env.OWNER_WORKSPACE_ENABLED === 'true' || process.env.MVP_V2_ENABLED === 'true', 503, 'OWNER_WORKSPACE_DISABLED', '第三方车主功能暂未开放。');
    }
    if(/^\/owner-h5(?:\/|$)/i.test(path))return ownerH5Access(this.db,request,context.switchToHttp().getResponse(),path);
    if(path.startsWith('/h5-sign/'))return h5Access(this.db,request,context.switchToHttp().getResponse(),path);
    if (request.method === 'POST' && ['/callbacks/wechat-pay', '/callbacks/wechat-refund', '/callbacks/fadada-sign', '/callbacks/fadada-electronic-sign', '/callbacks/fadada-identity', '/callbacks/fadada-owner-identity', '/callbacks/fadada-owner-sign', '/callbacks/fadada-owner-authorization', '/callbacks/wechat-pay-verification'].includes(path)) return true;
    if (path.startsWith('/public/') || path === '/health') return true;
    if (path === '/admin/auth/login') { adminOrigin(request); return true; }
    if (['/customer/auth/wechat','/customer/auth/sms/request','/customer/auth/sms/login'].includes(path)) return true;
    if (path.startsWith('/admin/')) {
      context.switchToHttp().getResponse().setHeader('Cache-Control','private, no-store');
      const raw = request.cookies?.admin_session;
      if (!raw) fail(401, 'UNAUTHENTICATED', '请登录后台');
      const session = await this.db.adminSession.findUnique({ where: { id: tokenHash(raw) }, include: { admin: true } });
      ensure(session && session.expiresAt > new Date() && session.admin.active && session.authVersion === session.admin.authVersion, 401, 'SESSION_EXPIRED', '会话已失效');
      const write = !['GET','HEAD','OPTIONS'].includes(request.method);
      if (write) { adminOrigin(request); ensure(request.headers['x-csrf-token'] === session.csrfToken, 403, 'CSRF_DENIED', '请求校验失败'); }
      const routeResource = path.split('/')[2];
      const resource = routeResource === 'order-renewals' ? 'order-changes' : ['cancellations04','terminations'].includes(routeResource) ? 'orders' : routeResource;
      // POST carries a quotation input but preview is read-only. Session, origin
      // and CSRF above still apply; nearby creation/action paths keep write RBAC.
      const renewalPreview = request.method === 'POST' && /^\/admin\/orders\/[^/]+\/renewals\/preview\/?$/.test(path);
      if(session.admin.role==='FIELD'&&resource==='auth')ensure(['/admin/auth/me','/admin/auth/logout','/admin/auth/password'].includes(path),403,'FORBIDDEN','现场账号无此权限');
      const partnerAllowed=partnerRouteAllowed(session.admin,path,request.method);
      const residualPreview=residualPreviewAllowed(session.admin.role,path,request.method);
      ensure(resource === 'auth' || (renewalPreview?allowed(session.admin.role,'order-changes',false):residualPreview!==null?residualPreview:partnerAllowed===null?allowed(session.admin.role, resource, write):partnerAllowed), 403, 'FORBIDDEN', '当前角色无权执行此操作');
      request.admin = session.admin; request.session = session;
      return true;
    }
    if (path.startsWith('/customer/')) {
      context.switchToHttp().getResponse().setHeader('Cache-Control','no-store');
      const raw = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '')?.[1];
      ensure(raw, 401, 'UNAUTHENTICATED', '请先登录');
      const session = await this.db.customerSession.findUnique({ where: { id: tokenHash(raw) }, include: { customer: true } });
      ensure(session && session.expiresAt > new Date(), 401, 'SESSION_EXPIRED', '登录已过期');
      await assertCustomerRecordVisible(this.db,session.customer.id,path);
      if(!['GET','HEAD','OPTIONS'].includes(request.method)&&/^\/customer\/owners(?:\/|$)/i.test(path)){
        const rawOwnerId=/^\/customer\/owners\/([^/]+)/i.exec(path)?.[1];
        let ownerId:string|undefined;
        try{ownerId=rawOwnerId?decodeURIComponent(rawOwnerId):undefined;}catch{ensure(false,400,'VALIDATION','企业记录编号无效');}
        const account=ownerId&&ownerId.toLowerCase()!=='claim'?await this.db.ownerESignAccount.findUnique({where:{ownerId},select:{consentSnapshot:true}}):null;
        ensure(process.env.OWNER_LEGAL_H5_ONLY!=='true'&&(account?.consentSnapshot as any)?.channel!=='OWNER_LEGAL_H5',409,'OWNER_H5_REQUIRED','企业认证与用印已迁至宁达汽车订阅服务号，请由法人本人进入车主中心办理');
      }
      if(request.method==='POST'&&/^\/customer\/(?:esign\/(?:register|verify|refresh)|(?:contracts|handovers|order-changes|technical-acceptances)\/[^/]+\/sign)$/i.test(path.replace(/\/+$/,''))){requireNativeSigning();await requireCurrentConsents(this.db,session.customer.id,['terms','privacy']);}
      request.customer = session.customer; request.session = session;
      return true;
    }
    return false;
  }
}
