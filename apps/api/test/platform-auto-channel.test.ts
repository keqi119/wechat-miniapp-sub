import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readSignedPlatformAuthorization} from '../src/owner-signing/platform-authorization-channel';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const bytes=Buffer.from('%PDF-1.7\n'+('Synthetic provider authorization. '.repeat(10))+'\n%%EOF');
const config:any={enabled:true,signingEnabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic-only',apiVersion:'2.0',requestTimeoutMs:1000,signUrlValidityMinutes:15};
function fixture(){
 const signer='CN=Synthetic company, O=Synthetic authority',time='2026-01-01 09:00:00';
 const authority:any={createdAt:new Date('2026-01-01T00:59:50Z'),providerContractId:'syntheticGrant',providerCustomerId:'syntheticEnterprise',providerTransactionId:'syntheticTransaction',certificateSerialNo:'synthetic-cert',platformEvidence:{identitySnapshot:{certificate:{subjectHash:hash(signer),validFrom:'2025-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'}}}};
 let result:any={code:'1',data:{result:'3000',endTime:time}},verification:any={code:'1000',result:'success',data:[{signer,integrityflag:true,timestampflag:true,timestampverifyflag:true,signedontime:time,timestamptime:time}]},pdf=bytes;const requests:any[]=[];
 const transport:any=async(req:any)=>{requests.push(req);return{status:200,headers:{},...(req.responseType==='arraybuffer'?{bodyBuffer:pdf}:{bodyText:JSON.stringify(req.url.endsWith('query_sign_result.api')?result:verification)})};};
 return{authority,transport,requests,setResult:(v:any)=>result=v,setVerification:(v:any)=>verification=v,setPdf:(v:Buffer)=>pdf=v,verification};
}
test('provider-generated authorization archives exact signed PDF only after bound original query and PDF signature verification',async()=>{
 const f=fixture(),proof=await readSignedPlatformAuthorization(config,f.authority,f.transport);
 assert.equal(proof.sha256,hash(bytes));assert.equal(proof.evidence.subjectHash,f.authority.platformEvidence.identitySnapshot.certificate.subjectHash);assert.equal(proof.signedAt.toISOString(),'2026-01-01T01:00:00.000Z');
 assert.deepEqual(f.requests.map(r=>new URL(r.url).pathname.split('/').pop()),['query_sign_result.api','downLoadContract.api','contract_verify.api']);
});
test('pending, mismatched provider account, invalid PDF and different signing subject do not create authorization proof',async()=>{
 const f=fixture();f.setResult({code:'1',data:{result:'0'}});await assert.rejects(readSignedPlatformAuthorization(config,f.authority,f.transport));
 f.setResult({code:'1',data:{result:'3000',endTime:'2026-01-01 09:00:00',customer_id:'other'}});await assert.rejects(readSignedPlatformAuthorization(config,f.authority,f.transport));
 f.setResult({code:'1',data:{result:'3000',endTime:'2026-01-01 09:00:00'}});f.setPdf(Buffer.from('<html>error</html>'));await assert.rejects(readSignedPlatformAuthorization(config,f.authority,f.transport));f.setPdf(bytes);
 f.setVerification({...f.verification,data:[{...f.verification.data[0],signer:'CN=Another company'}]});await assert.rejects(readSignedPlatformAuthorization(config,f.authority,f.transport));
});
test('second-precision provider time is accepted only within the same original request interval and valid certificate period',async()=>{
 const f=fixture();f.authority.createdAt=new Date('2026-01-01T01:00:00.950Z');await readSignedPlatformAuthorization(config,f.authority,f.transport);
 f.authority.createdAt=new Date('2026-01-01T01:00:01.000Z');await assert.rejects(readSignedPlatformAuthorization(config,f.authority,f.transport));
});
