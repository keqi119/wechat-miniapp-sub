import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {Db} from '../src/common/db';
import {hash,audit,notify} from '../src/common/data';
import {ensure} from '../src/common/errors';
import {requireCurrentStaff} from '../src/auth/staff-session';
import {lockOrder,requireContractReady} from '../src/offline-documents/readiness';
import {readDelayPaymentGuard} from '../src/order-changes/finance';
import {BillingService} from '../src/billing/billing';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';
const require=createRequire(import.meta.url),{createOneCentBill}=require('../../../scripts/ninda/order-one-cent-bill.cjs');
const deps={ensure,hash,requireCurrentStaff,lockOrder,requireContractReady,readDelayPaymentGuard,audit,notify};
let db:Db;before(()=>{db=new Db();});after(()=>db.$disconnect());
async function setup(ready=true){const f=await offlineOrder(db);if(ready)await approvedOfflineArchive(db,f.order.id);const actor=await db.adminUser.create({data:{username:randomUUID(),name:'合成管理员',role:'ADMIN',passwordHash:'synthetic-disabled-password'}});const order=await db.order.findUniqueOrThrow({where:{id:f.order.id}});return{...f,actor,scope:{orderId:order.id,customerId:order.customerId,revision:order.revision,orderHash:hash(order),idempotencyKey:randomUUID(),authorizationReference:'合成测试授权：仅1张1分钱账单，无真实渠道'}};}
const now=new Date('2026-10-29T10:00:00Z');
test('exactly one one-cent pending bill is appended atomically without changing the signed order or original rent',async()=>{
 const f=await setup(),before=await db.order.findUniqueOrThrow({where:{id:f.order.id}}),original=await db.bill.findUniqueOrThrow({where:{id:f.bill.id}});
 const results=await Promise.all([createOneCentBill(db,f.actor,f.scope,now,deps),createOneCentBill(db,f.actor,f.scope,now,deps)]);
 assert.equal(results.filter(r=>r.created).length,1);const bill=results[0].bill;assert.equal(bill.amount,1);assert.equal(bill.status,'PENDING');assert.equal(bill.type,'PAYMENT_TEST');assert.equal(bill.customerId,f.customer.id);assert.equal(bill.dueDate.toISOString().slice(0,10),'2026-10-29');assert.equal(bill.reviewedBy,null);
 assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);assert.deepEqual(await db.bill.findUniqueOrThrow({where:{id:f.bill.id}}),original);
 assert.equal(await db.auditLog.count({where:{resourceId:bill.id,action:'CREATE_AUTHORIZED_PAYMENT_TEST'}}),1);assert.equal(await db.notification.count({where:{resourceId:bill.id}}),1);assert.equal(await db.payment.count({where:{billId:bill.id}}),0);
});
test('scope, current role, version and archive checks cannot be skipped',async()=>{
 const f=await setup();
 for(const [actor,scope] of [[{...f.actor,role:'OPERATIONS'},f.scope],[f.actor,{...f.scope,customerId:'other'}],[f.actor,{...f.scope,revision:99}],[f.actor,{...f.scope,orderHash:'b'.repeat(64)}]])await assert.rejects(createOneCentBill(db,actor,scope,now,deps));
 await db.adminUser.update({where:{id:f.actor.id},data:{active:false}});await assert.rejects(createOneCentBill(db,f.actor,f.scope,now,deps));
 const g=await setup();await db.documentArchive.updateMany({where:{orderId:g.order.id},data:{currentApprovedVersionId:null}});await assert.rejects(createOneCentBill(db,g.actor,g.scope,now,deps));assert.equal(await db.bill.count({where:{orderId:g.order.id,type:'PAYMENT_TEST'}}),0);
});
test('notification failure rolls back the bill and audit, and a new key cannot create a second test bill',async()=>{
 const f=await setup();await assert.rejects(createOneCentBill(db,f.actor,f.scope,now,{...deps,notify:async()=>{throw Error('synthetic notification failure');}}));assert.equal(await db.bill.count({where:{orderId:f.order.id,type:'PAYMENT_TEST'}}),0);
 await createOneCentBill(db,f.actor,f.scope,now,deps);await assert.rejects(createOneCentBill(db,f.actor,{...f.scope,idempotencyKey:randomUUID()},now,deps));
});
test('the existing payment path accepts exactly one cent, enforces ownership and does not satisfy original first rent or create partner revenue',async()=>{
 const f=await setup(),result=await createOneCentBill(db,f.actor,f.scope,now,deps);let requests:any[]=[];
 const service=new BillingService(db,{create:async(input:any)=>{requests.push(input);return{timeStamp:String(Math.floor(Date.now()/1000)),nonceStr:'synthetic',package:'prepay_id=synthetic',signType:'RSA',paySign:'synthetic'};}} as any);
 await assert.rejects(service.pay({...f.customer,id:'another-customer'},result.bill.id,randomUUID()));assert.equal(requests.length,0);
 const payment=await service.pay(f.customer,result.bill.id,randomUUID());assert.equal(requests.length,1);assert.equal(requests[0].amount,1);
 await service.settle(payment.paymentId,{status:'SUCCEEDED',amount:1,transactionId:randomUUID(),succeededAt:new Date().toISOString()});
 assert.equal((await db.bill.findUniqueOrThrow({where:{id:result.bill.id}})).status,'PAID');assert.equal((await db.bill.findUniqueOrThrow({where:{id:f.bill.id}})).paidAmount,0);assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'AWAITING_PAYMENT');
 assert.equal(await db.partnerRevenueEvent.count({where:{paymentId:payment.paymentId}}),0);assert.equal(await db.depositEntry.count({where:{paymentId:payment.paymentId}}),0);assert.equal(await db.mileagePurchase.count({where:{billId:result.bill.id}}),0);assert.equal(await db.swapCreditPurchase.count({where:{billId:result.bill.id}}),0);
});
