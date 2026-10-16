import {listenForHttpTests} from './http-listener';
import { seedUsageLegal } from './usage-fixtures';
import '../src/common/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { Db } from '../src/common/db';
import { passwordHash } from '../src/auth/auth.service';
import { IdentityGateway } from '../src/common/gateways';
import { BillingService } from '../src/billing/billing';
import { tokenHash } from '../src/auth/auth.service';
import { SignatureService } from '../src/orders/signature.service';
let app: any, db: Db, base: string, cookie: string, csrf: string, customerToken: string, otherToken: string, customerId: string, otherId: string;
let vehicle: any, plan: any, doc: any, application: any, final: any, order: any;
const origin = 'http://localhost:3100';
const key = 'integration-request-0001';
async function req(path: string, method = 'GET', body?: any, identity: 'admin' | 'customer' | 'other' | 'none' = 'admin', extra: any = {}) {
  const headers: any = { 'Content-Type': 'application/json', Origin: origin, ...extra };
  if (identity === 'admin') { headers.Cookie = cookie; headers['X-CSRF-Token'] = csrf; }
  if (identity === 'customer' || identity === 'other') headers.Authorization = `Bearer ${identity === 'customer' ? customerToken : otherToken}`;
  const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json() as any;
  return { status: response.status, data, headers: response.headers };
}
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test'), 'test must use independent test database');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.ADMIN_ORIGIN = origin;
  db = new Db();
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  for (const { tablename } of tables) await db.$executeRawUnsafe(`TRUNCATE TABLE "${tablename.replaceAll('"', '""')}" CASCADE`);
  await seedUsageLegal(db);
  await db.adminUser.create({ data: { username: 'integration-admin', name: 'Test Admin', role: 'ADMIN', passwordHash: passwordHash('Strong-Test-Password-2026') } });
  app = await createApp({ db, identity: { wechat: async ({ loginCode }: any) => ({ mobile: loginCode === 'second' ? '13900000002' : '13900000001', openId: loginCode }), requestSms: async () => {}, verifySms: async () => ({ mobile: '13900000001' }) } as IdentityGateway });
  base = await listenForHttpTests(app);
  const login = await req('/admin/auth/login', 'POST', { username: 'integration-admin', password: 'Strong-Test-Password-2026' }, 'none');
  assert.equal(login.status, 201);
  cookie = login.headers.get('set-cookie')!.split(';')[0]; csrf = login.data.csrfToken;
  const consents = []; for (const type of ['terms','privacy']) { const d = await db.legalDocument.create({data:{type,version:1,title:type,content:'测试协议',status:'PUBLISHED',confirmedBy:'test',confirmedAt:new Date()}}); consents.push({documentId:d.id,version:d.version}); }
  const c = await req('/customer/auth/wechat', 'POST', { loginCode: 'first', phoneCode: 'valid', consents }, 'none');
  customerToken = c.data.token; customerId = c.data.customer.id;
  const c2 = await req('/customer/auth/wechat', 'POST', { loginCode: 'second', phoneCode: 'valid', consents }, 'none');
  otherToken = c2.data.token; otherId = c2.data.customer.id;
});
after(async () => { if (app) await app.close(); if (db) await db.$disconnect(); });
test('security: missing/expired sessions fail and CSRF Origin are enforced', async () => {
  assert.equal((await req('/admin/dashboard', 'GET', undefined, 'none')).status, 401);
  assert.equal((await req('/customer/context', 'GET', undefined, 'none')).status, 401);
  assert.equal((await req('/admin/vehicles', 'POST', {}, 'admin', { Origin: 'https://attacker.invalid' })).status, 403);
  const oldCsrf = csrf; csrf = 'bad'; assert.equal((await req('/admin/vehicles', 'POST', {})).status, 403); csrf = oldCsrf;
  const support = await db.adminUser.create({ data: { username: 'support', name: 'Support', role: 'SUPPORT', passwordHash: passwordHash('Support-Test-Password') } });
  const l = await req('/admin/auth/login', 'POST', { username: support.username, password: 'Support-Test-Password' }, 'none');
  const response = await fetch(`${base}/api/admin/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: l.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': l.data.csrfToken }, body: '{}' });
  assert.equal(response.status, 403);
  const logout = await fetch(`${base}/api/admin/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: l.headers.get('set-cookie')!.split(';')[0], 'X-CSRF-Token': l.data.csrfToken }, body: '{}' });
  assert.equal(logout.status, 201);
});
test('catalogue validates integer fees and preserves published vehicle view', async () => {
  const v = await req('/admin/vehicles', 'POST', { brand: '测试', model: 'E1', title: '测试纯电', year: 2026, city: '上海', mileageKm: 100, conditionDisclosure: '新库合成测试车况' });
  assert.equal(v.status, 201); vehicle = v.data;
  const payload = { vehicleId: vehicle.id, name: '12月', months: 12, monthlyFeeAmount: 300000, mileagePerMonthKm: 1500, excessMileagePriceAmount: 100, energyDescription: '自费充电', benefits: ['救援入口'], conditions: '测试条件' };
  assert.equal((await req('/admin/plans', 'POST', { ...payload, monthlyFeeAmount: 1.5 })).status, 400);
  plan = (await req('/admin/plans', 'POST', payload)).data;
  assert.equal((await req(`/admin/plans/${plan.id}/activate`, 'POST', {})).status, 201);
  assert.equal((await req(`/admin/vehicles/${vehicle.id}/publish`, 'POST', {})).status, 201);
  const view = await req(`/public/vehicles/${vehicle.id}`, 'GET', undefined, 'none');
  assert.equal(view.data.vehicle.minFeeAmount, 300000); assert.equal(view.data.plans[0].termMonths, 12);
  doc = await db.legalDocument.create({ data: { type: 'application', version: 1, title: '测试协议', content: '仅测试', status: 'PUBLISHED', confirmedBy: 'test-fixture', confirmedAt: new Date(), publishedAt: new Date() } });
});
test('application idempotency and ownership: repeated submit is one record, different payload conflicts', async () => {
  const payload = { vehicleId: vehicle.id, subscriptionPlanId: plan.id, profile: { name: '测试客户', drivingYears: 2 }, consents: [{ documentId: doc.id, version: 1 }], idempotencyKey: key };
  const responses = await Promise.all([req('/customer/applications', 'POST', payload, 'customer'), req('/customer/applications', 'POST', payload, 'customer')]);
  assert.equal(responses[0].status, 201); assert.equal(responses[1].status, 201);
  application = responses[0].data; assert.equal(application.id, responses[1].data.id);
  assert.equal(await db.application.count({ where: { customerId } }), 1);
  assert.equal((await req('/customer/applications', 'POST', { ...payload, profile: { name: 'different', drivingYears: 2 } }, 'customer')).status, 409);
  assert.equal((await req(`/customer/applications/${application.id}`, 'GET', undefined, 'other')).status, 404);
  assert.equal((await req(`/customer/applications/${application.id}/cancel`, 'POST', {}, 'other')).status, 404);
});
test('final plan optimistic revisions and concurrent confirmation allocate one vehicle atomically', async () => {
  const creditDoc=await db.legalDocument.create({data:{type:'credit-verification',version:1,title:'测试人工信用授权',content:'合成测试',status:'PUBLISHED',confirmedBy:'fixture',confirmedAt:new Date()}});
  async function authorizeCredit(applicationId:string,who:'customer'|'other') {
    const consent=await req(`/customer/applications/${applicationId}/credit-consent`,'POST',{documentId:creditDoc.id,version:creditDoc.version,decision:'ACCEPT',idempotencyKey:'credit-consent-test-0001'},who);
    assert.equal(consent.status,201);
    const verified=await req(`/admin/applications/${applicationId}/credit-verifications`,'POST',{consentId:consent.data.consent.id,creditRevision:consent.data.creditRevision,band:'B700_749',customerPresented:true,idempotencyKey:'credit-verify-test-0001'});
    assert.equal(verified.status,201); return verified.data.verification.id;
  }
  const commercialTerms = Object.fromEntries(['vehicleIdentification','permittedUse','conditionDisclosure','customerAddress','mileageCarryRule','excessMileageCalculation','usageCosts','insuranceDetails','maintenanceRule','serviceCoverage','handoverArrangement','earlyTerminationRule','depositRefundRule','otherFees'].map(key => [key, '测试明确条款：' + key]));
  const p = { creditVerificationId:await authorizeCredit(application.id,'customer'), commercialTerms, revision: 0, monthlyFeeAmount: 300000, depositAmount: 300000, months: 12, mileagePerMonthKm: 1500, excessMileagePriceAmount: 150, energyDescription: '自费', benefits: ['救援'], conditions: '测试', startDate: '2026-12-31', firstDueDate: '2026-12-31' };
  assert.equal((await req(`/admin/applications/${application.id}/review`, 'POST', { decision: 'IN_REVIEW', note: '审核' })).status, 201);
  const f = await req(`/admin/applications/${application.id}/final-plan`, 'POST', p); assert.equal(f.status, 201); final = f.data.finalPlan;
  assert.equal((await req(`/admin/applications/${application.id}/final-plan`, 'POST', p)).status, 409);
  assert.equal((await req(`/customer/applications/${application.id}/confirm`, 'POST', { revision: 0, commercialHash: final.commercialHash }, 'customer')).status, 409);
  const otherApplication = (await req('/customer/applications', 'POST', { vehicleId: vehicle.id, subscriptionPlanId: plan.id, profile: { name: '另一客户' }, consents: [{ documentId: doc.id, version: 1 }], idempotencyKey: key }, 'other')).data;
  await req(`/admin/applications/${otherApplication.id}/review`, 'POST', { decision: 'IN_REVIEW', note: '审核' });
  const otherFinal = (await req(`/admin/applications/${otherApplication.id}/final-plan`, 'POST', {...p,creditVerificationId:await authorizeCredit(otherApplication.id,'other')})).data.finalPlan;
  const results = await Promise.all([req(`/customer/applications/${application.id}/confirm`, 'POST', { revision: final.revision, commercialHash: final.commercialHash }, 'customer'), req(`/customer/applications/${otherApplication.id}/confirm`, 'POST', { revision: otherFinal.revision, commercialHash: otherFinal.commercialHash }, 'other')]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await db.order.count(), 1); assert.equal(await db.contract.count(), 1); assert.equal(await db.bill.count(), 13);
  order = await db.order.findFirstOrThrow();
  assert.deepEqual(order.finalPlanSnapshot.commercialTerms, commercialTerms);
  const winnerToken = order.customerId === customerId ? 'customer' : 'other';
  const winnerApp = order.customerId === customerId ? application : otherApplication;
  const winnerFinal = order.customerId === customerId ? final : otherFinal;
  assert.equal((await req(`/customer/applications/${winnerApp.id}/confirm`, 'POST', { revision: winnerFinal.revision, commercialHash: winnerFinal.commercialHash }, winnerToken)).data.id, order.id);
  const loser = await db.application.findFirstOrThrow({ where: { id: { not: winnerApp.id } } }); assert.equal(loser.status, 'AWAITING_CONFIRMATION');
  const dates = await db.bill.findMany({ where: { type: 'SUBSCRIPTION' }, orderBy: { sequence: 'asc' } });
  assert.deepEqual(dates.slice(0,3).map(d => d.dueDate.toISOString().slice(0, 10)), ['2026-12-31', '2027-01-31', '2027-02-28']);
});
test('legacy signing is closed and unconfigured payment never succeeds; handover requires signature and funds', async () => {
  const identity = order.customerId === customerId ? 'customer' : 'other';
  const contract = await db.contract.findFirstOrThrow();
  const legacySigning=await req(`/customer/contracts/${contract.id}/sign`, 'POST', {}, identity);
  assert.equal(legacySigning.status,503);assert.equal(legacySigning.data.error.code,'MINIAPP_SIGNING_UNAVAILABLE');
  const bill = await db.bill.findFirstOrThrow(); await req(`/admin/bills/${bill.id}/publish`, 'POST', {});
  assert.equal((await req(`/customer/bills/${bill.id}/pay`, 'POST', { idempotencyKey: 'payment-test-0001' }, identity)).status, 503);
  assert.equal((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).paidAmount, 0);
  await db.order.update({where:{id:order.id},data:{status:'AWAITING_HANDOVER'}});
  const h = await req('/admin/handovers', 'POST', { orderId: order.id, type: 'DELIVERY', actualAt:new Date().toISOString(), readingKm: 100, fileIds: [], checklist: [{ label: '车况', value: '已检查' }] });
  assert.equal(h.status, 201);
  await req(`/admin/handovers/${h.data.id}/publish`, 'POST', {});
  assert.equal((await req(`/customer/handovers/${h.data.id}/confirm`, 'POST', { manifestHash: 'wrong', readFileIds: [], idempotencyKey: 'handover-confirm-0001' }, identity)).status, 409);
  assert.equal((await req(`/customer/handovers/${h.data.id}/confirm`, 'POST', { manifestHash: h.data.manifestHash, readFileIds: [], idempotencyKey: 'handover-confirm-0001' }, identity)).status, 201);
  assert.equal((await req(`/admin/handovers/${h.data.id}/complete`, 'POST', {})).status, 409);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'AWAITING_HANDOVER');
});
test('payment and refund settlement reject mismatches and replay without duplicate deposits', async () => {
  const billing = app.get(BillingService) as BillingService;
  const deposit = await db.bill.findFirstOrThrow({ where: { orderId: order.id, type: 'DEPOSIT' } });
  await db.bill.update({ where: { id: deposit.id }, data: { status: 'PENDING' } });
  const payment = await db.payment.create({ data: { customerId: order.customerId, billId: deposit.id, amount: 300000, idempotencyKey: 'settle-deposit-0001', status: 'PENDING' } });
  await assert.rejects(() => billing.settle(payment.id, { status: 'SUCCEEDED', amount: 499999, transactionId: 'test-provider-txn' }));
  assert.equal((await db.bill.findUniqueOrThrow({ where: { id: deposit.id } })).paidAmount, 0);
  await Promise.all([billing.settle(payment.id, { status: 'SUCCEEDED', amount: 300000, transactionId: 'test-provider-txn' }), billing.settle(payment.id, { status: 'SUCCEEDED', amount: 300000, transactionId: 'test-provider-txn' })]);
  assert.equal(await db.depositEntry.count({ where: { paymentId: payment.id, type: 'RECEIPT' } }), 1);
  assert.equal((await db.bill.findUniqueOrThrow({ where: { id: deposit.id } })).paidAmount, 300000);
  const refund = await db.refund.create({ data: { customerId: order.customerId, paymentId: payment.id, amount: 10000, reason: '测试退款', status: 'PROCESSING', requestedBy: 'test-requester', approvedBy: 'test-approver' } });
  const event = { status: 'SUCCEEDED' as const, providerRefundId: 'test-provider-refund', paymentId: payment.id, amount: 10000, totalAmount: 300000 };
  await assert.rejects(() => billing.settleRefund(refund.id, { ...event, amount: 10001 }));
  assert.equal(await db.depositEntry.count({ where: { refundId: refund.id } }), 0);
  await Promise.all([billing.settleRefund(refund.id, event), billing.settleRefund(refund.id, event)]);
  assert.equal(await db.depositEntry.count({ where: { refundId: refund.id, type: 'REFUND' } }), 1);
});
test('file bytes enforce ownership, mileage submission awaits review, service cancellation follows state', async () => {
  const identity = order.customerId === customerId ? 'customer' : 'other'; const nonowner = identity === 'customer' ? 'other' : 'customer';
  const form = new FormData(); const bytes = Buffer.from([137,80,78,71,13,10,26,10,0]); form.append('file', new Blob([bytes], { type: 'image/png' }), 'meter.png'); form.append('purpose', 'mileage');
  const uploaded = await fetch(`${base}/api/customer/files`, { method: 'POST', headers: { Authorization: `Bearer ${identity === 'customer' ? customerToken : otherToken}` }, body: form });
  assert.equal(uploaded.status, 201); const file: any = await uploaded.json();
  const read = await fetch(`${base}/api/customer/files/${file.id}`, { headers: { Authorization: `Bearer ${identity === 'customer' ? customerToken : otherToken}` } });
  assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
  assert.equal((await req(`/customer/files/${file.id}`, 'GET', undefined, nonowner)).status, 404);
  await db.order.update({ where: { id: order.id }, data: { status: 'ACTIVE' } });
  await db.vehicle.update({where:{id:order.vehicleId},data:{status:'IN_USE'}});
  const dashboard = await req('/customer/dashboard', 'GET', undefined, identity);
  assert.ok(Object.hasOwn(dashboard.data, 'bill'));
  assert.ok(Object.hasOwn(dashboard.data.subscription, 'nextDueDate'));
  const h = await db.handover.findFirstOrThrow({ where: { orderId: order.id } });
  assert.ok(Array.isArray((await req(`/customer/handovers/${h.id}`, 'GET', undefined, identity)).data.evidence));
  const mileage = await req('/customer/mileages', 'POST', { orderId: order.id, readingKm: 1234, recordedAt: new Date().toISOString(), fileIds: [file.id], idempotencyKey: 'mileage-test-0001' }, identity);
  assert.equal(mileage.status, 201); assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmedMileageKm, 100);
  assert.equal((await req(`/admin/mileages/${mileage.data.id}/review`, 'POST', { decision: 'APPROVED', note: '照片核对' })).status, 201);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).confirmedMileageKm, 1234);
  assert.equal((await req(`/admin/mileages/${mileage.data.id}/review`, 'POST', { decision: 'APPROVED', note: '重复' })).status, 409);
  const body = { type: 'rescue', location: '上海测试点', description: '轮胎异常测试', mobile: '13900000001', fileIds: [file.id], idempotencyKey: 'service-test-0001' };
  const service = await req('/customer/services', 'POST', body, identity); assert.equal(service.status, 201);
  assert.equal((await req('/customer/services', 'POST', body, identity)).data.id, service.data.id);
  assert.equal((await req(`/admin/services/${service.data.id}/assign`, 'POST', { providerName: '测试服务商', contact: '测试联络', note: '测试派单' })).status, 201);
  assert.equal((await req(`/customer/services/${service.data.id}/cancel`, 'POST', {}, identity)).status, 409);
  assert.equal((await req(`/customer/records/services/${service.data.id}`, 'GET', undefined, nonowner)).status, 404);
  const notification = await db.notification.findFirstOrThrow({ where: { customerId: order.customerId } });
  assert.equal((await req(`/customer/notifications/${notification.id}/read`, 'POST', {}, nonowner)).status, 404);
  assert.equal((await req(`/customer/notifications/${notification.id}/read`, 'POST', {}, identity)).status, 201);
  assert.ok((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt);
});
test('expired customer sessions are rejected even when token was previously valid', async () => {
  await db.customerSession.update({ where: { id: tokenHash(customerToken) }, data: { expiresAt: new Date(0) } });
  assert.equal((await req('/customer/context', 'GET', undefined, 'customer')).status, 401);
});
test('signature result checks document hash, task ownership and archived bytes, and never completes handover', async () => {
  const signatures = app.get(SignatureService) as SignatureService;
  const handover = await db.handover.findFirstOrThrow({ where: { orderId: order.id } });
  await db.handover.update({ where: { id: handover.id }, data: { providerTaskId: 'test-handover-task', signatureStatus: 'PENDING' } });
  await assert.rejects(() => signatures.settleHandover(handover.id, { status: 'SIGNED', documentHash: 'wrong', taskId: 'test-handover-task' }));
  await assert.rejects(() => signatures.settleHandover(handover.id, { status: 'SIGNED', documentHash: handover.manifestHash, taskId: 'test-handover-task' }));
  assert.equal((await db.handover.findUniqueOrThrow({ where: { id: handover.id } })).signatureStatus, 'PENDING');
  const file = await db.storedFile.findFirstOrThrow({ where: { customerId: order.customerId } });
  const event = { status: 'SIGNED' as const, documentHash: handover.manifestHash, taskId: 'test-handover-task', signedFileId: file.id };
  await assert.rejects(() => signatures.settleHandover(handover.id, { ...event, taskId: 'other-task' }));
  await signatures.settleHandover(handover.id, event); await signatures.settleHandover(handover.id, event);
  const current = await db.handover.findUniqueOrThrow({ where: { id: handover.id } });
  assert.equal(current.signatureStatus, 'SIGNED'); assert.equal(current.status, 'CUSTOMER_CONFIRMED'); assert.equal(current.completedAt, null);
});

test('assembled Fadada routes remain authenticated except exact verified POST callbacks', async () => {
  assert.equal((await req('/customer/esign/readiness','GET',undefined,'none')).status,401);
  const current = await db.customerSession.findFirst({where:{customerId:otherId}});
  if(current) await db.customerSession.update({where:{id:current.id},data:{expiresAt:new Date(Date.now()+60000)}});
  const ready=await req('/customer/esign/readiness','GET',undefined,'other');assert.equal(ready.status,200);assert.equal(ready.data.readyForSigning,false);
  for(const path of ['/callbacks/fadada-sign','/callbacks/fadada-identity']) {
    assert.equal((await req(path,'GET',undefined,'none')).status,404);
    const invalid=await req(path,'POST',{},'none');assert.notEqual(invalid.status,201);assert.notEqual(invalid.status,200);assert.notEqual(invalid.status,403);
    assert.equal((await req(path+'/','POST',{},'none')).status,403);
  }
});

test('published fee evidence is readable only by billed customer', async()=>{
 for(const id of [customerId,otherId]) await db.customerSession.updateMany({where:{customerId:id},data:{expiresAt:new Date(Date.now()+60000)}});
 const identity=order.customerId===customerId?'customer':'other';const nonowner=identity==='customer'?'other':'customer';
 const form=new FormData();const bytes=Buffer.from('%PDF-test evidence');form.append('file',new Blob([bytes],{type:'application/pdf'}),'fee-evidence.pdf');form.append('purpose','evidence');
 const upload=await fetch(base+'/api/admin/files',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf},body:form});assert.equal(upload.status,201);const file:any=await upload.json();
 const bill=await db.bill.create({data:{orderId:order.id,customerId:order.customerId,type:'EXTRA_FEE',sequence:1,amount:100,dueDate:new Date(),evidenceFileIds:[file.id],status:'DRAFT'}});
 assert.equal((await req('/customer/files/'+file.id,'GET',undefined,identity)).status,404);
 await db.bill.update({where:{id:bill.id},data:{status:'PENDING'}});
 const response=await fetch(base+'/api/customer/files/'+file.id,{headers:{Authorization:'Bearer '+(identity==='customer'?customerToken:otherToken)}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await req('/customer/files/'+file.id,'GET',undefined,nonowner)).status,404);
 const record=await req('/customer/records/bills/'+bill.id,'GET',undefined,identity);assert.ok(record.data.documents.some((d:any)=>d.id===file.id));
});
