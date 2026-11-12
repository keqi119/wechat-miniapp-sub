import {AsyncLocalStorage} from 'node:async_hooks';
import {ensure} from '../common/errors';
import {h5Config} from '../h5-sign/config';
import {miniappReturnUrl,ownerH5EntryUrl} from '../common/platform-origins';
import {assertNewEsignAllowed,newOrderContractMode} from '../offline-documents/mode';
import {customerIdentityPolicy} from '../customers/identity-policy';

export {miniappReturnUrl};
export const MINIAPP_PROVIDER_API='https://textapi17.fadada.com/api2/';
const APPROVED_HOSTS=new Set(['textapi17.fadada.com','realnameverify16.fadada.com']);
const nativeContext=new AsyncLocalStorage<boolean>();
const customerIdentityContext=new AsyncLocalStorage<boolean>();

export function nativeProviderHosts(){
 return [...new Set((process.env.MINIAPP_SIGNING_PROVIDER_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(v=>APPROVED_HOSTS.has(v)))];
}
export function newEsignRequestsEnabled(){
 return newOrderContractMode()==='ESIGN'&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true';
}
export function nativeSigningConfig(){
 const providerHosts=nativeProviderHosts();
 const requestsEnabled=newEsignRequestsEnabled();
 const enabled=requestsEnabled&&process.env.MINIAPP_SIGNING_ENABLED==='true';
 const newElectronicRequestsEnabled=newOrderContractMode()==='ELECTRONIC'&&process.env.ELECTRONIC_SIGNING_ENABLED==='true'&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true';
 const electronicEnabled=newElectronicRequestsEnabled&&process.env.MINIAPP_SIGNING_ENABLED==='true';
 const signProviderConfigured=process.env.FADADA_BASE_URL===MINIAPP_PROVIDER_API&&[...APPROVED_HOSTS].every(host=>providerHosts.includes(host));
 const faceBridgeConfigured=enabled&&signProviderConfigured&&process.env.MINIAPP_FACE_BRIDGE_ENABLED==='true';
 return {
  mode:'MINIAPP_WEBVIEW',newOrderContractMode:newOrderContractMode(),newEsignRequestsEnabled:requestsEnabled,newElectronicRequestsEnabled,electronicEnabled,enabled,signProviderConfigured,
  providerHosts,returnUrl:miniappReturnUrl(),faceBridgeConfigured,faceBridgeAllowlist:[],
  faceBridgeProtocol:faceBridgeConfigured?'FADADA_H5_CURRENT_FLOW_V1':null,
  faceBridgeKinds:faceBridgeConfigured?['identity','owner-identity']:[],fallback:{...h5Config(),enabled:newOrderContractMode()!=='OFFLINE'&&h5Config().enabled},
  ownerPortal:{mode:'OWNER_LEGAL_H5',migrated:newOrderContractMode()!=='OFFLINE'&&process.env.OWNER_LEGAL_H5_ONLY==='true',entryUrl:ownerH5EntryUrl()}
 };
}
/** Customer identity is available independently of contract signing. */
export function customerIdentityConfig(scopedSigning=false){
 const identityPolicy=scopedSigning?'SIGNING_REQUIRED':customerIdentityPolicy();
 if(identityPolicy==='MANUAL_REVIEW')return{identityPolicy,mode:'MINIAPP_WEBVIEW',enabled:false,signProviderConfigured:false,providerHosts:[],returnUrl:miniappReturnUrl(),faceBridgeConfigured:false,faceBridgeAllowlist:[],faceBridgeProtocol:null,faceBridgeKinds:[]};
 const providerHosts=nativeProviderHosts();
 const signProviderConfigured=process.env.FADADA_BASE_URL===MINIAPP_PROVIDER_API&&[...APPROVED_HOSTS].every(host=>providerHosts.includes(host));
 const configured=['FADADA_APP_ID','FADADA_APP_SECRET'].every(key=>Boolean(process.env[key]?.trim()))&&Buffer.from(process.env.ESIGN_IDENTITY_ENCRYPTION_KEY||'','base64').length===32;
 const enabled=process.env.CUSTOMER_IDENTITY_ENABLED==='true'&&process.env.FADADA_ENABLED==='true'&&process.env.FADADA_ACCOUNT_REGISTER_ENABLED==='true'&&process.env.FADADA_REALNAME_VERIFY_ENABLED==='true'&&configured&&signProviderConfigured;
 const faceBridgeConfigured=enabled&&process.env.MINIAPP_FACE_BRIDGE_ENABLED==='true';
 return{identityPolicy,mode:'MINIAPP_WEBVIEW',enabled,signProviderConfigured,providerHosts,returnUrl:miniappReturnUrl(),faceBridgeConfigured,faceBridgeAllowlist:[],faceBridgeProtocol:faceBridgeConfigured?'FADADA_H5_CURRENT_FLOW_V1':null,faceBridgeKinds:faceBridgeConfigured?['identity']:[]};
}
export function requireCustomerIdentity(scopedSigning=false){ensure(customerIdentityConfig(scopedSigning).enabled&&(!scopedSigning||process.env.ESIGN_NEW_REQUESTS_ENABLED==='true'),503,'CUSTOMER_IDENTITY_UNAVAILABLE','实名认证暂未开放，请稍后重试或联系运营');}
export function requireNativeSigning(){
 assertNewEsignAllowed();
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
export function isCustomerIdentity(){return customerIdentityContext.getStore()===true;}
export function isNativeSigning(){return nativeContext.getStore()===true&&!isCustomerIdentity();}
export function runCustomerIdentity<T extends object>(action:()=>Promise<T>,scopedSigning=false){
 requireCustomerIdentity(scopedSigning);
 if(scopedSigning)return nativeContext.run(true,async()=>nativeSigningResult(await action()));
 return customerIdentityContext.run(true,async()=>nativeSigningResult(await action()));
}
export function runNativeSigning<T extends object>(action:()=>Promise<T>){
 return nativeContext.run(true,async()=>nativeSigningResult(await action()));
}
