import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runSwapCommandJourney} from './v31-swap-command-journey';
import {TerminationService} from '../src/orders/termination';
test('valid partial-swap termination reuses corrected physical receipt and releases unused reservations with history',async ctx=>runSwapCommandJourney(ctx,'delay',{configureSources:async()=>{},run:async()=>{},partial:async(ctx,db,{f,sub,change,receipt,receiptAdmin})=>{
 const actor={id:receiptAdmin.id,role:receiptAdmin.role,authVersion:receiptAdmin.authVersion},api=new TerminationService(db),view:any=await api.read(sub.order.id,actor);
 assert.equal(view.custody.id,receipt.id);assert.equal(view.custody.kind,'PARTIAL_SWAP');
 const evidence=await db.storedFile.create({data:{name:'合成法定解除原始依据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'b'.repeat(64),purpose:'evidence',adminId:actor.id}}),at=new Date(Date.now()-1000).toISOString(),from=new Date(Date.now()-86400000).toISOString(),until=new Date(Date.now()+86400000).toISOString();
 const p:any=await api.propose(sub.order.id,{revision:view.orderRevision,sourceHash:view.sourceHash,idempotencyKey:randomUUID(),reason:'旧车已收回且无法继续履行有效供车',holderId:sub.customer.id,senderPersonReference:sub.customer.id,senderAuthorityScope:'本人法定解除权',authorityFrom:from,authorityUntil:until,authorityEvidenceFileIds:[evidence.id],ground:'SAFETY_OR_UNUSABLE',legalBasis:'01第10.3条实际无法实现使用收益及真实证据',groundOccurredAt:from,groundEvidenceFileIds:[evidence.id],notices:[f.owner.id,f.platform.id].map(recipientId=>({recipientId,channel:'本单企业已核验联系渠道',channelSource:'原01企业联系人',content:'依法结束已无法继续履行的订阅',contentVersion:'1',arrivedAt:at,arrivalEvidenceFileIds:[evidence.id],promptChannel:'已核验短信',promptArrivedAt:at,promptEvidenceFileIds:[evidence.id]})),effectAt:at,noCureLegalBasis:'依法无需催告的客观履行不能'},actor,true);
 const r:any=await api.review(p.id,{revision:p.revision,idempotencyKey:randomUUID(),decision:'VERIFIED',note:'核对真实权能、法定依据、到达和旧车实际收回，无新车交付'},actor);
 const input={revision:r.revision,receiptEventId:receipt.id,receiptHash:receipt.factHash,idempotencyKey:randomUUID()};
 const resolved=await (api as any).resolvePartial(r.id,input,actor);assert.equal(resolved.custody.id,receipt.id);
 assert.equal((await (api as any).resolvePartial(r.id,input,actor)).custody.id,receipt.id);
 assert.equal(await db.vehicleReceiptEvent.count({where:{orderId:sub.order.id}}),0);assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'CONSUME'}}),0);assert.equal(await db.swapReservation.count({where:{changeId:change.id,status:'RESERVED'}}),0);assert.equal(await db.swapLedger.count({where:{changeId:change.id,type:'RELEASE'}}),1);
 assert.equal(await db.vehicleHold.count({where:{changeId:change.id,status:'HELD'}}),0);assert.equal((await db.orderChange.findUniqueOrThrow({where:{id:change.id}})).status,'CANCELLED');assert.equal((await db.order.findUniqueOrThrow({where:{id:sub.order.id}})).status,'SETTLING');assert.equal(await db.returnSettlement.count({where:{orderId:sub.order.id}}),1);
 assert.equal((await api.read(sub.order.id,actor) as any).custody.id,receipt.id);
}}));
