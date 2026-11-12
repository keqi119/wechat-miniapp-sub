import '../src/common/config';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {OrderCancellationReadinessController} from '../src/orders/cancellation-readiness.controller';
import {OrderActionsController} from '../src/orders/order-actions';
import {submitOfflineCancellation} from '../src/offline-documents/cancellation';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';

let db:Db,controller:OrderCancellationReadinessController,cancel:OrderActionsController,operator:any,reviewer:any,finance:any,support:any,field:any;
const errorCode=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;
before(async()=>{db=new Db();controller=new OrderCancellationReadinessController(db);cancel=new OrderActionsController(db);const staff=async(role:string)=>db.adminUser.create({data:{username:randomUUID(),name:'合成取消人员',role:role as any,passwordHash:'synthetic-disabled-password'}});operator=await staff('OPERATIONS');reviewer=await staff('ADMIN');finance=await staff('FINANCE');support=await staff('SUPPORT');field=await staff('FIELD');});
after(()=>db.$disconnect());
async function fixture(paperStatus='UNSIGNED',status='APPROVED'){
 const f=await offlineOrder(db);await db.vehicle.update({where:{id:f.vehicle.id},data:{reservedOrderId:f.order.id}});await db.order.update({where:{id:f.order.id},data:{status:'AWAITING_PAYMENT'}});
 const evidence=await db.storedFile.create({data:{name:'合成核实.pdf',mimeType:'application/pdf',size:20,sha256:'c'.repeat(64),storagePath:'synthetic-only',purpose:'evidence',adminId:operator.id}});
 const review=await db.offlineCancellationReview.create({data:{orderId:f.order.id,revision:1,paperStatus,status,businessSnapshotHash:'a'.repeat(64),reason:'合成核实说明',evidenceFileIds:[evidence.id],submittedBy:operator.id,...(status==='APPROVED'?{reviewedBy:reviewer.id}:{}),idempotencyKey:randomUUID(),requestHash:randomUUID()}});
 return{...f,evidence,review};
}
async function termination(orderId:string,signers=['CUSTOMER','OWNER','PLATFORM']){
 const archive=await db.documentArchive.create({data:{kind:'TERMINATION',subjectType:'ORDER',subjectId:orderId,orderId,createdBy:operator.id}});
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,status:'ARCHIVED',templateId:'synthetic',templateVersion:1,businessSnapshotHash:'a'.repeat(64),partiesSnapshot:[],requiredSigners:signers,scopeSnapshot:{}}});
 await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:version.id}});return{archive,version};
}
async function fingerprint(){
 const tables:any[]=await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");const result=[];
 for(const {tablename} of tables){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const digest:any[]=await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM "${tablename}" t`);result.push([tablename,digest[0].digest]);}return result;
}
const view=(id:string,actor=reviewer)=>controller.readiness(id,{admin:actor});
const command=async(id:string,actor=reviewer)=>cancel.cancel(id,{reason:'合成取消测试',revision:(await db.order.findUniqueOrThrow({where:{id}})).revision,idempotencyKey:randomUUID()},{admin:actor});

test('historical signed rental skips duplicate confirmation and unlocks only termination',async()=>{
 const f=await fixture('SIGNED','SUBMITTED');await approvedOfflineArchive(db,f.order.id);
 const before=await fingerprint(),v=await view(f.order.id,operator);
 assert.deepEqual(await fingerprint(),before);assert.equal(v.mode,'PRE_DELIVERY_CANCEL');assert.equal(v.canCancel,false);
 assert(!v.blockers.some(b=>b.code==='CANCELLATION_REVIEW_REQUIRED'));assert(v.blockers.some(b=>b.code==='TERMINATION_REQUIRED'));
 assert.equal(v.currentStep,'TERMINATION');assert.equal(v.steps.find(s=>s.key==='EVIDENCE')?.state,'DONE');
 assert.equal(v.steps.find(s=>s.key==='FUNDS')?.state,'WAITING');assert(!v.steps.some(s=>'parallelGroup' in s));
 assert.equal(v.actions.find(a=>a.key==='CREATE_ARCHIVE')?.enabled,true);
 await db.offlineCancellationReview.delete({where:{id:f.review.id}});assert.equal((await view(f.order.id)).currentStep,'TERMINATION');
 const term=await termination(f.order.id);await db.archiveVersion.update({where:{id:term.version.id},data:{status:'REVIEWED'}});
 assert.equal((await view(f.order.id)).canCancel,false);await db.archiveVersion.update({where:{id:term.version.id},data:{status:'ARCHIVED'}});
 assert.equal((await view(f.order.id)).canCancel,true);
});

test('legacy submitted confirmation permits its submitter and uploader, later actions wait',async()=>{
 const f=await fixture('SIGNED','SUBMITTED');const v=await view(f.order.id,operator);
 assert.equal(v.actions.find(a=>a.key==='REVIEW_CANCELLATION_EVIDENCE')?.enabled,true);
 assert.equal(v.currentStep,'EVIDENCE');assert.equal(v.actions.find(a=>a.key==='CREATE_ARCHIVE')?.enabled,false);
 const p=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,status:'SUCCEEDED',amount:100,idempotencyKey:randomUUID()}});
 const pending=await view(f.order.id);assert.equal(pending.steps.find(s=>s.key==='FUNDS')?.state,'WAITING');
 assert.equal(pending.actions.find(a=>a.key==='REQUEST_REFUND'&&a.target.id===p.id)?.enabled,false);
});

test('unsigned approved cancellation does not require payment, insurance or termination; command agrees and replays once',async()=>{
 const f=await fixture(),v=await view(f.order.id);assert.equal(v.canCancel,true);assert.equal(v.blockers.length,0);assert.equal(v.steps.find(s=>s.key==='TERMINATION')?.state,'NOT_APPLICABLE');
 const body={reason:'合成未交付取消',revision:v.orderRevision,idempotencyKey:randomUUID()},first=await cancel.cancel(f.order.id,body,{admin:reviewer}),again=await cancel.cancel(f.order.id,body,{admin:reviewer});
 assert.equal(first.status,'CANCELLED');assert.deepEqual(first,again);assert.equal(await db.auditLog.count({where:{action:'CANCEL',resourceType:'orders',resourceId:f.order.id}}),1);
 assert.equal((await db.bill.findUniqueOrThrow({where:{id:f.bill.id}})).status,'VOID');const vehicle=await db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});assert.equal(vehicle.status,'UNPUBLISHED');assert.equal(vehicle.reservedOrderId,null);
 const result=await view(f.order.id);assert.equal(result.mode,'TERMINAL');assert.equal(result.currentStep,'RESULT');assert.equal(result.canCancel,false);assert(!result.actions.some(a=>a.kind==='OPEN_FORM'&&a.enabled));
});

test('one-cent test cash must be fully refunded, then never creates a new rent obligation for cancellation',async()=>{
 const f=await fixture('SIGNED');await approvedOfflineArchive(db,f.order.id);const term=await termination(f.order.id);
 const bill=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'PAYMENT_TEST',sequence:2,amount:1,paidAmount:1,status:'PAID',dueDate:new Date()}}),payment=await db.payment.create({data:{billId:bill.id,customerId:f.customer.id,amount:1,status:'SUCCEEDED',reconciliationRequired:true,idempotencyKey:randomUUID()}});
 let v=await view(f.order.id);assert.equal(v.canCancel,false);assert(v.blockers.some(b=>b.code==='REFUND_REQUIRED'));assert.equal(v.actions.find(a=>a.key==='REQUEST_REFUND')?.target.id,payment.id);
 await db.refund.create({data:{paymentId:payment.id,customerId:f.customer.id,amount:1,status:'SUCCEEDED',reason:'合成退款',requestedBy:operator.id,approvedBy:reviewer.id,idempotencyKey:randomUUID()}});
 v=await view(f.order.id);assert.equal(v.canCancel,true);assert.equal(v.related.terminationArchive?.id,term.archive.id);assert.equal(v.related.payments[0].refundedAmount,1);assert.equal(v.related.payments[0].orderId,f.order.id);assert.equal((await command(f.order.id)).status,'CANCELLED');
});

test('readiness and final command retain every existing cancellation blocker',async()=>{
 const cases:[string,(f:Awaited<ReturnType<typeof fixture>>)=>Promise<unknown>][]=[
  ['PAPER_STATUS_UNKNOWN',f=>db.offlineCancellationReview.update({where:{id:f.review.id},data:{paperStatus:'UNKNOWN'}})],
  ['PAPER_STATUS_CONFLICT',f=>approvedOfflineArchive(db,f.order.id)],
  ['CANCELLATION_REVIEW_STALE',f=>db.offlineCancellationReview.update({where:{id:f.review.id},data:{businessSnapshotHash:'b'.repeat(64)}})],
  ['TERMINATION_REQUIRED',f=>db.offlineCancellationReview.update({where:{id:f.review.id},data:{paperStatus:'SIGNED'}})],
  ['ARCHIVE_FEEDBACK_OPEN',async f=>{const t=await termination(f.order.id);return db.archiveFeedback.create({data:{versionId:t.version.id,actorType:'CUSTOMER',actorId:f.customer.id,message:'合成反馈'}});}],
  ['VEHICLE_OWNERSHIP',f=>db.vehicle.update({where:{id:f.vehicle.id},data:{reservedOrderId:null}})],
  ['CHANGE_ACTIVE',f=>db.orderChange.create({data:{orderId:f.order.id,customerId:f.customer.id,priorTermsHash:'a'.repeat(64),priorTerms:{},originalContractId:f.contract.id,reason:'合成变更',createdBy:operator.id,idempotencyKey:randomUUID(),requestHash:randomUUID()}})],
  ['SIGNATURE_PENDING',f=>db.contract.update({where:{id:f.contract.id},data:{status:'PENDING'}})],
  ['PAYMENT_PENDING',f=>db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:100,status:'PENDING',idempotencyKey:randomUUID()}})],
  ['REFUND_PENDING',async f=>{const p=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:100,status:'SUCCEEDED',idempotencyKey:randomUUID()}});return db.refund.create({data:{paymentId:p.id,customerId:f.customer.id,amount:100,status:'PROCESSING',reason:'合成退款',requestedBy:reviewer.id,idempotencyKey:randomUUID()}});}],
  ['REFUND_REQUIRED',f=>db.bill.update({where:{id:f.bill.id},data:{paidAmount:100}})],
 ];
 for(const [code,change] of cases){const f=await fixture();await change(f);const before=await db.order.findUniqueOrThrow({where:{id:f.order.id}}),v=await view(f.order.id);assert.equal(v.canCancel,false,code);assert(v.blockers.some(b=>b.code===code),code);await assert.rejects(command(f.order.id),errorCode(code));assert.deepEqual(await db.order.findUniqueOrThrow({where:{id:f.order.id}}),before);}
});

test('termination must match the current order, approved version, snapshot and all three parties',async()=>{
 const f=await fixture('SIGNED'),other=await fixture('SIGNED');await termination(other.order.id);assert((await view(f.order.id)).blockers.some(b=>b.code==='TERMINATION_REQUIRED'));
 const t=await termination(f.order.id,['CUSTOMER','PLATFORM']);assert((await view(f.order.id)).blockers.some(b=>b.code==='TERMINATION_REQUIRED'));
 await db.archiveVersion.update({where:{id:t.version.id},data:{requiredSigners:['CUSTOMER','OWNER','PLATFORM'],businessSnapshotHash:'b'.repeat(64)}});assert((await view(f.order.id)).blockers.some(b=>b.code==='TERMINATION_REQUIRED'));
 await db.archiveVersion.update({where:{id:t.version.id},data:{businessSnapshotHash:'a'.repeat(64)}});assert.equal((await view(f.order.id)).canCancel,true);
});

test('completed delivery routes to return and settlement, never a cancellation command',async()=>{
 const f=await fixture();await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,vehicleId:f.vehicle.id,type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',readingKm:100,fileIds:[],checklist:[],manifestHash:'synthetic-delivery'}});
 const v=await view(f.order.id);assert.equal(v.mode,'POST_DELIVERY_RETURN');assert.equal(v.canCancel,false);assert(v.actions.some(a=>a.key==='OPEN_RETURN'&&a.target.orderId===f.order.id));assert(!v.actions.some(a=>a.key==='CANCEL_ORDER'&&a.enabled));await assert.rejects(command(f.order.id),errorCode('SIGNATURE_PENDING'));
});

test('only relevant same-order records appear and finance sees no cancellation evidence or archive details',async()=>{
 const f=await fixture('SIGNED','SUBMITTED'),other=await fixture('SIGNED');const term=await termination(f.order.id),otherTerm=await termination(other.order.id);await db.payment.create({data:{billId:other.bill.id,customerId:other.customer.id,amount:100,status:'PENDING',idempotencyKey:randomUUID()}});
 const v=await view(f.order.id,finance);assert.equal(v.related.review,null);assert.equal(v.related.terminationArchive,null);assert.deepEqual(v.related.tasks,[]);assert(!JSON.stringify(v).includes(f.evidence.id));assert(!JSON.stringify(v).includes(term.archive.id));assert(!JSON.stringify(v).includes(other.order.id));assert(!JSON.stringify(v).includes(otherTerm.archive.id));assert(!v.actions.some(a=>['CANCEL_ORDER','SUBMIT_CANCELLATION_REVIEW','REVIEW_CANCELLATION_EVIDENCE','CREATE_ARCHIVE'].includes(a.key)&&a.enabled));
 await assert.rejects(view(f.order.id,support),errorCode('FORBIDDEN'));await assert.rejects(view(f.order.id,field),errorCode('FORBIDDEN'));await assert.rejects(view(f.order.id,{...reviewer,authVersion:reviewer.authVersion+1}),errorCode('STAFF_SESSION_CHANGED'));await assert.rejects(view(randomUUID()),errorCode('NOT_FOUND'));
});

test('a fresh projection does not bypass later business changes or order revision checks',async()=>{
 const f=await fixture(),ready=await view(f.order.id);assert.equal(ready.canCancel,true);
 await db.order.update({where:{id:f.order.id},data:{revision:{increment:1}}});await assert.rejects(cancel.cancel(f.order.id,{reason:'合成',revision:ready.orderRevision,idempotencyKey:randomUUID()},{admin:reviewer}),errorCode('REVISION_CONFLICT'));
 await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,amount:100,status:'CREATING',idempotencyKey:randomUUID()}});await assert.rejects(command(f.order.id),errorCode('PAYMENT_PENDING'));
});

test('open feedback navigates to its actual same-order archive and remains private from finance',async()=>{
 const f=await fixture('SIGNED');await approvedOfflineArchive(db,f.order.id);await termination(f.order.id);
 const rental=await db.documentArchive.findFirstOrThrow({where:{orderId:f.order.id,kind:'RENTAL'}});
 await db.archiveFeedback.create({data:{versionId:rental.currentApprovedVersionId!,actorType:'CUSTOMER',actorId:f.customer.id,message:'合成待处理原件反馈'}});
 const v=await view(f.order.id),blocked=v.blockers.find(b=>b.code==='ARCHIVE_FEEDBACK_OPEN')!;
 assert.equal(blocked.action?.key,'OPEN_ARCHIVE');assert.equal(blocked.action?.target.id,rental.id);assert.equal(blocked.action?.target.orderId,f.order.id);assert.equal(blocked.action?.target.section,'RENTAL');assert.equal(blocked.action?.expectedRevision,rental.revision);
 const financial=await view(f.order.id,finance);assert(!JSON.stringify(financial).includes(rental.id));assert.equal(financial.blockers.find(b=>b.code==='ARCHIVE_FEEDBACK_OPEN')?.action?.enabled,false);
});

test('finance can inspect payments but cannot execute final cancellation or replay another staff session',async()=>{
 const f=await fixture();await assert.rejects(command(f.order.id,finance),errorCode('FORBIDDEN'));
 const ready=await view(f.order.id),body={reason:'合成权限取消',revision:ready.orderRevision,idempotencyKey:randomUUID()};await cancel.cancel(f.order.id,body,{admin:reviewer});
 await assert.rejects(cancel.cancel(f.order.id,body,{admin:{...reviewer,authVersion:reviewer.authVersion+1}}),errorCode('STAFF_SESSION_CHANGED'));
});

test('a pending field task is attention, never a fabricated cancellation requirement or implicit task cancellation',async()=>{
 const f=await fixture(),task=await db.fieldHandoverTask.create({data:{batchKey:'DELIVERY:INITIAL',orderId:f.order.id,vehicleId:f.vehicle.id,type:'DELIVERY',assigneeId:field.id,createdBy:operator.id,updatedBy:operator.id}});
 const v=await view(f.order.id);assert.equal(v.canCancel,true);assert.equal(v.blockers.length,0);
 const attention=v.attention.find(c=>c.code==='FIELD_TASK_REMAINS')!;assert.equal(attention.action?.target.id,task.id);assert.equal(attention.action?.expectedRevision,task.version);assert.equal(v.related.tasks[0].orderId,f.order.id);
 await command(f.order.id);assert.deepEqual(await db.fieldHandoverTask.findUniqueOrThrow({where:{id:task.id}}),task);
});

test('only unfinished signing tasks of this order block cancellation and link to the actual contract',async()=>{
 const f=await fixture(),other=await fixture();
 const seed=(order:any,contract:any)=>db.fadadaTask.create({data:{kind:'CONTRACT',resourceId:contract.id,customerId:order.customerId,documentHash:randomUUID(),sourcePdfHash:'synthetic',sourceFileId:'synthetic',approvalId:randomUUID(),providerEnvelopeId:randomUUID(),customerProviderId:'synthetic',platformProviderId:'synthetic',customerTransactionId:randomUUID(),platformTransactionId:randomUUID()}});
 await seed(other.order,other.contract);assert.equal((await view(f.order.id)).canCancel,true);
 const task=await seed(f.order,f.contract),v=await view(f.order.id),blocked=v.blockers.find(b=>b.code==='SIGNATURE_PENDING')!;assert.equal(v.canCancel,false);assert.equal(blocked.action?.key,'OPEN_CONTRACT');assert.equal(blocked.action?.target.id,f.contract.id);await assert.rejects(command(f.order.id),errorCode('SIGNATURE_PENDING'));
 await db.fadadaTask.update({where:{id:task.id},data:{status:'EXPIRED'}});assert.equal((await view(f.order.id)).canCancel,true);
});

test('refund approval remains independent, role protected and incomplete until channel success',async()=>{
 const f=await fixture(),p=await db.payment.create({data:{billId:f.bill.id,customerId:f.customer.id,status:'SUCCEEDED',amount:100,idempotencyKey:randomUUID()}}),refund=await db.refund.create({data:{paymentId:p.id,customerId:f.customer.id,amount:100,status:'PENDING_APPROVAL',reason:'合成权限退款',requestedBy:finance.id,idempotencyKey:randomUUID()}});
 const byFinance=await view(f.order.id,finance),byOperator=await view(f.order.id,operator),byReviewer=await view(f.order.id,reviewer);
 assert.equal(byFinance.actions.find(a=>a.key==='REVIEW_REFUND')?.enabled,false);assert.equal(byOperator.actions.find(a=>a.key==='REVIEW_REFUND')?.enabled,false);assert.equal(byReviewer.actions.find(a=>a.key==='REVIEW_REFUND')?.enabled,true);assert.equal(byReviewer.actions.find(a=>a.key==='REVIEW_REFUND')?.target.id,refund.id);
 await db.refund.update({where:{id:refund.id},data:{status:'PROCESSING',approvedBy:reviewer.id}});const processing=await view(f.order.id,finance);assert.equal(processing.canCancel,false);assert.equal(processing.actions.find(a=>a.key==='SYNC_REFUND')?.enabled,true);
 await db.refund.update({where:{id:refund.id},data:{status:'SUCCEEDED'}});assert.equal((await view(f.order.id)).canCancel,true);
});

test('active change navigation belongs to operations and gives finance an explicit responsible-role message',async()=>{
 const f=await fixture();await db.orderChange.create({data:{orderId:f.order.id,customerId:f.customer.id,priorTermsHash:'a'.repeat(64),priorTerms:{},originalContractId:f.contract.id,reason:'合成变更',createdBy:operator.id,idempotencyKey:randomUUID(),requestHash:randomUUID()}});
 const byFinance=(await view(f.order.id,finance)).blockers.find(b=>b.code==='CHANGE_ACTIVE')!.action!;
 assert.equal(byFinance.enabled,false);assert.match(byFinance.disabledReason||'',/运营/);assert.equal(byFinance.target.id,undefined);
 assert.equal((await view(f.order.id,operator)).blockers.find(b=>b.code==='CHANGE_ACTIVE')?.action?.enabled,true);
});

test('reviewed signed rental is historical signing evidence even before formal archival',async()=>{
 const f=await fixture('SIGNED','SUBMITTED');await approvedOfflineArchive(db,f.order.id);
 await db.archiveVersion.updateMany({where:{archive:{orderId:f.order.id,kind:'RENTAL'}},data:{status:'REVIEWED'}});
 await db.offlineCancellationReview.delete({where:{id:f.review.id}});
 const v=await view(f.order.id,operator);assert.equal(v.currentStep,'TERMINATION');assert.equal(v.signing.paperStatus,'SIGNED');
 assert.equal(v.signing.source,'ARCHIVE');assert(!v.blockers.some(b=>b.code==='CANCELLATION_REVIEW_REQUIRED'));
 await assert.rejects(db.serial(tx=>submitOfflineCancellation(tx,operator,f.order.id,{paperStatus:'UNSIGNED',reason:'不能否认已审核签字版',revision:0,idempotencyKey:randomUUID()})),errorCode('PAPER_STATUS_CONFLICT'));
 assert.equal(v.canCancel,false);
});
