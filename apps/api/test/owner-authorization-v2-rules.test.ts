import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ownerScope,ownerScopeHash,evaluateOwnerSigning} from '../src/owner-signing/rules';
const now=new Date('2026-10-21T10:00:00Z');
const delegate={id:'PLATFORM_OPERATOR',name:'上海宁达信息科技有限公司'};
const scope={version:2,validFrom:'2026-10-21T00:00:00Z',validUntil:'2027-10-21T00:00:00Z',delegates:[delegate],documentKinds:['SUBSCRIPTION_WITH_FEES']};
const facts=()=>({ownerId:'OwnerA',sealId:'SealA',certificateSerialNo:'CertA',ownerVerified:true,memberVerified:true,certificateValid:true,sealCurrent:true,identityCheckedAt:now,kind:'SUBSCRIPTION',vehicleId:'any-approved-owner-vehicle',templateId:'new-approved-template',templateVersion:9,templateHash:'b'.repeat(64),templateType:'owner-rental-contract',templateVerified:true,vehicleOwnershipApproved:true,delegate,documentKind:'SUBSCRIPTION_WITH_FEES',monthlyFeeAmount:900000,depositAmount:1200000,months:24,customerSigned:true,reviewed:true,authority:{ownerId:'OwnerA',sealId:'SealA',certificateSerialNo:'CertA',enabled:true,status:'AUTHORIZED',providerAuthorized:true,providerCheckedAt:now,scope}});
test('v2 parses only the three explicit controls and rejects empty duplicate or unsupported choices',()=>{
 assert.equal(ownerScope.safeParse(scope).success,true);
 for(const patch of [{delegates:[]},{delegates:[delegate,delegate]},{delegates:[{id:'OTHER',name:delegate.name}]},{documentKinds:[]},{documentKinds:['AMENDMENT']},{documentKinds:['SUBSCRIPTION_WITH_FEES','SUBSCRIPTION_WITH_FEES']},{validUntil:scope.validFrom},{vehicleIds:['v']},{maxMonthlyFeeAmount:1}])assert.equal(ownerScope.safeParse({...scope,...patch}).success,false);
});
test('v2 allows changed product terms and same-kind approved templates but requires current task and grant delegate agreement',()=>{
 const prior=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME=delegate.name;
 try{
  assert.equal(evaluateOwnerSigning(facts(),now).decision,'AUTO_ALLOWED');
  for(const patch of [{delegate:undefined},{delegate:{...delegate,name:'另一个企业'}},{delegate:{...delegate,id:'OTHER'}},{documentKind:'AMENDMENT'},{kind:'AMENDMENT'},{vehicleOwnershipApproved:false},{templateVerified:false},{templateType:'owner-vehicle-change'},{customerSigned:false},{reviewed:false},{monthlyFeeAmount:0.01},{depositAmount:-1},{months:0}])assert.notEqual(evaluateOwnerSigning({...facts(),...patch},now).decision,'AUTO_ALLOWED');
  assert.notEqual(evaluateOwnerSigning({...facts(),authority:{...facts().authority,scope:{...scope,delegates:[{...delegate,name:'另一个企业'}]}}},now).decision,'AUTO_ALLOWED');
  process.env.PLATFORM_LEGAL_ENTITY_NAME='另一运营主体';assert.notEqual(evaluateOwnerSigning(facts(),now).decision,'AUTO_ALLOWED');
 }finally{if(prior===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=prior;}
});
test('v2 hashes survive JSONB key ordering and enforce the half-open authorization period',()=>{
 assert.equal(ownerScopeHash(scope),ownerScopeHash({documentKinds:scope.documentKinds,delegates:[{name:delegate.name,id:delegate.id}],validUntil:scope.validUntil,validFrom:scope.validFrom,version:2}));
 const prior=process.env.PLATFORM_LEGAL_ENTITY_NAME;process.env.PLATFORM_LEGAL_ENTITY_NAME=delegate.name;
 try{for(const date of [new Date(scope.validFrom),new Date(scope.validUntil)]){const f=facts();f.identityCheckedAt=date;f.authority.providerCheckedAt=date;assert.equal(evaluateOwnerSigning(f,date).decision,date.getTime()===Date.parse(scope.validFrom)?'AUTO_ALLOWED':'MANUAL_REQUIRED');}}finally{if(prior===undefined)delete process.env.PLATFORM_LEGAL_ENTITY_NAME;else process.env.PLATFORM_LEGAL_ENTITY_NAME=prior;}
});
test('legacy v1 scope hash and product restrictions remain unchanged',()=>{
 const v1={version:1,vehicleIds:['vehicleA'],templateId:'templateA',templateVersion:2,templateHash:'a'.repeat(64),validFrom:scope.validFrom,validUntil:scope.validUntil,minMonthlyFeeAmount:1,maxMonthlyFeeAmount:500000,minDepositAmount:0,maxDepositAmount:1000000,minMonths:1,maxMonths:12};
 assert.equal(ownerScopeHash(v1),createHash('sha256').update(JSON.stringify(v1)).digest('hex'));
 assert.equal(evaluateOwnerSigning({...facts(),authority:{...facts().authority,scope:v1}},now).decision,'MANUAL_REQUIRED');
});
