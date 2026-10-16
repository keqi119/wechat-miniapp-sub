import '../src/common/config';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { Db } from '../src/common/db';
import { BillingService, BillingController } from '../src/billing/billing';
import { PaymentGateway } from '../src/common/gateways';
let db: Db, customer: any, bill: any, service: BillingService, paymentId: string;
let queryState: any = 'NOT_EXIST', createFails = true, createCount = 0, closeFails = true, refundState = 'NOT_FOUND', refundCount = 0;
let lastCreate: any;
const providerError = (code: string) => new HttpException({ error: { code, message: code } }, 503);
const gateway: PaymentGateway = {
  async create(input) { createCount++; lastCreate = input; if (createFails) throw providerError('PAYMENT_NETWORK_ERROR'); return { timeStamp: String(Math.floor(Date.now()/1000)), nonceStr: 'nonce', package: `prepay_id=retry-${createCount}`, signType: 'RSA', paySign: 'test' }; },
  async query() { if (queryState === 'NOT_EXIST') throw providerError('PAYMENT_ORDER_NOT_EXIST'); return { status: queryState, amount: 12000, ...(queryState === 'SUCCEEDED' ? { transactionId: 'recovery-txn' } : {}) }; },
  async close() { if (closeFails) throw providerError('PAYMENT_NETWORK_ERROR'); },
  async queryRefund() { if (refundState === 'NOT_FOUND') throw providerError('REFUND_NOT_FOUND'); return { status: refundState as 'SUCCEEDED', providerRefundId: `provider-${paymentId}`, paymentId, amount: 1000, totalAmount: 12000 }; },
  async refund() { refundCount++; return { status: 'PROCESSING', providerRefundId: `provider-${paymentId}` }; },
};
before(async () => {
  assert.ok(process.env.TEST_DATABASE_URL?.includes('_test')); db = new Db({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const suffix = Date.now().toString();
  customer = await db.customer.create({ data: { mobile: `test-recovery-${suffix}`, openId: `openid-${suffix}` } });
  const vehicle = await db.vehicle.create({ data: { brand: '测试', model:'测试', title:'恢复测试', year:2026,city:'上海',mileageKm:0 } });
  const plan = await db.subscriptionPlan.create({ data:{ vehicleId:vehicle.id,name:'恢复测试',months:1,monthlyFeeAmount:12000,mileagePerMonthKm:1000,excessMileagePriceAmount:10,energyDescription:'测试',benefits:[],conditions:'测试' } });
  const application = await db.application.create({ data:{ customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:suffix,requestHash:suffix } });
  const order = await db.order.create({ data:{ applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{},confirmedMileageKm:0 } });
  bill = await db.bill.create({ data:{ orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:1,amount:12000,dueDate:new Date(),status:'PENDING' } });
  service = new BillingService(db,gateway);
});
after(async () => { await db?.$disconnect(); });
test('unknown prepay failure recovers same payment and original OpenID after signed NOT_EXIST', async () => {
  await assert.rejects(() => service.pay(customer,bill.id,'recovery-original-key'));
  let payment = await db.payment.findFirstOrThrow({where:{billId:bill.id}}); paymentId = payment.id;
  assert.equal(payment.status,'CREATING');
  await db.payment.update({where:{id:paymentId},data:{updatedAt:new Date(Date.now()-60000)}});
  createFails=false;
  const result = await service.pay({...customer,openId:'rebound-openid'},bill.id,'recovery-another-key');
  assert.equal(result.paymentId,paymentId); assert.equal(lastCreate.openId,customer.openId);
  assert.equal(await db.payment.count({where:{billId:bill.id}}),1);
});
test('expired cached prepay refreshes same payment with one concurrent recovery lease', async () => {
  queryState='PENDING';
  await db.payment.update({where:{id:paymentId},data:{clientParameters:{timeStamp:String(Math.floor(Date.now()/1000)-7500),nonceStr:'old',package:'prepay_id=expired',signType:'RSA',paySign:'old'},updatedAt:new Date(Date.now()-60000)}});
  const results = await Promise.allSettled([service.pay(customer,bill.id,'refresh-key-0001'),service.pay(customer,bill.id,'refresh-key-0002')]);
  const success = results.filter(r=>r.status==='fulfilled'); assert.ok(success.length>=1);
  for(const result of success) { assert.equal(result.value.paymentId,paymentId); assert.notEqual(result.value.package,'prepay_id=expired'); }
  assert.equal(createCount,3); assert.equal(await db.payment.count({where:{billId:bill.id}}),1);
});
test('failed close preserves pending and confirmed close allows next payment',async()=>{
  await assert.rejects(()=>service.close(paymentId,customer.id));
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:paymentId}})).status,'PENDING');
  closeFails=false;
  await service.close(paymentId,customer.id);
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:paymentId}})).status,'CLOSED');
  await service.settle(paymentId,{status:'PENDING',amount:12000});
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:paymentId}})).status,'CLOSED');
  await assert.rejects(()=>service.close(paymentId,'other-customer'));
});
test('refund request replay retains one approval request and rejects changed payload',async()=>{
  await db.payment.update({where:{id:paymentId},data:{status:'SUCCEEDED'}});
  const controller = new BillingController(db,service,gateway);
  const payload = { paymentId,amount:2000,reason:'相同退款申请',idempotencyKey:'refund-request-recovery-01' };
  const request = {admin:{id:`admin-${customer.id}`}};
  const first = await controller.requestRefund(payload,request);
  const repeat = await controller.requestRefund(payload,request);
  assert.equal(first.id,repeat.id);
  assert.equal(await db.refund.count({where:{paymentId,idempotencyKey:payload.idempotencyKey}}),1);
  await assert.rejects(()=>controller.requestRefund({...payload,amount:2001},request));
});
test('approved unknown refund retries same id only after NOT_FOUND and sync settles once',async()=>{
  await db.payment.update({where:{id:paymentId},data:{status:'SUCCEEDED'}});
  const refund=await db.refund.create({data:{paymentId,customerId:customer.id,amount:1000,reason:'恢复测试',requestedBy:'reviewer-a',approvedBy:'reviewer-b',status:'PROCESSING',updatedAt:new Date(Date.now()-60000)}});
  const result=await service.retryRefund(refund.id,'reviewer-b'); assert.equal(result.id,refund.id); assert.equal(refundCount,1);
  refundState='SUCCEEDED'; await service.syncRefund(refund.id); await service.syncRefund(refund.id);
  assert.equal((await db.refund.findUniqueOrThrow({where:{id:refund.id}})).status,'SUCCEEDED'); assert.equal(refundCount,1);
});
