import {ensure} from '../common/errors';
export const H5_ORIGIN='https://app.subauto.keybox.cloud';
export const H5_ENTRY=H5_ORIGIN+'/miniapp-sign/';
export const H5_RETURN=H5_ENTRY+'return/';
export const H5_COOKIE='h5_signing_session';
export const H5_COOKIE_OPTIONS={httpOnly:true,secure:true,sameSite:'lax' as const,path:'/miniapp-sign/'};
export function h5Enabled(){return process.env.H5_SIGNING_ENABLED==='true';}
export function providerHosts(){return(process.env.H5_SIGNING_PROVIDER_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9.-]+$/.test(x));}
export function h5Config(){let host='';try{host=new URL(process.env.FADADA_BASE_URL||'').hostname;}catch{}return{mode:'SERVICE_ACCOUNT_H5',entryUrl:H5_ENTRY,enabled:h5Enabled(),signProviderConfigured:providerHosts().includes(host)};}
export function h5Origin(request:any){ensure(request.headers.origin===H5_ORIGIN,403,'ORIGIN_DENIED','请求来源不允许');}
export function approvedProviderUrl(value:unknown){let url:URL|undefined;try{url=new URL(String(value));}catch{}ensure(url&&url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&providerHosts().includes(url.hostname.toLowerCase()),502,'PROVIDER_REDIRECT_DENIED','签约服务返回地址未通过安全核验，请联系运营');return url.href;}
export function approvedReturnUrl(value:string|undefined){ensure(value==='https://mini-api.subauto.keybox.cloud/api/public/esign-return'||value===H5_RETURN,503,'FADADA_CALLBACK_CONFIG','签约返回地址未经批准');return value;}
