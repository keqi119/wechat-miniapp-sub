import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {cancellationFixture} from './v31-cancellation-fixture';
import {prepareElectronicDocument} from '../src/electronic-documents/prepare';
import {syntheticArchive} from './v31-initial-fixture';
import {finalizeElectronicArchive,captureStoppedSigningEvidence,proofFor} from '../src/electronic-documents/archive';
import {activateElectronicSubscription} from '../src/electronic-documents/subscription';
import {activateCancellation04} from '../src/orders/cancellation04';
import {guardCancellation04Delivery,guardCancellation04Refund} from '../src/orders/cancellation04-gates';
import {BillingController,BillingService} from '../src/billing/billing';
import {OrderActionsController} from '../src/orders/order-actions';
const code=(s:string)=>(e:any)=>e.getResponse?.().error?.code===s;
async function rollback(db:any,fn:(tx:any)=>Promise<void>){const sentinel=new Error('synthetic rollback');await assert.rejects(db.serial(async(tx:any)=>{await fn(tx);throw sentinel;}),(e:any)=>e===sentinel);}

test('04 true earlier agreement before original filing preserves legal and amount clocks, no fee, actual delivery and foreign renewal excluded',async()=>{
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const {f,sub,original,evidence,payment,service,input}=await cancellationFixture(db,true);
 await rollback(db,async tx=>{await tx.order.update({where:{id:sub.order.id},data:{status:'COMPLETED',serviceAnchor:{firstStartDay:'2026-11-01',anchorDay:1,ruleVersion:'V31'}}});await assert.rejects(new (service.constructor as any)({serial:(fn:any)=>fn(tx)}).propose(sub.order.id,input,f.actor),code('CANCELLATION_ALREADY_DELIVERED'));});
 await rollback(db,async tx=>{await tx.orderChange.create({data:{orderId:sub.order.id,customerId:sub.customer.id,kind:'SUBSCRIPTION_EXTENSION',priorTermsHash:'a'.repeat(64),priorTerms:{},originalContractId:(await tx.electronicSigningTask.findUniqueOrThrow({where:{id:original.taskId}})).contractId,reason:'synthetic',createdBy:f.actor.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});await assert.rejects(new (service.constructor as any)({serial:(fn:any)=>fn(tx)}).propose(sub.order.id,input,f.actor),code('CANCELLATION_FUTURE_RENEWAL'));});
 const earlierAt=new Date(Date.now()-30000).toISOString(),amountAt=new Date(Date.now()-20000).toISOString();
 const intent=async(subjectId:string)=>{const file=await db.storedFile.create({data:{name:'合成原始合意.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:80,sha256:'c'.repeat(64),purpose:'evidence',adminId:f.actor.id}});return{subjectId,personName:'合成有权本人',personReference:'verified-external-person-'+randomUUID(),intention:'原车未交付，同意解除并全退原付款10000分',occurredAt:earlierAt,fileIds:[file.id],authorityFrom:new Date(Date.now()-86400000).toISOString(),authorityUntil:new Date(Date.now()+86400000).toISOString(),authorityScope:'有权代表本企业确认本单解除及金额',authorityFileIds:[evidence.id]};};
 const earlierAgreement={customer:await intent(sub.customer.id),owner:await intent(f.owner.id),platform:await intent(f.platform.id),amountConfirmedAt:amountAt,confirmedNetRefundAmount:10000,terms:'三方真实同意解除并确认全退原付款10000分'};
 const proposed:any=await service.propose(sub.order.id,{...input,earlierAgreement},f.actor);assert.equal(proposed.netRefundAmount,10000);
 const verified:any=await service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核验三方原始合意和当时有权身份'},f.actor);
 assert.equal(verified.effectiveAt,earlierAt);assert.equal(verified.amountConfirmedAt,amountAt);assert.ok(verified.amountConfirmationFactId);assert.equal(verified.archivedAt,null);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 await db.serial(async tx=>{await finalizeElectronicArchive(tx,original.taskId);await activateElectronicSubscription(tx,await tx.electronicSigningTask.findUniqueOrThrow({where:{id:original.taskId}}));});
 assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 await db.serial(tx=>guardCancellation04Refund(tx,payment,10000));
 const final:any=await service.read(sub.order.id,f.actor);assert.equal(final.case.effectiveAt,earlierAt);assert.equal(final.case.amountConfirmedAt,amountAt);
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});

test('04 review uses real people, source freezes survive safe reads, stopped results cannot cancel or be replaced',async()=>{
 const db=new Db(),mode=process.env.NEW_ORDER_CONTRACT_MODE;process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';try{
 const {f,sub,parties,evidence,service,input}=await cancellationFixture(db);
 await db.adminUser.update({where:{id:f.actor.id},data:{role:'OPERATIONS',staffPersonId:'synthetic-person-a'}});f.actor.role='OPERATIONS';
 const proposed:any=await service.propose(sub.order.id,input,f.actor);assert.deepEqual(await service.propose(sub.order.id,input,f.actor),proposed);
 await assert.rejects(service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'self'},f.actor),code('CANCELLATION_SELF_REVIEW'));
 const peer=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'合成同人运营',role:'OPERATIONS',staffPersonId:'synthetic-person-a'}}),actor={id:peer.id,role:peer.role,authVersion:peer.authVersion};
 await assert.rejects(service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'same real person'},actor),code('CANCELLATION_SELF_REVIEW'));
 await db.adminUser.update({where:{id:peer.id},data:{staffPersonId:'synthetic-person-b'}});
 const reviewed:any=await service.review(proposed.id,{revision:proposed.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'independent actual person'},actor),confirmed:any=await service.confirm(proposed.id,{revision:reviewed.revision,proposalHash:proposed.proposalHash,idempotencyKey:randomUUID(),accepted:true},sub.customer.id);
 await assert.rejects(db.serial(tx=>guardCancellation04Delivery(tx,sub.order.id)),code('CANCELLATION04_DELIVERY_HOLD'));
 const prepare={kind:'PRE_DELIVERY_CANCELLATION',resourceId:proposed.id,revision:confirmed.revision,idempotencyKey:randomUUID()},prepared=await db.serial(tx=>prepareElectronicDocument(tx,prepare,f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}));assert.deepEqual(await db.serial(tx=>prepareElectronicDocument(tx,prepare,f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties})),prepared);
 await rollback(db,async tx=>{await tx.storedFile.update({where:{id:evidence.id},data:{sha256:'d'.repeat(64)}});await assert.rejects(prepareElectronicDocument(tx,{...prepare,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties}),code('CANCELLATION_EVIDENCE_CHANGED'));});
 await syntheticArchive(db,f,{...prepared,deferArchive:true});
 await db.serial(async tx=>{const task=await tx.electronicSigningTask.update({where:{id:prepared.taskId},data:{withdrawnAt:new Date(),status:'WITHDRAWN',stopStatus:'NEEDS_REVIEW'},include:{parties:true}});await captureStoppedSigningEvidence(tx,task.id,await proofFor(tx,task,new Date(),new Date()));await activateCancellation04(tx,task);});
 assert.notEqual((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'CANCELLED');
 const view:any=await service.read(sub.order.id,f.actor);await assert.rejects(service.propose(sub.order.id,{...input,revision:view.orderRevision,idempotencyKey:randomUUID()},f.actor),code('ELECTRONIC_STOP_REVIEW_REQUIRED'));
 await assert.rejects(db.serial(tx=>prepareElectronicDocument(tx,{...prepare,idempotencyKey:randomUUID()},f.actor.id,f.writer,{...f.options,resolveParties:async()=>parties})),code('CANCELLATION_NEW_VERSION_REQUIRED'));
 }finally{if(mode===undefined)delete process.env.NEW_ORDER_CONTRACT_MODE;else process.env.NEW_ORDER_CONTRACT_MODE=mode;await db.$disconnect();}
});
