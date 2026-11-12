import {createHash} from 'node:crypto';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import type {FadadaConfig} from '../esign/fadada/fadada.types';
import {FadadaHttpClient,type FadadaTransport} from '../esign/fadada/fadada-http-client';
import {NativeAwareFadadaClient,NativeAwareFadadaHttp} from '../esign/native-fadada-adapter';
import {buildFadadaRequest} from '../esign/fadada/fadada-request-builder';
import {assertSignerResult} from '../esign/fadada/fadada-safety';
import {providerInstant} from '../electronic-documents/provider-time';

const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** The provider generates this PDF. There is no locally manufactured unsigned original. */
export async function readSignedPlatformAuthorization(config:FadadaConfig,a:any,transport:FadadaTransport){
 const api=new NativeAwareFadadaClient(config,new NativeAwareFadadaHttp(config,transport)),expected={contractId:a.providerContractId,customerId:a.providerCustomerId,transactionId:a.providerTransactionId};
 const result=await api.querySignResult(expected);assertSignerResult(result,expected);
 ensure(result.status==='SIGNED',409,'PLATFORM_AUTH_SIGNATURE_PENDING','授权书尚未完成本人签署，请稍后刷新');
 const time=providerInstant((result.raw as any)?.data?.endTime,new Date(),a.createdAt),certificate=a.platformEvidence.identitySnapshot.certificate;
 const file=await api.downloadSignedContract({contractId:a.providerContractId}),bytes=file.buffer,sha256=digest(bytes);
 ensure(bytes.length>50&&bytes.length<=20*1024*1024&&bytes.subarray(0,5).toString()==='%PDF-',502,'PLATFORM_AUTH_FILE_INVALID','渠道尚未返回有效授权文件');
 const request=buildFadadaRequest({config,endpoint:'contract_verify.api',contentType:'multipart/form-data;charset=utf8',businessParams:{},explicitSortString:''});
 const response=await new FadadaHttpClient(config,transport).send(request,{buffer:bytes,contentType:'application/pdf',fieldName:'file',fileName:'authorization.pdf'}),raw=response.parsedBody as any;
 ensure(response.status===200&&String(raw?.code)==='1000'&&raw.result==='success'&&Array.isArray(raw.data)&&raw.data.length>0&&raw.data.length<=100,502,'PLATFORM_AUTH_VERIFY_REQUIRED','授权书签章核验尚未完成');
 for(const signature of raw.data){
  ensure(signature.integrityflag===true&&signature.timestampflag===true&&signature.timestampverifyflag===true&&typeof signature.signer==='string'&&digest(Buffer.from(signature.signer))===certificate.subjectHash,502,'PLATFORM_AUTH_SIGNER_MISMATCH','授权书签署主体或签章完整性不匹配');
  const signed=providerInstant(signature.signedontime,new Date()),timestamp=providerInstant(signature.timestamptime,new Date()),at=Date.parse(signed.at);
  ensure(at+signed.precisionMs>a.createdAt.getTime()&&at<Date.parse(time.at)+time.precisionMs&&at>=Date.parse(certificate.validFrom)&&at<Date.parse(certificate.validUntil)&&Date.parse(timestamp.at)+timestamp.precisionMs>at&&at+signed.precisionMs>Date.parse(timestamp.at),502,'PLATFORM_AUTH_SIGNING_TIME','授权书签署时间或证书有效期不匹配');
 }
 return{bytes,sha256,signedAt:new Date(time.at),evidence:{version:1,...expected,certificateSerialNo:a.certificateSerialNo,subjectHash:certificate.subjectHash,verified:true,finalSha256:sha256,queryHash:hash(result.raw),verificationHash:hash(raw),signedAt:time.at,signedAtRaw:time.raw,signedAtPrecisionMs:time.precisionMs,checkedAt:new Date().toISOString()}};
}
