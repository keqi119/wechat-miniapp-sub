import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {cancellationFixture} from './v31-cancellation-fixture';
import {RefundObligationsService} from '../src/billing/refund-obligations';
import {BillingController,BillingService} from '../src/billing/billing';
test('actual early04 source creates immutable obligation once; same-debt performance and late cash are distinct',async()=>{
 const db=new Db(),saved={...process.env};process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const {f,sub,evidence,payment,service,input}=await cancellationFixture(db),at=new Date(Date.now()-60000).toISOString();
 await db.adminUser.update({where:{id:f.actor.id},data:{staffPersonId:'source-person-'+randomUUID()}});
 const intent=(subjectId:string)=>({subjectId,personName:'合成权利人',personReference:'external-'+randomUUID(),intention:'取消并全退10000分',occurredAt:at,fileIds:[evidence.id],authorityFrom:new Date(Date.now()-86400000*3).toISOString(),authorityUntil:new Date(Date.now()+86400000).toISOString(),authorityScope:'本单取消金额',authorityFileIds:[evidence.id]});
 const p:any=await service.propose(sub.order.id,{...input,earlierAgreement:{customer:intent(sub.customer.id),owner:intent(f.owner.id),platform:intent(f.platform.id),amountConfirmedAt:at,confirmedNetRefundAmount:10000,terms:'原始三方一致全退'}},f.actor);
 await service.review(p.id,{revision:p.revision,decision:'VERIFIED',note:'原始证据核验',idempotencyKey:randomUUID()},f.actor);
 const api=new RefundObligationsService(db),v:any=await api.read(sub.order.id,f.actor);assert.equal(v.candidates.length,1);assert.equal(v.candidates[0].amount,10000);
 const body={sourceHash:v.sourceHash,idempotencyKey:randomUUID()};const out:any=await Promise.all([api.materialize(sub.order.id,body,f.actor),api.materialize(sub.order.id,body,f.actor)]);assert.equal(out[0].items[0].id,out[1].items[0].id);assert.equal(out[0].items[0].triggerAt,at);
 await assert.rejects(api.materialize(sub.order.id,{...body,amount:1},f.actor));await assert.rejects(api.read(sub.order.id,undefined,randomUUID()));await assert.rejects(api.materialize(sub.order.id,{...body,sourceHash:'f'.repeat(64),idempotencyKey:randomUUID()},f.actor));await assert.rejects(api.read(sub.order.id,{...f.actor,authVersion:f.actor.authVersion+1}));
 const finance=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'独立财务',role:'FINANCE',staffPersonId:'independent-'+randomUUID()}}),gateway={refund:async()=>({status:'PROCESSING'})} as any,billing=new BillingService(db,gateway),controller=new BillingController(db,billing,gateway);
 const r:any=await controller.requestRefund({paymentId:payment.id,amount:4000,reason:'原04同债履行',idempotencyKey:randomUUID()},{admin:f.actor});await controller.approve(r.id,{admin:finance});await billing.settleRefund(r.id,{status:'SUCCEEDED',providerRefundId:'SYN-'+randomUUID(),paymentId:payment.id,amount:4000,totalAmount:10000,succeededAt:new Date().toISOString()});
 const after:any=await api.read(sub.order.id,f.actor);assert.equal(after.items[0].remainingAmount,6000);assert.equal(after.items[0].triggerAt,at);assert.equal(after.items[0].completedAmount,4000);
 await db.payment.create({data:{billId:payment.billId,customerId:sub.customer.id,amount:123,status:'SUCCEEDED',idempotencyKey:randomUUID(),providerTransactionId:'SYN-LATE-'+randomUUID(),succeededAt:new Date()}});
 const late:any=await api.read(sub.order.id,f.actor);assert.equal(late.items[0].amount,10000);assert.ok(late.dependencies.some((d:any)=>d.code==='ADDITIONAL_AMOUNT_CONFIRMATION_REQUIRED'&&d.amount===123));
 assert.equal(await (db as any).refundObligation.count({where:{orderId:sub.order.id}}),1);await assert.rejects((db as any).refundObligation.update({where:{id:late.items[0].id},data:{amount:1}}));
 }finally{await db.$disconnect();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
