import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityPayload, certificationPayload, loginPayload, providerUrl, readEntry, sealImageUrl, smsPayload, toFen } from './model.ts';
import type { AuthorityForm, LegalDocument } from './model.ts';

const documents:LegalDocument[]=['terms','privacy','owner-identity','owner-auto-sign'].map((type,index)=>({id:`doc-${index}`,type,version:2,title:type,content:'合成测试文案'}));
const options={vehicles:[{vehicleId:'vehicle-1',vehicle:{title:'合成车辆'}}],template:{id:'template-1',version:3,hash:'a'.repeat(64),title:'合成合同'}};
const form:AuthorityForm={vehicleIds:['vehicle-1'],validFrom:'2099-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',minMonthlyFee:'100.01',maxMonthlyFee:'200.02',minDeposit:'0',maxDeposit:'1000',minMonths:'1',maxMonths:'12'};

test('provider redirects require exact HTTPS origins and reject URL parser ambiguities',()=>{
 const opaque='https://textapi17.fadada.com/path?sign=a%2fb%2B%3d&value=one+two&value=%23';
 assert.equal(providerUrl(opaque),opaque);
 assert.equal(providerUrl('https://realnameverify16.fadada.com/path'),'https://realnameverify16.fadada.com/path');
 for(const url of ['http://textapi17.fadada.com/x','https://textapi17.fadada.com.evil.test/x','https://textapi17.fadada.com:444/x','https://textapi17.fadada.com:443/x','https://textapi17.fadada.com/x#fragment','https://u:p@textapi17.fadada.com/x','//textapi17.fadada.com/x','javascript:alert(1)','https://textapi17.fadada.com\\@evil.test',' https://textapi17.fadada.com/x','https://textapi17.fadada.com/\n','https://textapi17.fadada.com/x?token='+'a'.repeat(16_384)]) assert.throws(()=>providerUrl(url));
});
test('login consumes only current terms/privacy; certification requires three separate consents',()=>{
 assert.deepEqual(loginPayload('13800000000','123456','challenge-1',true,documents),{challengeId:'challenge-1',mobile:'13800000000',code:'123456',consents:[{documentId:'doc-0',version:2},{documentId:'doc-1',version:2}]});
 assert.throws(()=>loginPayload('13800000000','123456','',true,documents));
 assert.throws(()=>loginPayload('13800000000','123456','',false,documents));
 assert.throws(()=>loginPayload('13800000000','123','',true,documents));
 assert.throws(()=>certificationPayload({'terms':true,'privacy':true},documents));
 assert.deepEqual(certificationPayload({'terms':true,'privacy':true,'owner-identity':true},documents),{accepted:true,consents:[{documentId:'doc-0',version:2},{documentId:'doc-1',version:2},{documentId:'doc-2',version:2}]});
 assert.throws(()=>certificationPayload({'terms':true,'privacy':true,'owner-identity':true},documents.filter(d=>d.type!=='owner-identity')));
});
test('money conversion is exact integer cents without floating point rounding or coercion',()=>{
 assert.equal(toFen('0.29'),29);assert.equal(toFen('21474836.47'),2147483647);
 for(const amount of ['21474836.48','-1','1.001','1e3','','Infinity',' 1','0x10']) assert.throws(()=>toFen(amount));
});
test('authority payload binds selected vehicles, template hash, seal and independent consent',()=>{
 const value=authorityPayload(form,options,'seal-1',true,documents,'test-idempotency-key');
 assert.deepEqual(value,{scope:{version:1,vehicleIds:['vehicle-1'],templateId:'template-1',templateVersion:3,templateHash:'a'.repeat(64),validFrom:'2099-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',minMonthlyFeeAmount:10001,maxMonthlyFeeAmount:20002,minDepositAmount:0,maxDepositAmount:100000,minMonths:1,maxMonths:12},sealId:'seal-1',accepted:true,consents:[{documentId:'doc-0',version:2},{documentId:'doc-1',version:2},{documentId:'doc-3',version:2}],idempotencyKey:'test-idempotency-key'});
 for(const override of [{vehicleIds:[]},{vehicleIds:['other']},{vehicleIds:['vehicle-1','vehicle-1']},{minMonths:'0'},{maxMonths:'61'},{minMonthlyFee:'201'},{validUntil:'2000-01-01T00:00:00Z'},{validFrom:'invalid'}]) assert.throws(()=>authorityPayload({...form,...override},options,'seal-1',true,documents,'test-idempotency-key'));
 assert.throws(()=>authorityPayload(form,{...options,template:null},'seal-1',true,documents,'test-idempotency-key'));
 assert.throws(()=>authorityPayload(form,options,'seal-1',false,documents,'test-idempotency-key'));
 assert.throws(()=>authorityPayload(form,options,'',true,documents,'test-idempotency-key'));
});
test('entry removes query tokens and ignores provider success assertions on return',()=>{
 assert.deepEqual(readEntry('/owner/return/','?success=true&ownerId=unknown&token=bad'),{isReturn:true,invitationToken:'',cleanPath:'/owner/return/'});
 assert.deepEqual(readEntry('/owner/','?invitationToken='+'a'.repeat(43)),{isReturn:false,invitationToken:'a'.repeat(43),cleanPath:'/owner/'});
});
test('invitation links are captured in memory while portal SMS payload stays explicit',()=>{
 for(const token of ['a'.repeat(24),'a'.repeat(43),'bad+']){
  assert.equal(readEntry('/owner/','?invitationToken='+token).invitationToken,token==='bad+'?'':token);
  assert.deepEqual(smsPayload('13800000000'),{mobile:'13800000000'});
 }
 for(const challenge of ['','bad handle','/invalid','a'.repeat(257)])assert.throws(()=>loginPayload('13800000000','123456',challenge,true,documents));
 for(const mobile of ['','123',' 13800000000'])assert.throws(()=>smsPayload(mobile));
});test('seal previews permit bounded raster data only, never active SVG or remote URLs',()=>{
 assert.equal(sealImageUrl({imageType:'png',imageBase64:'YWJj'}),'data:image/png;base64,YWJj');
 assert.throws(()=>sealImageUrl({imageType:'image/svg+xml',imageBase64:'YWJj'}));
 assert.throws(()=>sealImageUrl({imageType:'png',imageBase64:'https://evil.test/'}));
});

