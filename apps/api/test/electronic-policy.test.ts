import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requiredSignerRoles,selectSigningModes,nextSigningAction} from '../src/electronic-documents/policy';
import {electronicTask,esignNow,signingContext,signingParties} from './electronic-fixtures';
const code=(wanted:string)=>(error:any)=>error?.getResponse?.().error?.code===wanted;

test('order documents require all three actual roles; cooperation requires owner and Ningda; handovers cannot enter electronic signing',()=>{
  for(const kind of ['SUBSCRIPTION','DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION','RETURN_SETTLEMENT','RENEWAL_CANCELLATION'])assert.deepEqual(requiredSignerRoles(kind as any),['CUSTOMER','OWNER','PLATFORM']);
  assert.deepEqual(requiredSignerRoles('COOPERATION'),['OWNER','PLATFORM']);
  for(const kind of ['DELIVERY','RETURN','SWAP_RETURN','SWAP_DELIVERY','HANDOVER','unknown'])assert.throws(()=>requiredSignerRoles(kind as any),code('ELECTRONIC_KIND_INVALID'));
});
test('automatic mode needs both enterprises grants; a local letter or the API company as grantee cannot grant automatic signing',()=>{
  const parties=signingParties(),context=signingContext();
  assert.deepEqual(selectSigningModes(parties,esignNow,context).modes,{CUSTOMER:'MANUAL',OWNER:'AUTO',PLATFORM:'AUTO'});
  for(const mutate of [(p:any)=>p.autoAuthority.channelEvidenceHash=null,(p:any)=>p.autoAuthority.granteeVerified=false,(p:any)=>p.autoAuthority.delegateSubjectId='api-company',(p:any)=>p.autoAuthority.providerStatus='UNKNOWN',(p:any)=>p.autoAuthority.cooperationVersionIds=['another-cooperation'],(p:any)=>p.autoAuthority.vehicleIds=['another-vehicle'],(p:any)=>p.autoAuthority.documentKinds=['RENEWAL'],(p:any)=>p.autoAuthority.validUntil=esignNow.toISOString()]){
    const copy=signingParties();mutate(copy[1]);const result=selectSigningModes(copy,esignNow,context);assert.deepEqual(result.modes,{CUSTOMER:'MANUAL',OWNER:'MANUAL',PLATFORM:'MANUAL'});assert.ok(result.reasonCodes.length);
  }
});
test('personal lessor always signs personally, and enterprise identity cannot be substituted for Ningda',()=>{
  const parties=signingParties();parties[1].subjectType='INDIVIDUAL';
  assert.equal(selectSigningModes(parties,esignNow,signingContext()).modes.OWNER,'MANUAL');
  parties[2].subjectId='api-company';assert.throws(()=>selectSigningModes(parties,esignNow,signingContext()),code('ELECTRONIC_PLATFORM_MISMATCH'));
});
test('provider automatic authorization keeps the existing one-minute freshness limit, separately from certificate freshness',()=>{
  const parties=signingParties();parties[1].autoAuthority!.checkedAt='2026-11-02T07:59:00Z';
  assert.deepEqual(selectSigningModes(parties,esignNow,signingContext()).modes,{CUSTOMER:'MANUAL',OWNER:'MANUAL',PLATFORM:'MANUAL'});
  parties[1].autoAuthority!.checkedAt='2026-11-02T08:00:01Z';assert.equal(selectSigningModes(parties,esignNow,signingContext()).modes.OWNER,'MANUAL');
});
test('missing or duplicated parties and unverified identity block preparation instead of enabling a two-party path',()=>{
  for(const parties of [signingParties().slice(0,2),[...signingParties(),signingParties()[0]]])assert.throws(()=>selectSigningModes(parties,esignNow,signingContext()),code('ELECTRONIC_PARTIES_MISMATCH'));
  const parties=signingParties();parties[0].identityVerified=false;assert.throws(()=>selectSigningModes(parties,esignNow,signingContext()),code('ELECTRONIC_IDENTITY_REQUIRED'));
});
test('dispatch follows customer, owner, platform and does not file after the first two signatures',()=>{
  const task=electronicTask();assert.deepEqual(nextSigningAction(task,esignNow),{kind:'SIGN',role:'CUSTOMER',mode:'MANUAL'});
  task.parties[0].status='SIGNED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'SIGN',role:'OWNER',mode:'AUTO'});
  task.parties[1].status='SIGNED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'SIGN',role:'PLATFORM',mode:'AUTO'});
  task.parties[2].status='SIGNED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'FILE'});
  task.filingStatus='UNKNOWN';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'QUERY_FILING'});
  task.filingStatus='CONFIRMED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'ARCHIVE'});
});
test('unknown upload or auto-sign result can only query its original operation even if authorization is later revoked',()=>{
  const task=electronicTask();task.uploadStatus='UNKNOWN';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'QUERY_UPLOAD'});
  task.uploadStatus='UPLOADED';task.parties[0].status='SIGNED';task.parties[1].status='UNKNOWN';task.parties[1].autoAuthority!.enabled=false;
  assert.deepEqual(nextSigningAction(task,esignNow),{kind:'QUERY',role:'OWNER'});
  task.parties[1].status='PENDING';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_AUTO_AUTHORITY_REQUIRED'});
});
test('completed signatures survive later expiry, but the next signer requires a current certificate and no retired task can dispatch',()=>{
  const task=electronicTask();task.parties[0].status='SIGNED';task.parties[0].certificate.validUntil='2026-01-01T00:00:00Z';
  assert.equal(nextSigningAction(task,esignNow).kind,'SIGN');task.parties[1].certificate.validUntil='2026-01-01T00:00:00Z';
  assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_IDENTITY_REQUIRED'});
  task.status='RETIRED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'NONE',reason:'RETIRED'});
});
test('a later signer cannot leapfrog the first; stale certificate checks and unapproved business cannot dispatch',()=>{
  const task=electronicTask();task.parties[2].status='SIGNED';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_SIGNING_ORDER_INVALID'});
  task.parties[2].status='PENDING';task.parties[0].certificate.checkedAt='2026-10-31T07:00:00Z';assert.equal(nextSigningAction(task,esignNow).kind,'BLOCKED');
  task.businessApproved=false;assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_BUSINESS_APPROVAL_REQUIRED'});
});
test('cooperation must remain manual even after historical document acceptance',()=>{
 const task=electronicTask();task.kind='COOPERATION';task.context.kind='COOPERATION';task.parties=task.parties.filter(p=>p.role!=='CUSTOMER');
 for(const p of task.parties)p.autoAuthority!.documentKinds=['COOPERATION'];
 assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_MANUAL_REQUIRED'});
 (task.parties[0] as any).documentAccepted=true;
 assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_MANUAL_REQUIRED'});
});
