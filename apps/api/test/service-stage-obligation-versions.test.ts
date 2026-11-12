import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';

// Structural migration probe only; it does not pretend that these snapshots are approved business sources.
test('successive quote obligations preserve history in one service month with at most one active version',async()=>{
 const db=new Db();try{
  const customer=await db.customer.create({data:{mobile:'stage-versions-'+randomUUID()}}),vehicle=await db.vehicle.create({data:{title:'合成义务版本测试',brand:'测试',model:'测试',year:2026,city:'上海',mileageKm:0}}),staff=await db.adminUser.create({data:{username:'stage-versions-'+randomUUID(),name:'合成财务',role:'FINANCE',passwordHash:'synthetic-not-login'}});
  const plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'结构测试',months:1,monthlyFeeAmount:10000,mileagePerMonthKm:1500,excessMileagePriceAmount:150,energyDescription:'自付',benefits:[],conditions:'仅结构测试'}}),application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}}),order=await db.order.create({data:{applicationId:application.id,customerId:customer.id,vehicleId:vehicle.id,finalPlanSnapshot:{synthetic:'unchanged'},confirmedMileageKm:0}});
  const start=new Date('2026-10-01'),end=new Date('2026-11-01'),assignment=await db.vehicleAssignment.create({data:{orderId:order.id,customerId:customer.id,vehicleId:vehicle.id,startAt:start,startReadingKm:0}}),stage=await db.orderServiceStage.create({data:{orderId:order.id,customerId:customer.id,sequence:1,kind:'INITIAL',status:'ACTIVE',vehicleId:vehicle.id,assignmentId:assignment.id,startDate:start,endDate:end,months:1,firstPeriodSequence:1,lastPeriodSequence:1,snapshot:{synthetic:'structure-only'},snapshotHash:'a'.repeat(64),activatedAt:start}});
  const change=await db.orderChange.create({data:{orderId:order.id,customerId:customer.id,kind:'VEHICLE_CHANGE',status:'APPLIED',originalContractId:'synthetic',priorTermsHash:'a'.repeat(64),priorTerms:{},reason:'义务结构测试',createdBy:staff.id,idempotencyKey:randomUUID(),requestHash:'a'.repeat(64)}});
  const quote=async(revision:number)=>db.delayQuote.create({data:{changeId:change.id,revision,commercialHash:'b'.repeat(64),snapshot:{},fundsSnapshot:[],createdBy:staff.id}}),q1=await quote(1),q2=await quote(2),q3=await quote(3);
  const data={orderId:order.id,serviceStageId:stage.id,stageSequence:1,sequence:1,startDate:start,endDate:end,dueDate:start,amount:10000,sourceBillIds:[],chargeAmount:0};
  const old=await db.serviceObligation.create({data:{...data,quoteId:q1.id,active:true}});
  const next=await db.serviceObligation.create({data:{...data,quoteId:q2.id,amount:12000,active:false}});
  await db.serviceObligation.create({data:{...data,quoteId:q3.id,amount:13000,active:false}});
  await assert.rejects(db.serviceObligation.update({where:{id:next.id},data:{active:true}}),(e:any)=>e.code==='P2002');
  await db.$transaction(async tx=>{await tx.serviceObligation.update({where:{id:old.id},data:{active:false}});await tx.serviceObligation.update({where:{id:next.id},data:{active:true}});});
  const rows=await db.serviceObligation.findMany({where:{serviceStageId:stage.id}});assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.active).length,1);assert.equal(rows.find(r=>r.id===old.id)!.amount,10000);assert.equal(rows.find(r=>r.id===next.id)!.amount,12000);
  await assert.rejects(db.serviceObligation.create({data:{...data,quoteId:q2.id,active:false}}),(e:any)=>e.code==='P2002');
  assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,{synthetic:'unchanged'});
 }finally{await db.$disconnect();}
});
