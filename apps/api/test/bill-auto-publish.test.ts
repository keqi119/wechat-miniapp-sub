import '../src/common/config';
import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {BillingController} from '../src/billing/billing';
import {billAutoPublishOn,billAutoPublishCutoff,evaluateBillAutoPublication,publishBillAutomatically,scanAutomaticBills} from '../src/billing/auto-publication';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';

let db:Db;
before(()=>{db=new Db();});
after(async()=>{await db.$disconnect();});
const now=new Date('2026-10-29T00:00:00+08:00');
const code=(value:string)=>(error:any)=>error.getResponse?.().error?.code===value;
async function draft(ready=true,dueDate='2026-11-01'){
 const f=await offlineOrder(db);
 const bill=await db.bill.update({where:{id:f.bill.id},data:{status:'DRAFT',dueDate:new Date(dueDate)}});
 if(ready)await approvedOfflineArchive(db,f.order.id);
 return {...f,bill};
}
async function state(id:string){return(await db.bill.findUniqueOrThrow({where:{id}})).status;}
async function effects(id:string){return{
  audits:await db.auditLog.count({where:{resourceType:'bills',resourceId:id,action:'AUTO_PUBLISH',actorType:'SYSTEM'}}),
  notifications:await db.notification.count({where:{resourceType:'bills',resourceId:id}})
 };}
const withNotifications=(tx:any,create:(args:any)=>Promise<any>)=>new Proxy(tx,{get(target,property){return property==='notification'?{create}:Reflect.get(target,property);}});

test('publication uses the Beijing calendar boundary, including month, year and leap-day crossings',()=>{
 assert.equal(billAutoPublishOn(new Date('2026-11-01')),'2026-10-29');
 assert.equal(billAutoPublishOn(new Date('2027-01-02')),'2026-12-30');
 assert.equal(billAutoPublishOn(new Date('2028-03-02')),'2028-02-28');
 assert.equal(billAutoPublishCutoff(new Date('2026-10-28T15:59:59.999Z')).toISOString(),'2026-10-31T00:00:00.000Z');
 assert.equal(billAutoPublishCutoff(new Date('2026-10-28T16:00:00.000Z')).toISOString(),'2026-11-01T00:00:00.000Z');
});

test('a bill stays private before the calendar window and publishes once at midnight without creating payments',async()=>{
 const f=await draft();
 await assert.rejects(publishBillAutomatically(db,f.bill.id,new Date('2026-10-28T15:59:59.999Z')),code('BILL_AUTO_PUBLICATION_NOT_DUE'));
 assert.equal(await state(f.bill.id),'DRAFT');
 assert.equal((await publishBillAutomatically(db,f.bill.id,now)).published,true);
 assert.equal((await publishBillAutomatically(db,f.bill.id,now)).published,false);
 assert.equal(await state(f.bill.id),'PENDING');assert.deepEqual(await effects(f.bill.id),{audits:1,notifications:1});
 assert.equal(await db.payment.count({where:{billId:f.bill.id}}),0);
});

test('late archive approval catches up overdue drafts, and a missing or invalidated archive remains blocked',async()=>{
 const f=await draft(false,'2026-10-01');
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('OFFLINE_ARCHIVE_REQUIRED'));
 const archive=await approvedOfflineArchive(db,f.order.id);
 await db.documentArchive.update({where:{id:archive.archive.id},data:{currentApprovedVersionId:null}});
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('OFFLINE_ARCHIVE_REQUIRED'));
 await db.documentArchive.update({where:{id:archive.archive.id},data:{currentApprovedVersionId:archive.version.id}});
 assert.equal((await publishBillAutomatically(db,f.bill.id,now)).published,true);
});

test('archive snapshot mismatch and unresolved pre-delivery feedback cannot publish or change order revision',async()=>{
 const f=await draft(),archive=await db.documentArchive.findFirstOrThrow({where:{orderId:f.order.id}});
 await db.archiveVersion.update({where:{id:archive.currentApprovedVersionId!},data:{businessSnapshotHash:'b'.repeat(64)}});
 await assert.rejects(evaluateBillAutoPublication(db,f.bill,now),code('ARCHIVE_SNAPSHOT_MISMATCH'));
 await db.archiveVersion.update({where:{id:archive.currentApprovedVersionId!},data:{businessSnapshotHash:'a'.repeat(64)}});
 await db.archiveFeedback.create({data:{versionId:archive.currentApprovedVersionId!,actorType:'CUSTOMER',actorId:f.customer.id,message:'合成反馈'}});
 const before=await db.order.findUniqueOrThrow({where:{id:f.order.id}});
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('ARCHIVE_FEEDBACK_OPEN'));
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).revision,before.revision);
 assert.deepEqual(await effects(f.bill.id),{audits:0,notifications:0});
});

test('legacy electronic contracts require signed archive evidence before automatic publication',async()=>{
 const f=await draft(false);
 await db.order.update({where:{id:f.order.id},data:{contractMode:'ESIGN',status:'AWAITING_SIGNATURE'}});
 await db.contract.update({where:{id:f.contract.id},data:{executionMode:'ESIGN'}});
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('SIGNATURE_ARCHIVE_REQUIRED'));
 await db.contract.update({where:{id:f.contract.id},data:{status:'SIGNED'}});
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('SIGNATURE_ARCHIVE_REQUIRED'));
 const file=await db.storedFile.create({data:{customerId:f.customer.id,name:'synthetic-signed.pdf',mimeType:'application/pdf',size:10,sha256:'c'.repeat(64),storagePath:'synthetic-only',purpose:'contract'}});
 await db.contract.update({where:{id:f.contract.id},data:{signedFileId:file.id}});
 assert.equal((await publishBillAutomatically(db,f.bill.id,now)).published,true);
});

test('cancelled and completed orders and every special bill stay outside automatic publication',async()=>{
 for(const status of ['CANCELLED','COMPLETED'] as const){const f=await draft();await db.order.update({where:{id:f.order.id},data:{status}});await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('ORDER_STATE'));assert.equal(await state(f.bill.id),'DRAFT');}
 const f=await draft();
 for(const type of ['EXTRA_FEE','RETURN_SETTLEMENT','MILEAGE_EXCESS','DELAY_ADJUSTMENT','SWAP_ADJUSTMENT','DEPOSIT_ADJUSTMENT','SWAP_HANDOVER_FEE','MILEAGE_PACK','SWAP_CREDIT']){
  const bill=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type,sequence:1,amount:100,dueDate:new Date('2026-11-01')}});
  await assert.rejects(publishBillAutomatically(db,bill.id,now),code('BILL_AUTO_PUBLICATION_UNSUPPORTED'));
  assert.equal(await state(bill.id),'DRAFT');
 }
 const deposit=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'DEPOSIT',sequence:0,amount:100,dueDate:new Date('2026-11-01')}});
 assert.equal((await publishBillAutomatically(db,deposit.id,now)).published,true);
});

test('an active amendment blocks old rent and keeps a repeated eligibility check read-only',async()=>{
 const f=await draft();
 await db.orderChange.create({data:{orderId:f.order.id,customerId:f.customer.id,priorTermsHash:'a'.repeat(64),priorTerms:{},originalContractId:f.contract.id,reason:'合成延期',createdBy:'synthetic',idempotencyKey:randomUUID(),requestHash:randomUUID()}});
 const original=await db.order.findUniqueOrThrow({where:{id:f.order.id}});
 await assert.rejects(evaluateBillAutoPublication(db,f.bill,now),code('ORDER_CHANGE_PAYMENT_BLOCKED'));
 await assert.rejects(publishBillAutomatically(db,f.bill.id,now),code('ORDER_CHANGE_PAYMENT_BLOCKED'));
 assert.equal((await db.order.findUniqueOrThrow({where:{id:f.order.id}})).revision,original.revision);
});

test('physical receipt pauses future service months while formal return still allows earned unpaid rent',async()=>{
 const f=await draft();await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});
 const future=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'SUBSCRIPTION',sequence:2,amount:100,dueDate:new Date('2026-11-01')}});
 const account=await db.usageAccount.create({data:{orderId:f.order.id,customerId:f.customer.id,policyVersion:'USAGE_V1',startedOn:new Date('2026-10-01'),periods:{create:[{orderId:f.order.id,sequence:1,startDate:new Date('2026-10-01'),endDate:new Date('2026-11-01'),effectiveEndDate:new Date('2026-11-01')},{orderId:f.order.id,sequence:2,startDate:new Date('2026-11-01'),endDate:new Date('2026-12-01'),effectiveEndDate:new Date('2026-12-01')}]}}});
 await db.vehicleReceiptEvent.create({data:{handoverId:randomUUID(),orderId:f.order.id,vehicleId:f.vehicle.id,revision:1,receivedAt:new Date('2026-10-28T15:59:59Z'),readingKm:200,storageLocation:'合成位置',evidenceFileIds:[],createdBy:'synthetic',idempotencyKey:randomUUID(),requestHash:randomUUID()}});
 await assert.rejects(publishBillAutomatically(db,future.id,now),code('PHYSICAL_RETURN_BILL_PAUSED'));
 await db.vehicleReceiptEvent.updateMany({where:{orderId:f.order.id},data:{isCurrent:false}});
 await db.usageAccount.update({where:{id:account.id},data:{returnedOn:new Date('2026-10-28')}});
 await db.usagePeriod.updateMany({where:{accountId:account.id,sequence:2},data:{status:'CANCELLED'}});
 await db.order.update({where:{id:f.order.id},data:{status:'SETTLING'}});
 await assert.rejects(publishBillAutomatically(db,future.id,now),code('RETURN_FUTURE_BILL'));
 assert.equal((await publishBillAutomatically(db,f.bill.id,now)).published,true);
});

test('concurrent scanners publish exactly once and notification failure rolls back both bill and audit',async()=>{
 const f=await draft();
 const results=await Promise.all([publishBillAutomatically(db,f.bill.id,now),publishBillAutomatically(db,f.bill.id,now)]);
 assert.equal(results.filter(r=>r.published).length,1);assert.deepEqual(await effects(f.bill.id),{audits:1,notifications:1});
 const failure=await draft();
 const failing:any={serial:(operation:any)=>db.serial(tx=>operation(withNotifications(tx,async()=>{throw new Error('synthetic notification persistence failure');})))};
 await assert.rejects(publishBillAutomatically(failing,failure.bill.id,now),/synthetic notification persistence failure/);
 assert.equal(await state(failure.bill.id),'DRAFT');assert.deepEqual(await effects(failure.bill.id),{audits:0,notifications:0});
});

test('an order cancelled while the publisher waits for its row lock is re-read and never published',async()=>{
 const f=await draft();let release!:()=>void,held!:()=>void;
 const locked=new Promise<void>(resolve=>{held=resolve;}),continueCancellation=new Promise<void>(resolve=>{release=resolve;});
 const cancellation=db.serial(async tx=>{await tx.order.update({where:{id:f.order.id},data:{status:'CANCELLED'}});held();await continueCancellation;});
 await locked;
 const publication=publishBillAutomatically(db,f.bill.id,now).then(result=>({result,error:null}),error=>({result:null,error}));
 // Let the second database connection contend on the held Order row.
 await new Promise(resolve=>setTimeout(resolve,30));release();await cancellation;
 const outcome=await publication;assert.ok(code('ORDER_STATE')(outcome.error));
 assert.equal(await state(f.bill.id),'DRAFT');assert.deepEqual(await effects(f.bill.id),{audits:0,notifications:0});
});

test('keyset batches move beyond blocked first pages and an unexpected single-bill failure',async()=>{
 const blocked=await draft(false),broken=await draft(),eligible=await draft(),ids=[blocked.order.id,broken.order.id,eligible.order.id];
 const scoped:any={bill:{findMany:(args:any)=>db.bill.findMany({...args,where:{...args.where,orderId:{in:ids}}})},serial:(operation:any)=>db.serial(tx=>operation(withNotifications(tx,async(args:any)=>{if(args.data.resourceId===broken.bill.id)throw new Error('synthetic per-bill failure');return tx.notification.create(args);})))};
 const scan=await scanAutomaticBills(scoped,now,{batchSize:1});
 assert.deepEqual(scan,{scanned:3,published:1,blocked:1,failed:1});
 assert.equal(await state(blocked.bill.id),'DRAFT');assert.equal(await state(broken.bill.id),'DRAFT');assert.equal(await state(eligible.bill.id),'PENDING');
});

test('manual publication cannot bypass ordinary automatic bills while reviewed extra fees retain their path',async()=>{
 const f=await draft(),admin=await db.adminUser.create({data:{username:randomUUID(),passwordHash:'synthetic',name:'测试财务',role:'FINANCE'}}),controller=new BillingController(db,{} as any,{} as any);
 await assert.rejects(controller.publish(f.bill.id,{admin}),code('BILL_AUTO_PUBLICATION_MANAGED'));
 const fee=await db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'EXTRA_FEE',sequence:1,amount:100,dueDate:new Date('2026-11-01'),status:'REVIEWED',createdBy:'different-person',reviewedBy:admin.id}});
 assert.equal((await controller.publish(fee.id,{admin})).status,'PENDING');
});
