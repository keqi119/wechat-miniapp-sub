import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OwnerClient} from './client.ts';
import {partnerRoute,partnerStatus,cooperationStatus,maskedSettlementAccount,partnerRelationship,scopedArchiveFilePath} from './partner-model.ts';
test('settlements accept the server masked accountNumber and never fall back to a complete number',()=>{
 assert.equal(maskedSettlementAccount({accountNumber:'********1234'}),'********1234');
 assert.equal(maskedSettlementAccount({maskedNumber:'****5678'}),'****5678');
 assert.equal(maskedSettlementAccount({accountNumber:'1234567890123456'}),'尾号待核对');
});
test('cooperation activity is distinct from an active rental order',()=>{
 assert.equal(cooperationStatus('ACTIVE'),'合作中');assert.equal(cooperationStatus('SUSPENDED'),'合作已暂停');assert.equal(partnerStatus('ACTIVE'),'用车中');
});
test('offline routes retain owner scope and never route into signing',()=>{
 assert.deepEqual(partnerRoute('#/owners/p1/orders/o1','p1'),{tab:'orders',orderId:'o1'});
 assert.deepEqual(partnerRoute('#/owners/other/orders/o1','p1'),{tab:'workbench'});
 assert.deepEqual(partnerRoute('#/owners/p1/sign','p1'),{tab:'workbench'});
 assert.equal(partnerRelationship('INDIVIDUAL','SELF'),'本人');
 assert.equal(partnerStatus('PAYMENT_RECORDED'),'已登记实付，待核对');
 assert.equal(partnerStatus('APPROVED'),'已复核，待付款');
});
test('private published files retain owner, archive, version and file scope',()=>{
 assert.equal(scopedArchiveFilePath('p1','a1','v1','f1'),'/owners/p1/offline-archives/a1/versions/v1/files/f1');
 assert.throws(()=>scopedArchiveFilePath('../p2','a1','v1','f1'));
});
test('partner client permits scoped reads and refuses legacy feedback and other mutations',async()=>{
 const calls:string[]=[];const client=new OwnerClient((async(url,options)=>{calls.push(String(url));return new Response(JSON.stringify({items:[]}),{status:200,headers:{'Content-Type':'application/json'}});}) as typeof fetch);client.setCsrf('csrf');
 for(const path of ['/owners/p1/workbench','/owners/p1/vehicles','/owners/p1/policies','/owners/p1/orders/o1/workspace','/owners/p1/revenue-rules','/owners/p1/settlements','/owners/p1/offline-archives','/owners/p1/offline-archives/a1'])await client.request(path);
 await assert.rejects(client.request('/owners/p1/offline-archives/a1/feedback',{versionId:'v1',message:'问题',idempotencyKey:'stable-key'}));
 await assert.rejects(client.request('/owners/p1/settlements',{amount:1}));
 await assert.rejects(client.request('/owners/p1/policies/p1/pay',{}));
 assert.equal(calls.length,8);assert.ok(calls.every(path=>path.startsWith('/owner/api/owners/p1/')));
 await client.request('/owners/p1/offline-archives?kind=OWNER_COOPERATION&page=2&pageSize=20');
 await assert.rejects(client.request('/owners/p1/offline-archives?ownerId=p2'));
 await assert.rejects(client.request('/owners/p1/workbench?pageSize=101'));
 await assert.rejects(client.request('/owners/p1/offline-archives/a1?kind=OWNER_COOPERATION'));
});

