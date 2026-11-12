import {FadadaHttpClient} from '../esign/fadada/fadada-http-client';
import {providerInstant,providerPdfInstant} from './provider-time';
import {createHash} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {ensure} from '../common/errors';
import {canonicalHash} from '../customers/types';
import {miniappReturnUrl,ownerH5ReturnUrl,platformOrigins} from '../common/platform-origins';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../esign/native-fadada-adapter';
import type {FadadaSettings} from '../esign/esign.settings';
import type {FadadaTransport} from '../esign/fadada/fadada-http-client';
import {buildFadadaRequest,buildContractFilingRequest} from '../esign/fadada/fadada-request-builder';
import {formatFadadaTimestamp} from '../esign/fadada/fadada-digest';
import {isFadadaQueryAbsent,matchesFadadaQuery} from '../esign/fadada-query-binding';
import {assertNewProviderOperation} from '../offline-documents/mode';
import type {SignerRole} from './types';

const base='https://textapi17.fadada.com/api2/';
const allowed=new Set(['uploaddocs.api','extsign_auto.api','query_sign_result.api','contract_status.api','contractFiling.api','downLoadContract.api','contract_verify.api']);
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export interface ElectronicPosition{pagenum:number;x:number;y:number;}
export interface ElectronicProviderDocument{providerContractId:string;sourceSha256:string;title:string;positions:Partial<Record<SignerRole,ElectronicPosition[]>>;}
export interface ElectronicProviderParty{role:SignerRole;subjectType:'INDIVIDUAL'|'ENTERPRISE';providerCustomerId:string;signatureId?:string|null;transactionId:string;attemptedAt?:Date|null;}
/** Never forward signed credentials through a redirect or to a supplied download URL. */
export const electronicTransport:FadadaTransport=async request=>{
 ensure(request.url.startsWith(base)&&allowed.has(request.url.slice(base.length)),503,'ELECTRONIC_PROVIDER_CHANNEL','电子签接口来源未通过核验');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),request.timeoutMs);
 try{
  const response=await fetch(request.url,{method:request.method,body:request.body as never,headers:request.headers,signal:controller.signal,redirect:'error'});
  ensure(response.status===200,502,'ELECTRONIC_PROVIDER_RESPONSE','电子签服务暂未确认请求');
  const limit=request.responseType==='arraybuffer'?20*1024*1024:2*1024*1024;
  ensure(Number(response.headers.get('content-length')||0)<=limit,502,'ELECTRONIC_PROVIDER_SIZE','电子签响应超出允许大小');
  const chunks:Uint8Array[]=[],reader=response.body?.getReader();let size=0;
  if(reader)for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>limit){await reader.cancel();ensure(false,502,'ELECTRONIC_PROVIDER_SIZE','电子签响应超出允许大小');}chunks.push(item.value);}
  const bytes=Buffer.concat(chunks),headers=Object.fromEntries(response.headers);
  return{status:response.status,headers,...(request.responseType==='arraybuffer'?{bodyBuffer:bytes}:{bodyText:bytes.toString('utf8')})};
 }finally{clearTimeout(timer);}
};
function id(value:unknown){ensure(typeof value==='string'&&/^[A-Za-z0-9]{1,32}$/.test(value),409,'ELECTRONIC_PROVIDER_BINDING','签署渠道编号不完整');return value;}
function echoes(raw:any,expected:Record<string,string>,depth=0):boolean{
 if(!raw||typeof raw!=='object')return true;if(depth>5||Array.isArray(raw))return false;
 const aliases:Record<string,string>={contract_id:'contractId',contractId:'contractId',customer_id:'customerId',customerId:'customerId',transaction_id:'transactionId',transactionId:'transactionId',transactionNo:'transactionId'};
 return Object.entries(raw).every(([key,value])=>aliases[key]&&expected[aliases[key]]!==undefined?String(value)===expected[aliases[key]]:echoes(value,expected,depth+1));
}
function success(raw:any,contractId:string){
 if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&raw.result==='error'&&['2001','2002','2003'].includes(String(raw.code))&&echoes(raw,{contractId}))throw Object.assign(new HttpException({error:{code:'ELECTRONIC_PROVIDER_REJECTED',message:'法大大明确拒绝了本次操作，请核对后恢复原任务'}},502),{providerEvidenceHash:canonicalHash(raw)});
 ensure(raw&&typeof raw==='object'&&!Array.isArray(raw)&&String(raw.code)==='1000'&&raw.result==='success'&&echoes(raw,{contractId}),502,'ELECTRONIC_PROVIDER_UNCONFIRMED','法大大尚未明确确认本次操作');return canonicalHash(raw);
}
export class ElectronicProvider{
 private api:NativeAwareFadadaClient;
 private verificationHttp:FadadaHttpClient;
 constructor(private config:FadadaSettings,transport:FadadaTransport=electronicTransport){this.api=new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config,transport));this.verificationHttp=new FadadaHttpClient(config,transport);}
 capability(){return{configured:this.config.enabled&&this.config.baseUrl===base,signingEnabled:this.config.signingEnabled&&process.env.ELECTRONIC_SIGNING_ENABLED==='true'&&process.env.ESIGN_NEW_REQUESTS_ENABLED==='true'};}
 private ready(){ensure(this.config.enabled&&this.config.baseUrl===base,503,'ELECTRONIC_PROVIDER_CHANNEL','电子签渠道未配置或来源未核验');}
 private async mutationReady(){this.ready();await assertNewProviderOperation();ensure(this.config.signingEnabled&&process.env.ELECTRONIC_SIGNING_ENABLED==='true',503,'ELECTRONIC_SIGNING_DISABLED','电子签办理尚未开放');}
 private document(doc:ElectronicProviderDocument){id(doc.providerContractId);ensure(/^[a-f0-9]{64}$/.test(doc.sourceSha256)&&typeof doc.title==='string'&&doc.title.trim()&&doc.title.length<=100,409,'ELECTRONIC_PROVIDER_BINDING','冻结文件信息不完整');}
 private party(doc:ElectronicProviderDocument,party:ElectronicProviderParty){
  this.document(doc);id(party.providerCustomerId);id(party.transactionId);ensure(['CUSTOMER','OWNER','PLATFORM'].includes(party.role),409,'ELECTRONIC_PARTIES_MISMATCH','签署角色不正确');
  if(party.subjectType==='ENTERPRISE')id(party.signatureId);
  const positions=doc.positions[party.role];ensure(positions?.length&&positions.length<=30&&positions.every(p=>Number.isInteger(p.pagenum)&&p.pagenum>=0&&p.pagenum<=1000&&Number.isFinite(p.x)&&p.x>=0&&p.x<=800&&Number.isFinite(p.y)&&p.y>=0&&p.y<=1131),409,'ELECTRONIC_SIGNATURE_POSITIONS','缺少本方已冻结签章位置');return positions;
 }
 async upload(doc:ElectronicProviderDocument,bytes:Buffer){
  await this.mutationReady();this.document(doc);ensure(digest(bytes)===doc.sourceSha256,409,'ELECTRONIC_SOURCE_CHANGED','源文件校验失败');const response=await this.api.uploadDocs({contractId:doc.providerContractId,docTitle:doc.title,pdf:bytes,fileName:doc.title+'.pdf'});
  return{evidenceHash:success(response.raw,doc.providerContractId)};
 }
 async querySigner(doc:ElectronicProviderDocument,party:ElectronicProviderParty){
  this.ready();this.party(doc,party);const expected={contractId:doc.providerContractId,customerId:party.providerCustomerId,transactionId:party.transactionId},response=await this.api.querySignResult(expected);
  if(isFadadaQueryAbsent(response,expected))return{status:'ABSENT' as const,evidenceHash:canonicalHash(response.raw)};
  ensure(matchesFadadaQuery(response,expected),502,'ELECTRONIC_SIGNER_UNCONFIRMED','签署结果未通过原交易核验');
  const time=response.status==='SIGNED'?providerInstant((response.raw as any)?.data?.endTime,new Date(),party.attemptedAt??undefined):null;
  return{status:response.status,evidenceHash:canonicalHash({expected,response:response.raw}),...(time?{providerSignedAt:time.at,providerSignedAtRaw:time.raw,providerSignedAtPrecisionMs:time.precisionMs}:{})};
 }
 private async contractState(doc:ElectronicProviderDocument,allowMissingSigningRecord=false){
  this.ready();this.document(doc);const response=await this.api.queryContractStatus({contractId:doc.providerContractId}),raw=response.raw as any;
  // API2 can store an uploaded PDF before creating its signing-state record.
  // This response alone never proves upload: queryUpload still downloads and
  // checks every original byte. Filing callers do not accept this branch.
  if(allowMissingSigningRecord&&raw?.result==='error'&&String(raw.code)==='2002'&&raw.msg==='未检索到该合同号的记录'&&raw.contract_status===null&&raw.contractStatus===undefined&&echoes(raw,{contractId:doc.providerContractId}))return{status:'NO_SIGNING_RECORD',evidenceHash:canonicalHash(raw)};
  const evidenceHash=success(raw,doc.providerContractId),values=[raw.contract_status,raw.contractStatus].filter(v=>v!==undefined).map(String);
  ensure(values.length>0&&new Set(values).size===1&&['0','2','5'].includes(values[0]),502,'ELECTRONIC_PROVIDER_UNCONFIRMED','合同渠道状态未知');return{status:values[0],evidenceHash};
 }
 async queryUpload(doc:ElectronicProviderDocument){
  const state=await this.contractState(doc,true);ensure(['0','NO_SIGNING_RECORD'].includes(state.status),409,'ELECTRONIC_UPLOAD_UNCONFIRMED','上传结果不符合原文件待签状态');
  const file=await this.api.downloadSignedContract({contractId:doc.providerContractId});ensure(digest(file.buffer)===doc.sourceSha256,409,'ELECTRONIC_SOURCE_CHANGED','渠道文件与冻结原文不一致');
  return{uploaded:true,evidenceHash:canonicalHash({state,sourceSha256:doc.sourceSha256})};
 }
 async manualUrl(doc:ElectronicProviderDocument,party:ElectronicProviderParty,surface:'MINIAPP'|'OWNER_H5'){
  await this.mutationReady();const positions=this.party(doc,party);ensure(surface==='MINIAPP'?party.role==='CUSTOMER':surface==='OWNER_H5'&&party.role!=='CUSTOMER',403,'ELECTRONIC_SIGNER_SURFACE','请从本人对应签署入口办理');
  const timestamp=formatFadadaTimestamp(new Date()),request=buildFadadaRequest({config:this.config,endpoint:'extsign.api',method:'GET',timestamp,explicitMd5Seed:party.transactionId+timestamp,explicitSortString:party.providerCustomerId,businessParams:{contract_id:doc.providerContractId,customer_id:party.providerCustomerId,transaction_id:party.transactionId,doc_title:doc.title,notify_url:platformOrigins().api+'/api/callbacks/fadada-electronic-sign',return_url:surface==='MINIAPP'?miniappReturnUrl():ownerH5ReturnUrl(),open_environment:surface==='MINIAPP'?'4':'0',position_type:'1',signature_positions:JSON.stringify(positions),...(party.subjectType==='ENTERPRISE'?{signature_id:party.signatureId!}:{})}});
  const url=new URL(request.url);for(const[k,v]of Object.entries(request.params))url.searchParams.set(k,v);return{url:url.href,expiresAt:new Date(Date.now()+15*60000).toISOString()};
 }
 async autoSign(doc:ElectronicProviderDocument,party:ElectronicProviderParty){
  ensure(process.env.OWNER_AUTO_SIGNING_ENABLED==='true',503,'OWNER_AUTO_DISABLED','企业自动签署尚未启用');
  await this.mutationReady();const positions=this.party(doc,party);ensure(party.subjectType==='ENTERPRISE'&&party.role!=='CUSTOMER',403,'ELECTRONIC_PERSONAL_MANUAL_REQUIRED','自然人须本人逐份签署');
  const response=await this.api.autoSealContract({contractId:doc.providerContractId,customerId:party.providerCustomerId,signatureId:party.signatureId!,transactionId:party.transactionId,docTitle:doc.title,notifyUrl:platformOrigins().api+'/api/callbacks/fadada-electronic-sign',signaturePositions:positions});
  ensure(echoes(response.raw,{contractId:doc.providerContractId,customerId:party.providerCustomerId,transactionId:party.transactionId}),502,'ELECTRONIC_PROVIDER_BINDING','自动签响应绑定不匹配');return{evidenceHash:success(response.raw,doc.providerContractId)};
 }
 async verifyFinalFile(task:ElectronicProviderDocument&{parties:any[]},bytes:Buffer){
  this.ready();this.document(task);
  const finalSha256=digest(bytes);ensure(bytes.length>50&&bytes.length<=20*1024*1024&&bytes.subarray(0,5).toString()==='%PDF-'&&finalSha256!==task.sourceSha256,502,'ELECTRONIC_FINAL_PDF_REQUIRED','签后文件不符合核验要求');
  const expected=task.parties.map(p=>{const c=p.identitySnapshot?.certificate;ensure(c&&/^[a-f0-9]{64}$/.test(c.subjectHash),409,'ELECTRONIC_CERTIFICATE_SUBJECT_REQUIRED','请刷新证书主体证据');return{role:p.role,subjectHash:c.subjectHash,certificate:c,signedAt:new Date(p.providerSignedAt).getTime(),signedAtPrecisionMs:p.providerSignedAtPrecisionMs,attemptedAt:p.attemptedAt?new Date(p.attemptedAt).getTime():NaN};});
  ensure(expected.length>0&&new Set(expected.map(p=>p.subjectHash)).size===expected.length,409,'ELECTRONIC_CERTIFICATE_SUBJECT_REQUIRED','证书主体绑定不明确');
  const request=buildFadadaRequest({config:this.config,endpoint:'contract_verify.api',contentType:'multipart/form-data;charset=utf8',businessParams:{},explicitSortString:''});
  // Binary upload binds the response to these exact bytes; no external JSON or doc_url is accepted.
  const response=await this.verificationHttp.send(request,{buffer:Buffer.from(bytes),contentType:'application/pdf',fieldName:'file',fileName:'signed.pdf'}),raw=response.parsedBody as any;
  const checkedAt=new Date().toISOString(),verificationReceiptHash=canonicalHash({providerContractId:task.providerContractId,sourceSha256:task.sourceSha256,finalSha256,status:response.status,raw:raw??null});
  try{
  ensure(response.status===200&&raw?.code==='1000'&&raw.result==='success'&&Array.isArray(raw.data)&&raw.data.length>0&&raw.data.length<=300,502,'ELECTRONIC_FINAL_VERIFICATION_REQUIRED','渠道未确认最终文件验签');
  const subjects=new Set<string>(),now=new Date();
  for(const seal of raw.data){
   ensure(seal?.integrityflag===true&&seal.timestampflag===true&&seal.timestampverifyflag===true&&typeof seal.signer==='string',502,'ELECTRONIC_FINAL_INTEGRITY_INVALID','最终文件签名或时间戳无效');
   const subjectHash=digest(Buffer.from(seal.signer)),party=expected.find(p=>p.subjectHash===subjectHash);
   ensure(party,502,'ELECTRONIC_FINAL_SUBJECT_MISMATCH','最终文件签署主体不匹配');
   const signed=providerPdfInstant(seal.signedontime,now),timestamp=providerPdfInstant(seal.timestamptime,now),ms=Date.parse(signed.at);
   // query_sign_result.endTime may follow the PDF signing time. Bind both to
   // the original request interval instead of requiring the same clock second.
   const resultEnd=party.signedAt+party.signedAtPrecisionMs;
   ensure(Number.isFinite(party.signedAt)&&Number.isFinite(party.attemptedAt)&&[1,10,100,1000].includes(party.signedAtPrecisionMs)&&party.attemptedAt<resultEnd&&ms+signed.precisionMs>party.attemptedAt&&ms<resultEnd&&ms>=Date.parse(party.certificate.validFrom)&&ms<Date.parse(party.certificate.validUntil)&&Date.parse(timestamp.at)+timestamp.precisionMs>ms&&ms+signed.precisionMs>Date.parse(timestamp.at),502,'ELECTRONIC_FINAL_TIME_MISMATCH','最终文件签署时间或证书有效期不匹配');subjects.add(subjectHash);
  }
  ensure(expected.every(p=>subjects.has(p.subjectHash)),502,'ELECTRONIC_FINAL_SUBJECT_MISMATCH','最终文件缺少必需签署方');
  return{providerContractId:task.providerContractId,sourceSha256:task.sourceSha256,finalSha256,subjects:[...subjects].sort(),integrity:true as const,timestamps:true as const,evidenceHash:canonicalHash({providerContractId:task.providerContractId,finalSha256,raw}),verifiedAt:now.toISOString()};
  }catch(error){throw Object.assign(error as object,{verificationReceiptHash,verificationCheckedAt:checkedAt});}
 }
 async fileContract(doc:ElectronicProviderDocument){this.ready();this.document(doc);const response=await this.verificationHttp.send(buildContractFilingRequest({config:this.config,businessParams:{contract_id:doc.providerContractId}}));ensure(response.status===200,502,'ELECTRONIC_PROVIDER_UNCONFIRMED','归档尚未确认');return{evidenceHash:success(response.parsedBody,doc.providerContractId)};}
 async queryFiling(doc:ElectronicProviderDocument){const state=await this.contractState(doc);return{filed:state.status==='2',evidenceHash:state.evidenceHash};}
 async downloadFinal(doc:ElectronicProviderDocument){
  this.ready();this.document(doc);const response=await this.api.downloadSignedContract({contractId:doc.providerContractId}),sha256=digest(response.buffer);
  ensure(response.buffer.length>50&&response.buffer.length<=20*1024*1024&&response.buffer.subarray(0,5).toString()==='%PDF-'&&sha256!==doc.sourceSha256,502,'ELECTRONIC_FINAL_PDF_REQUIRED','签后PDF缺失或仍为待签原件');return{bytes:response.buffer,sha256};
 }
}
