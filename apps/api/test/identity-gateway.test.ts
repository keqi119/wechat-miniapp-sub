import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import '../src/common/config';
import { Db } from '../src/common/db';
import { RealIdentityGateway } from '../src/integrations/identity';

const settings = { appId: 'wx-test', secret: 'secret', smsEnabled: true, smsHashSecret: 's'.repeat(32) };
test('wechat exchanges both codes on server and rejects wrong phone watermark', async () => {
  let watermark = 'wx-test', tokenCalls = 0;
  const gateway = new RealIdentityGateway({} as Db, settings, async (url, init) => {
    if (url.includes('jscode2session')) { assert.match(url, /js_code=login-code/); return Response.json({ openid: 'verified-openid' }); }
    if (url.includes('stable_token')) { tokenCalls++; assert.equal(JSON.parse(init!.body as string).secret, 'secret'); return Response.json({ access_token: 'private-access', expires_in: 7200 }); }
    assert.equal(JSON.parse(init!.body as string).code, 'phone-code'); return Response.json({ phone_info: { purePhoneNumber: '13800000001', countryCode: '86', watermark: { appid: watermark } } });
  });
  assert.deepEqual(await gateway.wechat({ loginCode: 'login-code', phoneCode: 'phone-code' }), { openId: 'verified-openid', mobile: '13800000001' });
  watermark = 'wrong-app'; await assert.rejects(gateway.wechat({ loginCode: 'login-code', phoneCode: 'phone-code' })); assert.equal(tokenCalls, 1);
});
test('real database SMS claim serializes throttling, blocks guessing and consumes once', async () => {
  assert.ok(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test'));
  const db = new Db({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const mobile = '13800000991'; await db.smsChallenge.deleteMany({ where: { mobile } });
  let captured = '', sends = 0;
  const gateway = new RealIdentityGateway(db, settings, fetch, async (number, code) => { assert.equal(number, mobile); captured = code; sends++; });
  try {
    const results = await Promise.allSettled([gateway.requestSms(mobile), gateway.requestSms(mobile)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends, 1);
    const row = await db.smsChallenge.findFirstOrThrow({ where: { mobile } }); assert.notEqual(row.codeHash, captured); assert.equal(row.codeHash, createHmac('sha256', settings.smsHashSecret).update(`${row.id}:${captured}`).digest('hex'));
    await assert.rejects(gateway.verifySms({ mobile, code: captured === '000000' ? '000001' : '000000' }));
    assert.equal((await db.smsChallenge.findUniqueOrThrow({ where: { id: row.id } })).attempts, 1);
    const verifies = await Promise.allSettled([gateway.verifySms({ mobile, code: captured }), gateway.verifySms({ mobile, code: captured })]); assert.equal(verifies.filter(r => r.status === 'fulfilled').length, 1);
    await db.smsChallenge.update({ where: { id: row.id }, data: { status: 'SENT', consumedAt: null, attempts: 5 } }); await assert.rejects(gateway.verifySms({ mobile, code: captured }));
  } finally { await db.smsChallenge.deleteMany({ where: { mobile } }); await db.$disconnect(); }
});
