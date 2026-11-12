import {randomUUID} from 'node:crypto';
import type {Db} from '../src/common/db';
export async function offlineOrder(db:Db){
 const id=randomUUID();
 const customer=await db.customer.create({data:{mobile:`offline-${id}`,openId:`synthetic-${id}`,name:'合成客户'}});
 const vehicle=await db.vehicle.create({data:{brand:'测试',model:'EV',title:'合成离线订单车辆',year:2026,city:'上海',mileageKm:100,status:'RESERVED'}});
 const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'合成套餐',months:12,monthlyFeeAmount:100,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'合成测试',benefits:[],conditions:'合成测试'}});
 const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:id,requestHash:id,status:'FINAL_PLAN_CONFIRMED'}});
 const order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,confirmedMileageKm:100,contractMode:'OFFLINE',status:'AWAITING_CONTRACT_REVIEW',finalPlanSnapshot:{commercialHash:'a'.repeat(64),monthlyFeeAmount:100,months:12,depositAmount:0}}});
 const contract=await db.contract.create({data:{orderId:order.id,customerId:customer.id,executionMode:'OFFLINE',documentHash:'a'.repeat(64)}});
 const bill=await db.bill.create({data:{orderId:order.id,customerId:customer.id,type:'SUBSCRIPTION',sequence:1,amount:100,status:'PENDING',dueDate:new Date('2026-11-01')}});
 return{customer,vehicle,plan,application,order,contract,bill};
}
// Financial gate fixtures seed trusted synthetic archive facts; archive approval has its own full lifecycle tests.
export async function approvedOfflineArchive(db:Db,orderId:string){
 const archive=await db.documentArchive.create({data:{kind:'RENTAL',subjectType:'ORDER',subjectId:orderId,orderId,createdBy:'synthetic-uploader'}});
 const version=await db.archiveVersion.create({data:{archiveId:archive.id,version:1,status:'ARCHIVED',templateId:'synthetic-template',templateVersion:1,businessSnapshotHash:'a'.repeat(64),partiesSnapshot:[],requiredSigners:['CUSTOMER','OWNER','PLATFORM'],scopeSnapshot:{},reviewedBy:'synthetic-reviewer',reviewedAt:new Date()}});
 await db.documentArchive.update({where:{id:archive.id},data:{currentApprovedVersionId:version.id}});
 await db.order.update({where:{id:orderId},data:{status:'AWAITING_PAYMENT'}});
 return{archive,version};
}
