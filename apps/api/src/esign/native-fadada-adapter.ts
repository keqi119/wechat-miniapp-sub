import {FadadaApiClient} from './fadada/fadada-api.client';
import {FadadaHttpClient,FadadaTransport,FadadaMultipartFile,defaultFadadaTransport} from './fadada/fadada-http-client';
import {recordFadadaQuery} from './fadada-query-binding';
import {FadadaConfig,FadadaRequest} from './fadada/fadada.types';
import {buildFadadaRequest,buildPersonVerifyUrlRequest} from './fadada/fadada-request-builder';
import {isNativeSigning,MINIAPP_RETURN,MINIAPP_PROVIDER_API} from './native-signing';
import {ensure} from '../common/errors';
const PUBLIC_KEYS=new Set(['app_id','msg_digest','timestamp','v']);
function business(params:Record<string,string>){return Object.fromEntries(Object.entries(params).filter(([key])=>!PUBLIC_KEYS.has(key)));}
const queryUrl=MINIAPP_PROVIDER_API+'query_sign_result.api';
const querySafeTransport:FadadaTransport=async request=>{
 if(request.url!==queryUrl)return defaultFadadaTransport(request);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeoutMs);
 try{const response=await fetch(request.url,{method:request.method,body:request.body as never,headers:request.headers,signal:controller.signal,redirect:'error'});return{status:response.status,headers:Object.fromEntries(response.headers),bodyText:await response.text()};}
 finally{clearTimeout(timer);}
};
/** Keep the pinned SDK byte-for-byte intact. Add the documented WeChat fields before rebuilding its digest. */
export class NativeAwareFadadaHttp extends FadadaHttpClient {
 constructor(private readonly nativeConfig:FadadaConfig,transport?:FadadaTransport){super(nativeConfig,transport||querySafeTransport);}
 override async send(request:FadadaRequest,file?:FadadaMultipartFile){
  if(isNativeSigning())ensure(this.nativeConfig.baseUrl===MINIAPP_PROVIDER_API,503,'MINIAPP_PROVIDER_API','小程序供应商接口地址未通过核验');
  if(isNativeSigning()&&request.endpoint==='get_person_verify_url.api'){
   ensure(request.params.return_url===MINIAPP_RETURN,503,'FADADA_CALLBACK_CONFIG','小程序实名返回地址不匹配');
   request=buildPersonVerifyUrlRequest({config:this.nativeConfig,timestamp:request.params.timestamp,businessParams:{...business(request.params),is_mini_program:'3'}});
  }
  if(request.endpoint==='query_sign_result.api'){
   const p=request.params,identity={contractId:p.contract_id,customerId:p.customer_id,transactionId:p.transaction_id};
   ensure(this.nativeConfig.baseUrl===MINIAPP_PROVIDER_API&&request.url===queryUrl&&request.method==='POST'&&!file&&Object.values(identity).every(v=>typeof v==='string'&&v.length>0),503,'FADADA_QUERY_BINDING','签署查询地址或身份未通过核验');
   const signed=buildFadadaRequest({config:this.nativeConfig,endpoint:'query_sign_result.api',timestamp:p.timestamp,businessParams:{contract_id:identity.contractId,customer_id:identity.customerId,transaction_id:identity.transactionId},explicitSortString:identity.contractId+identity.customerId+identity.transactionId});
   ensure(Object.keys(p).length===Object.keys(signed.params).length&&Object.entries(signed.params).every(([key,v])=>p[key]===v),503,'FADADA_QUERY_BINDING','签署查询摘要未通过核验');
   const response=await super.send(request);
   if(response.status===200&&response.parsedBody)recordFadadaQuery(response.parsedBody,identity);
   return response;
  }
  return super.send(request,file);
 }
}
export class NativeAwareFadadaClient extends FadadaApiClient {
 constructor(private readonly nativeConfig:FadadaConfig,http:FadadaHttpClient){super(nativeConfig,http);}
 override async createExternalSignUrl(input:Parameters<FadadaApiClient['createExternalSignUrl']>[0]){
  const native=isNativeSigning();
  if(native){ensure(this.nativeConfig.baseUrl===MINIAPP_PROVIDER_API,503,'MINIAPP_PROVIDER_API','小程序供应商接口地址未通过核验');ensure(input.signaturePositions?.length,409,'MINIAPP_SIGNING_COORDINATES','小程序手动签署须使用已审核签署坐标');ensure(input.returnUrl===MINIAPP_RETURN,503,'FADADA_CALLBACK_CONFIG','小程序签署返回地址不匹配');}
  // The original SDK validates transaction IDs and every coordinate before producing its local page URL.
  const result=await super.createExternalSignUrl(input);
  if(!native)return result;
  const original=new URL(result.signUrl),params=Object.fromEntries(original.searchParams);
  const request=buildFadadaRequest({config:this.nativeConfig,endpoint:'extsign.api',method:'GET',timestamp:params.timestamp,businessParams:{...business(params),open_environment:'4'},explicitMd5Seed:input.transactionId+params.timestamp,explicitSortString:input.customerId});
  const url=new URL(request.url);for(const [key,value]of Object.entries(request.params))url.searchParams.set(key,value);
  return{...result,signUrl:url.href};
 }
}
