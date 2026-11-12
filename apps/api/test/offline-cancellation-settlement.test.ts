import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancellationGate,assertUnsignedEvidence,requireOfflineCancellation} from '../src/offline-documents/cancellation';
import {OrderActionsController} from '../src/orders/order-actions';
import {Db} from '../src/common/db';
import {randomUUID} from 'node:crypto';
import {offlineOrder} from './offline-fixtures';
import {submitOfflineCancellation,reviewOfflineCancellation} from '../src/offline-documents/cancellation';
import {returnView,returnAction} from '../src/usage/returns';
import {hash} from '../src/common/data';
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
test('unknown paper status cannot release an order',()=>{
 assert.deepEqual(cancellationGate({status:'APPROVED',paperStatus:'UNKNOWN'},false,false),{ready:false,code:'PAPER_STATUS_UNKNOWN'});
 assert.equal(cancellationGate(null,false,false).ready,false);
});
test('paper signed but unarchived is not unsigned',()=>{
 assert.equal(cancellationGate({status:'APPROVED',paperStatus:'SIGNED'},false,false).code,'TERMINATION_REQUIRED');
 assert.equal(cancellationGate({status:'APPROVED',paperStatus:'SIGNED'},false,true).ready,true);
});
test('historical archive contradicts an unsigned declaration',()=>{
 assert.throws(()=>assertUnsignedEvidence('UNSIGNED',true),code('PAPER_STATUS_CONFLICT'));
 assert.equal(cancellationGate({status:'APPROVED',paperStatus:'UNSIGNED'},true,false).ready,false);
 assert.equal(cancellationGate({status:'APPROVED',paperStatus:'UNSIGNED'},false,false).ready,true);
});
test('signed cancellation requires current three-party termination archive and no feedback',async()=>{
 let currentHash='old',feedback=0;
 const tx:any={offlineCancellationReview:{findFirst:async()=>({status:'APPROVED',paperStatus:'SIGNED',businessSnapshotHash:'hash'})},archiveVersion:{count:async()=>1},documentArchive:{findFirst:async()=>({currentApprovedVersionId:'v',versions:[{id:'v',status:'ARCHIVED',businessSnapshotHash:currentHash,requiredSigners:['CUSTOMER','OWNER','PLATFORM']}]})},archiveFeedback:{findMany:async()=>feedback?[{version:{archive:{id:'archive',orderId:'o',kind:'TERMINATION',revision:0}}}]:[]}};
 const order={id:'o',contractMode:'OFFLINE',finalPlanSnapshot:{commercialHash:'hash'}};
 await assert.rejects(requireOfflineCancellation(tx,order),code('TERMINATION_REQUIRED'));
 currentHash='hash';await requireOfflineCancellation(tx,order);
 feedback=1;await assert.rejects(requireOfflineCancellation(tx,order),code('ARCHIVE_FEEDBACK_OPEN'));
});
test('legacy draft signature state cannot bypass offline cancellation review',async()=>{
 const order={id:'o',vehicleId:'v',customerId:'c',contractMode:'OFFLINE',status:'AWAITING_PAYMENT',finalPlanSnapshot:{commercialHash:'hash'},contracts:[{id:'contract',status:'DRAFT'}],handovers:[],bills:[]};
 const mutation=async()=>({});
 const tx:any={archiveCommand:{findUnique:async()=>null},$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'staff',role:'ADMIN',active:true,authVersion:0})},order:{findUnique:async()=>order,update:async()=>order},orderChange:{findMany:async()=>[]},vehicle:{findUnique:async()=>({id:'v',status:'RESERVED',reservedOrderId:'o'}),update:mutation},fadadaTask:{findMany:async()=>[]},fieldHandoverTask:{findMany:async()=>[]},returnSettlement:{findMany:async()=>[]},archiveFeedback:{findMany:async()=>[]},bill:{updateMany:mutation},entitlement:{updateMany:mutation},handover:{updateMany:mutation},auditLog:{create:mutation},notification:{create:mutation},offlineCancellationReview:{findFirst:async()=>null},archiveVersion:{count:async()=>0},documentArchive:{findFirst:async()=>null}};
 const controller=new OrderActionsController({serial:(fn:any)=>fn(tx)} as any);
 await assert.rejects(controller.cancel('o',{reason:'客户取消',revision:0,idempotencyKey:'cancel-key'},{admin:{id:'staff',role:'ADMIN',authVersion:0}}),code('CANCELLATION_REVIEW_REQUIRED'));
});
test('final settlement stays blocked by missing return archive or unreconciled cash',async()=>{
 let archived=false,refunds:any[]=[];
 const bill={id:'b',orderId:'o',type:'EXTRA_FEE',sequence:1,status:'PAID',amount:100,paidAmount:100,dueDate:new Date('2026-10-01'),payments:[{status:'SUCCEEDED',amount:100,reconciliationRequired:true,get refunds(){return refunds;}}]};
 const order={id:'o',contractMode:'OFFLINE',status:'SETTLING',finalPlanSnapshot:{commercialHash:'hash'}},h={id:'h',orderId:'o',manifestHash:'manifest',type:'RETURN'};
 const tx:any={$queryRaw:async()=>[],usageAccount:{findUniqueOrThrow:async()=>({id:'a'})},usagePeriod:{findMany:async()=>[],aggregate:async()=>({_max:{sequence:1,endDate:new Date('2026-10-01')}})},bill:{findMany:async()=>[bill]},serviceObligation:{findMany:async()=>[]},mileagePurchase:{count:async()=>0},swapCreditPurchase:{count:async()=>0},order:{findUniqueOrThrow:async()=>order,findUnique:async()=>order},handover:{findFirst:async()=>h,findUnique:async()=>h},archiveFeedback:{count:async()=>0},documentArchive:{findFirst:async({where}:any)=>where.kind==='RENTAL'?{id:'rental',currentApprovedVersionId:'rv',versions:[{id:'rv',status:'ARCHIVED',businessSnapshotHash:'hash'}]}:archived?{id:'return',currentApprovedVersionId:'hv',versions:[{id:'hv',status:'ARCHIVED',businessSnapshotHash:'manifest'}]}:null}};
 const record={id:'s',orderId:'o',accountId:'a',status:'PENDING_PAYMENT',revision:0,returnedOn:new Date('2026-10-02')};
 let view=await returnView(tx,record,true);assert.equal(view.canComplete,false);assert.ok(view.documentBlockers.includes('OFFLINE_ARCHIVE_REQUIRED'));
 archived=true;view=await returnView(tx,record,true);assert.equal(view.documentBlockers.length,0);assert.equal(view.exceptionalCash,true);assert.equal(view.canComplete,false);
 refunds=[{status:'SUCCEEDED',amount:100}];assert.equal((await returnView(tx,record,true)).canComplete,true);
});
test('stale finance sessions cannot replay or execute settlement commands',async()=>{
 const record={id:'r',orderId:'o',accountId:'a',status:'COMPLETED',revision:1,returnedOn:new Date('2026-10-27')},input={revision:0,idempotencyKey:'settlement-key'};
 const tx:any={$queryRaw:async()=>[],adminUser:{findUnique:async()=>({id:'finance',role:'FINANCE',active:true,authVersion:2})},order:{update:async()=>({}),findUniqueOrThrow:async()=>({contractMode:'ESIGN'})},returnSettlement:{findUniqueOrThrow:async()=>record},usageAccount:{findUnique:async()=>({id:'a'}),update:async()=>({id:'a'}),findUniqueOrThrow:async()=>({id:'a'})},auditLog:{findFirst:async()=>({data:{requestHash:hash(input)}})},usagePeriod:{findMany:async()=>[],aggregate:async()=>({_max:{sequence:1}})},bill:{findMany:async()=>[]},serviceObligation:{findMany:async()=>[]},mileagePurchase:{count:async()=>0},swapCreditPurchase:{count:async()=>0}};
 await assert.rejects(returnAction(tx,record,'COMPLETE',input,'finance',{id:'finance',role:'FINANCE',authVersion:1}),code('STAFF_SESSION_CHANGED'));
});
test('database: single-operator signing confirmation, three-party termination and cash checks precede release',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const db=new Db();
 try{
  const f=await offlineOrder(db),submitter=await db.adminUser.create({data:{username:randomUUID(),name:'提交运营',role:'OPERATIONS',passwordHash:'synthetic'}}),reviewer=await db.adminUser.create({data:{username:randomUUID(),name:'复核运营',role:'OPERATIONS',passwordHash:'synthetic'}});
  await db.vehicle.update({where:{id:f.vehicle.id},data:{reservedOrderId:f.order.id}});
  const file=await db.storedFile.create({data:{name:'取消核实.pdf',mimeType:'application/pdf',size:20,sha256:'c'.repeat(64),storagePath:'synthetic-only',purpose:'evidence',adminId:submitter.id}});
  const controller=new OrderActionsController(db),cancelInput={reason:'合成取消原因',revision:0,idempotencyKey:randomUUID()};
  const unknown=await db.serial(tx=>submitOfflineCancellation(tx,submitter,f.order.id,{paperStatus:'UNKNOWN',reason:'待核实',evidenceFileIds:[file.id],revision:0,idempotencyKey:randomUUID()}));
  const review={reviewId:unknown.id,revision:unknown.revision,decision:'APPROVED',reason:'独立核实',idempotencyKey:randomUUID()};
  assert.equal(unknown.status,'APPROVED');
  await assert.rejects(controller.cancel(f.order.id,cancelInput,{admin:reviewer}),code('PAPER_STATUS_UNKNOWN'));assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}})).reservedOrderId,f.order.id);
  const signed=await db.serial(tx=>submitOfflineCancellation(tx,submitter,f.order.id,{paperStatus:'SIGNED',reason:'已核实纸质签署',evidenceFileIds:[file.id],revision:unknown.revision,idempotencyKey:randomUUID()}));assert.equal(signed.status,'APPROVED');
  await assert.rejects(controller.cancel(f.order.id,cancelInput,{admin:reviewer}),code('TERMINATION_REQUIRED'));
  const archive=await db.documentArchive.create({data:{kind:'TERMINATION',subjectType:'ORDER',subjectId:f.order.id,orderId:f.order.id,createdBy:submitter.id}}),v=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,status:'ARCHIVED',templateId:'synthetic',templateVersion:1,businessSnapshotHash:'a'.repeat(64),partiesSnapshot:[],requiredSigners:['CUSTOMER','OWNER','PLATFORM'],scopeSnapshot:{}}});await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:v.id}});
  const pending=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:100,status:'PENDING',idempotencyKey:randomUUID()}});
  await assert.rejects(controller.cancel(f.order.id,cancelInput,{admin:reviewer}),code('PAYMENT_PENDING'));await db.payment.update({where:{id:pending.id},data:{status:'CLOSED'}});
  const result=await controller.cancel(f.order.id,cancelInput,{admin:reviewer});assert.equal(result.status,'CANCELLED');assert.equal((await controller.cancel(f.order.id,cancelInput,{admin:reviewer})).id,result.id);assert.equal((await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}})).reservedOrderId,null);assert.equal((await db.bill.findUniqueOrThrow({where:{id:f.bill.id}})).status,'VOID');
 }finally{await db.$disconnect();}
});

test('single operator confirms without mandatory evidence and can confirm legacy submission',async()=>{
 const db=new Db();try{
 const f=await offlineOrder(db),actor=await db.adminUser.create({data:{username:randomUUID(),name:'合成运营',role:'OPERATIONS',passwordHash:'synthetic'}});
 const first=await db.serial(tx=>submitOfflineCancellation(tx,actor,f.order.id,{paperStatus:'UNSIGNED',reason:'客户未线下签署',revision:0,idempotencyKey:randomUUID()}));
 assert.equal(first.status,'APPROVED');assert.equal(first.reviewedBy,actor.id);assert.deepEqual(first.evidenceFileIds,[]);
 await db.offlineCancellationReview.update({where:{id:first.id},data:{status:'SUBMITTED',reviewedBy:null,reviewedAt:null}});
 const old=await db.serial(tx=>reviewOfflineCancellation(tx,actor,f.order.id,{reviewId:first.id,revision:first.revision,decision:'APPROVED',reason:'本人确认签署事实',idempotencyKey:randomUUID()}));
 assert.equal(old.status,'APPROVED');assert.equal(old.reviewedBy,actor.id);
 }finally{await db.$disconnect();}
});
