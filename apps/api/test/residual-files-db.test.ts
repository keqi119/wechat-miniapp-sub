import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {JourneyHarness,type Login} from './seven-module-journey-fixtures';

test('residual evidence HTTP preserves independent parents, roles, replay, lifecycle and private-file boundaries',{skip:process.env.NODE_ENV!=='test'},async()=>{
 const h=new JourneyHarness();
 try{
  await h.start();
  const [billCount,paymentCount,vehicleCount]=await Promise.all([h.db.bill.count(),h.db.payment.count(),h.db.vehicle.count()]);
  const model=await h.db.modelDefinition.create({data:{brand:'合成残值',name:`附件验证-${h.prefix}`,modelYear:2026}});
  const sample=async(label:string,status='ACTIVE')=>h.db.marketPriceObservation.create({data:{modelDefinitionId:model.id,modelSnapshot:{id:model.id,revision:model.revision,brand:model.brand,name:model.name,modelYear:2026},source:'MANUAL',observedOn:new Date('2026-10-30'),priceType:'DEALER_QUOTE',priceAmount:123456,sourceNote:`仅本地合成来源 ${label}`,dedupeKey:createHash('sha256').update(`${h.prefix}:${label}`).digest('hex'),confidenceScore:80,status,createdBy:h.maker.id,updatedBy:h.maker.id}});
  const observation=await sample('observation'),otherObservation=await sample('ignored','IGNORED');
  const sampleBase=`/admin/residual-observations/${observation.id}/files`,otherSampleBase=`/admin/residual-observations/${otherObservation.id}/files`;
  const bytes=Buffer.from(`%PDF-1.4\nSYNTHETIC RESIDUAL EVIDENCE ${h.prefix}\n%%EOF`),sha256=createHash('sha256').update(bytes).digest('hex'),sampleKey=randomUUID();
  const form=(revision:number,idempotencyKey:string,content:Buffer=bytes)=>{const body=new FormData();body.set('revision',String(revision));body.set('idempotencyKey',idempotencyKey);body.set('file',new Blob([content],{type:'application/pdf'}),'合成残值依据.pdf');return body;};
  const counters=(resourceId:string)=>Promise.all([h.db.assetPrivateFile.count({where:{OR:[{observationId:resourceId},{valuationReviewId:resourceId}]}}),h.db.archiveCommand.count({where:{resourceId,action:'ASSET_FILE_UPLOAD'}}),h.db.auditLog.count({where:{resourceId,action:'ASSET_FILE_UPLOAD'}})]);

  await h.reject(sampleBase,form(0,sampleKey),h.finance,'FORBIDDEN');
  for(const who of [h.support,h.field]){await h.reject(sampleBase,undefined,who,'FORBIDDEN');await h.reject(sampleBase,form(0,randomUUID()),who,'FORBIDDEN');}
  const [uploaded,replayed]=await Promise.all([h.post(sampleBase,form(0,sampleKey)),h.post(sampleBase,form(0,sampleKey))]);
  assert.deepEqual(replayed,uploaded);assert.equal(uploaded.revision,1);assert.equal(uploaded.sha256,sha256);assert.equal(uploaded.name,'合成残值依据.pdf');assert.equal('storagePath'in uploaded,false);assert.deepEqual(await counters(observation.id),[1,1,1]);
  assert.equal(await h.db.vehicle.count(),vehicleCount,'A market sample upload must not create or require a vehicle');
  assert.equal((await h.db.marketPriceObservation.findUniqueOrThrow({where:{id:observation.id}})).priceAmount,123456);
  const sampleFile=await h.db.assetPrivateFile.findUniqueOrThrow({where:{fileId:uploaded.id}});assert.equal(sampleFile.kind,'RESIDUAL_OBSERVATION');assert.equal(sampleFile.observationId,observation.id);for(const field of ['baasContractId','depreciationPolicyId','costEntryId','licensePlateId','valuationReviewId'] as const)assert.equal(sampleFile[field],null);
  const listed=await h.get(sampleBase,h.finance);assert.equal(listed.revision,1);assert.deepEqual(listed.items.map((file:any)=>file.id),[uploaded.id]);assert.equal(JSON.stringify(listed).includes('storagePath'),false);assert.deepEqual(await h.assertPdf(`${sampleBase}/${uploaded.id}`,h.finance),bytes);
  await h.reject(sampleBase,form(0,sampleKey,Buffer.from('%PDF-1.4\nDIFFERENT')),h.maker,'IDEMPOTENCY_CONFLICT');await h.reject(sampleBase,form(0,randomUUID()),h.maker,'REVISION_CONFLICT');
  const races=await Promise.all([h.raw(sampleBase,form(1,randomUUID())),h.raw(sampleBase,form(1,randomUUID()))]);assert.deepEqual(races.map(r=>r.status).sort(),[201,409]);assert.equal(races.find(r=>r.status===409)!.data.error.code,'REVISION_CONFLICT');assert.deepEqual(await counters(observation.id),[2,2,2]);assert.equal((await h.db.marketPriceObservation.findUniqueOrThrow({where:{id:observation.id}})).revision,2);
  const ignoredFile=await h.post(otherSampleBase,form(0,randomUUID()));assert.equal(ignoredFile.revision,1);await h.assertPdf(`${otherSampleBase}/${ignoredFile.id}`,h.finance);

  // Parent fixtures are seeded because this package tests only the registered
  // dedicated file HTTP surface, before residual business controllers exist.
  const vehicle=await h.db.vehicle.create({data:{title:'估值附件合成车',brand:'合成残值',model:'EV',modelDefinitionId:model.id,year:2026,city:'上海',mileageKm:0,status:'DRAFT'}}),otherVehicle=await h.db.vehicle.create({data:{title:'异车估值附件',brand:'合成残值',model:'EV',year:2026,city:'上海',mileageKm:0,status:'DRAFT'}});
  const profileBase=`/admin/vehicle-assets/${vehicle.id}`,profileBefore=await h.get(profileBase);assert.equal(profileBefore.registered,false);assert.equal(profileBefore.batteryCapacityKwh,null);
  const capacity=await h.post(profileBase,{revision:profileBefore.revision,vehicleRevision:profileBefore.vehicleRevision,idempotencyKey:randomUUID(),batteryCapacityKwh:'075.500'},h.maker,'PATCH');assert.equal(capacity.batteryCapacityKwh,'75.5');assert.equal((await h.db.vehicleAssetProfile.findUniqueOrThrow({where:{vehicleId:vehicle.id}})).batteryCapacityKwh?.toString(),'75.5');
  const financeCapacity=await h.get(profileBase,h.finance);assert.equal(financeCapacity.batteryCapacityKwh,'75.5');assert.equal('notes'in financeCapacity,false);await h.reject(profileBase,{revision:capacity.revision,vehicleRevision:capacity.vehicleRevision,idempotencyKey:randomUUID(),batteryCapacityKwh:'80'},h.finance,'FORBIDDEN','PATCH');
  const cleared=await h.post(profileBase,{revision:capacity.revision,vehicleRevision:capacity.vehicleRevision,idempotencyKey:randomUUID(),batteryCapacityKwh:null},h.maker,'PATCH');assert.equal(cleared.batteryCapacityKwh,null);assert.equal(cleared.revision,capacity.revision+1);assert.equal((await h.get(profileBase,h.finance)).batteryCapacityKwh,null);
  const valuation=(vehicleId:string,label:string)=>h.db.vehicleValuationReview.create({data:{vehicleId,source:'MANUAL',requestedAmount:1000000,reason:`本地合成估值 ${label}`,beforeSnapshot:{synthetic:true},sourceSnapshot:{synthetic:true,label},sourceHash:createHash('sha256').update(`${h.prefix}:${label}`).digest('hex'),createdBy:h.maker.id,updatedBy:h.maker.id}});
  const review=await valuation(vehicle.id,'main'),sameVehicleReview=await valuation(vehicle.id,'same-vehicle'),otherVehicleReview=await valuation(otherVehicle.id,'other-vehicle');
  const valuationBase=(id:string)=>`/admin/vehicle-valuations/${id}/files`,reviewBase=valuationBase(review.id);
  const opsKey=randomUUID(),opsProof=await h.post(reviewBase,form(0,opsKey)),financeKey=randomUUID();
  const [financeProof,financeReplay]=await Promise.all([h.post(reviewBase,form(1,financeKey),h.finance),h.post(reviewBase,form(1,financeKey),h.finance)]);assert.deepEqual(financeReplay,financeProof);assert.equal(financeProof.revision,2);assert.deepEqual(await counters(review.id),[2,2,2]);
  const reviewRow=await h.db.vehicleValuationReview.findUniqueOrThrow({where:{id:review.id}});assert.equal(reviewRow.vehicleId,vehicle.id);assert.equal(reviewRow.requestedAmount,1000000);assert.equal(reviewRow.status,'PENDING');assert.equal(reviewRow.approvedAmount,null);assert.equal((await h.db.vehicle.findUniqueOrThrow({where:{id:vehicle.id}})).revision,vehicle.revision,'Taking the vehicle lock must not change vehicle revision');
  const reviewFile=await h.db.assetPrivateFile.findUniqueOrThrow({where:{fileId:financeProof.id}});assert.equal(reviewFile.kind,'VALUATION');assert.equal(reviewFile.valuationReviewId,review.id);for(const field of ['baasContractId','depreciationPolicyId','costEntryId','licensePlateId','observationId'] as const)assert.equal(reviewFile[field],null);
  for(const who of [h.maker,h.finance,h.reviewer]){assert.equal((await h.get(reviewBase,who)).items.length,2);assert.deepEqual(await h.assertPdf(`${reviewBase}/${opsProof.id}`,who),bytes);assert.deepEqual(await h.assertPdf(`${reviewBase}/${financeProof.id}`,who),bytes);}
  for(const who of [h.support,h.field]){await h.reject(reviewBase,undefined,who,'FORBIDDEN');await h.reject(reviewBase,form(2,randomUUID()),who,'FORBIDDEN');}

  const contract=await h.db.vehicleBaasContract.create({data:{vehicleId:vehicle.id,provider:'合成旧域',contractNumber:h.prefix,batteryPackage:'合成电池',effectiveFrom:new Date('2026-01-01'),effectiveTo:new Date('2026-12-31'),billingCycle:'MONTHLY',rentalAmount:10000,paymentDayOfMonth:1,termsHash:'a'.repeat(64),createdBy:h.maker.id,updatedBy:h.maker.id}}),baasBase=`/admin/baas-contracts/${contract.id}/files`,baasFile=await h.post(baasBase,form(0,randomUUID()));
  for(const [base,id] of [[otherSampleBase,uploaded.id],[valuationBase(sameVehicleReview.id),opsProof.id],[valuationBase(otherVehicleReview.id),opsProof.id],[sampleBase,opsProof.id],[reviewBase,uploaded.id],[sampleBase,baasFile.id],[reviewBase,baasFile.id],[baasBase,uploaded.id],[baasBase,opsProof.id]])await h.reject(`${base}/${id}`,undefined,h.maker,'ASSET_FILE_INVALID');

  await h.db.marketPriceObservation.update({where:{id:observation.id},data:{status:'VOIDED',revision:{increment:1}}});
  await h.reject(sampleBase,form(3,randomUUID()),h.maker,'ASSET_SOURCE_CLOSED');await h.assertPdf(`${sampleBase}/${uploaded.id}`,h.finance);const closedSampleCount=await counters(observation.id);assert.deepEqual(await h.post(sampleBase,form(0,sampleKey)),uploaded);assert.deepEqual(await counters(observation.id),closedSampleCount,'A historical successful replay may return its file but never append');assert.equal((await h.get(sampleBase,h.finance)).revision,3);
  const sameProof=await h.post(valuationBase(sameVehicleReview.id),form(0,randomUUID())),otherProof=await h.post(valuationBase(otherVehicleReview.id),form(0,randomUUID()));
  const terminalCases=[{row:review,status:'APPROVED',proof:opsProof,currentRevision:2},{row:sameVehicleReview,status:'REJECTED',proof:sameProof,currentRevision:1},{row:otherVehicleReview,status:'CANCELLED',proof:otherProof,currentRevision:1}] as const;
  for(const entry of terminalCases){
   const data:any={status:entry.status,revision:{increment:1},decidedBy:h.finance.id,decidedAt:new Date(),decisionReason:'仅本地测试既有终态附件边界'};
   if(entry.status==='APPROVED')Object.assign(data,{approvedAmount:1000000,nextReviewDate:new Date('2027-01-31'),evidenceFileIds:[opsProof.id,financeProof.id],evidenceSnapshot:[{id:opsProof.id,sha256},{id:financeProof.id,sha256}]});
   await h.db.vehicleValuationReview.update({where:{id:entry.row.id},data});const base=valuationBase(entry.row.id),before=await counters(entry.row.id);await h.reject(base,form(entry.currentRevision+1,randomUUID()),h.maker,'ASSET_SOURCE_CLOSED');await h.reject(base,form(entry.currentRevision+1,randomUUID()),h.finance,'ASSET_SOURCE_CLOSED');
   for(const who of [h.maker,h.finance])await h.assertPdf(`${base}/${entry.proof.id}`,who);assert.deepEqual(await counters(entry.row.id),before);
  }

  const customer=await h.customer('residual-file-boundary'),publicWho:Login={id:'public',headers:{}};
  for(const [id,base] of [[uploaded.id,sampleBase],[opsProof.id,reviewBase]]){
   await h.reject(`/admin/files/${id}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/customer/files/${id}`,undefined,customer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/public/media/${id}`,undefined,publicWho,'NOT_FOUND');
   // Deliberately wrong purpose and public linkage must not bypass the actual
   // AssetPrivateFile binding. Dedicated reads also fail closed on corruption.
   await h.db.storedFile.update({where:{id},data:{purpose:'vehicle',mimeType:'image/png'}});await h.db.vehicle.update({where:{id:vehicle.id},data:{status:'PUBLISHED',coverFileId:id}});
   await h.reject(`/admin/files/${id}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/customer/files/${id}`,undefined,customer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/public/media/${id}`,undefined,publicWho,'NOT_FOUND');await h.reject(`${base}/${id}`,undefined,h.maker,'ASSET_FILE_INVALID');
   await h.db.storedFile.update({where:{id},data:{purpose:base===sampleBase?'asset-residual-observation':'asset-valuation',mimeType:'application/pdf'}});await h.assertPdf(`${base}/${id}`,h.finance);
  }
  for(const purpose of ['asset-residual-observation','asset-valuation']){
   await h.reject('/admin/files',h.form({purpose},purpose),h.maker,'FILE_PURPOSE');await h.reject('/customer/files',h.form({purpose},purpose),customer,'FILE_PURPOSE');
   const original=await h.db.storedFile.findUniqueOrThrow({where:{id:uploaded.id}}),orphan=await h.db.storedFile.create({data:{name:original.name,mimeType:original.mimeType,size:original.size,sha256:original.sha256,storagePath:original.storagePath,purpose,adminId:h.maker.id}});
   await h.reject(`/admin/files/${orphan.id}`,undefined,h.reviewer,'ASSET_FILE_ROUTE_REQUIRED');await h.reject(`/customer/files/${orphan.id}`,undefined,customer,'ASSET_FILE_ROUTE_REQUIRED');
  }

  const beforeRevocation=[await counters(observation.id),await counters(review.id)];
  await h.db.adminUser.update({where:{id:h.maker.id},data:{role:'SUPPORT'}});
  await h.reject(sampleBase,form(0,sampleKey),h.maker,'FORBIDDEN');await h.reject(reviewBase,form(0,opsKey),h.maker,'FORBIDDEN');await h.reject(sampleBase,undefined,h.maker,'FORBIDDEN');
  await h.db.adminUser.update({where:{id:h.finance.id},data:{active:false,authVersion:{increment:1}}});
  await h.reject(reviewBase,form(1,financeKey),h.finance,'SESSION_EXPIRED');await h.reject(`${reviewBase}/${financeProof.id}`,undefined,h.finance,'SESSION_EXPIRED');assert.deepEqual([await counters(observation.id),await counters(review.id)],beforeRevocation);
  assert.equal(await h.db.bill.count(),billCount);assert.equal(await h.db.payment.count(),paymentCount);assert.equal(h.payment.providerCalls,0);assert.equal(h.externalCalls,0);assert.equal(h.identityCalls,0);assert.equal(h.esignCalls,0);assert.equal(h.realSmsSends,0);
 }finally{await h.close();}
});
