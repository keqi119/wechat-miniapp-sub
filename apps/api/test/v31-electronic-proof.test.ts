import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ElectronicProvider} from '../src/electronic-documents/provider';
const config:any={enabled:true,signingEnabled:true,baseUrl:'https://textapi17.fadada.com/api2/',appId:'synthetic',appSecret:'synthetic-secret',apiVersion:'2.0',requestTimeoutMs:1000};
const doc:any={providerContractId:'Contract123',sourceSha256:'a'.repeat(64),title:'Synthetic',positions:{CUSTOMER:[{pagenum:0,x:1,y:1}]}};
const party:any={role:'CUSTOMER',subjectType:'INDIVIDUAL',providerCustomerId:'Customer123',transactionId:'Transaction123',attemptedAt:new Date('2026-01-01T01:00:00.500Z')};
function provider(endTime?:string,extra={}){return new ElectronicProvider(config,async()=>({status:200,headers:{},bodyText:JSON.stringify({code:'1',data:{result:'3000',...(endTime?{endTime}:{}),...extra}})}));}
test('3000 without actual endTime cannot prove signing',async()=>{await assert.rejects(provider().querySigner(doc,party));});
test('provider second precision is preserved despite fractional dispatch and later verification',async()=>{const result:any=await provider('2026-01-01 09:00:00').querySigner(doc,party);assert.equal(result.providerSignedAt,'2026-01-01T01:00:00.000Z');assert.equal(result.providerSignedAtRaw,'2026-01-01 09:00:00');});
test('future, impossible, premature and wrong-bound provider facts reject',async()=>{for(const time of ['2099-01-01 09:00:00','2026-02-30 09:00:00','2025-12-31 09:00:00'])await assert.rejects(provider(time).querySigner(doc,party));await assert.rejects(provider('2026-01-01 09:00:00',{customer_id:'wrong'}).querySigner(doc,party));});
import {createHash} from 'node:crypto';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
test('exact PDF verification accepts repeated seals per frozen certificate subject and rejects extra subjects or tampering',async()=>{
 const bytes=Buffer.from('%PDF-1.7\n'+('signed '.repeat(30))),cn='1@Synthetic@123456789012345678@123456';
 const task:any={...doc,parties:[{...party,providerSignedAt:new Date('2026-01-01T01:00:00Z'),providerSignedAtPrecisionMs:1000,identitySnapshot:{certificate:{subjectHash:sha(cn),validFrom:'2025-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'}}}]};
 let seals:any[]=[{integrityflag:true,signer:cn,signedontime:'2026-01-01 09:00:00.50',timestampflag:true,timestamptime:'2026-01-01 09:00:00.50',timestampverifyflag:true}];
 const requests:any[]=[];const p:any=new ElectronicProvider(config,async req=>{requests.push(req);return{status:200,headers:{},bodyText:JSON.stringify({code:'1000',result:'success',data:seals})};});
 seals.push({...seals[0]});const proof=await p.verifyFinalFile(task,bytes);assert.equal(proof.finalSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(proof.subjects.length,1);assert.ok((requests[0].body as Buffer).includes(bytes));
 seals.push({...seals[0],signer:'2@Other@012345678901234567@123456'});await assert.rejects(p.verifyFinalFile(task,bytes));seals=seals.slice(0,1);seals[0].integrityflag=false;await assert.rejects(p.verifyFinalFile(task,bytes));seals[0].integrityflag='true';await assert.rejects(p.verifyFinalFile(task,bytes));
});
import {certificateSubjectEvidence} from '../src/esign/fadada/certificate-evidence';

test('query_cert JSON-string data preserves the same bound subject as object and direct records',()=>{
 const cn='1@Synthetic@123456789012345678@123456',data={certType:'0',sequenceNo:'Serial123',dn:`CN=${cn},O=CA,C=CN`,startTime:'2026-01-01',endTime:'2099-01-01'};
 for(const raw of [data,{code:'1',data},{code:'1',data:JSON.stringify(data)},{code:'1',customer_id:'Customer123',data:JSON.stringify({...data,customerId:'Customer123'})}])assert.equal(certificateSubjectEvidence(raw,'Customer123','Serial123'),sha(cn));
});

test('query_cert subject parsing refuses malformed encodings and conflicting bindings without throwing',()=>{
 const data={certType:'0',sequenceNo:'Serial123',dn:'CN=1@Synthetic@123456789012345678@123456,O=CA'};
 const invalid:any[]=[null,[],true,1,'{bad','null','[]','true','1',JSON.stringify(JSON.stringify(data)),{data:JSON.stringify(data)}];
 for(const value of invalid)assert.equal(certificateSubjectEvidence({code:'1',data:value},'Customer123','Serial123'),null);
 for(const encoded of [false,true]){
  const envelope=(record:any,outer:any={})=>({code:'1',...outer,data:encoded?JSON.stringify(record):record});
  for(const key of ['customerId','customer_id']){
   assert.equal(certificateSubjectEvidence(envelope(data,{[key]:'Other'}),'Customer123','Serial123'),null);
   assert.equal(certificateSubjectEvidence(envelope({...data,[key]:'Other'}),'Customer123','Serial123'),null);
   assert.equal(certificateSubjectEvidence(envelope({...data,customerId:'Customer123',customer_id:'Other'}),'Customer123','Serial123'),null);
  }
  for(const patch of [{sequenceNo:'Other'},{certType:'1'},{dn:'CN=1@Other@123456789012345678@123456,O=CA'}])assert.equal(certificateSubjectEvidence(envelope(data,patch),'Customer123','Serial123'),null);
  for(const patch of [{sequenceNo:'Other'},{certType:'1'},{dn:null},{dn:'CN=Synthetic,O=CA'},{dn:data.dn+',CN=1@Other@123456789012345678@123456'},{dn:data.dn+'\\escaped'},{dn:data.dn+'\n'},{dn:'CN=1@'+('x'.repeat(4096))+'@id@code'}])assert.equal(certificateSubjectEvidence(envelope({...data,...patch}),'Customer123','Serial123'),null);
 }
});
test('certificate subject digest comes only from a bound real-identity certificate DN',()=>{
 const cn='1@Synthetic@123456789012345678@123456';const raw={code:'1',data:{customerId:'Customer123',sequenceNo:'Serial123',certType:'0',dn:`CN=${cn},O=CA,C=CN`}};
 assert.equal(certificateSubjectEvidence(raw,'Customer123','Serial123'),sha(cn));
 for(const data of [{...raw.data,customerId:'Other'},{...raw.data,sequenceNo:'Other'},{...raw.data,certType:'1'},{...raw.data,dn:'CN=Synthetic,O=CA'}])assert.equal(certificateSubjectEvidence({code:'1',data},'Customer123','Serial123'),null);
});
import {electronicProof} from './electronic-fixtures';
import {assertElectronicArchiveProof} from '../src/electronic-documents/proof';
test('persisted final-verification proof rejects extra subjects and verification after archive',()=>{
 const f=electronicProof();f.proof.finalVerification.subjects.push('9'.repeat(64));assert.throws(()=>assertElectronicArchiveProof(f.proof,f.expected));
 const g=electronicProof();g.proof.finalVerification.verifiedAt='2099-01-01T00:00:00Z';assert.throws(()=>assertElectronicArchiveProof(g.proof,g.expected));
});
test('timestamp and signing precision intervals must overlap in both directions',async()=>{
 const bytes=Buffer.from('%PDF-1.7\n'+('signed '.repeat(30))),cn='1@Synthetic@123456789012345678@123456',task:any={...doc,parties:[{...party,providerSignedAt:new Date('2026-01-01T01:00:00Z'),providerSignedAtPrecisionMs:1000,identitySnapshot:{certificate:{subjectHash:sha(cn),validFrom:'2025-01-01T00:00:00Z',validUntil:'2027-01-01T00:00:00Z'}}}]};
 let timestamp='2026-01-02 09:00:00.50';const p=new ElectronicProvider(config,async()=>({status:200,headers:{},bodyText:JSON.stringify({code:'1000',result:'success',data:[{integrityflag:true,signer:cn,signedontime:'2026-01-01 09:00:00.50',timestampflag:true,timestamptime:timestamp,timestampverifyflag:true}]})}));
 await assert.rejects(p.verifyFinalFile(task,bytes));timestamp='2026-01-01 08:59:59.99';await assert.rejects(p.verifyFinalFile(task,bytes));timestamp='2026-01-01 09:00:00';await p.verifyFinalFile(task,bytes);
});
