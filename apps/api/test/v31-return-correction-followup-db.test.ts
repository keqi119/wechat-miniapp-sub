import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {VehicleReceiptController} from '../src/offline-documents/vehicle-receipt';
import {FilesController} from '../src/files/files';

test('electronic correction can follow a reviewed request for evidence without replacing original receipt',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T04:00:00Z')});
 const db=new Db(),saved={...process.env};
 try{
  const {f,sub,controller,photo}=await activeSwapFixture(db);
  const order=await db.order.findUniqueOrThrow({where:{id:sub.order.id}});
  const h:any=await controller.handover({orderId:order.id,type:'RETURN',actualAt:'2026-11-13T03:30:00Z',readingKm:250,fileIds:[photo.id],checklist:[{label:'conditionChecklist',value:'客户对费用有异议'}],revision:order.revision,idempotencyKey:randomUUID()},{admin:f.actor});
  const published:any=await controller.publishHandover(h.id,{admin:f.actor},{revision:h.revision,idempotencyKey:randomUUID()});
  const api=new VehicleReceiptController(db),input={receivedAt:'2026-11-13T03:30:00Z',readingKm:250,storageLocation:'合成实际收车点',evidenceFileIds:[photo.id],revision:0,handoverRevision:published.revision,manifestHash:published.manifestHash,idempotencyKey:randomUUID()};
  const event:any=await api.received(h.id,input,{admin:f.actor});
  assert.equal(event.receivedAt.getTime(),Date.parse(input.receivedAt));assert.equal(event.assignmentId,order.currentAssignmentId);
  assert.equal((await api.received(h.id,input,{admin:f.actor})).id,event.id);
  assert.equal((await db.handover.findUniqueOrThrow({where:{id:h.id}})).status,'PUBLISHED');
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).status,'ACTIVE');
  assert.equal(await db.returnSettlement.count({where:{orderId:order.id}}),0);
  await assert.rejects(api.received(h.id,{...input,idempotencyKey:randomUUID(),manifestHash:'f'.repeat(64)},{admin:f.actor}));
  await assert.rejects(api.received(h.id,{...input,idempotencyKey:randomUUID()},{admin:{...f.actor,authVersion:f.actor.authVersion+1}}));
  const correction:any=await api.received(h.id,{...input,readingKm:251,revision:1,previousEventId:event.id,correctionReason:'原始读数影像核验更正',idempotencyKey:randomUUID()},{admin:f.actor});assert.equal(correction.isCurrent,false);assert.equal((await db.vehicleReceiptEvent.findUniqueOrThrow({where:{id:event.id}})).isCurrent,true);
  await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';
  const requested=await api.reviewReturn(h.id,{eventId:correction.id,requestHash:correction.requestHash,decision:'REQUEST_EVIDENCE',reason:'补充原始读数影像',idempotencyKey:randomUUID()},{admin:f.actor});assert.equal(requested.disposition,'NEEDS_EVIDENCE');
  const next:any=await api.received(h.id,{...input,readingKm:252,revision:correction.revision,previousEventId:correction.id,correctionReason:'根据追加原始影像继续更正',idempotencyKey:randomUUID()},{admin:f.actor});
  const reviewed:any=await api.reviewReturn(h.id,{eventId:next.id,requestHash:next.requestHash,decision:'APPROVE',reason:'证据补齐并核验原始事实',idempotencyKey:randomUUID()},{admin:f.actor});assert.equal(reviewed.disposition,'APPLIED');assert.equal(next.previousEventId,correction.id);assert.equal(reviewed.source.previousEventId,event.id);assert.equal((await db.vehicleReceiptEvent.findUniqueOrThrow({where:{id:event.id}})).readingKm,250);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
