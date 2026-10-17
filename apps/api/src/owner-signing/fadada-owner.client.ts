import {FadadaConfig,FadadaRequest} from '../esign/fadada/fadada.types';
import {FadadaHttpClient,FadadaTransport} from '../esign/fadada/fadada-http-client';
import {buildFadadaRequest} from '../esign/fadada/fadada-request-builder';
import {formatFadadaTimestamp} from '../esign/fadada/fadada-digest';
import {MINIAPP_PROVIDER_API,MINIAPP_RETURN} from '../esign/native-signing';
import {certificateCurrentlyValid} from '../esign/fadada/fadada-safety';
import {authorizationEvidence,checkEcho,enterpriseEvidence,providerId,record,requireEvidence,requiredText,scalar,sealEvidence} from './provider-evidence';

const IDENTITY_NOTIFY='https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-owner-identity';
const AUTH_NOTIFY='https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-owner-authorization';
const SIGN_NOTIFY='https://mini-api.subauto.keybox.cloud/api/callbacks/fadada-owner-sign';
export interface OwnerCompanyIdentity {customerId:string;name:string;creditCode:string;}
export interface OwnerGrantIdentity {customerId:string;contractId:string;transactionId:string;}

const ownerTransport:FadadaTransport=async request=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeoutMs);
  try{
    const response=await fetch(request.url,{method:request.method,body:request.body as never,headers:request.headers,signal:controller.signal,redirect:'error'});
    // Company responses can contain identity photos. Do not accept an unbounded response body.
    const reader=response.body?.getReader();let length=0;const chunks:Uint8Array[]=[];
    if(reader)try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;requireEvidence(length<=4_000_000,'OWNER_PROVIDER_RESPONSE_SIZE');chunks.push(part.value);}}finally{await reader.cancel();}
    return{status:response.status,headers:Object.fromEntries(response.headers),bodyText:Buffer.concat(chunks).toString('utf8')};
  }finally{clearTimeout(timer);}
};

/** API credentials remain Xiaolang's; every business request binds the actual owner identity. */
export class FadadaOwnerClient {
  private readonly http:FadadaHttpClient;
  constructor(private readonly config:FadadaConfig,http?:FadadaHttpClient){this.http=http||new FadadaHttpClient(config,ownerTransport);}
  private enabled(){requireEvidence(this.config.enabled&&this.config.baseUrl===MINIAPP_PROVIDER_API&&this.config.apiVersion==='2.0','OWNER_PROVIDER_DISABLED');}
  private async send(request:FadadaRequest){
    this.enabled();requireEvidence(request.url===MINIAPP_PROVIDER_API+request.endpoint&&(request.method==='POST'||request.endpoint==='query_cert.api'&&request.method==='GET'),'OWNER_PROVIDER_ENDPOINT');
    const response=await this.http.send(request);
    requireEvidence(response.status===200,'OWNER_PROVIDER_HTTP');const body=record(response.parsedBody);
    // These endpoints document code=1; error messages may contain identity data and are not surfaced.
    requireEvidence(scalar(body.code)==='1','OWNER_PROVIDER_REJECTED');return body;
  }
  async registerEnterprise(openId:string){
    this.enabled();providerId(openId);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'account_register.api',businessParams:{account_type:'2',open_id:openId}}));
    return{customerId:providerId(body.data),openId};
  }
  async createVerification(input:OwnerCompanyIdentity){
    this.enabled();providerId(input.customerId);const name=requiredText(input.name),creditCode=requiredText(input.creditCode,18);requireEvidence(/^[A-Z0-9]{18}$/.test(creditCode),'OWNER_COMPANY_CODE');
    const request=buildFadadaRequest({config:this.config,endpoint:'get_company_verify_url.api',businessParams:{customer_id:input.customerId,company_info:JSON.stringify({company_name:name,credit_no:creditCode}),organization_type:'0',page_modify:'2',cert_flag:'1',verified_way:'0',is_mini_program:'3',notify_url:IDENTITY_NOTIFY,return_url:MINIAPP_RETURN}});
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
    return{customerId,bound,serialNo:bound?serialNo:undefined};
  }
  async queryAuthorization(input:OwnerGrantIdentity){
    for(const value of Object.values(input))providerId(value);const body=await this.send(buildFadadaRequest({config:this.config,endpoint:'get_auth_status.api',businessParams:{customer_id:input.customerId},explicitSortString:input.customerId}));
    checkEcho(body,['customer_id','customerId'],input.customerId);return authorizationEvidence(body.data,input);
  }
  private page(endpoint:'before_authsign.api'|'extsign.api',input:OwnerGrantIdentity&{signatureId:string},extra:Record<string,string>){
    this.enabled();providerId(input.customerId);providerId(input.contractId);providerId(input.transactionId,32);providerId(input.signatureId);
    const timestamp=formatFadadaTimestamp(new Date()),request=buildFadadaRequest({config:this.config,endpoint,method:'GET',timestamp,explicitMd5Seed:input.transactionId+timestamp,explicitSortString:input.customerId,businessParams:{...extra,customer_id:input.customerId,signature_id:input.signatureId,contract_id:input.contractId,transaction_id:input.transactionId,return_url:MINIAPP_RETURN,open_environment:'4'}});
    const url=new URL(request.url);for(const [key,value]of Object.entries(request.params))url.searchParams.set(key,value);return{url:url.href};
  }
  createAuthorizationUrl(input:OwnerGrantIdentity&{signatureId:string}){return this.page('before_authsign.api',input,{auth_type:'1',notify_url:AUTH_NOTIFY});}
  createManualSignUrl(input:OwnerGrantIdentity&{signatureId:string;title:string;positions:Array<{pagenum:number;x:number;y:number}>}){
    requireEvidence(Array.isArray(input.positions)&&input.positions.length>0&&input.positions.length<=30,'OWNER_SIGN_COORDINATES');
    const positions=input.positions.map(p=>{requireEvidence(Number.isInteger(p.pagenum)&&p.pagenum>=0&&p.pagenum<=1000&&Number.isFinite(p.x)&&p.x>=0&&p.x<=800&&Number.isFinite(p.y)&&p.y>=0&&p.y<=1131,'OWNER_SIGN_COORDINATES');return{pagenum:p.pagenum,x:p.x,y:p.y};});
    return this.page('extsign.api',input,{doc_title:requiredText(input.title,100),notify_url:SIGN_NOTIFY,position_type:'1',signature_positions:JSON.stringify(positions)});
  }
}
