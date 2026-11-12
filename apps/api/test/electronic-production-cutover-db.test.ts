import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';
import {offlineOrder,approvedOfflineArchive} from './offline-fixtures';

test('production cutover refuses a stale paper quotation before reservation or billing and retains confirmed history',async()=>{
 const h=new JourneyHarness();try{await h.start();const f=await offlineOrder(h.db),customer=await h.customer('切换客户');
 const application=await h.db.application.create({data:{customerId:customer.id,vehicleId:f.vehicle.id,subscriptionPlanId:f.plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:randomUUID(),status:'AWAITING_CONFIRMATION',revision:1}});
 const quote=await h.db.finalPlan.create({data:{applicationId:application.id,revision:1,contractMode:'OFFLINE',reviewStatus:'APPROVED',commercialHash:'c'.repeat(64),monthlyFeeAmount:100,depositAmount:100,months:12,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'合成测试',startDate:new Date('2026-11-10'),firstDueDate:new Date('2026-11-10')}});
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 const before=await h.db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}});
 await h.reject(`/customer/applications/${application.id}/confirm`,{revision:1,commercialHash:quote.commercialHash},customer,'CONTRACT_MODE_CHANGED');
 assert.equal(await h.db.order.count({where:{applicationId:application.id}}),0);
 assert.deepEqual(await h.db.vehicle.findUniqueOrThrow({where:{id:f.vehicle.id}}),before);
 assert.equal((await h.get(`/admin/orders/${f.order.id}/workspace`,h.maker)).capabilities.canUpload,false);
 assert.equal((await h.db.order.findUniqueOrThrow({where:{id:f.order.id}})).contractMode,'OFFLINE');
 assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});

test('production cutover blocks paper archive creation versions and signatures while history remains readable',async()=>{
 const h=new JourneyHarness();try{await h.start();const f=await offlineOrder(h.db),{archive,version}=await approvedOfflineArchive(h.db,f.order.id);
 process.env.NEW_ORDER_CONTRACT_MODE='ELECTRONIC';
 await h.reject('/admin/offline-archives',{kind:'RENTAL',subjectType:'ORDER',subjectId:f.order.id,templateId:'synthetic-template',revision:0,idempotencyKey:randomUUID()},h.maker,'PAPER_SIGNING_DISABLED');
 await h.reject(`/admin/offline-archives/${archive.id}/versions`,{templateId:'synthetic-template',revision:0,idempotencyKey:randomUUID()},h.maker,'PAPER_SIGNING_DISABLED');
 for(const action of ['prepare','confirm-print'])await h.reject(`/admin/offline-archives/${archive.id}/versions/${version.id}/${action}`,{revision:0,idempotencyKey:randomUUID()},h.maker,'PAPER_SIGNING_DISABLED');
 assert.equal(await h.db.archiveVersion.count({where:{archiveId:archive.id}}),1);
 const read=await h.get(`/admin/offline-archives/${archive.id}`,h.maker);assert.equal(read.id,archive.id);assert.equal(read.versions[0].status,'ARCHIVED');
 assert.equal(h.externalCalls+h.esignCalls+h.payment.providerCalls,0);
 }finally{await h.close();}
});
