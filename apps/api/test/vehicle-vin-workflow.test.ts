import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Db} from '../src/common/db';
import {AdminController} from '../src/operations/admin';
import {LicensePlatesService} from '../src/license-plates/service';
test('admin plate changes keep order, policy and cooperation links on the same VIN vehicle',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55432');assert.equal(target.pathname,'/chundian_test');
 const db=new Db({datasourceUrl:process.env.TEST_DATABASE_URL}),old=process.env.MVP_V2_ENABLED;process.env.MVP_V2_ENABLED='true';
 const suffix=randomUUID(),vin='L'+randomBytes(8).toString('hex').toUpperCase();
 try{
  const actor=await db.adminUser.create({data:{username:'vin-'+suffix,name:'Synthetic',passwordHash:'fixture',role:'OPERATIONS'}}),request={admin:actor},controller=new AdminController(db);
  const data={brand:'Synthetic',model:'Synthetic',title:'Synthetic vehicle',year:2026,city:'上海',mileageKm:1000,revision:0,idempotencyKey:randomUUID()};
  await assert.rejects(controller.create('vehicles',data,request),(e:any)=>e.getResponse?.().error?.code==='VIN_INVALID');
  const vehicle:any=await controller.create('vehicles',{...data,vin,idempotencyKey:randomUUID()},request);
  const customer=await db.customer.create({data:{mobile:'vin-'+suffix}}),plan=await db.subscriptionPlan.create({data:{vehicleId:vehicle.id,name:'Synthetic',months:12,monthlyFeeAmount:1000,mileagePerMonthKm:1500,excessMileagePriceAmount:100,energyDescription:'Synthetic',benefits:[],conditions:'Synthetic'}});
  const application=await db.application.create({data:{customerId:customer.id,vehicleId:vehicle.id,subscriptionPlanId:plan.id,profile:{},consents:[],idempotencyKey:randomUUID(),requestHash:randomUUID()}});
  const order=await db.order.create({data:{customerId:customer.id,vehicleId:vehicle.id,applicationId:application.id,confirmedMileageKm:1000,finalPlanSnapshot:{vehicle:{vin,plateNumber:'沪A00001'}}}});
  const policy=await db.insurancePolicy.create({data:{insurer:'Synthetic',policyNumber:suffix,createdBy:actor.id}});
  const policyVersion=await db.insurancePolicyVersion.create({data:{policyId:policy.id,version:1,effectiveAt:new Date(),startAt:new Date(),endAt:new Date('2099-01-01'),policyholder:'Synthetic',insuredParty:'Synthetic',vehicleIds:[vehicle.id],coverageItems:[],terms:'Synthetic',fileIds:[],requirementVersionIds:[],createdBy:actor.id}});
  const ownerId='owner-'+suffix,agreement=await db.partnerAgreement.create({data:{ownerId,createdBy:actor.id}}),version=await db.partnerAgreementVersion.create({data:{agreementId:agreement.id,ownerId,version:1,contentHash:'a'.repeat(64),vehicleIds:[vehicle.id],createdBy:actor.id}});
  await db.partnerAgreementVehicle.create({data:{vehicleId:vehicle.id,ownerId,agreementId:agreement.id,agreementVersionId:version.id,assignedBy:actor.id}});
  await db.vehicle.update({where:{id:vehicle.id},data:{reservedOrderId:order.id,plateNumber:'沪A00001'}});
  await assert.rejects(controller.patch('vehicles',vehicle.id,{plateNumber:'沪B00002',revision:vehicle.revision,idempotencyKey:randomUUID()},request),(e:any)=>e.getResponse?.().error?.code==='PLATE_BINDING_REQUIRED');
  const plates=new LicensePlatesService(),registered=await db.serial(tx=>plates.create(tx,actor,{plateNumber:'合成'+suffix.slice(0,12),plateType:'明确测试类型',revision:0,idempotencyKey:randomUUID()})),sha256='b'.repeat(64),proof=await db.storedFile.create({data:{adminId:actor.id,purpose:'asset-plate',name:'合成换牌凭据.pdf',mimeType:'application/pdf',size:20,sha256,storagePath:'synthetic-no-byte-read'}});
  await db.assetPrivateFile.create({data:{fileId:proof.id,kind:'PLATE',licensePlateId:registered.id,sha256,uploadedBy:actor.id}});
  const command={revision:0,idempotencyKey:randomUUID(),vehicleId:vehicle.id,vehicleRevision:vehicle.revision,currentBindingId:null,currentBindingRevision:null,oldVehicleId:null,oldVehicleRevision:null,reason:'核对真实换牌事实',fileIds:[proof.id]};
  const result=await db.serial(tx=>plates.bind(tx,actor,registered.id,command)),updated=await db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}});assert.equal(updated.id,vehicle.id);assert.equal(updated.vin,vin);assert.equal(updated.plateNumber,registered.plateNumber);
  assert.deepEqual(await db.serial(tx=>plates.bind(tx,actor,registered.id,command)),result);
  assert.equal((await db.order.findUniqueOrThrow({where:{id:order.id}})).vehicleId,vehicle.id);
  assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:order.id}})).finalPlanSnapshot,order.finalPlanSnapshot);
  assert.deepEqual((await db.insurancePolicyVersion.findUniqueOrThrow({where:{id:policyVersion.id}})).vehicleIds,[vehicle.id]);
  assert.equal((await db.partnerAgreementVehicle.findUniqueOrThrow({where:{vehicleId:vehicle.id}})).agreementId,agreement.id);
  await assert.rejects(controller.patch('vehicles',vehicle.id,{vin:'L'+randomBytes(8).toString('hex').toUpperCase(),revision:updated.revision,idempotencyKey:randomUUID()},request),(e:any)=>e.getResponse?.().error?.code==='VIN_IMMUTABLE');
  assert.equal((await controller.list('vehicles',{keyword:vin},{admin:actor})).items.some((row:any)=>row.id===vehicle.id),true);
 }finally{await db.$disconnect();if(old===undefined)delete process.env.MVP_V2_ENABLED;else process.env.MVP_V2_ENABLED=old;}
});
