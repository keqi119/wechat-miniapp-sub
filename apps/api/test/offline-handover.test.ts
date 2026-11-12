import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertOfflineInspection,requireOfflineHandoverReady} from '../src/offline-documents/handover';
import {isFutureUnperformedPeriod,receiptInput,assertReceiptRevision} from '../src/offline-documents/vehicle-receipt';
import {WorkflowsController} from '../src/operations/workflows';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';
import {recordPhysicalReceipt,guardPhysicalReceiptBill,requireReceiptMatchesHandover} from '../src/offline-documents/vehicle-receipt';
import {FieldHandoverService} from '../src/field-handover/service';
import {projectRoot} from '../src/common/config';
import {resolve} from 'node:path';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('inspection confirmation is distinct from signature status',()=>{
 const h={executionMode:'OFFLINE',status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date(),manifestHash:'current',signatureStatus:'DRAFT'};
 assert.doesNotThrow(()=>assertOfflineInspection(h));
 assert.throws(()=>assertOfflineInspection({...h,status:'SUPERSEDED',signatureStatus:'SIGNED'}),code('HANDOVER_NOT_READY'));
 assert.throws(()=>assertOfflineInspection({...h,confirmedAt:null}),code('HANDOVER_NOT_READY'));
});
test('paper receipt must match the current inspection manifest and open feedback blocks completion',async()=>{
 const h={id:'h',revision:1,orderId:'o',type:'RETURN',executionMode:'OFFLINE',status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date(),manifestHash:'current'};
 let versionHash='old',open=0;
 const tx:any={$queryRaw:async()=>[],handover:{findUnique:async()=>h},documentArchive:{findFirst:async()=>({id:'a',currentApprovedVersionId:'v',versions:[{id:'v',status:'ARCHIVED',businessSnapshotHash:versionHash}]})},archiveFeedback:{count:async()=>open}};
 await assert.rejects(requireOfflineHandoverReady(tx,h),code('ARCHIVE_SNAPSHOT_MISMATCH'));
 versionHash='current';await requireOfflineHandoverReady(tx,h);
 open=1;await assert.rejects(requireOfflineHandoverReady(tx,h),code('ARCHIVE_FEEDBACK_OPEN'));
});
test('physical return pauses future periods without forgiving the current or prior period',()=>{
 const receivedAt=new Date('2026-10-26T17:30:00Z');
 assert.equal(isFutureUnperformedPeriod(receivedAt,new Date('2026-10-28')),true);
 assert.equal(isFutureUnperformedPeriod(receivedAt,new Date('2026-10-27')),false);
 assert.equal(isFutureUnperformedPeriod(receivedAt,new Date('2026-10-01')),false);
});
test('receipt corrections require the current revision and preserve the previous event',()=>{
 assert.doesNotThrow(()=>assertReceiptRevision(null,{revision:0} as any,'FIELD'));
 const current={id:'old',revision:1};
 assert.throws(()=>assertReceiptRevision(current,{revision:1,previousEventId:'old',correctionReason:'核实读数'} as any,'FIELD'),code('RECEIPT_CORRECTION_FORBIDDEN'));
 assert.throws(()=>assertReceiptRevision(current,{revision:0,previousEventId:'old',correctionReason:'核实读数'} as any,'OPERATIONS'),code('REVISION_CONFLICT'));
 assert.throws(()=>assertReceiptRevision(current,{revision:1,previousEventId:'different',correctionReason:'核实读数'} as any,'ADMIN'),code('RECEIPT_PREVIOUS_REQUIRED'));
 assert.doesNotThrow(()=>assertReceiptRevision(current,{revision:1,previousEventId:'old',correctionReason:'核实读数'} as any,'OPERATIONS'));
});
test('receipt input requires concrete storage location and evidence',()=>{
 const input={receivedAt:'2026-10-27T10:00:00+08:00',readingKm:100,storageLocation:'上海交付中心车位A',evidenceFileIds:['file'],revision:0,idempotencyKey:'receipt-key'};
 assert.equal(receiptInput.safeParse(input).success,true);
 assert.equal(receiptInput.safeParse({...input,evidenceFileIds:[]}).success,false);
 assert.equal(receiptInput.safeParse({...input,storageLocation:''}).success,false);
});
test('completion consults offline archives even when electronic signature is DRAFT',async()=>{
 const item={id:'h',revision:1,orderId:'o',customerId:'c',type:'RETURN',executionMode:'OFFLINE',status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date(),manifestHash:'current',signatureStatus:'DRAFT',order:{id:'o',customerId:'c',contractMode:'OFFLINE'}};
 const tx:any={archiveCommand:{findUnique:async()=>null,create:async()=>({})},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'staff',role:'ADMIN',active:true,authVersion:0})},handover:{findUnique:async()=>item,findUniqueOrThrow:async()=>item},documentArchive:{findFirst:async()=>null}};
 const controller=new WorkflowsController({serial:(fn:any)=>fn(tx)} as any,{} as any,{} as any);
 await assert.rejects(controller.complete('h',{admin:{id:'staff',role:'ADMIN',authVersion:0}},{revision:1,idempotencyKey:'complete-handover-test'}),code('OFFLINE_ARCHIVE_REQUIRED'));
});
test('repeating a completed handover does not duplicate usage or release another vehicle',async()=>{
 const item={id:'h',revision:1,status:'COMPLETED',executionMode:'OFFLINE',orderId:'o'};
 const tx:any={archiveCommand:{findUnique:async()=>null,create:async()=>({})},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'staff',role:'ADMIN',active:true,authVersion:0})},handover:{findUnique:async()=>item,findUniqueOrThrow:async()=>item}};
 const controller=new WorkflowsController({serial:(fn:any)=>fn(tx)} as any,{} as any,{} as any);
 assert.equal((await controller.complete('h',{admin:{id:'staff',role:'ADMIN',authVersion:0}},{revision:1,idempotencyKey:'complete-handover-test'})).id,'h');
});
test('formal return must reconcile previously recorded receipt facts',()=>{
 const event={receivedAt:new Date('2026-10-27T02:00:00Z'),readingKm:200};
 assert.doesNotThrow(()=>requireReceiptMatchesHandover(event,{actualAt:event.receivedAt,readingKm:200}));
 assert.throws(()=>requireReceiptMatchesHandover(event,{actualAt:event.receivedAt,readingKm:201}),code('PHYSICAL_RECEIPT_MISMATCH'));
});
test('ordinary task file routes cannot bypass the paper archive route',async()=>{
 const file={id:'file',name:'paper.pdf',mimeType:'application/pdf',purpose:'offline-archive',storagePath:resolve(process.env.UPLOAD_DIR||resolve(projectRoot,'var/uploads'),'synthetic-only')};
 const tx:any={adminUser:{findFirst:async()=>({id:'field',active:true,role:'FIELD'}),findUnique:async()=>({id:'field',active:true,role:'FIELD',authVersion:0})},fieldHandoverTask:{findFirst:async()=>({id:'task',assigneeId:'field',status:'ASSIGNED',materialGeneration:0})},storedFile:{findFirst:async()=>file}};
 let streams=0;const service=new FieldHandoverService({serial:(fn:any)=>fn(tx)} as any),response={setHeader:()=>{},sendFile:()=>{streams++;}};
 await assert.rejects(service.readFile('task','file','field',response),code('ARCHIVE_ROUTE_REQUIRED'));assert.equal(streams,0);
});
test('database: unpaid physical return pauses future bills, revoked assignee loses access, paper return keeps vehicle held',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db();
 try{
  const f=await offlineOrder(db),staff=await db.adminUser.create({data:{username:randomUUID(),name:'收车员工',role:'FIELD',passwordHash:'synthetic'}}),manager=await db.adminUser.create({data:{username:randomUUID(),name:'运营',role:'OPERATIONS',passwordHash:'synthetic'}}),other=await db.adminUser.create({data:{username:randomUUID(),name:'新员工',role:'FIELD',passwordHash:'synthetic'}});
  await approvedOfflineArchive(db,f.order.id);
  await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});await db.vehicle.update({where:{id:f.vehicle.id},data:{status:'IN_USE',reservedOrderId:f.order.id}});
  const now=new Date(Date.now()-10000),start=new Date(now.getTime()-15*86400000),end=new Date(now.getTime()+15*86400000),later=new Date(now.getTime()+45*86400000);
  const a=await db.usageAccount.create({data:{orderId:f.order.id,customerId:f.customer.id,policyVersion:'USAGE_V1',startedOn:start,periods:{create:[{orderId:f.order.id,sequence:1,startDate:start,endDate:end,effectiveEndDate:end,startReadingKm:100},{orderId:f.order.id,sequence:2,startDate:end,endDate:later,effectiveEndDate:later}]}}});
  await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',vehicleId:f.vehicle.id,actualAt:start,readingKm:100,fileIds:[],checklist:[],manifestHash:'delivery',completedAt:start}});
  const h=await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RETURN',executionMode:'OFFLINE',status:'PUBLISHED',vehicleId:f.vehicle.id,actualAt:now,readingKm:200,fileIds:[],checklist:[],manifestHash:'return-current'}});
  const taskId=randomUUID(),t=await db.fieldHandoverTask.create({data:{id:taskId,batchKey:'LEGACY:'+taskId,orderId:f.order.id,type:'RETURN',vehicleId:f.vehicle.id,assigneeId:staff.id,createdBy:manager.id,updatedBy:manager.id,currentHandoverId:h.id}});await db.handover.update({where:{id:h.id},data:{fieldTaskId:t.id}});
  const file=await db.storedFile.create({data:{name:'合成照片.png',mimeType:'image/png',size:10,sha256:'b'.repeat(64),storagePath:'synthetic-only',purpose:'handover',adminId:staff.id,fieldTaskId:t.id,fieldTaskGeneration:t.materialGeneration}});
  const input={receivedAt:now.toISOString(),readingKm:200,storageLocation:'合成保管位置',evidenceFileIds:[file.id],revision:0,taskVersion:t.version,idempotencyKey:randomUUID()};
  const event=await db.serial(tx=>recordPhysicalReceipt(tx,staff,h.id,input,t.id));
  assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'ACTIVE');assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}})).reservedOrderId,f.order.id);assert.equal((await db.bill.findUniqueOrThrow({where:{id:f.bill.id}})).status,'PENDING');
  assert.equal((await db.serial(tx=>recordPhysicalReceipt(tx,staff,h.id,input,t.id))).id,event.id);
  const future=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'SUBSCRIPTION',sequence:2,status:'PENDING',amount:100,dueDate:end}});
  await assert.rejects(db.serial(tx=>guardPhysicalReceiptBill(tx,future)),code('PHYSICAL_RETURN_BILL_PAUSED'));await db.serial(tx=>guardPhysicalReceiptBill(tx,f.bill));
  await db.fieldHandoverTask.update({where:{id:t.id},data:{assigneeId:other.id,version:{increment:1}}});
  await assert.rejects(db.serial(tx=>recordPhysicalReceipt(tx,staff,h.id,input,t.id)),code('NOT_FOUND'));
  await assert.rejects(db.serial(tx=>recordPhysicalReceipt(tx,other,h.id,{...input,revision:1,previousEventId:event.id,correctionReason:'调整',taskVersion:t.version+1,idempotencyKey:randomUUID()},t.id)),code('RECEIPT_CORRECTION_FORBIDDEN'));
  const correction=await db.serial(tx=>recordPhysicalReceipt(tx,manager,h.id,{...input,revision:1,previousEventId:event.id,correctionReason:'核实保管位置',storageLocation:'合成位置B',idempotencyKey:randomUUID()}));assert.equal(correction.previousEventId,event.id);assert.equal(await db.vehicleReceiptEvent.count({where:{handoverId:h.id,isCurrent:true}}),1);
  const controller=new WorkflowsController(db,{} as any,{} as any);await assert.rejects(controller.complete(h.id,{admin:manager},{revision:h.revision,idempotencyKey:'complete-offline-return'}),code('HANDOVER_NOT_READY'));
  await db.handover.update({where:{id:h.id},data:{status:'CUSTOMER_CONFIRMED',customerResponse:'CONFIRM',confirmedAt:new Date()}});
  await assert.rejects(controller.complete(h.id,{admin:manager},{revision:h.revision,idempotencyKey:'complete-offline-return'}),code('OFFLINE_ARCHIVE_REQUIRED'));
  const ar=await db.documentArchive.create({data:{kind:'RETURN_RECEIPT',subjectType:'HANDOVER',subjectId:h.id,handoverId:h.id,orderId:f.order.id,createdBy:manager.id}}),v=await db.archiveVersion.create({data:{archiveId:ar.id,version:1,status:'ARCHIVED',templateId:'synthetic',templateVersion:1,businessSnapshotHash:h.manifestHash,partiesSnapshot:[],requiredSigners:['CUSTOMER','PLATFORM'],scopeSnapshot:{}}});await db.documentArchive.update({where:{id:ar.id},data:{currentApprovedVersionId:v.id}});
  assert.equal((await controller.complete(h.id,{admin:manager},{revision:h.revision,idempotencyKey:'complete-offline-return'})).status,'COMPLETED');assert.equal((await controller.complete(h.id,{admin:manager},{revision:h.revision,idempotencyKey:'complete-offline-return'})).status,'COMPLETED');
  assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).status,'SETTLING');assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}})).reservedOrderId,f.order.id);assert.equal(await db.returnSettlement.count({where:{accountId:a.id}}),1);
 }finally{await db.$disconnect();}
});
