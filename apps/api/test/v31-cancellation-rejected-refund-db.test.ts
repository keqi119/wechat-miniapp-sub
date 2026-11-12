import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {Db} from '../src/common/db';
import {BillingController,BillingService} from '../src/billing/billing';
import {guardCancellation04Delivery,guardCancellation04Refund} from '../src/orders/cancellation04-gates';
import {cancellationFixture} from './v31-cancellation-fixture';

const code=(expected:string)=>(e:any)=>e.getResponse?.().error?.code===expected;
async function rollback(db:Db,work:(tx:any)=>Promise<void>){const sentinel=new Error('rollback probe');await assert.rejects(db.serial(async tx=>{await work(tx);throw sentinel;}),(e:any)=>e===sentinel);}

test('genuinely rejected04 releases ordinary refund request approve and NOT_FOUND retry without losing financial guards',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date()});const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 try{
  const {f,sub,payment,evidence,service,input}=await cancellationFixture(db),personId='maker-'+randomUUID();
  await db.adminUser.update({where:{id:f.actor.id},data:{staffPersonId:personId}});
  const staff=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'合成财务',role:'FINANCE',staffPersonId:personId}}),finance={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  const calls:any[]=[];let queries=0;const gateway={refund:async(args:any)=>{calls.push(args);return{status:'PROCESSING'};},queryRefund:async()=>{queries++;throw new HttpException({error:{code:'REFUND_NOT_FOUND'}},404);}} as any,billing=new BillingService(db,gateway),controller=new BillingController(db,billing,gateway);
  const request=(amount=1000)=>({paymentId:payment.id,amount,reason:'原合同继续履行的普通原路退款',idempotencyKey:randomUUID()});
  const proposed:any=await service.propose(sub.order.id,input,f.actor);
  await assert.rejects(controller.requestRefund(request(),{admin:f.actor}),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
  await rollback(db,async tx=>{await tx.orderPreDeliveryCancellation.update({where:{id:proposed.id},data:{state:'REJECTED'}});await assert.rejects(new BillingController({serial:(fn:any)=>fn(tx)} as any,billing,gateway).requestRefund(request(),{admin:f.actor}),code('CANCELLATION_FACT_CHAIN'));});
  const rejected:any=await service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'REJECTED',note:'未达成解除，拒绝本次取消并保留原合同'},f.actor),history=await db.preDeliveryCancellationFact.findMany({where:{cancellationId:proposed.id},orderBy:{revision:'asc'}});
  assert.equal(rejected.state,'REJECTED');await db.serial(tx=>guardCancellation04Delivery(tx,sub.order.id));
  const command=request(),ordinary:any=await controller.requestRefund(command,{admin:f.actor});
  assert.equal(ordinary.preDeliveryCancellationId,null);assert.equal(ordinary.preDeliveryCancellationSourceHash,null);assert.equal((await controller.requestRefund(command,{admin:f.actor})).id,ordinary.id);
  await assert.rejects(controller.approve(ordinary.id,{admin:f.actor}),code('DUAL_APPROVAL'));
  await assert.rejects(controller.approve(ordinary.id,{admin:finance}),code('DUAL_APPROVAL'));assert.equal(calls.length,0);
  await db.adminUser.update({where:{id:staff.id},data:{staffPersonId:'reviewer-'+randomUUID()}});
  await assert.rejects(controller.approve(ordinary.id,{admin:{...finance,authVersion:finance.authVersion+1}}),code('STAFF_SESSION_CHANGED'));
  assert.equal((await controller.approve(ordinary.id,{admin:finance})).status,'PROCESSING');assert.equal(calls.length,1);
  await assert.rejects(controller.requestRefund(request(10000),{admin:f.actor}),code('REFUND_LIMIT'));
  await rollback(db,async tx=>{await tx.orderChange.create({data:{orderId:sub.order.id,customerId:sub.customer.id,kind:'SUBSCRIPTION_EXTENSION',priorTermsHash:'a'.repeat(64),priorTerms:{},originalContractId:(await tx.orderPreDeliveryCancellation.findUniqueOrThrow({where:{id:proposed.id}})).originalContractId,reason:'合成独立依赖',createdBy:f.actor.id,idempotencyKey:randomUUID(),requestHash:'b'.repeat(64)}});await assert.rejects(new BillingController({serial:(fn:any)=>fn(tx)} as any,billing,gateway).requestRefund(request(),{admin:f.actor}),code('CHANGE_REFUND_MANAGED'));});
  ctx.mock.timers.setTime(Date.now()+60000);await assert.rejects(billing.retryRefund(ordinary.id,finance.id,{...finance,authVersion:finance.authVersion+1}),code('STAFF_SESSION_CHANGED'));assert.equal(calls.length,1);
  ctx.mock.timers.setTime(Date.now()+60000);await db.adminUser.update({where:{id:staff.id},data:{staffPersonId:personId}});await assert.rejects(billing.retryRefund(ordinary.id,finance.id,finance),code('DUAL_APPROVAL'));assert.equal(calls.length,1);
  await db.adminUser.update({where:{id:staff.id},data:{staffPersonId:'reviewer-'+randomUUID()}});ctx.mock.timers.setTime(Date.now()+60000);
  assert.equal((await billing.retryRefund(ordinary.id,finance.id,finance)).status,'PROCESSING');assert.equal(calls.length,2);assert.equal(calls[1].refundId,ordinary.id);assert.ok(queries>=1);
  const saved=await db.refund.findUniqueOrThrow({where:{id:ordinary.id}});assert.equal(saved.preDeliveryCancellationId,null);assert.equal(saved.preDeliveryCancellationSourceHash,null);assert.deepEqual(await db.preDeliveryCancellationFact.findMany({where:{cancellationId:proposed.id},orderBy:{revision:'asc'}}),history);
  await billing.settleRefund(ordinary.id,{status:'SUCCEEDED',paymentId:payment.id,amount:1000,totalAmount:payment.amount,providerRefundId:'SYN-'+randomUUID(),succeededAt:new Date().toISOString()});
  const current:any=await service.read(sub.order.id,f.actor),second:any=await service.propose(sub.order.id,{...input,revision:current.orderRevision,idempotencyKey:randomUUID()},f.actor);
  assert.equal(second.version,2);await assert.rejects(controller.requestRefund(request(),{admin:f.actor}),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
  await service.review(second.id,{revision:second.revision,idempotencyKey:randomUUID(),decision:'REJECTED',note:'第二次提案未获同意'},f.actor);
  const latest:any=await service.read(sub.order.id,f.actor),at=new Date().toISOString(),intent=(subjectId:string)=>({subjectId,personName:'合成有权本人',personReference:'external-'+randomUUID(),intention:'真实合意解除且剩余9000分全退',occurredAt:at,fileIds:[evidence.id],authorityFrom:new Date(Date.now()-86400000).toISOString(),authorityUntil:new Date(Date.now()+86400000).toISOString(),authorityScope:'本单解除和金额',authorityFileIds:[evidence.id]});
  const third:any=await service.propose(sub.order.id,{...input,revision:latest.orderRevision,idempotencyKey:randomUUID(),earlierAgreement:{customer:intent(sub.customer.id),owner:intent(f.owner.id),platform:intent(f.platform.id),amountConfirmedAt:at,confirmedNetRefundAmount:9000,terms:'三方确认解除，剩余9000分退款'}},f.actor);
  await service.review(third.id,{revision:third.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核验原始三方合意和金额'},f.actor);
  const bound:any=await controller.requestRefund(request(500),{admin:f.actor});assert.equal(bound.preDeliveryCancellationId,third.id);assert.equal(bound.preDeliveryCancellationSourceHash,third.proposalHash);
  await assert.rejects(db.serial(tx=>guardCancellation04Refund(tx,payment,bound.amount,{...bound,preDeliveryCancellationId:proposed.id},finance)),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
  assert.deepEqual(await db.preDeliveryCancellationFact.findMany({where:{cancellationId:proposed.id},orderBy:{revision:'asc'}}),history);
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});

test('04-bound refunds never fall through a missing or genuinely rejected case',async()=>{
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 try{
  const {f,sub,payment,service,input}=await cancellationFixture(db),reference={id:randomUUID(),paymentId:payment.id,customerId:sub.customer.id,amount:1,requestedBy:f.actor.id,preDeliveryCancellationId:randomUUID(),preDeliveryCancellationSourceHash:'a'.repeat(64)};
  await assert.rejects(db.serial(tx=>guardCancellation04Refund(tx,payment,1,reference,f.actor)),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
  const proposed:any=await service.propose(sub.order.id,input,f.actor);await service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'REJECTED',note:'未达成解除'},f.actor);
  await assert.rejects(db.serial(tx=>guardCancellation04Refund(tx,payment,1,{...reference,preDeliveryCancellationId:proposed.id,preDeliveryCancellationSourceHash:proposed.proposalHash},f.actor)),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
  await assert.rejects(db.serial(tx=>guardCancellation04Refund(tx,payment,1,{...reference,preDeliveryCancellationId:null},f.actor)),code('CANCELLATION04_REFUND_SOURCE_REQUIRED'));
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});
