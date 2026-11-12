import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildFrozenEntitlements,entitlementBalance,assertReservationCapacity,assertReverseCapacity,assertServiceConsumption,EntitlementService} from '../src/entitlements/service';
import {reserveInput,reverseInput} from '../src/entitlements/types';
import {Db} from '../src/common/db';
import {offlineOrder} from './offline-fixtures';

const count={benefitVersionId:'count-v1',definitionId:'count',version:1,kind:'COUNT',name:'取送车服务',description:'约定范围内取送车',provider:'宁达',conditions:'提前预约',validity:'ORDER',unit:'次',totalQuantity:1};
const description={...count,benefitVersionId:'description-v1',definitionId:'description',kind:'DESCRIPTION',name:'用车咨询',unit:null,totalQuantity:null};
const order={id:'order',customerId:'customer',status:'AWAITING_CONTRACT_REVIEW',finalPlanSnapshot:{productSnapshot:{productVersionId:'product-v1',benefits:[count,description]}}};
const code=(value:string)=>(e:any)=>e.getResponse?.().error?.code===value;

test('confirmation freezes pending rights with a whole-order quantity and no description balance',()=>{
 const rows=buildFrozenEntitlements(order);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.status==='PENDING'));
 assert.equal(rows[0].totalQuantity,1);assert.equal(rows[0].sourceSnapshot.validity,'ORDER');assert.equal(rows[1].totalQuantity,null);assert.equal(rows[1].unit,null);
 const view=entitlementBalance({...rows[1],status:'ACTIVE'},[],[]);assert.equal(view.availableQuantity,null);assert.equal(view.usedQuantity,null);
});
test('historical text remains description-only and no monthly or mileage counter is invented',()=>{
 const rows=buildFrozenEntitlements({...order,finalPlanSnapshot:{benefits:['每月服务约定','里程额度以合同为准']}});assert.equal(rows.length,2);assert.ok(rows.every(r=>r.kind==='DESCRIPTION'&&r.totalQuantity===null));
 assert.throws(()=>buildFrozenEntitlements({...order,finalPlanSnapshot:{productSnapshot:{productVersionId:'p',benefits:[{...count,unit:'公里'}]}}}));
});
test('used, reserved and reversed entries produce an auditable available balance',()=>{
 const item={...buildFrozenEntitlements(order)[0],status:'ACTIVE',totalQuantity:3};
 const result=entitlementBalance(item,[{status:'RESERVED',quantity:1}],[{type:'CONSUME',quantity:2},{type:'REVERSE',quantity:1}]);
 assert.deepEqual(result,{totalQuantity:3,reservedQuantity:1,usedQuantity:1,availableQuantity:1,expiredQuantity:0,pendingServiceCount:1});
 assert.throws(()=>assertReservationCapacity(result,2),code('ENTITLEMENT_EXHAUSTED'));assert.doesNotThrow(()=>assertReservationCapacity(result,1));
});
test('return expiry keeps ongoing services and historical usage but offers no new reservations',()=>{
 const item={...buildFrozenEntitlements(order)[0],status:'EXPIRED',totalQuantity:4};const result=entitlementBalance(item,[{status:'RESERVED',quantity:1}],[{type:'CONSUME',quantity:1}]);
 assert.equal(result.availableQuantity,0);assert.equal(result.usedQuantity,1);assert.equal(result.reservedQuantity,1);assert.equal(result.expiredQuantity,2);assert.equal(result.pendingServiceCount,1);
});
test('reverse quantity is bounded by original use minus previous corrections',()=>{
 assert.doesNotThrow(()=>assertReverseCapacity(3,1,2));assert.throws(()=>assertReverseCapacity(3,1,3),code('ENTITLEMENT_REVERSE_LIMIT'));
 assert.equal(reverseInput.safeParse({revision:1,serviceRequestId:'s',entryId:'use',quantity:0,reason:'更正',idempotencyKey:'12345678'}).success,false);
 assert.equal(reserveInput.safeParse({revision:1,serviceRequestId:'s',quantity:1,idempotencyKey:'12345678',availableQuantity:10}).success,false);
});
test('staff revocation or unsupported roles fail before ledger mutation',async()=>{
 const service=new EntitlementService(),tx:any={adminUser:{findUnique:async()=>({id:'operator',active:true,role:'OPERATIONS',authVersion:2})}};
 await assert.rejects(service.reserve(tx,{id:'operator',role:'OPERATIONS',authVersion:1},'e',{revision:0,serviceRequestId:'s',quantity:1,idempotencyKey:'12345678'}),code('STAFF_SESSION_CHANGED'));
});
test('service completion is required before final count consumption',()=>{assert.throws(()=>assertServiceConsumption('IN_PROGRESS'),code('SERVICE_STATE'));assert.doesNotThrow(()=>assertServiceConsumption('COMPLETED'));});
test('database grant, competing reservations, exact use, release, reverse and return expiry',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test');const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL});
 try{
  const seed=randomUUID(),staff=await db.adminUser.create({data:{username:'entitlements-'+seed,name:'合成权益运营',role:'OPERATIONS',passwordHash:'synthetic-unused'}}),actor={id:staff.id,role:staff.role,authVersion:staff.authVersion};
  const f=await offlineOrder(db),service=new EntitlementService();await db.order.update({where:{id:f.order.id},data:{finalPlanSnapshot:{...f.order.finalPlanSnapshot as object,productSnapshot:order.finalPlanSnapshot.productSnapshot}}});
  const frozen=await db.serial(tx=>service.freeze(tx,f.order.id));assert.equal(frozen.length,2);assert.ok(frozen.every(e=>e.status==='PENDING'));
  assert.equal((await db.serial(tx=>service.freeze(tx,f.order.id))).length,2);await assert.rejects(db.serial(tx=>service.grant(tx,f.order.id)),code('ENTITLEMENT_DELIVERY_REQUIRED'));
  await db.order.update({where:{id:f.order.id},data:{status:'ACTIVE'}});await db.handover.create({data:{orderId:f.order.id,customerId:f.customer.id,type:'DELIVERY',executionMode:'OFFLINE',status:'COMPLETED',manifestHash:'a'.repeat(64),readingKm:100,checklist:{location:'合成地点'},fileIds:[]}});
  const granted=await db.serial(tx=>service.grant(tx,f.order.id));assert.ok(granted.every(e=>e.status==='ACTIVE'));assert.equal((await db.serial(tx=>service.grant(tx,f.order.id)))[0].revision,granted[0].revision);
  const entitlement=granted.find(e=>e.kind==='COUNT')!;
  async function work(customerId=f.customer.id,orderId=f.order.id){return db.serviceRequest.create({data:{customerId,orderId,type:'benefit',location:'合成地点',description:'合成权益申请',mobile:'13800000000',fileIds:[],idempotencyKey:randomUUID(),requestHash:seed,status:'ACCEPTED',entitlementId:entitlement.id} as any});}
  const wrongCustomer=await work('other-synthetic-customer');await assert.rejects(db.serial(tx=>service.reserve(tx,actor,entitlement.id,{revision:entitlement.revision,serviceRequestId:wrongCustomer.id,quantity:1,idempotencyKey:randomUUID()})),code('ENTITLEMENT_SERVICE_SCOPE'));
  const a=await work(),b=await work();const reserve=(id:string)=>db.serial(tx=>service.reserve(tx,actor,entitlement.id,{revision:entitlement.revision,serviceRequestId:id,quantity:1,idempotencyKey:randomUUID()}));
  const raced=await Promise.allSettled([reserve(a.id),reserve(b.id)]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
  const reserved=(raced.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;const reservation=await (db as any).entitlementReservation.findFirst({where:{entitlementId:entitlement.id,status:'RESERVED'}});assert.ok(reservation);
  await db.serviceRequest.update({where:{id:reservation.serviceRequestId},data:{status:'IN_PROGRESS'}});
  const consume={revision:reserved.revision,serviceRequestId:reservation.serviceRequestId,reservationId:reservation.id,idempotencyKey:randomUUID()};await assert.rejects(db.serial(tx=>service.consume(tx,actor,entitlement.id,consume)),code('SERVICE_STATE'));
  await db.serviceRequest.update({where:{id:reservation.serviceRequestId},data:{status:'COMPLETED'}});const used=await db.serial(tx=>service.consume(tx,actor,entitlement.id,consume));assert.equal(used.usedQuantity,1);assert.equal(used.reservedQuantity,0);assert.equal((await db.serial(tx=>service.consume(tx,actor,entitlement.id,consume))).revision,used.revision);
  const entry=await (db as any).entitlementLedger.findFirst({where:{entitlementId:entitlement.id,type:'CONSUME'}});
  const corrected=await db.serial(tx=>service.reverse(tx,actor,entitlement.id,{revision:used.revision,serviceRequestId:reservation.serviceRequestId,entryId:entry.id,quantity:1,reason:'合成误核销更正',idempotencyKey:randomUUID()}));assert.equal(corrected.usedQuantity,0);assert.equal(corrected.availableQuantity,1);
  await assert.rejects(db.serial(tx=>service.reverse(tx,actor,entitlement.id,{revision:corrected.revision,serviceRequestId:reservation.serviceRequestId,entryId:entry.id,quantity:1,reason:'重复超额更正',idempotencyKey:randomUUID()})),code('ENTITLEMENT_REVERSE_LIMIT'));
  const c=await work();const held=await db.serial(tx=>service.reserve(tx,actor,entitlement.id,{revision:corrected.revision,serviceRequestId:c.id,quantity:1,idempotencyKey:randomUUID()}));const pending=await (db as any).entitlementReservation.findUnique({where:{serviceRequestId:c.id}});
  await db.order.update({where:{id:f.order.id},data:{status:'SETTLING'}});const expired=await db.serial(tx=>service.expire(tx,f.order.id));const pendingExpired=expired.find(e=>e.id===entitlement.id)!;assert.equal(pendingExpired.pendingServiceCount,1);assert.equal(pendingExpired.availableQuantity,0);
  await db.serviceRequest.update({where:{id:c.id},data:{status:'CANCELLED'}});const release={revision:pendingExpired.revision,serviceRequestId:c.id,reservationId:pending.id,reason:'合成取消',idempotencyKey:randomUUID()};const released=await db.serial(tx=>service.release(tx,actor,entitlement.id,release));assert.equal(released.reservedQuantity,0);assert.equal(released.expiredQuantity,1);assert.equal((await db.serial(tx=>service.release(tx,actor,entitlement.id,release))).revision,released.revision);
  assert.ok(held.revision>corrected.revision);assert.equal(await (db as any).entitlementLedger.count({where:{entitlementId:entitlement.id,type:'CONSUME'}}),1);
 }finally{await db.$disconnect();}
});
