import {ensure} from './errors';

type Environment = Record<string,string|undefined>;
type Callback = 'fadada-sign'|'fadada-identity'|'fadada-owner-identity'|'fadada-owner-authorization'|'fadada-owner-sign';
function origin(value:string|undefined,fallback:string,key:string){
 const raw=value===undefined?fallback:value;
 let url:URL|undefined;try{url=new URL(raw);}catch{}
 // Accept a canonical HTTPS origin only. No normalization may hide userinfo,
 // default ports, whitespace, path, query or fragment in deployment settings.
 ensure(url&&url.protocol==='https:'&&url.origin===raw&&!url.port&&!url.username&&!url.password,
  503,'PLATFORM_ORIGIN_INVALID',`${key}必须为不含端口、路径或凭据的HTTPS来源`);
 return raw;
}
export function platformOrigins(env:Environment=process.env){
 const production=env.NODE_ENV==='production';
 return{api:origin(env.PLATFORM_API_ORIGIN,production?'':'https://mini-api.subauto.keybox.cloud','PLATFORM_API_ORIGIN'),
  h5:origin(env.H5_SIGNING_ORIGIN,production?'':'https://app.subauto.keybox.cloud','H5_SIGNING_ORIGIN')};
}
export function platformCallback(name:Callback,env:Environment=process.env){return platformOrigins(env).api+'/api/callbacks/'+name;}
export function approvedPlatformCallback(value:string|undefined,name:Callback,env:Environment=process.env){
 ensure(value===platformCallback(name,env),503,'FADADA_CALLBACK_CONFIG','供应商通知地址与当前环境的指定回调不匹配');return value;
}
export function miniappReturnUrl(env:Environment=process.env){return platformOrigins(env).api+'/api/public/esign-return';}
export function h5EntryUrl(env:Environment=process.env){return platformOrigins(env).h5+'/miniapp-sign/';}
export function h5ReturnUrl(env:Environment=process.env){return h5EntryUrl(env)+'return/';}
export function ownerH5EntryUrl(env:Environment=process.env){return platformOrigins(env).h5+'/owner/';}
export function ownerH5ReturnUrl(env:Environment=process.env){return ownerH5EntryUrl(env)+'return/';}
export function approvedPlatformReturn(value:string|undefined,env:Environment=process.env){
 ensure(value===miniappReturnUrl(env)||value===h5ReturnUrl(env)||value===ownerH5ReturnUrl(env),503,'FADADA_CALLBACK_CONFIG','签约返回地址未经当前环境批准');return value;
}
