import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {activeSwapFixture} from './v31-swap-fixture';
import {VehicleReceiptController} from '../src/offline-documents/vehicle-receipt';
import {FilesController} from '../src/files/files';

test('electronic ordinary custody records exact time before customer confirmation, 06 and funds',async ctx=>{
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
  const review={eventId:correction.id,requestHash:correction.requestHash,decision:'APPROVE',reason:'核对该次原始读数来源',idempotencyKey:randomUUID()};await assert.rejects((api as any).reviewReturn(h.id,review,{admin:f.actor}));
  await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';const reviewed=await (api as any).reviewReturn(h.id,review,{admin:f.actor});assert.equal(reviewed.disposition,'APPLIED');assert.equal((await db.vehicleReceiptEvent.findUniqueOrThrow({where:{id:event.id}})).readingKm,250);assert.equal((await db.vehicleReceiptEvent.findUniqueOrThrow({where:{id:correction.id}})).isCurrent,true);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('ordinary expiry return after original end keeps exact custody without requiring06 or fictitious renewal',async ctx=>{
 ctx.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T04:00:00Z')});const db=new Db(),saved={...process.env};try{
 const {f,sub,controller,photo}=await activeSwapFixture(db),last=await db.usagePeriod.findFirstOrThrow({where:{orderId:sub.order.id},orderBy:{sequence:'desc'}}),actual=new Date(last.endDate.toISOString().slice(0,10)+'T12:00:00+08:00');actual.setTime(actual.getTime()+86400000);ctx.mock.timers.setTime(actual.getTime()+60000);
 const order=await db.order.findUniqueOrThrow({where:{id:sub.order.id}}),h:any=await controller.handover({orderId:order.id,type:'RETURN',actualAt:actual.toISOString(),readingKm:250,fileIds:[photo.id],checklist:[{label:'conditionChecklist',value:'合成期满归还'}],revision:order.revision,idempotencyKey:randomUUID()},{admin:f.actor}),pub:any=await controller.publishHandover(h.id,{admin:f.actor},{revision:h.revision,idempotencyKey:randomUUID()});
 await new VehicleReceiptController(db).received(h.id,{receivedAt:actual.toISOString(),readingKm:250,storageLocation:'原交付点',evidenceFileIds:[photo.id],revision:0,handoverRevision:pub.revision,manifestHash:pub.manifestHash,idempotencyKey:randomUUID()},{admin:f.actor});
 await new FilesController(db).customerRead(photo.id,{customer:{id:sub.customer.id}},{setHeader:()=>{},send:()=>{}});
 await db.eSignAccount.update({where:{customerId:sub.customer.id},data:{checkedAt:new Date()}});
 await controller.confirmHandover(h.id,{revision:pub.revision,manifestHash:pub.manifestHash,readFileIds:[photo.id],fileIds:[],idempotencyKey:randomUUID(),documentId:pub.onlineRecordSnapshot.documentId,termsVersion:pub.onlineRecordSnapshot.termsVersion,termsHash:pub.onlineRecordSnapshot.termsHash,termsAccepted:true},{customer:{id:sub.customer.id}});
 assert.equal((await controller.complete(h.id,{admin:f.actor},{revision:pub.revision,idempotencyKey:randomUUID()})).status,'COMPLETED');
 assert.equal((await db.usagePeriod.findUniqueOrThrow({where:{id:last.id}})).effectiveEndDate.toISOString(),last.endDate.toISOString());
 const {terminationReadiness,TerminationService}=await import('../src/orders/termination');const readiness=await db.serial(tx=>terminationReadiness(tx,order));assert.equal(readiness.normalExpiry,true);assert.equal(readiness.ready,true);assert.equal(readiness.case,null);
 const {readReturnView}=await import('../src/usage/returns');const settlement=await db.returnSettlement.findUniqueOrThrow({where:{orderId:order.id}});const closing:any=await db.serial(tx=>readReturnView(tx,settlement,true));assert.ok(closing.financialBlockers.includes('EXIT_AMOUNT_CONFIRMATION_REQUIRED'));assert.equal(closing.documentBlockers.length,0);const service=new TerminationService(db);let view:any=await service.read(order.id,f.actor);assert.ok(view.settlementSource);assert.equal(view.settlementSource.amounts.compensationAmount,0);assert.ok(view.settlementSource.paymentReferences.length>0);
 const evidence=await db.storedFile.create({data:{name:'合成迟还责任证据.pdf',storagePath:'synthetic',mimeType:'application/pdf',size:50,sha256:'b'.repeat(64),purpose:'evidence',adminId:f.actor.id}});
 const claim=await (service as any).claimOccupancy(order.id,{sourceHash:view.settlementSource.hash,responsibility:'CUSTOMER',basis:'客户在约定到期后继续实际占有且出租方未拒收，已核对减损和同期间无其他收费',evidenceFileIds:[evidence.id],idempotencyKey:randomUUID()},f.actor);assert.equal(claim.status,'PROPOSED');assert.ok(claim.source.calculatedAmount>0);
 await assert.rejects((service as any).reviewOccupancy(claim.id,{decision:'VERIFIED',reason:'本人不可复核运营责任事实',idempotencyKey:randomUUID()},f.actor));await db.adminUser.update({where:{id:f.actor.id},data:{role:'ADMIN'}});f.actor.role='ADMIN';
 await (service as any).reviewOccupancy(claim.id,{decision:'VERIFIED',reason:'管理员核验实际占用和可归责程度，资金仍由独立财务处理',idempotencyKey:randomUUID()},f.actor);view=await service.read(order.id,f.actor);assert.equal(view.settlementSource.occupancyClaim.amount,claim.source.calculatedAmount);
 const confirm={responseVersion:view.settlementSource.responses.version,predecessorId:view.settlementSource.responses.headId,sourceHash:view.settlementSource.hash,decision:'CONFIRM',reason:'核对期满无个人提前补偿，实收押金余额及租金清理分别确认',idempotencyKey:randomUUID()};const response=await (service as any).respondAmounts(order.id,confirm,sub.customer.id);assert.equal(response.decision,'CONFIRM');assert.equal(response.sourceHash,view.settlementSource.hash);assert.equal(response.source.actualReceiptAt,actual.toISOString());assert.equal((await (service as any).respondAmounts(order.id,confirm,sub.customer.id)).id,response.id);
 const originalReceipt=await db.vehicleReceiptEvent.findFirstOrThrow({where:{orderId:order.id,isCurrent:true}}),api=new VehicleReceiptController(db),late:any=await api.received(h.id,{receivedAt:new Date(actual.getTime()+30000).toISOString(),readingKm:251,storageLocation:'原交付点',evidenceFileIds:[photo.id],revision:1,previousEventId:originalReceipt.id,correctionReason:'结算确认后收到原始时间读数补证',handoverRevision:pub.revision,manifestHash:pub.manifestHash,idempotencyKey:randomUUID()},{admin:f.actor});
 const corrected:any=await (api as any).reviewReturn(h.id,{eventId:late.id,requestHash:late.requestHash,decision:'APPROVE',reason:'核验更正事实，已确认金额另由财务处理',idempotencyKey:randomUUID()},{admin:f.actor});assert.equal(corrected.disposition,'REQUIRES_FINANCIAL_REVIEW');assert.equal(corrected.source.confirmedAmountSourceIds[0],response.id);assert.ok(corrected.source.financialDifferences);assert.equal((await db.vehicleReceiptEvent.findUniqueOrThrow({where:{id:originalReceipt.id}})).isCurrent,true);assert.deepEqual(await db.orderExitAmountResponse.findUniqueOrThrow({where:{id:response.id}}),response);
 }finally{await db.$disconnect();ctx.mock.timers.reset();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
