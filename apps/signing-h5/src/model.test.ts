import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigation, signingPayload, externalUrl, verificationPayload} from './model.ts';
test('entry navigation accepts only whitelisted kind/id and ignores fabricated success',()=>{
  assert.deepEqual(navigation('?kind=AMENDMENT&id=qa-change&result=success'),{kind:'AMENDMENT',id:'qa-change'});
  assert.equal(navigation('?kind=PAYMENT&id=qa'),null);assert.equal(navigation('?token=private'),null);assert.equal(navigation('?kind=HANDOVER&id=../other'),null);
});
test('AMENDMENT signs and syncs with latest explicit revision; other kinds send no fake revision',()=>{
  assert.deepEqual(signingPayload({kind:'AMENDMENT',revision:4}),{revision:4});
  assert.throws(()=>signingPayload({kind:'AMENDMENT'}),/刷新/);
  assert.deepEqual(signingPayload({kind:'SUBSCRIPTION'}),{});assert.deepEqual(signingPayload({kind:'HANDOVER'}),{});
});
test('external entry must be HTTPS with no userinfo, never javascript or URL result',()=>{
  assert.equal(externalUrl('https://sign.fadada.com/qa'), 'https://sign.fadada.com/qa');
  for(const value of ['javascript:alert(1)','http://sign.fadada.com','https://user:secret@host.invalid','/return?success=true']) assert.throws(()=>externalUrl(value));
});
test('each real-name request carries separately accepted current privacy, never login consent alone',()=>{
  const privacy={id:'qa-privacy',type:'privacy' as const,version:2,title:'隐私政策',content:'QA'};
  assert.throws(()=>verificationPayload('QA姓名','110101199001010010',false,privacy),/用途/);
  assert.throws(()=>verificationPayload('QA姓名','110101199001010010',true,undefined),/隐私/);
  assert.deepEqual(verificationPayload('QA姓名','110101199001010010',true,privacy),{name:'QA姓名',idCardNo:'110101199001010010',consent:{accepted:true,documentId:'qa-privacy',version:2}});
});
