import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {JourneyHarness} from './seven-module-journey-fixtures';

const sourceReference={fileSha256:'a'.repeat(64),sheetName:'合成库存清单',cellReference:'AR4'};
const action='CORRECT_INVENTORY_MILEAGE';
const route=(vehicleId:string)=>`/admin/vehicle-assets/${vehicleId}/mileage-correction`;
const body=(vehicle:any,orderId:string|null=null)=>({vehicleRevision:vehicle.revision,previousMileageKm:vehicle.mileageKm,mileageKm:33000,reason:'仅隔离测试库：核对合成库存误填读数',sourceReference,expectedReservedOrderId:orderId,expectedOrderStatus:orderId?'AWAITING_PAYMENT':null,idempotencyKey:randomUUID()});
const car=(label:string)=>({title:`合成里程 ${label}`,brand:'合成',model:'EV',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:12000,status:'PUBLISHED' as const});
const withoutUpdatedAt=(row:any)=>{const {updatedAt,...rest}=row;return rest;};

async function reservation(h:JourneyHarness,label:string){
 const vehicle=await h.db.vehicle.create({data:car(label)});
 const customer=await h.db.customer.create({data:{mobile:`synthetic-mileage-${randomUUID()}`,name:'合成里程客户',profile:{}}});
 const plan=await h.db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成月付方案',months:1,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'充换电自付',benefits:[],conditions:''}});
 const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,status:'FINAL_PLAN_CONFIRMED',profile:{synthetic:true},consents:[],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
 const order=await h.db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,status:'AWAITING_PAYMENT',contractMode:'OFFLINE',confirmedMileageKm:12000,finalPlanSnapshot:{synthetic:true,vehicle:{id:vehicle.id,mileageKm:12000},monthlyFeeAmount:10000,depositAmount:20000}}});
 const reserved=await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'RESERVED',reservedOrderId:order.id}});
 return{vehicle:reserved,customer,plan,application,order};
}

async function unchangedAfterReject(h:JourneyHarness,fixture:Awaited<ReturnType<typeof reservation>>,code:string){
 const vehicleBefore=await h.db.vehicle.findUniqueOrThrow({where:{id:fixture.vehicle.id}}),orderBefore=await h.db.order.findUniqueOrThrow({where:{id:fixture.order.id}});
 const input=body(vehicleBefore,fixture.order.id);
 await h.reject(route(fixture.vehicle.id),input,h.reviewer,code);
 assert.deepEqual(await h.db.vehicle.findUniqueOrThrow({where:{id:fixture.vehicle.id}}),vehicleBefore);
 assert.deepEqual(await h.db.order.findUniqueOrThrow({where:{id:fixture.order.id}}),orderBefore);
 assert.equal(await h.db.auditLog.count({where:{action,resourceId:fixture.vehicle.id}}),0);
 assert.equal(await h.db.archiveCommand.count({where:{actorId:h.reviewer.id,action,key:input.idempotencyKey}}),0);
}

test('inventory mileage correction real HTTP/DB retains reservation facts and fails closed for used vehicles',{skip:process.env.NODE_ENV!=='test'},async t=>{
 const {JourneyHarness}=await import('./seven-module-journey-fixtures');
 const h=new JourneyHarness();try{
  await h.start();
  const financeCounts=await Promise.all([h.db.payment.count(),h.db.refund.count(),h.db.assetCostEntry.count(),h.db.assetManualPaymentRecord.count()]);

  await t.test('ADMIN only; same-key concurrent requests change current mileage once and retain asset initial mileage',async()=>{
   const vehicle=await h.db.vehicle.create({data:car('无占用')}),path=route(vehicle.id),input=body(vehicle);
   const profile=await h.db.vehicleAssetProfile.create({data:{vehicleId:vehicle.id,initialMileageKm:9000,batteryOwnership:'BAAS',createdBy:h.reviewer.id,updatedBy:h.reviewer.id}});
   for(const actor of [h.maker,h.finance,h.support,h.field])await h.reject(path,input,actor,'FORBIDDEN');
   assert.deepEqual(await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}}),vehicle);
   const replies=await Promise.all([h.raw(path,input,h.reviewer),h.raw(path,input,h.reviewer)]);
   assert.deepEqual(replies.map(reply=>reply.status),[201,201]);assert.deepEqual(replies[0].data,replies[1].data);
   assert.equal(replies[0].data.mileageKm,33000);assert.equal(replies[0].data.vehicleRevision,vehicle.revision+1);
   const after=await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}});
   assert.deepEqual(withoutUpdatedAt(after),{...withoutUpdatedAt(vehicle),mileageKm:33000,revision:vehicle.revision+1});
   assert.deepEqual(await h.db.vehicleAssetProfile.findUniqueOrThrow({where:{vehicleId:vehicle.id}}),profile);
   const audits=await h.db.auditLog.findMany({where:{action,resourceId:vehicle.id}});assert.equal(audits.length,1);
   const audit:any=audits[0].data;assert.equal(audit.before.mileageKm,12000);assert.equal(audit.after.mileageKm,33000);assert.deepEqual(audit.sourceReference,sourceReference);assert.equal(audits[0].actorId,h.reviewer.id);
   assert.equal(await h.db.archiveCommand.count({where:{actorId:h.reviewer.id,action,key:input.idempotencyKey}}),1);
   await h.reject(path,{...input,mileageKm:34000},h.reviewer,'IDEMPOTENCY_CONFLICT');
   await h.reject(path,{...input,idempotencyKey:randomUUID()},h.reviewer,'REVISION_CONFLICT');
  });

  await t.test('explicit AWAITING_PAYMENT reservation succeeds without changing order, application, contract or financial snapshots',async()=>{
   const f=await reservation(h,'待支付占用');
   // Controlled local facts; no payment/signature provider or business workflow is invoked.
   const contract=await h.db.contract.create({data:{orderId:f.order.id,customerId:f.customer.id,executionMode:'OFFLINE',documentHash:'b'.repeat(64),status:'SIGNED',body:'合成历史合同，不用于真实签署'}});
   const bill=await h.db.bill.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'RENT',sequence:1,amount:10000,paidAmount:0,dueDate:new Date('2026-10-31T00:00:00Z'),status:'PENDING'}});
   const input=body(f.vehicle,f.order.id),path=route(f.vehicle.id);
   const replies=await Promise.all([h.raw(path,input,h.reviewer),h.raw(path,input,h.reviewer)]);assert.deepEqual(replies.map(reply=>reply.status),[201,201]);assert.deepEqual(replies[0].data,replies[1].data);
   assert.equal(replies[0].data.reservedOrderId,f.order.id);assert.equal(replies[0].data.status,'RESERVED');assert.equal(replies[0].data.mileageKm,33000);
   assert.deepEqual(await h.db.order.findUniqueOrThrow({where:{id:f.order.id}}),f.order);
   assert.deepEqual(await h.db.application.findUniqueOrThrow({where:{id:f.application.id}}),f.application);
   assert.deepEqual(await h.db.subscriptionPlan.findUniqueOrThrow({where:{id:f.plan.id}}),f.plan);
   assert.deepEqual(await h.db.contract.findUniqueOrThrow({where:{id:contract.id}}),contract);
   assert.deepEqual(await h.db.bill.findUniqueOrThrow({where:{id:bill.id}}),bill);
   assert.equal(await h.db.vehicleAssignment.count({where:{vehicleId:f.vehicle.id}}),0);assert.equal(await h.db.handover.count({where:{orderId:f.order.id}}),0);assert.equal(await h.db.mileage.count({where:{orderId:f.order.id}}),0);
   const audits=await h.db.auditLog.findMany({where:{action,resourceId:f.vehicle.id}});assert.equal(audits.length,1);assert.deepEqual((audits[0].data as any).reservation,{orderId:f.order.id,orderStatus:'AWAITING_PAYMENT'});
  });

  await t.test('different keys competing on one revision yield one success and one stale rejection',async()=>{
   const vehicle=await h.db.vehicle.create({data:car('竞争版本')}),path=route(vehicle.id);
   const replies=await Promise.all([h.raw(path,body(vehicle),h.reviewer),h.raw(path,{...body(vehicle),mileageKm:34000},h.reviewer)]);
   assert.deepEqual(replies.map(reply=>reply.status).sort(),[201,409]);assert.equal(replies.find(reply=>reply.status===409)!.data.error.code,'REVISION_CONFLICT');
   const after=await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}});assert.equal(after.revision,1);assert.equal(after.mileageKm,replies.find(reply=>reply.status===201)!.data.mileageKm);assert.equal(await h.db.auditLog.count({where:{action,resourceId:vehicle.id}}),1);
  });

  await t.test('stale revision/readings, changed binding and advanced order statuses are rejected without writes',async()=>{
   const f=await reservation(h,'状态漂移'),path=route(f.vehicle.id),input=body(f.vehicle,f.order.id);
   for(const changes of [{vehicleRevision:99},{previousMileageKm:11000}])await h.reject(path,{...input,...changes,idempotencyKey:randomUUID()},h.reviewer,'REVISION_CONFLICT');
   for(const changes of [{expectedReservedOrderId:null,expectedOrderStatus:null},{expectedReservedOrderId:'synthetic-other-order'}])await h.reject(path,{...input,...changes,idempotencyKey:randomUUID()},h.reviewer,'MILEAGE_CORRECTION_STATE');
   for(const status of ['ACTIVE','AWAITING_HANDOVER'] as const){await h.db.order.update({where:{id:f.order.id},data:{status}});await unchangedAfterReject(h,f,'MILEAGE_CORRECTION_STATE');}
   await h.db.order.update({where:{id:f.order.id},data:{status:'AWAITING_PAYMENT'}});await h.db.vehicle.update({where:{id:f.vehicle.id},data:{status:'IN_USE'}});await unchangedAfterReject(h,f,'MILEAGE_CORRECTION_STATE');
  });

  await t.test('both pointer holds and independent HELD ledger rows block correction',async()=>{
   for(const pointer of [true,false]){
    const f=await reservation(h,pointer?'指针预留':'台账预留');
    if(pointer)await h.db.vehicle.update({where:{id:f.vehicle.id},data:{holdId:'synthetic-pointer-hold'}});
    else await h.db.vehicleHold.create({data:{vehicleId:f.vehicle.id,orderId:f.order.id,changeId:'synthetic-change',quoteId:'synthetic-quote',status:'HELD',expiresAt:new Date('2099-01-01T00:00:00Z')}});
    await unchangedAfterReject(h,f,'MILEAGE_CORRECTION_STATE');
   }
  });

  await t.test('closed/active assignments and current assignment pointers block correction',async()=>{
   for(const status of ['CLOSED','ACTIVE'] as const){
    const f=await reservation(h,'实际分配 '+status);
    await h.db.vehicleAssignment.create({data:{orderId:f.order.id,vehicleId:f.vehicle.id,customerId:f.customer.id,startAt:new Date('2026-09-01T00:00:00Z'),startReadingKm:12000,status,...(status==='CLOSED'?{endAt:new Date('2026-10-01T00:00:00Z'),endReadingKm:13000}:{})}});
    await unchangedAfterReject(h,f,'MILEAGE_CORRECTION_FACTS');
   }
   const pointed=await reservation(h,'当前分配指针');await h.db.order.update({where:{id:pointed.order.id},data:{currentAssignmentId:'synthetic-assignment-pointer'}});await unchangedAfterReject(h,pointed,'MILEAGE_CORRECTION_STATE');
  });

  await t.test('handover evidence resolves by vehicle or legacy order when vehicleId is null',async()=>{
   const unrelated=await reservation(h,'交接来源另单');
   for(const legacyOrderLink of [true,false]){
    const f=await reservation(h,legacyOrderLink?'旧单交付证据':'车辆换车交付证据');
    await h.db.handover.create({data:{orderId:legacyOrderLink?f.order.id:unrelated.order.id,customerId:legacyOrderLink?f.customer.id:unrelated.customer.id,vehicleId:legacyOrderLink?null:f.vehicle.id,type:legacyOrderLink?'DELIVERY':'SWAP_DELIVERY',status:legacyOrderLink?'PUBLISHED':'COMPLETED',readingKm:13000,fileIds:[],checklist:{synthetic:true},manifestHash:'c'.repeat(64),completedAt:legacyOrderLink?null:new Date('2026-10-01T00:00:00Z')}});
    await unchangedAfterReject(h,f,'MILEAGE_CORRECTION_FACTS');
   }
  });

  await t.test('approved mileage and confirmed order readings cannot be bypassed',async()=>{
   const approved=await reservation(h,'审核里程');await h.db.mileage.create({data:{orderId:approved.order.id,customerId:approved.customer.id,readingKm:13000,recordedAt:new Date('2026-10-01T00:00:00Z'),fileIds:[],idempotencyKey:randomUUID(),status:'APPROVED',reviewedBy:h.reviewer.id}});await unchangedAfterReject(h,approved,'MILEAGE_CORRECTION_FACTS');
   const higher=await reservation(h,'已确认更高读数');await h.db.order.update({where:{id:higher.order.id},data:{confirmedMileageKm:40000}});await unchangedAfterReject(h,higher,'MILEAGE_REGRESSION');
  });

  await t.test('current admin permission and live session are checked even on an already successful replay',async()=>{
   const admin=await h.staff('ADMIN','mileage-replay-admin'),vehicle=await h.db.vehicle.create({data:car('回放权限')}),path=route(vehicle.id),input=body(vehicle);
   await h.post(path,input,admin);await h.db.adminUser.update({where:{id:admin.id},data:{role:'OPERATIONS'}});await h.reject(path,input,admin,'FORBIDDEN');
   await h.db.adminUser.update({where:{id:admin.id},data:{active:false,authVersion:{increment:1}}});await h.reject(path,input,admin);
   assert.equal(await h.db.auditLog.count({where:{action,resourceId:vehicle.id}}),1);assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).revision,1);
  });

  assert.deepEqual(await Promise.all([h.db.payment.count(),h.db.refund.count(),h.db.assetCostEntry.count(),h.db.assetManualPaymentRecord.count()]),financeCounts);
  assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.payment.providerCalls,0);assert.equal(h.syntheticSmsSends,0);
 }finally{await h.close();}
});
