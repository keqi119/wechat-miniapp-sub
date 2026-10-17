import '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/common/db';
import { createApp } from '../src/app';
import { tokenHash } from '../src/auth/auth.service';
import { hash } from '../src/common/data';
import { listenForHttpTests } from './http-listener';
import { locationInput, locationCapabilities, resolveLocation } from '../src/applications/handover-location';

let db: Db, server: any, base: string, bindings: any, docs: any[];
const originalPolicy = process.env.HANDOVER_LOCATION_POLICY_JSON, originalMap = process.env.HANDOVER_LOCATION_MAP_ENABLED;
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test')); process.env.NODE_ENV = 'test';
  db = new Db({ datasourceUrl: process.env.TEST_DATABASE_URL }); docs = [];
  for (const type of ['terms', 'privacy', 'application', 'handover-location']) {
    const max = await db.legalDocument.aggregate({ where: { type }, _max: { version: true } });
    docs.push(await db.legalDocument.create({ data: { type, version: (max._max.version || 0) + 1, title: type, content: '合成选址测试文案 ' + type, status: 'PUBLISHED', confirmedBy: 'fixture', confirmedAt: new Date() } }));
  }
  bindings = Object.fromEntries(docs.filter(d => d.type !== 'terms').map(d => [d.type, { documentId: d.id, version: d.version, contentHash: hash(d.content) }]));
  process.env.HANDOVER_LOCATION_POLICY_JSON = JSON.stringify(bindings); process.env.HANDOVER_LOCATION_MAP_ENABLED = 'true';
  server = await createApp({ db }); base = await listenForHttpTests(server);
});
after(async () => { if(originalPolicy === undefined) delete process.env.HANDOVER_LOCATION_POLICY_JSON; else process.env.HANDOVER_LOCATION_POLICY_JSON = originalPolicy; if(originalMap === undefined) delete process.env.HANDOVER_LOCATION_MAP_ENABLED; else process.env.HANDOVER_LOCATION_MAP_ENABLED = originalMap; await server?.close(); await db?.$disconnect(); });
async function request(path: string, body?: any, token?: string) {
  const r = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() as any };
}
async function fixture() {
  const token = randomUUID(), c = await db.customer.create({ data: { mobile: token, name: '合成测试' } });
  await db.customerSession.create({ data: { id: tokenHash(token), customerId: c.id, expiresAt: new Date(Date.now() + 3600000) } });
  for(const doc of docs.filter(d => ['privacy','terms'].includes(d.type))) await db.customerConsent.create({data:{customerId:c.id,documentId:doc.id,type:doc.type,version:doc.version,source:'TEST'}});
  const v = await db.vehicle.create({ data: { brand: '测试', model: 'T', title: '合成车辆', year: 2026, city: '上海', mileageKm: 1, status: 'PUBLISHED' } });
  const p = await db.subscriptionPlan.create({ data: { vehicleId: v.id, name: '合成套餐', months: 12, monthlyFeeAmount: 100, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '自费', benefits: [], conditions: '测试', active: true } });
  return { token, customerId: c.id, body: { vehicleId: v.id, subscriptionPlanId: p.id, profile: { name: '合成测试' } as any, consents: docs.filter(d => d.type === 'application').map(d => ({ documentId: d.id, version: d.version })), idempotencyKey: randomUUID() } };
}
const manual = { source: 'MANUAL', name: '测试交接点', address: '上海测试路100号入口' };
const code = (expected: string) => (e: any) => e.getResponse?.().error?.code === expected;

test('capability defaults closed, pins all published document identities and hashes, and isolates map switch', async () => {
  delete process.env.HANDOVER_LOCATION_POLICY_JSON; assert.equal((await locationCapabilities(db)).enabled, false);
  process.env.HANDOVER_LOCATION_POLICY_JSON = JSON.stringify(bindings);
  process.env.HANDOVER_LOCATION_MAP_ENABLED = 'false'; const cap = await locationCapabilities(db); assert.equal(cap.enabled, true); assert.equal(cap.mapEnabled, false); assert.equal(cap.notice.id, bindings['handover-location'].documentId);
  assert.equal((await request('/public/handover-location')).data.policyHash, cap.policyHash);
  const doc = docs.find(d => d.type === 'application'); await db.legalDocument.update({where:{id:doc.id},data:{content:'变更未同步'}});
  assert.equal((await locationCapabilities(db)).enabled,false);
  await db.legalDocument.update({where:{id:doc.id},data:{content:doc.content}});
  process.env.HANDOVER_LOCATION_MAP_ENABLED = 'true';
});
test('strict location schema rejects coordinates, forged snapshots and nested extra fields', () => {
  assert.equal(locationInput.safeParse(manual).success,true);
  for (const extra of [{latitude:31},{longitude:121},{coordinates:[1,2]},{consentedAt:'spoof'},{notice:{id:'spoof'}},{source:'GPS'}]) assert.equal(locationInput.safeParse({...manual,...extra}).success,false);
});
test('manual needs no map consent, omission preserves old value, null clears, map needs current explicit consent', async () => {
  process.env.HANDOVER_LOCATION_MAP_ENABLED = 'false'; assert.deepEqual(await resolveLocation(db,manual,'test'),manual);
  assert.deepEqual(await resolveLocation(db,undefined,'test',manual),manual); assert.equal(await resolveLocation(db,null,'test',manual),null);
  const cap=await locationCapabilities(db), selected={...manual,source:'MAP',accepted:true,policyHash:cap.policyHash};
  await assert.rejects(resolveLocation(db,selected,'test'),code('LOCATION_MAP_DISABLED'));
  process.env.HANDOVER_LOCATION_MAP_ENABLED='true';
  await assert.rejects(resolveLocation(db,{...selected,policyHash:'0'.repeat(64)},'test'),code('LOCATION_POLICY_CHANGED'));
  await assert.rejects(resolveLocation(db,{...selected,accepted:false},'test'));
  const saved=await resolveLocation(db,selected,'test'); assert.equal(saved.source,'MAP'); assert.equal(saved.consent.documentId,cap.notice.id); assert.equal(saved.consent.version,cap.notice.version); assert.equal(saved.consent.contentHash,hash(cap.notice.content)); assert.equal(saved.consent.policyHash,cap.policyHash); assert.ok(saved.consent.acceptedAt); assert.equal(saved.consent.customerId,'test');
});
test('HTTP submit persists only approved text with per-application consent; retries are idempotent',async()=>{
  const f=await fixture(),cap=await locationCapabilities(db); f.body.profile.handoverLocation={...manual,source:'MAP',accepted:true,policyHash:cap.policyHash};
  const r=await request('/customer/applications',f.body,f.token); assert.equal(r.status,201,JSON.stringify(r.data));
  assert.equal(r.data.profile.handoverLocation.consent.customerId,f.customerId); assert.equal(r.data.profile.handoverLocation.address,manual.address);
  process.env.HANDOVER_LOCATION_MAP_ENABLED='false';const replay=await request('/customer/applications',f.body,f.token);assert.equal(replay.data.id,r.data.id);process.env.HANDOVER_LOCATION_MAP_ENABLED='true';
  const other=await fixture();assert.equal((await request('/customer/applications/'+r.data.id,undefined,other.token)).status,404);
  const bad=await fixture();bad.body.profile={name:'测试',handoverLocation:{...manual,latitude:31}};assert.equal((await request('/customer/applications',bad.body,bad.token)).status,400);
  bad.body.profile={name:'测试',latitude:31};assert.equal((await request('/customer/applications',bad.body,bad.token)).status,400);
});
test('HTTP amendment keeps omitted location, clears explicit null, requires current status and ownership',async()=>{
  const f=await fixture();f.body.profile.handoverLocation=manual;const created=await request('/customer/applications',f.body,f.token);assert.equal(created.status,201);
  const id=created.data.id, payload={profile:{name:'测试补件',drivingYears:2,fileIds:[]},idempotencyKey:randomUUID()};
  assert.equal((await request(`/customer/applications/${id}/amend`,payload,f.token)).status,409);
  await db.application.update({where:{id},data:{status:'NEEDS_INFO'}});
  const other=await fixture();assert.equal((await request(`/customer/applications/${id}/amend`,payload,other.token)).status,404);
  const amended=await request(`/customer/applications/${id}/amend`,payload,f.token);assert.deepEqual(amended.data.profile.handoverLocation,manual);
  assert.equal((await request(`/customer/applications/${id}/amend`,payload,f.token)).status,201);
  await db.application.update({where:{id},data:{status:'NEEDS_INFO'}});
  const cleared=await request(`/customer/applications/${id}/amend`,{...payload,profile:{...payload.profile,handoverLocation:null},idempotencyKey:randomUUID()},f.token);assert.equal(cleared.data.profile.handoverLocation,null);
});
test('amendment of a place needs the current privacy consent; withdrawing the place remains available',async()=>{
  const f=await fixture(),created=await request('/customer/applications',f.body,f.token),id=created.data.id;
  await db.application.update({where:{id},data:{status:'NEEDS_INFO'}});
  await db.customerConsent.deleteMany({where:{customerId:f.customerId,type:'privacy'}});
  const body={profile:{name:'测试',handoverLocation:manual},idempotencyKey:randomUUID()};
  assert.equal((await request(`/customer/applications/${id}/amend`,body,f.token)).status,409);
  assert.equal((await request(`/customer/applications/${id}/amend`,{profile:{name:'测试',handoverLocation:null},idempotencyKey:randomUUID()},f.token)).status,201);
});
