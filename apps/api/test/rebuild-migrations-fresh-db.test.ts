import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readdirSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {verifyResidualSchema} from './residual-schema-checks';
import {verifyWorkOrderSchema} from './work-order-schema-checks';
import {verifyCustomerSourceSchema} from './customer-source-schema-checks';
import {verifyCollectionSchema} from './collection-schema-checks';
import {verifyOfflineChangeSchema} from './offline-change-schema-checks';
import {verifyFieldBatchSchema} from './field-batch-schema-checks';
import {verifyOrderServiceStageSchema} from './order-service-stage-schema-checks';
import {verifyRenewalMutualAgreementSchema} from './renewal-mutual-agreement-schema-checks';

test('all checked-in migrations deploy into a fresh isolated local schema',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const target=new URL(process.env.TEST_DATABASE_URL||'http://invalid');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&target.port==='55432'&&target.pathname==='/chundian_test');
 const schema='rebuild_migration_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^rebuild_migration_[a-f0-9]{32}$/);
 const db=new PrismaClient({datasourceUrl:target.toString()});
 target.searchParams.set('schema',schema);
 const isolated=new PrismaClient({datasourceUrl:target.toString()});
 let created=false;
 try{
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created=true;
  const result=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',resolve('prisma/schema.prisma')],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:target.toString()},windowsHide:true,encoding:'utf8',timeout:120000});
  // Never include a child process environment, credentials or unfiltered output in assertions.
  assert.equal(result.error?.name,undefined,'migration CLI must finish');
  assert.equal(result.status,0,'fresh migration deployment must succeed');
  const applied=await isolated.$queryRawUnsafe<any[]>(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
  const expected=readdirSync(resolve('prisma/migrations'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  assert.deepEqual(applied.map(row=>row.migration_name).sort(),expected);
  assert.ok(applied.every(row=>row.finished_at&&!row.rolled_back_at));
  assert.equal(await isolated.productVersion.count(),0);
  assert.equal(await isolated.vehicleListing.count(),0);
  assert.equal(await isolated.usageAccount.count(),0);
  const policy={policyVersion:'SWAP_TERM_V2',includedCount:2,extraFeeAmount:62550,sourceHash:'a'.repeat(64)};
  await isolated.swapCredit.create({data:{id:'synthetic-legacy-credit',orderId:'synthetic-order',source:'FREE',cycleSequence:1}});
  await isolated.swapCredit.create({data:{id:'synthetic-term-credit',orderId:'synthetic-order',source:'FREE',termSequence:1,policySnapshot:policy}});
  const checkViolation=(constraint:string)=>(error:any)=>
   (error?.code==='P2004'||error?.meta?.code==='23514'||/23514/.test(error?.message||''))&&String(error?.message||error?.meta?.message||'').includes(constraint);
  for(const [constraint,data] of [
   ['SwapCredit_source',{cycleSequence:null,termSequence:null}],
   ['SwapCredit_source',{cycleSequence:1,termSequence:1,policySnapshot:policy}],
   ['SwapCredit_source',{termSequence:1}],
   ['SwapCredit_policy_shape',{termSequence:3,policySnapshot:policy}],
   ['SwapCredit_policy_shape',{termSequence:2,policySnapshot:{...policy,sourceHash:'bad'}}],
  ] as const)await assert.rejects(isolated.swapCredit.create({data:{id:randomUUID(),orderId:'synthetic-invalid',source:'FREE',...data}}),checkViolation(constraint));
  const model=await isolated.modelDefinition.create({data:{brand:'合成迁移验证',name:'明确年款',modelYear:2024}});
  assert.equal(model.revision,0);assert.equal(model.modelYear,2024);
  await assert.rejects(isolated.modelDefinition.create({data:{brand:'合成迁移验证',name:'错误年款',modelYear:2101}}),checkViolation('ModelDefinition_modelYear_check'));
  const vehicle=await isolated.vehicle.create({data:{brand:'合成迁移验证',model:'资产约束',title:'迁移隔离测试',year:2026,city:'测试',mileageKm:0}});
  const asset={vehicleId:vehicle.id,createdBy:'synthetic-admin',updatedBy:'synthetic-admin'};
  await assert.rejects(isolated.vehicleAssetProfile.create({data:{...asset,batteryOwnership:'INVALID'}}),checkViolation('VehicleAssetProfile_values'));
  await isolated.vehicleAssetProfile.create({data:{...asset,batteryOwnership:'BAAS'}});
  const from=new Date('2026-01-01T00:00:00Z'),to=new Date('2026-01-31T00:00:00Z');
  const baasData={...asset,provider:'合成供应商',contractNumber:'TEST-BAAS',batteryPackage:'测试电池包',effectiveFrom:from,effectiveTo:to,billingCycle:'MONTHLY',rentalAmount:10000,paymentDayOfMonth:31,termsHash:'b'.repeat(64)};
  await assert.rejects(isolated.vehicleBaasContract.create({data:{...baasData,rentalAmount:0}}),checkViolation('VehicleBaasContract_values'));
  const baas=await isolated.vehicleBaasContract.create({data:{...baasData,status:'ACTIVE'}});
  await assert.rejects(isolated.vehicleBaasContract.create({data:{...baasData,status:'ACTIVE'}}),(error:any)=>error?.code==='P2002');
  const depreciation={...asset,method:'STRAIGHT_LINE',basisAmount:10000,basisSource:'MANUAL',basisEvidence:'合成依据',residualAmount:1000,startDate:from,usefulLifeMonths:12,termsHash:'d'.repeat(64)};
  await assert.rejects(isolated.vehicleDepreciationPolicy.create({data:{...depreciation,usefulLifeMonths:null}}),checkViolation('VehicleDepreciationPolicy_values'));
  const policyRow=await isolated.vehicleDepreciationPolicy.create({data:depreciation});
  const planData={vehicleId:vehicle.id,sourceKind:'BAAS',baasContractId:baas.id,costPeriod:'2026-01',periodStart:from,periodEnd:to,amount:10000,dueDate:to,sourceRevision:0,sourceHash:baas.termsHash,sourceSnapshot:{synthetic:true},createdBy:'synthetic-admin'};
  await assert.rejects(isolated.assetCostPlan.create({data:{...planData,depreciationPolicyId:policyRow.id}}),checkViolation('AssetCostPlan_values'));
  const costPlan=await isolated.assetCostPlan.create({data:planData});
  const entryData={vehicleId:vehicle.id,planId:costPlan.id,sourceKey:'synthetic-cost',category:'BAAS_RENT',amount:10000,periodStart:from,periodEnd:to,postedBy:'synthetic-finance',sourceSnapshot:{synthetic:true},sourceHash:baas.termsHash};
  const entry=await isolated.assetCostEntry.create({data:entryData});
  await assert.rejects(isolated.assetCostEntry.create({data:{...entryData,sourceKey:'synthetic-duplicate'}}),(error:any)=>error?.code==='P2002');
  await assert.rejects(isolated.assetCostEntry.create({data:{...entryData,sourceKey:'synthetic-reversal',effect:'REVERSAL'}}),checkViolation('AssetCostEntry_values'));
  await assert.rejects(isolated.assetManualPaymentRecord.create({data:{entryId:entry.id,amount:10000,paidAt:to,referenceNo:'TEST',reason:'测试',evidenceFileIds:[],recordedBy:'synthetic-finance'}}),checkViolation('AssetManualPaymentRecord_values'));
  const file=await isolated.storedFile.create({data:{name:'合成凭证.pdf',mimeType:'application/pdf',size:1,sha256:'f'.repeat(64),storagePath:'synthetic/no-file',purpose:'asset-baas'}});
  await assert.rejects(isolated.assetPrivateFile.create({data:{fileId:file.id,kind:'BAAS',baasContractId:baas.id,costEntryId:entry.id,sha256:file.sha256,uploadedBy:'synthetic-admin'}}),checkViolation('AssetPrivateFile_scope'));
  await isolated.assetPrivateFile.create({data:{fileId:file.id,kind:'BAAS',baasContractId:baas.id,sha256:file.sha256,uploadedBy:'synthetic-admin'}});
  const plate=await isolated.licensePlate.create({data:{plateNumber:'沪AD12345',normalizedNumber:'沪AD12345',plateType:'新能源小型',createdBy:'synthetic-admin',updatedBy:'synthetic-admin'}});
  const plate2=await isolated.licensePlate.create({data:{plateNumber:'沪AD12346',normalizedNumber:'沪AD12346',plateType:'新能源小型',createdBy:'synthetic-admin',updatedBy:'synthetic-admin'}});
  const owner=await isolated.vehicleOwner.create({data:{name:'合成牌照归属人',address:'合成地址',createdBy:'synthetic-admin'}});
  const ownership={plateId:plate.id,ownerId:owner.id,validFrom:from,recordedBy:'synthetic-admin',reason:'测试备案',evidenceFileIds:[file.id],evidenceSnapshot:[{id:file.id,sha256:file.sha256}]};
  await assert.rejects(isolated.plateOwnershipPeriod.create({data:{...ownership,endedBy:'synthetic-admin',endReason:'没有结束时间'}}),checkViolation('PlateOwnershipPeriod_end_metadata'));
  await isolated.plateOwnershipPeriod.create({data:ownership});
  await assert.rejects(isolated.plateOwnershipPeriod.create({data:ownership}),(error:any)=>error?.code==='P2002');
  const binding={plateId:plate.id,vehicleId:vehicle.id,validFrom:from,recordedBy:'synthetic-admin',reason:'测试绑定',evidenceFileIds:[file.id],evidenceSnapshot:[{id:file.id,sha256:file.sha256}]};
  await assert.rejects(isolated.plateVehicleBinding.create({data:{...binding,endedBy:'synthetic-admin',endReason:'没有结束时间'}}),checkViolation('PlateVehicleBinding_end_metadata'));
  await isolated.plateVehicleBinding.create({data:binding});
  await assert.rejects(isolated.plateVehicleBinding.create({data:{...binding,plateId:plate2.id}}),(error:any)=>error?.code==='P2002');
  // The driver omits the column name from its 23502 error text. All other
  // required columns below are populated, leaving only evidenceFileIds null.
  const missingEvidence=(error:any)=>error?.meta?.code==='23502';
  // Use SQL so Prisma's input validation cannot mask a nullable database column.
  for(const omit of [false,true]){
   await assert.rejects(omit
    ?isolated.$executeRaw`INSERT INTO "PlateOwnershipPeriod" (id,"plateId","ownerId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${owner.id},${from},${to},'synthetic','test','synthetic','test','[]'::jsonb)`
    :isolated.$executeRaw`INSERT INTO "PlateOwnershipPeriod" (id,"plateId","ownerId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceFileIds","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${owner.id},${from},${to},'synthetic','test','synthetic','test',NULL,'[]'::jsonb)`,missingEvidence);
   await assert.rejects(omit
    ?isolated.$executeRaw`INSERT INTO "PlateVehicleBinding" (id,"plateId","vehicleId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${vehicle.id},${from},${to},'synthetic','test','synthetic','test','[]'::jsonb)`
    :isolated.$executeRaw`INSERT INTO "PlateVehicleBinding" (id,"plateId","vehicleId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceFileIds","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${vehicle.id},${from},${to},'synthetic','test','synthetic','test',NULL,'[]'::jsonb)`,missingEvidence);
   await assert.rejects(omit
    ?isolated.$executeRaw`INSERT INTO "AssetManualPaymentRecord" (id,"entryId",amount,"paidAt","referenceNo",reason,"recordedBy") VALUES (${randomUUID()},${entry.id},10000,${to},'test','test','synthetic')`
    :isolated.$executeRaw`INSERT INTO "AssetManualPaymentRecord" (id,"entryId",amount,"paidAt","referenceNo",reason,"recordedBy","evidenceFileIds") VALUES (${randomUUID()},${entry.id},10000,${to},'test','test','synthetic',NULL)`,missingEvidence);
  }
  await assert.rejects(isolated.$executeRaw`INSERT INTO "PlateOwnershipPeriod" (id,"plateId","ownerId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceFileIds","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${owner.id},${from},${to},'synthetic','test','synthetic','test',ARRAY[NULL]::TEXT[],'[]'::jsonb)`,checkViolation('PlateOwnershipPeriod_evidence_elements'));
  await assert.rejects(isolated.$executeRaw`INSERT INTO "PlateVehicleBinding" (id,"plateId","vehicleId","validFrom","validUntil","recordedBy",reason,"endedBy","endReason","evidenceFileIds","evidenceSnapshot") VALUES (${randomUUID()},${plate.id},${vehicle.id},${from},${to},'synthetic','test','synthetic','test',ARRAY[NULL]::TEXT[],'[]'::jsonb)`,checkViolation('PlateVehicleBinding_evidence_elements'));
  await assert.rejects(isolated.$executeRaw`INSERT INTO "AssetManualPaymentRecord" (id,"entryId",amount,"paidAt","referenceNo",reason,"recordedBy","evidenceFileIds") VALUES (${randomUUID()},${entry.id},10000,${to},'test','test','synthetic',ARRAY[NULL]::TEXT[])`,checkViolation('AssetManualPaymentRecord_evidence_elements'));
  await verifyResidualSchema(isolated,model,vehicle,from);
  await verifyWorkOrderSchema(isolated,vehicle,from);
  await verifyCustomerSourceSchema(isolated);
  await verifyCollectionSchema(isolated,vehicle);
  await verifyOfflineChangeSchema(isolated,vehicle);
  await verifyFieldBatchSchema(isolated,vehicle);
  await verifyOrderServiceStageSchema(isolated,vehicle);
  await verifyRenewalMutualAgreementSchema(isolated);
 }finally{
  await isolated.$disconnect();
  // The only dropped object is this test's newly created, validated random schema.
  if(created)await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$disconnect();
 }
});
