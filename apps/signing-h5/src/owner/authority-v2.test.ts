import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from './model.ts';

const documents=['terms','privacy','owner-auto-sign','owner-rental-contract'].map((type,index)=>({id:type==='owner-auto-sign'?'notice-2':type==='owner-rental-contract'?'template-1':`doc-${index}`,type,version:2,title:type,content:'完整合成正文',contentHash:'a'.repeat(64)}));
const options={scopeVersion:2,delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:[{id:'SUBSCRIPTION_WITH_FEES',label:'汽车订阅主合同及费用附件',template:{id:'template-1',version:2,hash:'a'.repeat(64),title:'合成合同'}}],authorizationNotice:{id:'notice-2',version:2,hash:'a'.repeat(64)}};
const form={delegateIds:['PLATFORM_OPERATOR'],documentKinds:['SUBSCRIPTION_WITH_FEES'],validFrom:'2099-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z'};
const scope={version:2,validFrom:'2099-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',delegates:[{id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'}],documentKinds:['SUBSCRIPTION_WITH_FEES']};
const authority={id:'grant-2',ownerId:'owner-1',sealId:'seal-1',scope,scopeHash:'b'.repeat(64),status:'AUTHORIZED',enabled:false,revision:3};
const detail={id:'owner-1',revision:1,autoSigningExecutionEnabled:true,seals:[{id:'seal-1',status:'ACTIVE',imageHash:'c'.repeat(64)}],capabilities:{canManageAuthority:true,canEnableAuthority:true}};

test('v2 request contains only period, trusted selected delegate and selected document kind',()=>{
 const actual=(model.authorityPayload as any)(form,options,'seal-1',true,documents,'test-idempotency-key');
 assert.deepEqual(actual,{scope,sealId:'seal-1',accepted:true,consents:[{documentId:'doc-0',version:2},{documentId:'doc-1',version:2},{documentId:'notice-2',version:2}],idempotencyKey:'test-idempotency-key'});
});
test('v2 request rejects empty, duplicate or forged choices, invalid periods and unconfirmed current notice',()=>{
 for(const change of [{delegateIds:[]},{delegateIds:['OTHER']},{delegateIds:['PLATFORM_OPERATOR','PLATFORM_OPERATOR']},{documentKinds:[]},{documentKinds:['VEHICLE_CHANGE']},{documentKinds:['SUBSCRIPTION_WITH_FEES','SUBSCRIPTION_WITH_FEES']},{validFrom:'invalid'},{validUntil:'2000-01-01T00:00:00Z'},{validUntil:form.validFrom}])assert.throws(()=>(model.authorityPayload as any)({...form,...change},options,'seal-1',true,documents,'test-idempotency-key'));
 for(const docs of [documents.filter(d=>d.type!=='owner-auto-sign'),documents.map(d=>d.type==='owner-auto-sign'?{...d,version:1}:d),documents.map(d=>d.type==='owner-auto-sign'?{...d,contentHash:'d'.repeat(64)}:d)])assert.throws(()=>(model.authorityPayload as any)(form,options,'seal-1',true,docs,'test-idempotency-key'));
 assert.throws(()=>(model.authorityPayload as any)(form,options,'seal-1',false,documents,'test-idempotency-key'));
});
test('missing v2 authorization notice blocks requests with a readable validation error',()=>{
 const withoutNotice={...options,authorizationNotice:null};
 assert.equal((model.matchingAuthorityNotice as any)(documents,withoutNotice),undefined);
 assert.equal((model.authorityTemplateReady as any)(documents,withoutNotice),false);
 assert.throws(()=>(model.authorityPayload as any)(form,withoutNotice,'seal-1',true,documents,'test-idempotency-key'),/当前授权说明未加载或版本已变化/);
});
test('v2 enable keeps the saved three-part scope while a same-kind current template changes',()=>{
 const updated={...options,documentKinds:[{...options.documentKinds[0],template:{id:'template-2',version:3,hash:'e'.repeat(64),title:'新版合成合同'}}]};
 const updatedDocs=documents.map(d=>d.type==='owner-rental-contract'?{...d,id:'template-2',version:3,contentHash:'e'.repeat(64)}:d);
 assert.deepEqual((model.authorityEnablePayload as any)(detail,authority,updatedDocs,model.authorityConfirmationKey(detail as any,authority as any),updated),{enabled:true,revision:3,scopeHash:'b'.repeat(64)});
 for(const change of [{...authority,scope:{...scope,delegates:[{id:'PLATFORM_OPERATOR',name:'其他公司'}]}},{...authority,scope:{...scope,documentKinds:['VEHICLE_CHANGE']}}])assert.throws(()=>(model.authorityEnablePayload as any)(detail,change,updatedDocs,model.authorityConfirmationKey(detail as any,change as any),updated));
 assert.throws(()=>(model.authorityEnablePayload as any)(detail,authority,updatedDocs,null,updated));
});
const letterOptions={...options,authorizationMethod:'UNILATERAL_LETTER',authorizationNotice:{...options.authorizationNotice,version:3},authorizationLetterTemplate:{id:'letter-1',version:1,hash:'f'.repeat(64),title:'企业车主单方用印授权书'}};
const letterDocuments=[...documents.map(d=>d.type==='owner-auto-sign'?{...d,version:3}:d),{id:'letter-1',type:'owner-authorization-letter',version:1,title:'企业车主单方用印授权书',content:'被授权人：上海宁达信息科技有限公司',contentHash:'f'.repeat(64)}];
test('unilateral letter requires its exact published template, current notice and separate document consent',()=>{
 const actual=(model.authorityPayload as any)(form,letterOptions,'seal-1',true,letterDocuments,'test-idempotency-key');
 assert.deepEqual(actual.scope,scope);
 assert.deepEqual(actual.consents,[{documentId:'doc-0',version:2},{documentId:'doc-1',version:2},{documentId:'notice-2',version:3},{documentId:'letter-1',version:1}]);
 for(const docs of [letterDocuments.filter(d=>d.type!=='owner-authorization-letter'),letterDocuments.map(d=>d.type==='owner-auto-sign'?{...d,version:2}:d),letterDocuments.map(d=>d.type==='owner-authorization-letter'?{...d,version:2}:d),letterDocuments.map(d=>d.type==='owner-authorization-letter'?{...d,contentHash:'b'.repeat(64)}:d),letterDocuments.map(d=>d.type==='owner-authorization-letter'?{...d,type:'owner-identity'}:d),letterDocuments.map(d=>d.type==='owner-authorization-letter'?{...d,content:''}:d)]){
  assert.equal((model.authorityTemplateReady as any)(docs,letterOptions),false);
  assert.throws(()=>(model.authorityPayload as any)(form,letterOptions,'seal-1',true,docs,'test-idempotency-key'));
 }
 assert.throws(()=>(model.authorityPayload as any)(form,{...letterOptions,authorizationLetterTemplate:undefined},'seal-1',true,letterDocuments,'test-idempotency-key'));
});
test('unilateral authorization cannot select another delegate even when supplied in options',()=>{
 assert.throws(()=>(model.authorityPayload as any)(form,{...letterOptions,delegates:[{id:'PLATFORM_OPERATOR',name:'上海晓浪网络科技有限公司'}]},'seal-1',true,letterDocuments,'test-idempotency-key'));
});
test('unilateral document navigation stays on the protected same-origin route without provider tokens',()=>{
 const documentPath=(model as any).authorityDocumentPath;
 assert.equal(typeof documentPath,'function');
 assert.equal(documentPath('owner-1','grant-2','source'),'/owner/api/owners/owner-1/authorities/grant-2/document/source');
 assert.equal(documentPath('owner-1','grant-2','signed'),'/owner/api/owners/owner-1/authorities/grant-2/document/signed');
 for(const [owner,id,kind] of [['../owner','grant-2','source'],['owner-1','grant/2','signed'],['owner-1','grant-2','https://evil.test'],['owner-1','grant-2?token=x','source'],['owner-1','grant-2','SOURCE']])assert.throws(()=>documentPath(owner,id,kind));
});
test('a method switch cannot submit a form loaded for the other authorization flow',()=>{
 const matches=(model as any).authorityMethodMatches;
 assert.equal(typeof matches,'function');
 assert.equal(matches({authorizationMethod:'UNILATERAL_LETTER'},letterOptions),true);
 assert.equal(matches({authorizationMethod:'UNILATERAL_LETTER'},options),false);
 assert.equal(matches({authorizationMethod:'PROVIDER_AUTO_GRANT'},letterOptions),false);
 assert.equal(matches({},options),true);
});
