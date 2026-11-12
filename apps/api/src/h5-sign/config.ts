import {ensure} from '../common/errors';
import {platformOrigins,h5EntryUrl,h5ReturnUrl,approvedPlatformReturn} from '../common/platform-origins';
export {h5EntryUrl,h5ReturnUrl};
export const H5_COOKIE='h5_signing_session';
export const H5_COOKIE_OPTIONS={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/miniapp-sign/'};
export function h5Enabled(){return process.env.H5_SIGNING_ENABLED==='true';}
export function providerHosts(){return(process.env.H5_SIGNING_PROVIDER_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9.-]+$/.test(x));}
export function h5Config(){let host='';try{host=new URL(process.env.FADADA_BASE_URL||'').hostname;}catch{}return{mode:'SERVICE_ACCOUNT_H5',entryUrl:h5EntryUrl(),enabled:h5Enabled(),signProviderConfigured:providerHosts().includes(host)};}
export function h5Origin(request:any){ensure(request.headers.origin===platformOrigins().h5,403,'ORIGIN_DENIED','请求来源不允许');}
export function approvedProviderUrl(value:unknown){let url:URL|undefined;try{url=new URL(String(value));}catch{}ensure(url&&url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&providerHosts().includes(url.hostname.toLowerCase()),502,'PROVIDER_REDIRECT_DENIED','签约服务返回地址未通过安全核验，请联系运营');return url.href;}
export const approvedReturnUrl=approvedPlatformReturn;
