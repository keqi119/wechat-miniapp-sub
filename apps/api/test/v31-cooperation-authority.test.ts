import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSigningModes,nextSigningAction} from '../src/electronic-documents/policy';
import {electronicTask,esignNow,signingContext,signingParties} from './electronic-fixtures';
import * as mode from '../src/offline-documents/mode';

test('V31 cooperation and 03–06 require enterprise manual signatures even with technical grants',()=>{
 for(const kind of ['COOPERATION','COOPERATION_GRANT','COOPERATION_AMENDMENT','COOPERATION_TERMINATION','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION'] as const){
  const parties=signingParties().filter(p=>!kind.startsWith('COOPERATION')||p.role!=='CUSTOMER');
  for(const p of parties)if(p.autoAuthority)p.autoAuthority.documentKinds=[kind];
  const result=selectSigningModes(parties,esignNow,{...signingContext(),kind});
  assert.equal(result.modes.OWNER,'MANUAL');assert.equal(result.modes.PLATFORM,'MANUAL');
 }
});
test('old automatic cooperation intent cannot newly dispatch but accepted intent remains queryable',()=>{
 const task=electronicTask();task.kind='COOPERATION';task.context.kind='COOPERATION';task.parties=task.parties.filter(p=>p.role!=='CUSTOMER');
 for(const p of task.parties){p.autoAuthority!.documentKinds=['COOPERATION'];p.documentAccepted=true;}
 assert.deepEqual(nextSigningAction(task,esignNow),{kind:'BLOCKED',code:'ELECTRONIC_MANUAL_REQUIRED'});
 task.parties[0].status='UNKNOWN';assert.deepEqual(nextSigningAction(task,esignNow),{kind:'QUERY',role:'OWNER'});
});
test('enterprise onboarding supports ELECTRONIC without opening legacy document issuance',()=>{
 const guard=(mode as any).assertEnterpriseOnboardingAllowed;
 assert.equal(typeof guard,'function');
 const env={ESIGN_NEW_REQUESTS_ENABLED:'true',NEW_ORDER_CONTRACT_MODE:'ELECTRONIC'};
 assert.doesNotThrow(()=>guard({env}));
 assert.throws(()=>mode.assertNewEsignAllowed({executionMode:'ELECTRONIC',env}));
 assert.throws(()=>guard({env:{...env,ESIGN_NEW_REQUESTS_ENABLED:'false'}}));
 assert.throws(()=>guard({env:{...env,NEW_ORDER_CONTRACT_MODE:'OFFLINE'}}));
});

import * as grants from '../src/electronic-documents/seal-authorization';
test('V31 automatic grant requires independent archived scope, exact versions and actual agreed commercial terms',()=>{
 const evaluate=(grants as any).evaluateV31AutoGrant;assert.equal(typeof evaluate,'function');
 const product={id:'pv1',content:{months:6,minimumTermMonths:3,baseFeeAmount:8000,mileageMonthlyFeeAmount:2000,monthlyFeeAmount:10000,benefits:[],swapPolicy:{includedCount:1},customerBaas:{disposition:'INCLUDED'},mileagePerMonthKm:1500,excessMileagePriceAmount:100}};
 const scope={cooperation:{id:'cv1',hash:'a'.repeat(64),validFrom:'2026-01-01',validUntil:'2027-12-31',terms:{exceptions:[]}},parties:{OWNER:{id:'owner'}},products:[product],templates:[{id:'t1',version:1,hash:'b'.repeat(64)}],vehicles:[{id:'v1',content:{scope:{validFrom:'2026-01-01',validUntil:'2027-12-31',rightsRestrictions:{status:'NONE'}}}}],depositAuthorizations:[{productVersionId:'pv1',rule:{kind:'FIXED',amount:0}}]};
 const party={subjectId:'owner',grant:{signed:true,archived:true,revoked:false,scope},channelAuthorized:true};
 const context={kind:'SUBSCRIPTION',ownerId:'owner',cooperationVersionId:'cv1',cooperationHash:'a'.repeat(64),vehicleId:'v1',productVersionId:'pv1',template:{id:'t1',version:1,hash:'b'.repeat(64)},startDate:'2026-11-07',endDate:'2027-05-07',terms:{...product.content,agreedFeeComponents:{baseFeeAmount:8000,mileageMonthlyFeeAmount:2000},depositAmount:0}};
 assert.equal(evaluate(party,context,esignNow).allowed,true);
 const disclosed=structuredClone(party),actual:any=structuredClone(context);const v:any=disclosed.grant.scope.vehicles[0];v.content.scope.rightsRestrictions={status:'DISCLOSED',description:'已披露抵押，权利人独立同意本范围出租',evidenceFileIds:['rights-proof']} as any;v.content.authorityEvidence=[{fileId:'rental-proof',sha256:'a'.repeat(64)}];v.content.rightsEvidence=[{fileId:'rights-proof',sha256:'b'.repeat(64)}];actual.vehicleAuthority={rightsRestrictions:structuredClone(v.content.scope.rightsRestrictions),authorityEvidence:structuredClone(v.content.authorityEvidence),rightsEvidence:structuredClone(v.content.rightsEvidence)};
 assert.equal(evaluate(disclosed,actual,esignNow).allowed,true);actual.vehicleAuthority.rightsRestrictions.description='权限已变更';assert.equal(evaluate(disclosed,actual,esignNow).allowed,false);actual.vehicleAuthority.rightsRestrictions=structuredClone(v.content.scope.rightsRestrictions);v.content.authorityEvidence=[];assert.equal(evaluate(disclosed,actual,esignNow).allowed,false);v.content.scope.rightsRestrictions.status='UNKNOWN';assert.equal(evaluate(disclosed,actual,esignNow).allowed,false);
 for(const mutate of [(p:any,c:any)=>p.grant.signed=false,(p:any,c:any)=>p.channelAuthorized=false,(p:any,c:any)=>p.grant.revoked=true,(p:any,c:any)=>c.productVersionId='pv2',(p:any,c:any)=>c.template.version=2,(p:any,c:any)=>c.terms.agreedFeeComponents.baseFeeAmount=9000,(p:any,c:any)=>c.terms.months=7,(p:any,c:any)=>c.ownerId='other',(p:any,c:any)=>p.grant.scope.products=null,(p:any,c:any)=>c.terms.depositAmount=1,(p:any,c:any)=>c.terms.benefits=[{name:'new'}]]){
  const p=structuredClone(party),c=structuredClone(context);mutate(p,c);assert.equal(evaluate(p,c,esignNow).allowed,false);
 }
});

import {readAutomaticSigningAuthority} from '../src/electronic-documents/authorization';
test('actual authority reader cannot use a legacy broad checkbox without V31 commercial source',async()=>{
 const p=signingParties()[1];let reads=0;
 const result=await readAutomaticSigningAuthority({electronicAutoAuthority:{findMany:async()=>{reads++;throw new Error('must fail closed before broad authority lookup');}}} as any,p,signingContext(),esignNow);
 assert.equal(result,null);assert.equal(reads,0);
});

import {OwnerAuthorizationService} from '../src/owner-signing/authorization';
test('ELECTRONIC onboarding cannot issue or resume the legacy unilateral-letter signing workflow',async()=>{
 const saved={...process.env};try{Object.assign(process.env,{NEW_ORDER_CONTRACT_MODE:'ELECTRONIC',ESIGN_NEW_REQUESTS_ENABLED:'true',OWNER_AUTHORIZATION_ENABLED:'true',OWNER_AUTHORIZATION_METHOD:'UNILATERAL_LETTER'});
 const service=new OwnerAuthorizationService({} as any,{} as any,{} as any);
 for(const run of [()=>service.request('person','owner',{}),()=>service.resume('person','owner','old-letter')])await assert.rejects(run,(e:any)=>e.getResponse?.().error?.code==='V31_INDEPENDENT_GRANT_REQUIRED');
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

import {assertV31PreparationSourcesCurrent} from '../src/contract-terms/preparation';
import {canonicalHash} from '../src/customers/types';
test('enterprise revision normalization preserves hashes and never masks record or semantic changes',()=>{
 const content={name:'合成主体',signer:{id:'legal',revision:1}},snapshot={schema:'NINDA_V31_SOURCES',parties:{OWNER:{id:'owner',revision:1,content,hash:canonicalHash(content)}}},frozen={snapshot,hash:canonicalHash(snapshot)},changed=structuredClone(snapshot);changed.parties.OWNER.revision=2;
 const current={snapshot:changed,hash:canonicalHash(changed)};assert.doesNotThrow(()=>assertV31PreparationSourcesCurrent(frozen,current));assert.equal(current.snapshot.parties.OWNER.revision,2);assert.equal(frozen.snapshot.parties.OWNER.revision,1);
 assert.throws(()=>assertV31PreparationSourcesCurrent(frozen,{...current,hash:'0'.repeat(64)}));
 for(const mutate of [(s:any)=>s.parties.OWNER.id='another',(s:any)=>s.parties.OWNER.content.name='真实变更',(s:any)=>s.parties.OWNER.content.signer.revision=2]){const s=structuredClone(changed);mutate(s);s.parties.OWNER.hash=canonicalHash(s.parties.OWNER.content);assert.throws(()=>assertV31PreparationSourcesCurrent(frozen,{snapshot:s,hash:canonicalHash(s)}));}
});
