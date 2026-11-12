import test from 'node:test';
import assert from 'node:assert/strict';
import {partnerIdentity,partnerElectronicProgress} from './partner-electronic-progress-model.ts';

const verified={applicable:true,identity:{state:'COMPLETED',complete:true,label:'已认证',companyName:'认证企业',creditCode:'91310000SYNTHETIC00',legalName:'认证法人',verifiedAt:'2026-11-10T00:00:00Z'},certification:{state:'VERIFIED'},seal:{state:'READY',selected:true,selectedAt:'2026-11-10T00:01:00Z',checkedAt:'2026-11-10T00:02:00Z'},checkedAt:'2026-11-10T00:02:00Z'};
const owner={id:'partner-a',name:'当前登记名',subjectType:'ENTERPRISE',status:'VERIFIED',readyForSigning:true,autoSigningEnabled:true,allowedActions:{electronicCooperation:true},enterpriseVerification:verified,agreements:[]};

test('missing and inconsistent evidence never borrow owner status or signing flags as identity proof',()=>{
 assert.equal(partnerIdentity({...owner,enterpriseVerification:undefined}).label,'待核实');
 for(const identity of [{state:'COMPLETED',complete:false},{state:'UNKNOWN',complete:true}]){
  const display=partnerIdentity({...owner,enterpriseVerification:{...verified,identity:{...verified.identity,...identity}}});
  assert.equal(display.complete,false);assert.equal(display.companyName,null);assert.equal(display.legalName,null);
 }
 assert.equal(partnerElectronicProgress({...owner,enterpriseVerification:undefined}).current?.key,'identity');
});

test('current verified identity facts survive a certificate or seal refresh requirement',()=>{
 const current={...owner,enterpriseVerification:{...verified,certification:{state:'REFRESH_REQUIRED'},seal:{...verified.seal,state:'REFRESH_REQUIRED'}}};
 const identity=partnerIdentity(current),progress=partnerElectronicProgress(current);
 assert.equal(identity.complete,true);assert.equal(identity.companyName,'认证企业');assert.equal(identity.legalName,'认证法人');
 assert.equal(progress.steps[0].state,'DONE');assert.equal(progress.seal.selected,true);assert.equal(progress.seal.label,'已选用，待更新核验');assert.equal(progress.current?.key,'seal');
});

test('material change shows reauthentication and separates historical names from current proof',()=>{
 const value=partnerIdentity({...owner,enterpriseVerification:{...verified,identity:{...verified.identity,state:'REAUTH_REQUIRED',complete:false,previous:{companyName:'历史企业',legalName:'历史法人',capturedAt:'2026-11-09T00:00:00Z'}}}});
 assert.equal(value.label,'需重新认证');assert.equal(value.companyName,null);assert.equal(value.legalName,null);assert.equal(value.previous?.companyName,'历史企业');
});

test('a selected but unavailable seal is not described as a verified company seal',()=>{
 const progress=partnerElectronicProgress({...owner,enterpriseVerification:{...verified,seal:{...verified.seal,state:'UNAVAILABLE'}}});
 assert.equal(progress.seal.selected,true);assert.equal(progress.seal.ready,false);assert.equal(progress.seal.label,'已选用，需核对');assert.match(progress.steps[1].summary,/不可用或归属待核对/);assert.equal(progress.current?.key,'seal');
});

test('individual subjects do not become unverified enterprises or enter enterprise signing preparation',()=>{
 const value={...owner,subjectType:'INDIVIDUAL',enterpriseVerification:{...verified,applicable:false,identity:{state:'NOT_APPLICABLE',complete:false}}};
 assert.equal(partnerIdentity(value).label,'不适用');assert.equal(partnerElectronicProgress(value).steps[0].state,'NOT_APPLICABLE');assert.equal(partnerElectronicProgress(value).current?.key,'cooperation');assert.equal(partnerElectronicProgress(value).steps[2].state,'BLOCKED');
});

test('identity and selected seal do not imply effective cooperation or automatic authority',()=>{
 const progress=partnerElectronicProgress(owner,{items:[]});
 assert.equal(progress.steps[0].state,'DONE');assert.equal(progress.steps[1].state,'DONE');assert.equal(progress.steps[2].state,'WAITING');assert.equal(progress.steps[3].state,'OPTIONAL');assert.equal(progress.current?.key,'cooperation');
 assert.match(progress.steps[3].summary,/逐份手签/);
});

test('disabled electronic service is an explicit cooperation blocker and drafts are not signed agreements',()=>{
 const off=partnerElectronicProgress({...owner,allowedActions:{electronicCooperation:false}});assert.equal(off.steps[2].state,'BLOCKED');assert.match(off.steps[2].summary,/未开放/);
 const draft=partnerElectronicProgress({...owner,agreements:[{id:'a',status:'DRAFT',latestVersion:{id:'v',executionMode:'ELECTRONIC',status:'DRAFT'}}]});assert.equal(draft.steps[2].state,'WAITING');assert.match(draft.steps[2].label,/草稿/);
});

test('effective electronic cooperation can finish the required sequence while authority remains optional',()=>{
 const effective={...owner,agreements:[{id:'a',status:'ACTIVE',currentVersion:{id:'v',executionMode:'ELECTRONIC',status:'ACTIVE'}}]};
 const progress=partnerElectronicProgress(effective,{items:[]});assert.equal(progress.steps[2].state,'DONE');assert.equal(progress.current,null);assert.equal(progress.steps[3].state,'OPTIONAL');
 const enabled=partnerElectronicProgress(effective,{items:[{enabled:true,revokedAt:null}]});assert.equal(enabled.steps[3].label,'企业已开启');assert.match(enabled.steps[3].summary,/逐单校验/);
 const revoked=partnerElectronicProgress(effective,{items:[{enabled:true,revokedAt:'2026-11-09'}]});assert.equal(revoked.steps[3].state,'OPTIONAL');
});

test('a closed electronic path preserves already effective and signed agreement facts',()=>{
 const closed={...owner,allowedActions:{electronicCooperation:false}};
 const active=partnerElectronicProgress({...closed,agreements:[{status:'ACTIVE',currentVersion:{id:'v',executionMode:'ELECTRONIC',status:'ACTIVE'}}]});assert.match(active.steps[2].label,/1 份协议已生效/);assert.match(active.steps[2].summary,/新增.*未开放/);
 const signed=partnerElectronicProgress({...closed,agreements:[{status:'DRAFT',latestVersion:{id:'v',executionMode:'ELECTRONIC',status:'SIGNED'}}]});assert.equal(signed.steps[2].label,'协议已签署，待生效');assert.notEqual(signed.steps[2].state,'DONE');assert.match(signed.steps[2].summary,/新增.*未开放/);
});

test('cooperation dates use inclusive Shanghai days and never mark expired or future versions complete',()=>{
 const at=Date.parse('2026-11-09T16:00:00Z');
 const agreement=(validFrom:string,validUntil:string)=>({status:'ACTIVE',currentVersion:{id:'v',executionMode:'ELECTRONIC',status:'ACTIVE',validFrom,validUntil}});
 const step=(record:any,now=at)=>partnerElectronicProgress({...owner,agreements:[record]},undefined,now).steps[2];
 assert.equal(step(agreement('2026-11-10','2026-11-10')).state,'DONE');
 assert.notEqual(step(agreement('2026-11-10','2026-11-10'),at-1).state,'DONE');
 assert.match(step(agreement('2026-11-01','2026-11-09')).label,/已到期/);
 assert.match(step(agreement('2026-11-11','2026-12-01')).label,/未到生效期/);
 assert.equal(step(agreement('bad-date','2026-12-01')).state,'UNKNOWN');
 const old=agreement('2026-11-01','2026-11-09');const current=partnerElectronicProgress({...owner,agreements:[{...old,latestVersion:{id:'draft',executionMode:'ELECTRONIC',status:'DRAFT'}}]},undefined,at);assert.equal(current.current?.key,'cooperation');assert.match(current.steps[2].label,/草稿/);assert.notEqual(current.steps[2].state,'DONE');
});
