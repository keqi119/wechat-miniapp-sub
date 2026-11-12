import {ensure} from '../common/errors';
import {ownerH5EntryUrl,ownerH5ReturnUrl,platformOrigins} from '../common/platform-origins';

export {ownerH5EntryUrl,ownerH5ReturnUrl};
export const OWNER_H5_COOKIE='owner_h5_session';
export const OWNER_H5_COOKIE_OPTIONS={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/owner/'};
export function ownerH5Enabled(env:NodeJS.ProcessEnv=process.env){
 return env.OWNER_LEGAL_H5_ENABLED==='true'&&env.PORTAL_SMS_ENABLED==='true'&&
  (env.SESSION_SECRET?.length||0)>=32&&
  ['ALIYUN_SMS_ACCESS_KEY_ID','ALIYUN_SMS_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_LOGIN_TEMPLATE_CODE'].every(key=>!!env[key]?.trim());
}
export function ownerH5Config(){return{enabled:ownerH5Enabled(),entryUrl:ownerH5EntryUrl(),mode:'PARTNER_READONLY'};}
export function ownerH5Origin(request:any){
 ensure(typeof request.headers.origin==='string'&&request.headers.origin===platformOrigins().h5,403,'ORIGIN_DENIED','请求来源不允许');
}

