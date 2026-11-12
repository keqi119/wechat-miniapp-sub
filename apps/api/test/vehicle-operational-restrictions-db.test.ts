import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {availableVehicle} from '../src/vehicle-changes/assignments';
import {requireVehicleUnrestricted} from '../src/vehicles/operational-restrictions';
import {guardHandoverOrder} from '../src/operations/handover-records';

const denied=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
test('committed restrictions block HTTP application and actual delivery; a blocked claim rechecks after vehicle-row contention',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();const vehicle=await h.db.vehicle.create({data:{title:'合成限制车',brand:'Synthetic',model:'EV',year:2026,city:'上海',mileageKm:100,status:'PUBLISHED'}});
  const customer=await h.customer('restriction');
  const plan=await h.db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成方案',months:12,monthlyFeeAmount:10000,mileagePerMonthKm:1000,excessMileagePriceAmount:100,energyDescription:'自付',benefits:[],conditions:'合成条件',active:true}});
  const work=await h.db.assetWorkOrder.create({data:{vehicleId:vehicle.id,workOrderNo:'RESTRICT-'+h.prefix,kind:'REPAIR',occurredAt:new Date(),title:'合成维修限制',description:'内部原因不投影给客户',costConfirmationRequired:true,createdBy:h.maker.id,updatedBy:h.maker.id}});
  let announceLocked!:()=>void,announceRead!:()=>void,releaseWriter!:()=>void;const locked=new Promise<void>(r=>announceLocked=r),read=new Promise<void>(r=>announceRead=r),release=new Promise<void>(r=>releaseWriter=r);
  const writer=h.db.serial(async tx=>{await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id=${vehicle.id} FOR UPDATE`;announceLocked();await release;await tx.vehicle.update({where:{id:vehicle.id},data:{revision:{increment:1}}});return tx.vehicleOperationalRestriction.create({data:{vehicleId:vehicle.id,workOrderId:work.id,scopes:['ALLOCATION','DELIVERY'],reason:'合成限制',evidenceFileIds:['synthetic-proof'],evidenceSnapshot:[{id:'synthetic-proof',sha256:'b'.repeat(64)}],createdBy:h.maker.id}});});
  await locked;
  const claimant=h.db.serial(async tx=>{await tx.vehicle.findUnique({where:{id:vehicle.id}});announceRead();await availableVehicle(tx,vehicle.id);await tx.vehicle.update({where:{id:vehicle.id},data:{status:'RESERVED'}});});
  await read;releaseWriter();const restriction=await writer;await assert.rejects(claimant,denied('VEHICLE_ALLOCATION_RESTRICTED'));assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).status,'PUBLISHED');
  const applicationsBefore=await h.db.application.count({where:{customerId:customer.id}});
  const response=await h.raw('/customer/applications',{vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{name:'合成客户',fileIds:[],handoverLocation:null},consents:[{documentId:h.docs.application.id,version:h.docs.application.version}],idempotencyKey:randomUUID()},customer);assert.equal(response.status,409);assert.equal(response.data.error.code,'VEHICLE_ALLOCATION_RESTRICTED');assert(!JSON.stringify(response.data).includes(work.id));assert.equal(await h.db.application.count({where:{customerId:customer.id}}),applicationsBefore);
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{synthetic:true},consents:[],idempotencyKey:randomUUID(),requestHash:'c'.repeat(64)}});
  const order=await h.db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,contractMode:'ESIGN',status:'AWAITING_HANDOVER',confirmedMileageKm:100,finalPlanSnapshot:{synthetic:true}}});
  await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'RESERVED',reservedOrderId:order.id}});
  await assert.rejects(h.db.serial(tx=>guardHandoverOrder(tx,order,'DELIVERY',100)),denied('VEHICLE_DELIVERY_RESTRICTED'));assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).revision,order.revision,'Rejected handover rolls back its order write');
  await h.db.order.update({where:{id:order.id},data:{status:'ACTIVE'}});await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'IN_USE'}});await h.db.serial(async tx=>guardHandoverOrder(tx,await tx.order.findUniqueOrThrow({where:{id:order.id}}),'RETURN',100));
  await h.db.vehicleOperationalRestriction.update({where:{id:restriction.id},data:{status:'RELEASED',releasedBy:h.maker.id,releasedAt:new Date(),releaseReason:'合成维修后核对',releaseEvidenceFileIds:['synthetic-release-proof'],releaseEvidenceSnapshot:[{id:'synthetic-release-proof',sha256:'c'.repeat(64)}]}});
  await requireVehicleUnrestricted(h.db,vehicle.id,'ALLOCATION');await requireVehicleUnrestricted(h.db,vehicle.id,'DELIVERY');assert.equal(h.externalCalls,0);assert.equal(h.payment.providerCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();}
});
