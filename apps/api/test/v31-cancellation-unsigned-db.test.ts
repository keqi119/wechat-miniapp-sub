import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {prepareFixture,syntheticArchive} from './v31-initial-fixture';
import {seedV31Subscription} from './v31-cooperation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {signingParties,syntheticSigningTime} from './electronic-fixtures';
import {canonicalHash} from '../src/customers/types';
import {OrderActionsController} from '../src/orders/order-actions';
test('unsigned electronic order can withdraw without01/04 consent, but unknown or partial original signing blocks',async()=>{
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const f=await prepareFixture(db),first=await seedV31Subscription(db,f),actions=new OrderActionsController(db);
 await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:first.order.id}});
 const input={revision:0,idempotencyKey:randomUUID(),reason:'未成立且无外部请求，撤回业务申请'};
 const cancelled=await actions.cancel(first.order.id,input,{admin:f.actor});assert.equal(cancelled.status,'CANCELLED');assert.deepEqual(await actions.cancel(first.order.id,input,{admin:f.actor}),cancelled);assert.equal(await db.orderPreDeliveryCancellation.count({where:{orderId:first.order.id}}),0);
 await db.legalDocument.update({where:{id:f.template.id},data:{status:'PUBLISHED',confirmedBy:f.actor.id,confirmedAt:new Date()}});await syntheticArchive(db,f,await db.serial(tx=>prepareElectronicDocument(tx,f.input,f.actor.id,f.writer,f.options)));
 const sub=await seedV31Subscription(db,f);await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'RESERVED',reservedOrderId:sub.order.id}});const parties=signingParties().map(p=>({...p,subjectId:p.role==='CUSTOMER'?sub.customer.id:p.role==='OWNER'?f.owner.id:f.platform.id,autoAuthority:null,certificate:{...p.certificate,checkedAt:new Date().toISOString()}}));
 const prepared=await db.serial(tx=>prepareElectronicDocument(tx,{kind:'SUBSCRIPTION',resourceId:sub.order.id,revision:0,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));
 for(const status of ['UNKNOWN','SIGNED']){const sentinel=new Error('rollback');await assert.rejects(db.serial(async(tx:any)=>{const task=await tx.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}}),attemptedAt=new Date(),manualConsent={version:1,taskId:task.id,role:'CUSTOMER',actorId:sub.customer.id,sourceSha256:task.sourceSha256,acceptedAt:attemptedAt.toISOString()};await tx.electronicSigningParty.updateMany({where:{taskId:task.id,role:'CUSTOMER'},data:{status,attemptedAt,manualConsent,manualConsentHash:canonicalHash(manualConsent),...(status==='SIGNED'?{...syntheticSigningTime(attemptedAt),verifiedAt:attemptedAt,queryEvidenceHash:'b'.repeat(64)}:{})}});await assert.rejects(new OrderActionsController({serial:(fn:any)=>fn(tx)} as any).cancel(sub.order.id,{...input,idempotencyKey:randomUUID()},{admin:f.actor}),(e:any)=>e.getResponse?.().error?.code==='ELECTRONIC_STOP_REVIEW_REQUIRED');throw sentinel;}),(e:any)=>e===sentinel);}
 const result=await actions.cancel(sub.order.id,{...input,idempotencyKey:randomUUID()},{admin:f.actor});assert.equal(result.status,'CANCELLED');const stopped=await db.electronicSigningTask.findUniqueOrThrow({where:{id:prepared.taskId}});assert.equal(stopped.status,'WITHDRAWN');assert.equal(stopped.stopStatus,'STOPPED_LOCAL_ONLY');assert.equal(await db.preDeliveryCancellationFact.count({where:{cancellationId:{in:(await db.orderPreDeliveryCancellation.findMany({where:{orderId:sub.order.id}})).map(c=>c.id)}}}),0);
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});
