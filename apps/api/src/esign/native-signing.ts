import {AsyncLocalStorage} from 'node:async_hooks';
import {ensure} from '../common/errors';
import {h5Config} from '../h5-sign/config';

export const MINIAPP_RETURN='https://mini-api.subauto.keybox.cloud/api/public/esign-return';
export const MINIAPP_PROVIDER_API='https://textapi17.fadada.com/api2/';
const APPROVED_HOSTS=new Set(['textapi17.fadada.com','realnameverify16.fadada.com']);
const nativeContext=new AsyncLocalStorage<boolean>();

export function nativeProviderHosts(){
 return [...new Set((process.env.MINIAPP_SIGNING_PROVIDER_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>APPROVED_HOSTS.has(v)))];
}
export function nativeSigningConfig(){
 const providerHosts=nativeProviderHosts();
 const enabled=process.env.MINIAPP_SIGNING_ENABLED==='true';
 const signProviderConfigured=process.env.FADADA_BASE_URL===MINIAPP_PROVIDER_API&&[...APPROVED_HOSTS].every(host=>providerHosts.includes(host));
 const faceBridgeConfigured=enabled&&signProviderConfigured&&process.env.MINIAPP_FACE_BRIDGE_ENABLED==='true';
 return {
  mode:'MINIAPP_WEBVIEW', enabled,signProviderConfigured,
  providerHosts,returnUrl:MINIAPP_RETURN,faceBridgeConfigured,faceBridgeAllowlist:[],
  faceBridgeProtocol:faceBridgeConfigured?'FADADA_H5_CURRENT_FLOW_V1':null,
  faceBridgeKinds:faceBridgeConfigured?['identity','owner-identity']:[],fallback:h5Config()
 };
}
export function requireNativeSigning(){
 const config=nativeSigningConfig();
 ensure(config.enabled&&config.signProviderConfigured,503,'MINIAPP_SIGNING_UNAVAILABLE','小程序实名与签署入口尚未开放，请稍后重试或联系运营');
}
export function approvedNativeUrl(value:unknown){
 const raw=typeof value==='string'?value:'';
 const match=raw.length<=16384&&/^https:\/\/([a-zA-Z0-9.-]+)(\/[^\s\\#]*)$/.exec(raw);
 ensure(match&&nativeProviderHosts().includes(match[1].toLowerCase()),502,'PROVIDER_REDIRECT_DENIED','签约服务返回地址未通过安全核验，请联系运营');
 // A short-lived supplier URL can contain signed query bytes; validation must not normalize them.
 return raw;
}
export function nativeRealnameUrl(value:unknown){
 const raw=typeof value==='string'?value:'';
 const source='https://realnameverify.fadada.com/';
 // Official 5.1.3 requires the public realname origin to use the tenant's registered business domain.
 // Replace only the exact authority prefix, never opaque path/query values or other response fields.
 const mapped=raw.startsWith(source)?'https://realnameverify16.fadada.com/'+raw.slice(source.length):raw;
 ensure(mapped.startsWith('https://realnameverify16.fadada.com/'),502,'PROVIDER_REDIRECT_DENIED','实名服务返回地址未通过安全核验，请联系运营');
 return approvedNativeUrl(mapped);
}
export function nativeSigningResult<T extends object>(result:T):T{
 const value=result as {url?:string};return value.url?{...result,url:approvedNativeUrl(value.url)}:result;
}
export function isNativeSigning(){return nativeContext.getStore()===true;}
export function runNativeSigning<T extends object>(action:()=>Promise<T>){
 return nativeContext.run(true,async()=>nativeSigningResult(await action()));
}
