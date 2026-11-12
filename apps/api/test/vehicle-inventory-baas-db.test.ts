import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {JourneyHarness,command} from './seven-module-journey-fixtures';

// Root runs this only after schema/client generation in the harness's fixed isolated loopback DB.
test('inventory BAAS persists nullable drafts, protects private detail and uses finite long-term cost windows',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();try{
  await h.start();const initialBills=await h.db.bill.count(),initialPayments=await h.db.payment.count(),initialManualPayments=await h.db.assetManualPaymentRecord.count();
  const vehicle=await h.db.vehicle.create({data:{title:'合成库存长期BAAS',brand:'合成',model:'EV',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:500,status:'DRAFT'}});
  const profile=await h.post('/admin/vehicle-assets/'+vehicle.id,{...command(),vehicleRevision:vehicle.revision,batteryOwnership:'BAAS',registeredOwnerName:'合成登记人'},h.maker,'PATCH');
  const base='/admin/baas-contracts',fields=['provider','batteryPackage','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'];
  const body={...command(),vehicleId:vehicle.id,vehicleRevision:vehicle.revision,assetRevision:profile.revision,...Object.fromEntries(fields.map(field=>[field,null])),effectiveTo:null,supplierOrderNumber:'0000000000000123456789',batteryBrand:'合成品牌',lesseeName:'合成承租人',lesseeCreditCode:'91310000SYNTHETIC1',lessorCollectionAccountInfo:'合成银行\n合成户名\n00000000123456'};
  const creations=await Promise.all([h.raw(base,body),h.raw(base,body)]);assert.deepEqual(creations.map(row=>row.status),[201,201]);assert.deepEqual(creations[0].data,creations[1].data);
  const created=creations[0].data,path=base+'/'+created.id;assert.match(created.contractNumber,/^BAAS-[0-9a-f-]{36}$/);assert.deepEqual(created.missingFields,fields);assert.equal(created.effectiveTo,null);assert.equal('lessorCollectionAccountInfo'in created,false);assert.equal(await h.db.vehicleBaasContract.count({where:{vehicleId:vehicle.id}}),1);
  const detail=await h.get(path);assert.equal(detail.lessorCollectionAccountInfo,body.lessorCollectionAccountInfo);assert.equal(detail.vehicle.registeredOwnerName,'合成登记人');assert.equal(detail.supplierOrderNumber,body.supplierOrderNumber);
  const list=await h.get(base+'?vehicleId='+vehicle.id);assert.equal('lessorCollectionAccountInfo'in list.items[0],false);assert.equal('registeredOwnerName'in list.items[0].vehicle,false);assert.equal('registeredOwnerName'in (await h.get(path,h.finance)).vehicle,false);
  for(const actor of [h.support,h.field])await h.reject(path,undefined,actor,'FORBIDDEN');await h.reject(path,{...command(),batteryBrand:'越权'},h.finance,'FORBIDDEN','PATCH');
  await h.reject(base,{...body,supplierOrderNumber:'different'},h.maker,'IDEMPOTENCY_CONFLICT');
  for(const suffix of ['/activate','/cost-plans'])await h.reject(path+suffix,suffix==='/activate'?{...command(),reason:'资料缺失'}:{...command(),fromPeriod:'2028-02',toPeriod:'2028-03',previewHash:'a'.repeat(64),acknowledgedWarningIds:[]},h.maker,'BAAS_DRAFT_INCOMPLETE');
  const missing=await h.reject(path+'/cost-preview?fromPeriod=2028-02&toPeriod=2028-03',undefined,h.maker,'BAAS_DRAFT_INCOMPLETE');assert.deepEqual(missing.data.error.missingFields,fields);
  assert.equal(await h.db.assetCostPlan.count({where:{vehicleId:vehicle.id}}),0);assert.equal(await h.db.assetCostEntry.count({where:{vehicleId:vehicle.id}}),0);

  // Raw SQL checks exercise DB enforcement, not the DTO or Prisma date parser.
  const constraint=(error:any)=>error?.code==='P2010'&&error.meta?.code==='23514';
  for(const status of ['ACTIVE','SUSPENDED','TERMINATED'])await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "status"=${status} WHERE "id"=${created.id}`,constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "activatedAt"=CURRENT_TIMESTAMP WHERE "id"=${created.id}`,constraint);
  await h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "status"='ARCHIVED' WHERE "id"=${created.id}`;
  assert.deepEqual((await h.get(path)).missingFields,fields);await h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "status"='DRAFT' WHERE "id"=${created.id}`;
  for(const field of ['effectiveFrom','effectiveTo'])for(const value of ['infinity','-infinity','0001-01-01 BC','10000-01-01'])await assert.rejects(h.db.$executeRaw(Prisma.sql`UPDATE "VehicleBaasContract" SET ${Prisma.raw('"'+field+'"')}=CAST(${value} AS date) WHERE "id"=${created.id}`),constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "rentalAmount"=0 WHERE "id"=${created.id}`,constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "paymentDayOfMonth"=32 WHERE "id"=${created.id}`,constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "billingCycle"='WEEKLY' WHERE "id"=${created.id}`,constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "provider"='   ' WHERE "id"=${created.id}`,constraint);
  await assert.rejects(h.db.$executeRaw`UPDATE "VehicleBaasContract" SET "effectiveFrom"='2028-03-01'::date,"effectiveTo"='2028-02-29'::date WHERE "id"=${created.id}`,constraint);

  const edits=await Promise.all(['甲','乙'].map(batteryBrand=>h.raw(path,{...command(),batteryBrand},h.maker,'PATCH')));assert.deepEqual(edits.map(row=>row.status).sort(),[200,409]);const changed=edits.find(row=>row.status===200)!.data;assert.equal(changed.termsHash,created.termsHash);assert.equal(changed.lessorCollectionAccountInfo,body.lessorCollectionAccountInfo);
  const cleared=await h.post(path,{...command(changed.revision),supplierOrderNumber:' ',lessorCollectionAccountInfo:null},h.maker,'PATCH');assert.equal(cleared.supplierOrderNumber,null);assert.equal(cleared.lessorCollectionAccountInfo,null);
  const ready=await h.post(path,{...command(cleared.revision),provider:'合成出租方',batteryPackage:'75kWh',effectiveFrom:'2028-02-15',billingCycle:'MONTHLY',rentalAmount:98000,paymentDayOfMonth:31},h.maker,'PATCH');assert.deepEqual(ready.missingFields,[]);assert.equal(ready.effectiveTo,null);
  const file=await h.post(path+'/files',h.form({revision:ready.revision,idempotencyKey:randomUUID()},'inventory-baas-contract'));
  const active=await h.post(path+'/activate',{...command(file.revision),reason:'仅隔离库合成附件核对'});assert.equal(active.status,'ACTIVE');assert.equal(active.effectiveTo,null);
  for(const field of fields)await assert.rejects(h.db.$executeRaw(Prisma.sql`UPDATE "VehicleBaasContract" SET ${Prisma.raw('"'+field+'"')}=NULL WHERE "id"=${created.id}`),constraint);
  const max=await h.get(path+'/cost-preview?fromPeriod=2028-02&toPeriod=2038-01');assert.equal(max.rows.length,120);assert.equal(max.totalAmount,11760000);assert.deepEqual(max.warningIds,['2028-02:OUTSIDE_CONTRACT_START']);await h.reject(path+'/cost-preview?fromPeriod=2028-02&toPeriod=2038-02',undefined,h.maker,'SCHEDULE_LIMIT');
  const preview=await h.get(path+'/cost-preview?fromPeriod=2028-02&toPeriod=2028-03');assert.equal(preview.rows[0].dueDate,'2028-02-29');
  const generation={...command(active.revision),fromPeriod:'2028-02',toPeriod:'2028-03',previewHash:preview.previewHash,acknowledgedWarningIds:preview.warningIds},generated=await Promise.all([h.raw(path+'/cost-plans',generation),h.raw(path+'/cost-plans',generation)]);assert.deepEqual(generated.map(row=>row.status),[201,201]);assert.deepEqual(generated[0].data,generated[1].data);assert.equal(generated[0].data.created.length,2);
  const plans=await h.db.assetCostPlan.findMany({where:{baasContractId:created.id}});assert.equal((plans[0].sourceSnapshot as any).terms.effectiveTo,null);assert.equal('lessorCollectionAccountInfo'in (plans[0].sourceSnapshot as any).terms,false);
  const confirmation=await h.post('/admin/asset-costs/confirm',{plans:generated[0].data.created.map((row:any)=>({id:row.id,revision:row.revision})),idempotencyKey:randomUUID()},h.finance);assert.equal(confirmation.totalAmount,196000);assert.equal(confirmation.entries.length,2);
  await h.db.adminUser.update({where:{id:h.maker.id},data:{active:false,authVersion:{increment:1}}});await h.reject(base,body,h.maker);assert.equal(await h.db.vehicleBaasContract.count({where:{vehicleId:vehicle.id}}),1);
  assert.equal(await h.db.bill.count(),initialBills);assert.equal(await h.db.payment.count(),initialPayments);assert.equal(await h.db.assetManualPaymentRecord.count(),initialManualPayments);assert.equal(h.payment.providerCalls,0);assert.equal(h.externalCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.identityCalls,0);
 }finally{await h.close();}
});
