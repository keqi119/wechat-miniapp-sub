import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from './model.ts';

const doc={id:'template-1',type:'owner-rental-contract',version:2,title:'合成合同',content:'完整测试正文',contentHash:'a'.repeat(64)};
const authority={id:'grant-1',ownerId:'owner-1',sealId:'seal-1',scope:{version:1,vehicleIds:['vehicle-1'],templateId:'template-1',templateVersion:2,templateHash:'a'.repeat(64),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',minMonthlyFeeAmount:1,maxMonthlyFeeAmount:2,minDepositAmount:0,maxDepositAmount:1,minMonths:1,maxMonths:12},scopeHash:'b'.repeat(64),status:'AUTHORIZED',enabled:false,revision:3};
const detail={id:'owner-1',revision:1,autoSigningExecutionEnabled:true,seals:[{id:'seal-1',status:'ACTIVE',imageHash:'c'.repeat(64)}],capabilities:{canManageAuthority:true,canEnableAuthority:true}};

test('enable requires independent confirmation for this exact owner, authority version and current template',()=>{
 const key=(model as any).authorityConfirmationKey,enable=(model as any).authorityEnablePayload;
 assert.equal(typeof enable,'function','enable must require explicit saved-scope confirmation');
 assert.throws(()=>enable(detail,authority,[doc],null));
 assert.deepEqual(enable(detail,authority,[doc],key(detail,authority)),{enabled:true,revision:3,scopeHash:'b'.repeat(64)});
 for(const changed of [{...authority,revision:4},{...authority,status:'PENDING'},{...authority,scopeHash:'d'.repeat(64)},{...authority,scope:{...authority.scope,maxMonthlyFeeAmount:100}}]) assert.throws(()=>enable(detail,changed,[doc],key(detail,authority)));
 assert.throws(()=>enable({...detail,id:'owner-2'},authority,[doc],key(detail,authority)));
 assert.throws(()=>enable({...detail,revision:2},authority,[doc],key(detail,authority)));
 assert.throws(()=>enable({...detail,seals:[{id:'seal-1',status:'ACTIVE',imageHash:'d'.repeat(64)}]},authority,[doc],key(detail,authority)));
});
test('execution disabled or unavailable and old/unloaded template cannot enable authorized grants',()=>{
 const key=(model as any).authorityConfirmationKey,enable=(model as any).authorityEnablePayload;
 assert.equal(typeof enable,'function');
 for(const changed of [{...detail,autoSigningExecutionEnabled:false},{...detail,autoSigningExecutionEnabled:undefined},{...detail,capabilities:{canManageAuthority:true,canEnableAuthority:false}},{...detail,seals:[]}]) assert.throws(()=>enable(changed,authority,[doc],key(changed,authority)));
 for(const documents of [[],[{...doc,version:3}],[{...doc,contentHash:'d'.repeat(64)}],[{...doc,content:''}]]) assert.throws(()=>enable(detail,authority,documents,key(detail,authority)));
});
test('a unilateral letter is never an automatic-signing grant even when execution flags or provider status are wrong',()=>{
 const key=(model as any).authorityConfirmationKey,enable=(model as any).authorityEnablePayload;
 for(const status of ['PENDING','UNKNOWN','SIGNED','WITHDRAWN','AUTHORIZED']){
  const letter={...authority,method:'UNILATERAL_LETTER',status,document:{state:status,bodyHash:'d'.repeat(64),sourceAvailable:true,signedAvailable:status==='SIGNED',technicalAuthorizationStatus:'UNCONFIRMED'}};
  assert.throws(()=>enable(detail,letter,[doc],key(detail,letter)),/单方授权书/);
 }
});
const pendingLetter={...authority,method:'UNILATERAL_LETTER',status:'PENDING',document:{state:'SIGNING',bodyHash:'d'.repeat(64),sourceAvailable:true,signedAvailable:false,technicalAuthorizationStatus:'UNCONFIRMED'}};
const readyDetail={...detail,authorizationEntryEnabled:true,readyForSigning:true};
test('only an eligible unfinished unilateral letter can resume its original signing transaction',()=>{
 const canResume=(model as any).canResumeAuthority,resume=(model as any).authorityResumePayload;
 assert.equal(typeof canResume,'function');assert.equal(typeof resume,'function');
 for(const status of ['PENDING','UNKNOWN']){
  const pending={...pendingLetter,status};assert.equal(canResume(readyDetail,pending),true);assert.deepEqual(resume(readyDetail,pending),{});
 }
 for(const changed of [{...pendingLetter,method:'PROVIDER_AUTO_GRANT'},{...pendingLetter,ownerId:'another-owner'},{...pendingLetter,document:undefined},...['SIGNED','WITHDRAWN','REJECTED','AUTHORIZED'].map(status=>({...pendingLetter,status})),...['ARCHIVED','SIGNED','REJECTED','WITHDRAWN'].map(state=>({...pendingLetter,document:{...pendingLetter.document,state}})),{...pendingLetter,document:{...pendingLetter.document,withdrawnAt:'2026-10-21T00:00:00Z'}},{...pendingLetter,document:{...pendingLetter.document,signedAvailable:true}},{...pendingLetter,document:{...pendingLetter.document,signedPdfHash:'e'.repeat(64)}}]){
  assert.equal(canResume(readyDetail,changed),false);assert.throws(()=>resume(readyDetail,changed));
 }
 for(const changed of [{...readyDetail,authorizationEntryEnabled:false},{...readyDetail,readyForSigning:false},{...readyDetail,capabilities:{...readyDetail.capabilities,canManageAuthority:false}}]){
  assert.equal(canResume(changed,pendingLetter),false);assert.throws(()=>resume(changed,pendingLetter));
 }
});
test('a rejected unilateral letter shows a terminal result and never asks the owner to continue signing it',()=>{
 assert.equal(model.authorityLetterStatus('REJECTED'),'授权书签署已终止');
 const notice=(model as any).authorityLetterNotice;assert.equal(typeof notice,'function');
 const message=notice({...pendingLetter,status:'REJECTED',document:{...pendingLetter.document,state:'REJECTED'}});
 assert.match(message,/已终止/);assert.doesNotMatch(message,/请由法人本人核对并签署/);
});
