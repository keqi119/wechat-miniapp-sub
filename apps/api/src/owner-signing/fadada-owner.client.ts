import {FadadaConfig,FadadaRequest} from '../esign/fadada/fadada.types';
import {AsyncLocalStorage} from 'node:async_hooks';
import {FadadaHttpClient,FadadaTransport} from '../esign/fadada/fadada-http-client';
import {buildFadadaRequest} from '../esign/fadada/fadada-request-builder';
import {formatFadadaTimestamp} from '../esign/fadada/fadada-digest';
import {MINIAPP_PROVIDER_API,miniappReturnUrl} from '../esign/native-signing';
import {platformCallback,ownerH5ReturnUrl} from '../common/platform-origins';
import {certificateCurrentlyValid,verifiedCallback} from '../esign/fadada/fadada-safety';
import {certificateEvidence,certificateSubjectEvidence} from '../esign/fadada/certificate-evidence';
import {authorizationEvidence,checkEcho,enterpriseEvidence,providerId,record,requireEvidence,requiredText,scalar,sealEvidence} from './provider-evidence';
import {assertNewProviderOperation,assertNewEsignAllowed} from '../offline-documents/mode';
import {ensure} from '../common/errors';
import {readSignedPlatformAuthorization} from './platform-authorization-channel';

export interface OwnerCompanyIdentity {customerId:string;name:string;creditCode:string;}
export interface OwnerGrantIdentity {customerId:string;contractId:string;transactionId:string;}
const ownerChannel=new AsyncLocalStorage<'owner-h5'>();
export function runOwnerH5<T>(operation:()=>T):T{return ownerChannel.run('owner-h5',operation);}
export function isOwnerH5Request(){return ownerChannel.getStore()==='owner-h5';}
export function ownerLegalPolicy(){return process.env.OWNER_LEGAL_H5_ONLY==='true'||ownerChannel.getStore()==='owner-h5';}

export const ownerTransport:FadadaTransport=async request=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeoutMs);
  try{
    const response=await fetch(request.url,{method:request.method,body:request.body as never,headers:request.headers,signal:controller.signal,redirect:'error'});
    // Company responses can contain identity photos. Do not accept an unbounded response body.
    const reader=response.body?.getReader();let length=0;const chunks:Uint8Array[]=[];
    if(reader)try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;requireEvidence(length<=(request.responseType==='arraybuffer'?20*1024*1024:4_000_000),'OWNER_PROVIDER_RESPONSE_SIZE');chunks.push(part.value);}}finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);return{status:response.status,headers:Object.fromEntries(response.headers),...(request.responseType==='arraybuffer'?{bodyBuffer:bytes}:{bodyText:bytes.toString('utf8')})};
  }finally{clearTimeout(timer);}
};

/** API credentials remain Xiaolang's; every business request binds the actual owner identity. */
export class FadadaOwnerClient {
  private readonly http:FadadaHttpClient;
  constructor(private readonly config:FadadaConfig,http?:FadadaHttpClient){this.http=http||new FadadaHttpClient(config,ownerTransport);}
  assertAvailable(){ensure(this.config.enabled&&this.config.appId?.trim()&&this.config.appSecret?.trim()&&this.config.baseUrl===MINIAPP_PROVIDER_API&&this.config.apiVersion==='2.0',503,'FADADA_DISABLED','历史企业电子签渠道未配置，无法核验原交易');}
  private enabled(){requireEvidence(this.config.enabled&&this.config.baseUrl===MINIAPP_PROVIDER_API&&this.config.apiVersion==='2.0','OWNER_PROVIDER_DISABLED');}
  private async send(request:FadadaRequest){
    if(!['find_companyCertInfo.api','query_signature.api','query_cert.api','get_auth_status.api'].includes(request.endpoint))await assertNewProviderOperation();
    this.enabled();requireEvidence(request.url===MINIAPP_PROVIDER_API+request.endpoint&&(request.method==='POST'||request.endpoint==='query_cert.api'&&request.method==='GET'),'OWNER_PROVIDER_ENDPOINT');
    const response=await this.http.send(request);
    requireEvidence(response.status===200,'OWNER_PROVIDER_HTTP');const body=record(response.parsedBody);
    // These endpoints document code=1; error messages may contain identity data and are not surfaced.
    requireEvidence(scalar(body.code)==='1','OWNER_PROVIDER_REJECTED');return body;
  }
  async registerEnterprise(openId:string){
    await assertNewProviderOperation();
    this.enabled();providerId(openId);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'account_register.api',businessParams:{account_type:'2',open_id:openId}}));
    return{customerId:providerId(body.data),openId};
  }
  async createVerification(input:OwnerCompanyIdentity&{channel?:'miniapp'|'owner-h5';legalRepresentative?:{name:string;mobile:string}}){
    await assertNewProviderOperation();
    this.enabled();providerId(input.customerId);const name=requiredText(input.name),creditCode=requiredText(input.creditCode,18);requireEvidence(/^[A-Z0-9]{18}$/.test(creditCode),'OWNER_COMPANY_CODE');
    const h5=input.channel==='owner-h5';let channelParams:Record<string,string>={verified_way:'0',is_mini_program:'3',return_url:miniappReturnUrl()};
    if(h5){requireEvidence(input.legalRepresentative&&/^1\d{10}$/.test(input.legalRepresentative.mobile),'OWNER_LEGAL_INPUT');channelParams={verified_way:'3',company_principal_type:'1',legal_info:JSON.stringify({legal_name:requiredText(input.legalRepresentative.name),legal_mobile:input.legalRepresentative.mobile}),return_url:ownerH5ReturnUrl()};}
    const request=buildFadadaRequest({config:this.config,endpoint:'get_company_verify_url.api',businessParams:{customer_id:input.customerId,company_info:JSON.stringify({company_name:name,credit_no:creditCode}),organization_type:'0',page_modify:'2',cert_flag:'1',...channelParams,notify_url:platformCallback('fadada-owner-identity')}});
    // Official 3.3.2 and legacy SDK exclude this field from the digest.
    request.params.m_verified_way='0';const body=await this.send(request),data=record(body.data);
    checkEcho(data,['customer_id','customerId'],input.customerId);const serialNo=providerId(data.transactionNo);
    const encoded=requiredText(data.url,22000);requireEvidence(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),'OWNER_VERIFY_URL');
    let url=Buffer.from(encoded,'base64').toString('utf8');if(url.startsWith('https://realnameverify.fadada.com/'))url='https://realnameverify16.fadada.com/'+url.slice('https://realnameverify.fadada.com/'.length);
    requireEvidence(url.length<=16384&&/^https:\/\/realnameverify16\.fadada\.com\/[^\s\\#]*$/.test(url),'OWNER_VERIFY_URL');return{customerId:input.customerId,serialNo,url};
  }
  async queryEnterprise(input:OwnerCompanyIdentity&{serialNo:string}){
    providerId(input.customerId);providerId(input.serialNo);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'find_companyCertInfo.api',businessParams:{verified_serialno:input.serialNo}}));
    checkEcho(body,['customer_id','customerId'],input.customerId);return enterpriseEvidence(body.data,input);
  }
  async querySeals(customerId:string){
    providerId(customerId);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'query_signature.api',businessParams:{customer_id:customerId},explicitSortString:customerId}));
    checkEcho(body,['customer_id','customerId'],customerId);return sealEvidence(body.data,customerId);
  }
  async queryCertificate(customerId:string){
    providerId(customerId);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'query_cert.api',method:'GET',businessParams:{customerId}}));
    checkEcho(body,['customerId','customer_id'],customerId);const data=record(body.data||{});checkEcho(data,['customerId','customer_id'],customerId);
    const serialNo=scalar(data.sequenceNo);const bound=!!(serialNo&&scalar(data.dn)&&scalar(data.certType)==='0'&&certificateCurrentlyValid(data));
    return{customerId,bound,subjectHash:bound?certificateSubjectEvidence(body,customerId,serialNo!):null,serialNo:bound?serialNo:undefined,...(bound?certificateEvidence(data):null)};
  }
  async queryAuthorization(input:OwnerGrantIdentity){
    for(const value of Object.values(input))providerId(value);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'get_auth_status.api',businessParams:{customer_id:input.customerId},explicitSortString:input.customerId}));
    checkEcho(body,['customer_id','customerId'],input.customerId);return authorizationEvidence(body.data,input);
  }
  async signedEvidence(authority:any){return readSignedPlatformAuthorization(this.config,authority,ownerTransport);}
  private page(endpoint:'before_authsign.api'|'extsign.api',input:OwnerGrantIdentity&{signatureId:string},extra:Record<string,string>){
    assertNewEsignAllowed();
    this.enabled();providerId(input.customerId);providerId(input.contractId);providerId(input.transactionId,32);providerId(input.signatureId);
    const h5=ownerChannel.getStore()==='owner-h5',timestamp=formatFadadaTimestamp(new Date()),request=buildFadadaRequest({config:this.config,endpoint,method:'GET',timestamp,explicitMd5Seed:input.transactionId+timestamp,explicitSortString:input.customerId,businessParams:{...extra,customer_id:input.customerId,signature_id:input.signatureId,contract_id:input.contractId,transaction_id:input.transactionId,return_url:h5?ownerH5ReturnUrl():miniappReturnUrl(),open_environment:h5?'0':'4'}});
    const url=new URL(request.url);for(const [key,value]of Object.entries(request.params))url.searchParams.set(key,value);return{url:url.href};
  }
  verifyCallback(payload:unknown){return verifiedCallback(payload,this.config);}
  createAuthorizationUrl(input:OwnerGrantIdentity&{signatureId:string}){assertNewEsignAllowed();return this.page('before_authsign.api',input,{auth_type:'1',notify_url:platformCallback('fadada-owner-authorization')});}
  createRevocationUrl(customerId:string){
    this.enabled();providerId(customerId);const h5=ownerChannel.getStore()==='owner-h5',request=buildFadadaRequest({config:this.config,endpoint:'cancel_extsign_auto_page.api',method:'GET',businessParams:{customer_id:customerId,notify_url:platformCallback('fadada-owner-authorization'),return_url:h5?ownerH5ReturnUrl():miniappReturnUrl(),...(h5?{open_environment:'0'}:{})}});
    const url=new URL(request.url);for(const [key,value]of Object.entries(request.params))url.searchParams.set(key,value);return{url:url.href};
  }
  createManualSignUrl(input:OwnerGrantIdentity&{signatureId:string;title:string;positions:Array<{pagenum:number;x:number;y:number}>}){
    assertNewEsignAllowed();
    return this.manualSignPage(input,'fadada-owner-sign');
  }
  createPlatformHandoverSignUrl(input:OwnerGrantIdentity&{signatureId:string;title:string;positions:Array<{pagenum:number;x:number;y:number}>}){
    assertNewEsignAllowed();
    requireEvidence(ownerChannel.getStore()==='owner-h5','OWNER_LEGAL_H5_REQUIRED');
    return this.manualSignPage(input,'fadada-sign');
  }
  createAuthorityDocumentSignUrl(input:OwnerGrantIdentity&{signatureId:string;title:string;positions:Array<{pagenum:number;x:number;y:number}>}){
    assertNewEsignAllowed();
    requireEvidence(ownerChannel.getStore()==='owner-h5','OWNER_LEGAL_H5_REQUIRED');
    return this.manualSignPage(input,'fadada-owner-authorization');
  }
  private manualSignPage(input:OwnerGrantIdentity&{signatureId:string;title:string;positions:Array<{pagenum:number;x:number;y:number}>},callback:'fadada-owner-sign'|'fadada-owner-authorization'|'fadada-sign'){
    requireEvidence(Array.isArray(input.positions)&&input.positions.length>0&&input.positions.length<=30,'OWNER_SIGN_COORDINATES');
    const positions=input.positions.map(p=>{requireEvidence(Number.isInteger(p.pagenum)&&p.pagenum>=0&&p.pagenum<=1000&&Number.isFinite(p.x)&&p.x>=0&&p.x<=800&&Number.isFinite(p.y)&&p.y>=0&&p.y<=1131,'OWNER_SIGN_COORDINATES');return{pagenum:p.pagenum,x:p.x,y:p.y};});
    return this.page('extsign.api',input,{doc_title:requiredText(input.title,100),notify_url:platformCallback(callback),position_type:'1',signature_positions:JSON.stringify(positions)});
  }
}
