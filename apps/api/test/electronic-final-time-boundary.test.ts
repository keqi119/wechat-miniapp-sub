import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ElectronicProvider} from '../src/electronic-documents/provider';

const config:any={enabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic-secret',apiVersion:'2.0',requestTimeoutMs:1000};
const signer='2@SyntheticCompany@913100000000000000@SyntheticCert';
const bytes=Buffer.from('%PDF-1.7\n'+('Synthetic signed document '.repeat(8))+'\n%%EOF');
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const party={role:'OWNER',providerSignedAt:new Date('2026-01-01T01:19:41.000Z'),providerSignedAtPrecisionMs:1000,attemptedAt:new Date('2026-01-01T01:18:47.228Z'),identitySnapshot:{certificate:{subjectHash:sha(signer),validFrom:'2025-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z'}}};
 const seal={integrityflag:true,signer,signedontime:'2026-01-01 09:19:40.00',timestampflag:true,timestamptime:'2026-01-01 09:19:40.00',timestampverifyflag:true};
 const task={providerContractId:'SyntheticContract123',sourceSha256:sha('Synthetic unsigned source'),title:'合成协议',positions:{},parties:[party]};
 const provider=new ElectronicProvider(config,async()=>({status:200,headers:{},bodyText:JSON.stringify({code:'1000',result:'success',data:[seal]})}));
 return {task,party,seal,provider};
}
const timeMismatch=(error:any)=>error?.getResponse?.().error?.code==='ELECTRONIC_FINAL_TIME_MISMATCH';

test('exact signed PDF can precede the original query endTime by one second without changing either fact',async()=>{
 const f=fixture();const proof=await f.provider.verifyFinalFile(f.task,bytes);
 assert.equal(proof.finalSha256,sha(bytes));assert.deepEqual(proof.subjects,[sha(signer)]);
 assert.equal(f.party.providerSignedAt.toISOString(),'2026-01-01T01:19:41.000Z');
 assert.equal(f.seal.signedontime,'2026-01-01 09:19:40.00');
});

test('PDF and TSA whole-second times padded with .00 include dispatch within that same second',async()=>{
 const f=fixture();f.party.attemptedAt=new Date('2026-01-01T01:19:40.057Z');
 const proof=await f.provider.verifyFinalFile(f.task,bytes);
 assert.equal(proof.finalSha256,sha(bytes));
 assert.equal(f.party.attemptedAt.toISOString(),'2026-01-01T01:19:40.057Z');
 assert.equal(f.seal.signedontime,'2026-01-01 09:19:40.00');
});

test('padded PDF seconds do not admit an earlier second or loosen nonzero fractions',async()=>{
 for(const [signed,attempted] of [['2026-01-01 09:19:40.00','2026-01-01T01:19:41.000Z'],['2026-01-01 09:19:40.05','2026-01-01T01:19:40.061Z'],['2026-01-01 09:19:40.000','2026-01-01T01:19:40.002Z']]){
  const f=fixture();f.seal.signedontime=signed;f.seal.timestamptime=signed;f.party.attemptedAt=new Date(attempted);
  await assert.rejects(f.provider.verifyFinalFile(f.task,bytes),timeMismatch);
 }
});

test('a valid signature outside the original request-to-result interval cannot be archived',async()=>{
 for(const signed of ['2026-01-01 09:18:47.21','2026-01-01 09:19:42.00']){
  const f=fixture();f.seal.signedontime=signed;f.seal.timestamptime=signed;
  await assert.rejects(f.provider.verifyFinalFile(f.task,bytes),timeMismatch);
 }
});

test('missing or invalid original request time and result precision cannot establish the signing interval',async()=>{
 for(const change of [(f:any)=>{f.party.attemptedAt=null;},(f:any)=>{f.party.attemptedAt=new Date('invalid');},(f:any)=>{f.party.attemptedAt=new Date('2026-01-01T01:19:42.000Z');},(f:any)=>{f.party.providerSignedAtPrecisionMs=undefined;},(f:any)=>{f.party.providerSignedAtPrecisionMs=60000;}]){
  const f=fixture();f.seal.signedontime='2026-01-01 09:19:41.00';f.seal.timestamptime=f.seal.signedontime;change(f);
  await assert.rejects(f.provider.verifyFinalFile(f.task,bytes),timeMismatch);
 }
});

test('signed PDF timestamp and certificate validity remain mandatory within the original transaction interval',async()=>{
 for(const change of [(f:any)=>{f.seal.timestamptime='2026-01-01 09:19:39.99';},(f:any)=>{f.seal.timestamptime='2026-01-01 09:19:41.00';},(f:any)=>{f.party.identitySnapshot.certificate.validFrom='2026-01-01T01:19:40.001Z';},(f:any)=>{f.party.identitySnapshot.certificate.validUntil='2026-01-01T01:19:40.000Z';}]){
  const f=fixture();change(f);await assert.rejects(f.provider.verifyFinalFile(f.task,bytes),timeMismatch);
 }
});
