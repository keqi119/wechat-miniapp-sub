import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness,command} from './seven-module-journey-fixtures';
import {platformLegalEntity} from '../src/common/platform-legal-entity';

test('HTTP seal evidence, fee inputs/replays and optional cancellation attachments cannot reuse private inspection files',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const car=await h.post('/admin/vehicles',{...command(),brand:'合成',model:'EV',title:'查验边界-'+h.prefix,vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:1,mediaFileIds:[]});
  const file=await h.post(`/admin/vehicles/${car.id}/inspection-files`,h.form({idempotencyKey:randomUUID()},'私密查验',true)),normal=await h.proof(h.maker,'evidence');
  const seal={sealName:'仅本地合成',organizationName:platformLegalEntity(),providerCustomerId:'synthetic-'+h.prefix,providerSignatureId:'synthetic-'+h.prefix,evidenceFileId:file.id};
  const oldFlag=process.env.ESIGN_NEW_REQUESTS_ENABLED;process.env.ESIGN_NEW_REQUESTS_ENABLED='true';
  try{
   await h.reject('/admin/enterprise-seals',seal,h.reviewer,'VEHICLE_INSPECTION_ROUTE_REQUIRED');assert.equal(await h.db.enterpriseSeal.count({where:{evidenceFileId:file.id}}),0);
   const draft=await h.post('/admin/enterprise-seals',{...seal,evidenceFileId:normal.id},h.reviewer);assert.equal(draft.status,'DRAFT');
  }finally{if(oldFlag===undefined)delete process.env.ESIGN_NEW_REQUESTS_ENABLED;else process.env.ESIGN_NEW_REQUESTS_ENABLED=oldFlag;}
  // Deliberate synthetic fixtures for already-existing pre-signature business; no signing/payment channel is invoked.
  const customer=await h.db.customer.create({data:{mobile:'synthetic-boundary-'+h.prefix,name:'仅本地合成',profile:{}}});
  const plan=await h.db.subscriptionPlan.create({data:{vehicleId:car.id,name:'仅本地合成',months:1,monthlyFeeAmount:100,mileagePerMonthKm:0,excessMileagePriceAmount:0,energyDescription:'合成',conditions:'合成',benefits:[],active:false}});
  const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:car.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
  const order=await h.db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:car.id,contractMode:'ESIGN',status:'ACTIVE',finalPlanSnapshot:{},confirmedMileageKm:1}});
  await h.db.storedFile.update({where:{id:file.id},data:{purpose:'evidence'}});
  const bill={orderId:order.id,type:'EXTRA_FEE',amount:100,dueDate:'2026-11-03',description:'仅本地草稿',fileIds:[file.id],idempotencyKey:randomUUID()};
  await h.reject('/admin/bills',bill,h.finance,'VEHICLE_INSPECTION_ROUTE_REQUIRED');assert.equal(await h.db.bill.count({where:{orderId:order.id}}),0);
  const ordinary={...bill,fileIds:[normal.id],idempotencyKey:randomUUID()},created=await h.post('/admin/bills',ordinary,h.finance);assert.equal(created.status,'DRAFT');assert.deepEqual(await h.post('/admin/bills',ordinary,h.finance),created);
  await h.db.bill.update({where:{id:created.id},data:{evidenceFileIds:[file.id]}});await h.reject('/admin/bills',ordinary,h.finance,'VEHICLE_INSPECTION_ROUTE_REQUIRED');
  await h.db.order.update({where:{id:order.id},data:{status:'AWAITING_PAYMENT'}});await h.db.vehicle.update({where:{id:car.id},data:{status:'RESERVED',reservedOrderId:order.id}});
  await h.reject(`/admin/orders/${order.id}/cancel`,{reason:'合成取消',terminationFileId:file.id},h.maker,'VEHICLE_INSPECTION_ROUTE_REQUIRED');assert.equal((await h.db.order.findUniqueOrThrow({where:{id:order.id}})).status,'AWAITING_PAYMENT');assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:car.id}})).reservedOrderId,order.id);
  const cancelled=await h.post(`/admin/orders/${order.id}/cancel`,{reason:'合成无附件取消'},h.maker);assert.equal(cancelled.status,'CANCELLED');
  assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.payment.providerCalls,0);
 }finally{await h.close();}
});
