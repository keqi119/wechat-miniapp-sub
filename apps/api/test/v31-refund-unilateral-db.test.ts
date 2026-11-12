import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RefundObligationsService} from '../src/billing/refund-obligations';
import {Db} from '../src/common/db';
import {cancellationFixture} from './v31-cancellation-fixture';
import {TerminationService} from '../src/orders/termination';
import {cancellation04Readiness} from '../src/orders/cancellation04-gates';
test('verified unilateral original cancellation yields actual3day debt without04/06 or invented receipt',async()=>{
 const db=new Db(),saved={...process.env};process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const {f,sub,evidence}=await cancellationFixture(db),api=new TerminationService(db),source:any=await api.read(sub.order.id,f.actor),ago=(n:number)=>new Date(Date.now()-n*3600000).toISOString();
 const input={revision:source.orderRevision,sourceHash:source.sourceHash,idempotencyKey:randomUUID(),reason:'供车前车辆全部灭失',holderId:sub.customer.id,senderPersonReference:sub.customer.id,senderAuthorityScope:'本人依法行使法定解除权',authorityFrom:ago(48),authorityUntil:new Date(Date.now()+86400000).toISOString(),authorityEvidenceFileIds:[evidence.id],ground:'TOTAL_LOSS',legalBasis:'01第10.3条及真实全损事实核验',groundOccurredAt:ago(24),groundEvidenceFileIds:[evidence.id],notices:[f.owner.id,f.platform.id].map(recipientId=>({recipientId,channel:'本单约定已核验联系人渠道',channelSource:'原01明确企业联系人渠道记录',content:'因车辆全部灭失解除原合同',contentVersion:'v1',arrivedAt:ago(3),arrivalEvidenceFileIds:[evidence.id],promptChannel:'已核验短信提示渠道',promptArrivedAt:ago(2),promptEvidenceFileIds:[evidence.id]})),effectAt:ago(1),noCureLegalBasis:'全损客观无法补正，无需租金催告'};
 await assert.rejects(api.propose(sub.order.id,{...input,ground:'UNCURED_RENT_DEFAULT'},f.actor,true));
 await assert.rejects(api.propose(sub.order.id,{...input,notices:input.notices.map(n=>({...n,arrivedAt:new Date(Date.now()+60000).toISOString()}))},f.actor,true));
 const p:any=await api.propose(sub.order.id,input,f.actor,true);assert.equal(p.effectiveAt,null);assert.notEqual((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 const verified:any=await api.review(p.id,{revision:p.revision,decision:'VERIFIED',note:'逐项核实原始全损、权能、通知内容可调取及真实到达，通知提示已到达',idempotencyKey:randomUUID()},f.actor);assert.equal(verified.effectiveAt,input.effectAt);
 const order=await db.order.findUniqueOrThrow({where:{id:sub.order.id}});assert.equal(order.status,'CANCELLED');assert.equal(await db.vehicleReceiptEvent.count({where:{orderId:order.id}}),0);assert.equal(await db.orderPreDeliveryCancellation.count({where:{orderId:order.id}}),0);assert.equal(await db.contract.count({where:{orderId:order.id,kind:'TERMINATION'}}),0);
 const apiRefund=new RefundObligationsService(db),exit:any=await api.read(order.id,f.actor),statement=exit.settlementSource;
 assert.ok(statement);await api.respondAmounts(order.id,{sourceHash:statement.hash,responseVersion:statement.responses.version,predecessorId:statement.responses.headId,decision:'CONFIRM',reason:'本人确认实收及全退范围',idempotencyKey:randomUUID()},sub.customer.id);
 const v:any=await apiRefund.read(order.id,f.actor);assert.equal(v.candidates.length,1);const out:any=await apiRefund.materialize(order.id,{sourceHash:v.sourceHash,idempotencyKey:randomUUID()},f.actor);assert.equal(out.items[0].workingDays,3);assert.equal(out.items[0].sourceKind,'UNILATERAL');assert.equal(out.items[0].amount,10000);const trigger=out.items[0].triggerAt;
 const again:any=await api.read(order.id,f.actor);await api.respondAmounts(order.id,{sourceHash:again.settlementSource.hash,responseVersion:again.settlementSource.responses.version,predecessorId:again.settlementSource.responses.headId,decision:'OBJECT',reason:'后续对部分范围提出异议，旧确认仍保留',idempotencyKey:randomUUID()},sub.customer.id);
 const disputed:any=await apiRefund.read(order.id,f.actor);assert.equal(disputed.items[0].triggerAt,trigger);assert.equal(disputed.items[0].amount,10000);assert.ok(disputed.dependencies.some((d:any)=>d.code==='EXIT_OBJECTION_SCOPE_REVIEW_REQUIRED'&&d.undisputedAmount===null));
 const readiness:any=await db.serial(tx=>cancellation04Readiness(tx,order,f.actor));assert.equal(readiness.cancellationKind,'UNILATERAL');assert.deepEqual(readiness.blockers,[]);
 }finally{await db.$disconnect();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
