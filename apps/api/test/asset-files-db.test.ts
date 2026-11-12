import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {JourneyHarness} from './seven-module-journey-fixtures';

test('private asset HTTP uploads enforce current roles, parent CAS, atomic replay and scoped downloads',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();
  const vehicle=await h.db.vehicle.create({data:{title:'资产附件合成车',brand:'本地',model:'合成',vin:'L'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),year:2026,city:'上海',mileageKm:0,status:'DRAFT'}});
  const contract=await h.db.vehicleBaasContract.create({data:{vehicleId:vehicle.id,provider:'合成供应商',contractNumber:h.prefix,batteryPackage:'合成',effectiveFrom:new Date('2026-01-01'),effectiveTo:new Date('2026-12-31'),billingCycle:'MONTHLY',rentalAmount:12345,paymentDayOfMonth:1,termsHash:'a'.repeat(64),createdBy:h.maker.id,updatedBy:h.maker.id}});
  const base=`/admin/baas-contracts/${contract.id}/files`,bytes=Buffer.from('%PDF-1.4\nSYNTHETIC ASSET ONLY '+h.prefix+'\n%%EOF'),sha=createHash('sha256').update(bytes).digest('hex'),key=randomUUID();
  function form(revision=0,idempotencyKey=key,content=bytes){const f=new FormData();f.set('revision',String(revision));f.set('idempotencyKey',idempotencyKey);f.set('file',new Blob([content],{type:'application/pdf'}),'合成资产资料.pdf');return f;}
  await h.reject(base,form(),h.finance,'FORBIDDEN');await h.reject(base,undefined,h.support,'FORBIDDEN');await h.reject(base,undefined,h.field,'FORBIDDEN');
  const [one,two]=await Promise.all([h.post(base,form()),h.post(base,form())]);assert.deepEqual(one,two);assert.equal(one.revision,1);assert.equal(one.sha256,sha);assert.equal(one.name,'合成资产资料.pdf');assert.equal('storagePath' in one,false);
  assert.equal(await h.db.assetPrivateFile.count({where:{baasContractId:contract.id}}),1);assert.equal((await h.db.vehicleBaasContract.findUniqueOrThrow({where:{id:contract.id}})).rentalAmount,12345);assert.equal(await h.db.archiveCommand.count({where:{resourceId:contract.id,action:'ASSET_FILE_UPLOAD'}}),1);
  const listed=await h.get(base,h.finance);assert.equal(listed.revision,1);assert.equal(listed.items.length,1);assert.equal(JSON.stringify(listed).includes('storagePath'),false);assert.deepEqual(await h.assertPdf(`${base}/${one.id}`,h.finance),bytes);
  await h.reject(base,form(0,key,Buffer.from('%PDF-changed')),h.maker,'IDEMPOTENCY_CONFLICT');await h.reject(base,form(0,randomUUID()),h.maker,'REVISION_CONFLICT');
  const conflict=await Promise.all([h.raw(base,form(1,randomUUID())),h.raw(base,form(1,randomUUID()))]);assert.deepEqual(conflict.map(r=>r.status).sort(),[201,409]);assert.equal(await h.db.assetPrivateFile.count({where:{baasContractId:contract.id}}),2);
  const other=await h.db.vehicleBaasContract.create({data:{vehicleId:vehicle.id,provider:'其他合成',contractNumber:randomUUID(),batteryPackage:'合成',effectiveFrom:new Date('2027-01-01'),effectiveTo:new Date('2027-12-31'),billingCycle:'MONTHLY',rentalAmount:5000,paymentDayOfMonth:1,termsHash:'b'.repeat(64),createdBy:h.maker.id,updatedBy:h.maker.id}});
  await h.reject(`/admin/baas-contracts/${other.id}/files/${one.id}`,undefined,h.maker,'ASSET_FILE_INVALID');
  const policy=await h.db.vehicleDepreciationPolicy.create({data:{vehicleId:vehicle.id,method:'STRAIGHT_LINE',basisAmount:100000,basisSource:'合成依据',basisEvidence:'合成材料',residualAmount:10000,startDate:new Date('2026-01-01'),usefulLifeMonths:12,termsHash:'c'.repeat(64),createdBy:h.finance.id,updatedBy:h.finance.id}});
  const depBase=`/admin/depreciation-policies/${policy.id}/files`;await h.reject(depBase,form(),h.maker,'FORBIDDEN');const dep=await h.post(depBase,form(),h.finance);await h.assertPdf(`${depBase}/${dep.id}`,h.finance);
  const plan=await h.db.assetCostPlan.create({data:{vehicleId:vehicle.id,sourceKind:'BAAS',baasContractId:contract.id,costPeriod:'2026-01',periodStart:new Date('2026-01-01'),periodEnd:new Date('2026-01-31'),amount:12345,dueDate:new Date('2026-01-01'),sourceRevision:2,sourceHash:'a'.repeat(64),sourceSnapshot:{synthetic:true},createdBy:h.finance.id,status:'CONFIRMED'}});
  const cost=await h.db.assetCostEntry.create({data:{vehicleId:vehicle.id,planId:plan.id,sourceKey:randomUUID(),category:'BAAS_RENT',amount:12345,periodStart:plan.periodStart,periodEnd:plan.periodEnd,postedBy:h.finance.id,sourceSnapshot:{synthetic:true},sourceHash:'a'.repeat(64)}}),costBase=`/admin/asset-costs/${cost.id}/files`;
  await h.reject(costBase,form(),h.maker,'FORBIDDEN');const proof=await h.post(costBase,form(),h.finance);assert.equal(proof.revision,1);await h.db.assetCostEntry.update({where:{id:cost.id},data:{lockedAt:new Date(),lockedBy:h.finance.id}});await h.reject(costBase,form(1,randomUUID()),h.finance,'ASSET_COST_LOCKED');await h.assertPdf(`${costBase}/${proof.id}`,h.finance);
  // Corrupt purpose deliberately: domain mapping must still block generic URLs.
  await h.db.storedFile.update({where:{id:one.id},data:{purpose:'vehicle',mimeType:'image/png'}});await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'PUBLISHED',coverFileId:one.id}});
  await h.reject(`/admin/files/${one.id}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');const customer=await h.customer('asset-boundary');await h.reject(`/customer/files/${one.id}`,undefined,customer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/public/media/${one.id}`,undefined,{id:'public',headers:{}},'NOT_FOUND');await h.reject(`${base}/${one.id}`,undefined,h.maker,'ASSET_FILE_INVALID');
  await h.db.adminUser.update({where:{id:h.maker.id},data:{role:'SUPPORT',authVersion:{increment:1}}});await h.reject(base,form(),h.maker);await h.reject(base,undefined,h.maker);assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);
 }finally{await h.close();}
});
