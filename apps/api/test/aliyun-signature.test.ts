import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signAliyunRequest, sendAliyunCode } from '../src/integrations/aliyun-sms';
test('ACS3 signature matches published Alibaba Cloud known-answer vector', () => {
  const result = signAliyunRequest({ host: 'ecs.cn-shanghai.aliyuncs.com', action: 'RunInstances', version: '2014-05-26', keyId: 'YourAccessKeyId', keySecret: 'YourAccessKeySecret', date: '2023-10-26T10:22:32Z', nonce: '3156853299f313e23d1673dc12e1703d', parameters: { ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd', RegionId: 'cn-shanghai' } });
  assert.ok(result.headers.Authorization.endsWith('Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0'));
});
test('SMS rejection never reports sent and request is not retried implicitly', async () => {
  let calls = 0;
  await assert.rejects(sendAliyunCode('13800000001', '123456', { ALIYUN_SMS_ACCESS_KEY_ID: 'test', ALIYUN_SMS_ACCESS_KEY_SECRET: 'test', ALIYUN_SMS_SIGN_NAME: 'test', ALIYUN_SMS_LOGIN_TEMPLATE_CODE: 'test' }, async () => { calls++; return Response.json({ Code: 'isv.BUSINESS_LIMIT_CONTROL' }); }));
  assert.equal(calls, 1);
});
