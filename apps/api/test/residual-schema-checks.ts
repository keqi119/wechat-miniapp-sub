import assert from 'node:assert/strict';

/** Called only inside the fresh-schema test's guarded, newly created schema. */
export async function verifyResidualSchema(db:any,model:{id:string},vehicle:{id:string},date:Date){
 const names=['MarketPriceObservation','MarketPriceImportBatch','VehicleResidualCurve','VehicleResidualCurvePoint','VehicleResidualForecast','VehicleResidualForecastPoint','VehicleValuationReview'];
 const tables=await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()`;
 for(const name of names)assert.ok(tables.some((row:any)=>row.table_name===name),`missing residual table ${name}`);
 const check=(name:string)=>(e:any)=>(e?.code==='P2004'||e?.meta?.code==='23514'||/23514/.test(e?.message||''))&&String(e?.message||'').includes(name);
 const unique=(e:any)=>e?.code==='P2002';
 const actors={createdBy:'synthetic-admin',updatedBy:'synthetic-admin'},hash='e'.repeat(64);
 const observation={modelDefinitionId:model.id,modelSnapshot:{brand:'合成',name:'样本'},source:'MANUAL',observedOn:date,priceType:'TRANSACTION',priceAmount:10000,sourceNote:'合成迁移验证',dedupeKey:hash,confidenceScore:90,...actors};
 await assert.rejects(db.marketPriceObservation.create({data:{...observation,priceAmount:0}}),check('MarketPriceObservation_values'));
 await assert.rejects(db.marketPriceObservation.create({data:{...observation,modelSnapshot:[]}}),check('MarketPriceObservation_values'));
 const sample=await db.marketPriceObservation.create({data:observation});
 await assert.rejects(db.marketPriceObservation.create({data:{...observation,status:'IGNORED'}}),unique);
 await db.marketPriceObservation.update({where:{id:sample.id},data:{status:'VOIDED'}});
 const correction=await db.marketPriceObservation.create({data:{...observation,correctionOfId:sample.id}});
 await assert.rejects(db.marketPriceObservation.update({where:{id:sample.id},data:{status:'ACTIVE'}}),unique);
 await assert.rejects(db.marketPriceObservation.update({where:{id:correction.id},data:{correctionOfId:correction.id}}),check('MarketPriceObservation_values'));
 const batch={csvHash:hash,fileName:'synthetic.csv',source:'CSV_IMPORT',status:'COMPLETED',rowCount:2,importedCount:2,duplicateCount:0,failedCount:0,rowResults:[],createdBy:'synthetic-admin'};
 await assert.rejects(db.marketPriceImportBatch.create({data:{...batch,importedCount:3}}),check('MarketPriceImportBatch_values'));
 await db.marketPriceImportBatch.create({data:batch});
 const curveData={modelDefinitionId:model.id,name:'合成曲线',dimensionHash:hash,dimensionSnapshot:{modelDefinitionId:model.id},filterSnapshot:{},sourceSnapshot:{samples:[]},sourceHash:hash,algorithmVersion:'RESIDUAL_STATISTICAL_V1',referenceCommit:'db4b48c55890f11f52c4fc52c29242d7c0d150be',pointCount:1,sampleCount:3,confidenceScore:90,skippedReasons:[],...actors};
 await assert.rejects(db.vehicleResidualCurve.create({data:{...curveData,sourceHash:'bad'}}),check('VehicleResidualCurve_values'));
 const curve=await db.vehicleResidualCurve.create({data:{...curveData,status:'ACTIVE',effectiveFrom:date,activatedAt:date,activatedBy:'synthetic-admin'}});
 await assert.rejects(db.vehicleResidualCurve.create({data:{...curveData,status:'ACTIVE',effectiveFrom:date,activatedAt:date,activatedBy:'synthetic-admin'}}),unique);
 await db.vehicleResidualCurve.create({data:curveData});
 const pointData={curveId:curve.id,ageMonth:12,sampleCount:3,medianPriceAmount:10000,p25PriceAmount:9000,p75PriceAmount:11000,averagePriceAmount:10000,minPriceAmount:8000,maxPriceAmount:12000,confidenceScore:90,sampleSnapshot:[]};
 await assert.rejects(db.vehicleResidualCurvePoint.create({data:{...pointData,p25PriceAmount:10001}}),check('VehicleResidualCurvePoint_values'));
 await assert.rejects(db.vehicleResidualCurvePoint.create({data:{...pointData,sampleCount:0}}),check('VehicleResidualCurvePoint_values'));
 await db.vehicleResidualCurvePoint.create({data:pointData});
 await assert.rejects(db.vehicleResidualCurvePoint.create({data:pointData}),unique);
 const forecastData={vehicleId:vehicle.id,curveId:curve.id,asOfDate:date,vehicleRevision:0,assetRevision:0,curveRevision:0,inputSnapshot:{},curveSnapshot:{},sourceHash:hash,...actors};
 await assert.rejects(db.vehicleResidualForecast.create({data:{...forecastData,curveSnapshot:[]}}),check('VehicleResidualForecast_values'));
 const forecast=await db.vehicleResidualForecast.create({data:forecastData});
 const fp={forecastId:forecast.id,horizonMonth:0,targetDate:date,targetAgeMonth:12,status:'GENERATED',interpolationMethod:'EXACT',predictedAmount:10000,lowerAmount:9000,upperAmount:11000,matchSnapshot:{}};
 await assert.rejects(db.vehicleResidualForecastPoint.create({data:{...fp,status:'UNSUPPORTED'}}),check('VehicleResidualForecastPoint_values'));
 await assert.rejects(db.vehicleResidualForecastPoint.create({data:{...fp,adoptedAmount:11000}}),check('VehicleResidualForecastPoint_values'));
 const forecastPoint=await db.vehicleResidualForecastPoint.create({data:fp});
 await db.vehicleResidualForecastPoint.create({data:{...fp,horizonMonth:120,status:'UNSUPPORTED',interpolationMethod:'UNSUPPORTED',predictedAmount:null,lowerAmount:null,upperAmount:null}});
 await assert.rejects(db.vehicleResidualForecastPoint.create({data:fp}),unique);
 const reviewData={vehicleId:vehicle.id,source:'FORECAST',forecastPointId:forecastPoint.id,requestedAmount:10000,reason:'合成迁移估值',beforeSnapshot:{},sourceSnapshot:{},sourceHash:hash,...actors};
 const review=await db.vehicleValuationReview.create({data:reviewData});
 await assert.rejects(db.vehicleValuationReview.create({data:reviewData}),unique);
 await assert.rejects(db.vehicleValuationReview.create({data:{...reviewData,source:'MANUAL'}}),check('VehicleValuationReview_values'));
 await assert.rejects(db.vehicleValuationReview.update({where:{id:review.id},data:{status:'APPROVED',approvedAmount:10000}}),check('VehicleValuationReview_values'));
 await assert.rejects(db.$executeRaw`UPDATE "VehicleValuationReview" SET "evidenceFileIds"=NULL WHERE id=${review.id}`,(e:any)=>e?.meta?.code==='23502');
 await assert.rejects(db.$executeRaw`UPDATE "VehicleValuationReview" SET "evidenceFileIds"=ARRAY[NULL]::text[] WHERE id=${review.id}`,check('VehicleValuationReview_values'));
 await assert.rejects(db.vehicleAssetProfile.update({where:{vehicleId:vehicle.id},data:{batteryCapacityKwh:'-1'}}),check('VehicleAssetProfile_capacity'));
 await db.vehicleAssetProfile.update({where:{vehicleId:vehicle.id},data:{batteryCapacityKwh:'75.500'}});
 await assert.rejects(db.$executeRaw`UPDATE "VehicleAssetProfile" SET "batteryCapacityKwh"='NaN'::numeric WHERE "vehicleId"=${vehicle.id}`,check('VehicleAssetProfile_capacity'));
 await assert.rejects(db.$executeRaw`UPDATE "MarketPriceObservation" SET "batteryCapacityKwh"='NaN'::numeric WHERE id=${sample.id}`,check('MarketPriceObservation_values'));
 await db.vehicleValuationReview.update({where:{id:review.id},data:{status:'APPROVED',approvedAmount:10000,decidedBy:'synthetic-finance',decidedAt:date,decisionReason:'合成验证',nextReviewDate:date,evidenceFileIds:['synthetic-evidence'],evidenceSnapshot:[{id:'synthetic-evidence',sha256:hash}]}});
 const datedRows=[['MarketPriceObservation','observedOn',sample.id],['MarketPriceObservation','registrationDate',sample.id],['VehicleResidualCurve','effectiveFrom',curve.id],['VehicleResidualForecast','asOfDate',forecast.id],['VehicleResidualForecastPoint','targetDate',forecastPoint.id],['VehicleValuationReview','nextReviewDate',review.id]];
 for(const [table,field,id] of datedRows)for(const value of ['infinity','10000-01-01']){
  // Identifier names above are fixed test constants; values stay parameters.
  await assert.rejects(db.$executeRawUnsafe(`UPDATE "${table}" SET "${field}"=$1::date WHERE id=$2`,value,id),check(table+'_dates'));
 }
 const file=await db.storedFile.create({data:{name:'合成残值.pdf',mimeType:'application/pdf',size:1,sha256:hash,storagePath:'synthetic/no-file',purpose:'asset-residual-observation'}});
 await assert.rejects(db.assetPrivateFile.create({data:{fileId:file.id,kind:'RESIDUAL_OBSERVATION',observationId:sample.id,valuationReviewId:review.id,sha256:hash,uploadedBy:'synthetic-admin'}}),check('AssetPrivateFile_scope'));
 await db.assetPrivateFile.create({data:{fileId:file.id,kind:'RESIDUAL_OBSERVATION',observationId:sample.id,sha256:hash,uploadedBy:'synthetic-admin'}});
 await assert.rejects(db.marketPriceObservation.delete({where:{id:sample.id}}),(e:any)=>e?.code==='P2003');
 assert.equal(await db.bill.count(),0);assert.equal(await db.payment.count(),0);
}
