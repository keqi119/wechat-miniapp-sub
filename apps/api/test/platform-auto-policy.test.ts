import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSigningModes,nextSigningAction} from '../src/electronic-documents/policy';
import {electronicDocumentKinds} from '../src/electronic-documents/types';
import {signingParties,signingContext,electronicTask,esignNow,sha} from './electronic-fixtures';

function parties(){return signingParties().map(p=>p.role==='CUSTOMER'?p:{...p,autoAuthority:{...p.autoAuthority!,policyVersion:3,platformSubjectId:'ninda',delegateSubjectId:'XIAOLANG_NETWORK_TECHNOLOGY',applicationBinding:sha('f'),documentKinds:electronicDocumentKinds.filter(k=>k!=='COOPERATION_GRANT'),cooperationVersionIds:null,vehicleIds:null}});}
test('new enterprise platform grants cover supported contracts without order/vehicle restrictions, customers always sign personally',()=>{
 for(const kind of electronicDocumentKinds.filter(k=>k!=='COOPERATION_GRANT')){
  const ps=parties().filter(p=>!kind.startsWith('COOPERATION')||p.role!=='CUSTOMER'),context={...signingContext(),kind,cooperationVersionId:null,vehicleIds:[],orderId:undefined};
  const modes=selectSigningModes(ps,esignNow,context).modes;
  assert.equal(modes.OWNER,kind.startsWith('COOPERATION')?'MANUAL':'AUTO',kind);assert.equal(modes.PLATFORM,'AUTO',kind);
  if(!kind.startsWith('COOPERATION'))assert.equal(modes.CUSTOMER,'MANUAL');
  const task={...electronicTask(),kind,context,parties:ps.map(p=>({...p,mode:modes[p.role]!,status:p.role==='CUSTOMER'?'SIGNED' as const:'PENDING' as const,transactionId:'txn-'+p.role}))};
  assert.deepEqual(nextSigningAction(task,esignNow),{kind:'SIGN',role:'OWNER',mode:kind.startsWith('COOPERATION')?'MANUAL':'AUTO'},kind);
 }
});
test('cooperation owner signs each contract; Ningda automation does not require an owner auto grant',()=>{
 const ps=parties().filter(p=>p.role!=='CUSTOMER');ps[0].autoAuthority=null;
 const context={...signingContext(),kind:'COOPERATION' as const};
 assert.deepEqual(selectSigningModes(ps,esignNow,context).modes,{OWNER:'MANUAL',PLATFORM:'AUTO'});
 const task={...electronicTask(),kind:context.kind,context,parties:ps.map(p=>({...p,mode:'AUTO' as const,status:'PENDING' as const,transactionId:'txn-'+p.role}))};
 assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_MANUAL_REQUIRED'});
});
test('initial or expanded authority documents must be personally signed even with platform grants',()=>{
 const context={...signingContext(),kind:'COOPERATION_GRANT' as const},ps=parties().filter(p=>p.role!=='CUSTOMER');
 assert.deepEqual(selectSigningModes(ps,esignNow,context).modes,{OWNER:'MANUAL',PLATFORM:'MANUAL'});
});
test('wrong platform/grantee, missing channel proof, pause, stale status, expired certificate and manual-only test do not grant auto execution',()=>{
 for(const mutate of [(p:any)=>p.autoAuthority.platformSubjectId='other',(p:any)=>p.autoAuthority.delegateSubjectId='ninda',(p:any)=>p.autoAuthority.applicationBinding=null,(p:any)=>p.autoAuthority.channelEvidenceHash=null,(p:any)=>p.autoAuthority.enabled=false,(p:any)=>p.autoAuthority.checkedAt='2026-11-01T08:00:00Z']){
  const ps=parties();mutate(ps[1]);assert.deepEqual(selectSigningModes(ps,esignNow,signingContext()).modes,{CUSTOMER:'MANUAL',OWNER:'MANUAL',PLATFORM:'MANUAL'});
 }
 assert.deepEqual(selectSigningModes(parties(),esignNow,{...signingContext(),signaturePolicy:'MANUAL_ONLY'}).modes,{CUSTOMER:'MANUAL',OWNER:'MANUAL',PLATFORM:'MANUAL'});
 const invalid=parties();invalid[1].certificate.validUntil=esignNow.toISOString();assert.throws(()=>selectSigningModes(invalid,esignNow,signingContext()));
});
test('old evidence does not gain cooperation/renewal permissions by setting a kind; mixed versions cannot enable new kinds',()=>{
 const old=signingParties();for(const p of old)if(p.autoAuthority)p.autoAuthority.documentKinds=['RENEWAL'];
 assert.equal(selectSigningModes(old,esignNow,{...signingContext(),kind:'RENEWAL'}).modes.OWNER,'MANUAL');
 const mixed=parties();mixed[1]=old[1] as any;assert.equal(selectSigningModes(mixed,esignNow,{...signingContext(),kind:'RENEWAL'}).modes.PLATFORM,'MANUAL');
});
test('a customer cannot be automatically signed even if a malformed persisted task says AUTO; unknown issued operations query first',()=>{
 const task=electronicTask();task.parties[0].mode='AUTO';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_MANUAL_REQUIRED'});
 task.parties[0].status='UNKNOWN';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'QUERY',role:'CUSTOMER'});
});
test('v3 subscriptions reject both legacy-only and mixed legacy/Xiaolang authorizations',()=>{
 const context={...signingContext(),autoSigningPolicyVersion:3 as const};
 for(const ps of [signingParties(),parties().map((p,i)=>i===1?signingParties()[i]:p)]){
  assert.deepEqual(selectSigningModes(ps,esignNow,context).modes,{CUSTOMER:'MANUAL',OWNER:'MANUAL',PLATFORM:'MANUAL'});
  const task={...electronicTask(),context,parties:ps.map(p=>({...p,mode:p.role==='CUSTOMER'?'MANUAL' as const:'AUTO' as const,status:p.role==='CUSTOMER'?'SIGNED' as const:'PENDING' as const,transactionId:'txn-'+p.role}))};
  assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_AUTO_AUTHORITY_REQUIRED'});
 }
});
