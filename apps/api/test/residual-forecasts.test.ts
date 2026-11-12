import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {ResidualForecastsController} from '../src/residual-market/forecast-controller';
import {forecastCreateInput,forecastPreviewInput,forecastListInput} from '../src/residual-market/forecast-types';
import {residualForecastTransaction} from '../src/residual-market/forecast-command';
import {curveError,curveFinance,curveNow,curveOperator,forecastCommand,forecastSetup,savedForecast} from './residual-forecasts-fixture';

test('forecast strict DTO rejects forged dimensions, price sources, invalid dates and duplicate horizons',()=>{
 const request={vehicleId:'vehicle',curveId:'curve',asOfDate:'2026-10-31'};assert.equal(forecastPreviewInput.safeParse(request).success,true);
 for(const change of [{purchasePriceAmount:1},{trim:'旗舰'},{asOfDate:'2026-02-30'},{horizonMonths:[0,0]},{horizonMonths:[121]},{vehicleId:'x\0y'}])assert.equal(forecastPreviewInput.safeParse({...request,...change}).success,false);
 assert.equal(forecastCreateInput.safeParse({...request,...forecastCommand(),curveRevision:0,previewHash:'a'.repeat(64)}).success,false);
});

test('finance forecast preview is read-only, clamps month-end, never invents purchase price and maps unsupported points',async()=>{
 const f=await forecastSetup(false),before=f.writes.length,locks=f.locks.length,preview=await f.service.preview(f.tx,curveFinance,f.input);
 assert.equal(f.writes.length,before);assert.equal(f.locks.length,locks);assert.ok(preview.warnings.includes('CURVE_NOT_ACTIVE'));assert.ok(preview.warnings.includes('PURCHASE_PRICE_UNAVAILABLE'));
 assert.deepEqual(preview.points.map((p:any)=>[p.horizonMonth,p.predictedAmount,p.predictedResidualRateBps]),[[0,100003,null],[6,90003,null],[12,80003,null],[24,null,null]]);assert.equal(preview.points[1].targetDate,'2027-04-30');assert.equal(preview.points[3].interpolationMethod,'UNSUPPORTED');assert.equal(preview.points[3].matchSnapshot.interpolation,null);
 await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,{...f.input,...forecastCommand(),assetRevision:0,curveRevision:0,previewHash:preview.previewHash})),curveError('FORECAST_CURVE_INACTIVE'));
});

test('forecast matching requires actual model/year, registration, battery facts and rejects unavailable trim',async()=>{
 for(const [dimension,mutate] of [[{trim:'旗舰'},()=>{}],[{batteryOwnership:'BAAS'},()=>{}],[{batteryCapacityKwh:'80'},()=>{}],[{},(f:any)=>{f.rows('vehicleAssetProfile')[0].firstRegistrationDate=null;}],[{},(f:any)=>{f.rows('vehicle')[0].modelDefinitionId='other';}],[{},(f:any)=>{f.rows('modelDefinition')[0].modelYear=2025;}]] as const){
  const f=await forecastSetup(true,dimension);mutate(f);await assert.rejects(f.service.preview(f.tx,curveFinance,f.input),(error:any)=>['FORECAST_DIMENSION_MISMATCH','FORECAST_REGISTRATION_REQUIRED','FORECAST_MODEL_REQUIRED'].includes(error.getResponse?.().error?.code));
 }
});

test('forecast create rechecks revisions/hash, locks actual resources and replays before changed current assets',async()=>{
 const f=await savedForecast();assert.equal(f.row.status,'GENERATED');assert.equal(f.row.points.length,4);assert.ok(f.locks.some(value=>value.includes('VehicleAssetProfile')));assert.ok(f.locks.some(value=>value.includes('VehicleResidualCurve')));
 const before=f.writes.length;f.rows('vehicleAssetProfile')[0].revision++;await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,{...f.body,idempotencyKey:randomUUID()})),curveError('REVISION_CONFLICT'));assert.deepEqual(await f.serial(tx=>f.service.create(tx,curveOperator,f.body)),f.row);assert.equal(f.writes.length,before);
 await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,{...f.body,assetRevision:1,idempotencyKey:randomUUID()})),curveError('PREVIEW_CHANGED'));
 f.rows('adminUser').find(row=>row.id===curveOperator.id).role='SUPPORT';await assert.rejects(f.serial(tx=>f.service.create(tx,curveOperator,f.body)),curveError('STAFF_SESSION_CHANGED'));
});

test('forecast history validates frozen mathematics and real curve point provenance without reading changed live assets',async()=>{
 const f=await savedForecast();f.rows('vehicle')[0].title='后来名称';f.rows('vehicleAssetProfile')[0].firstRegistrationDate=null;f.rows('modelDefinition')[0].modelYear=2025;f.rows('vehicleResidualCurve')[0].sourceHash='b'.repeat(64);
 const result=await f.service.detail(f.tx,curveFinance,f.row.id);assert.equal(result.inputSnapshot.vehicle.title,'冻结车辆');assert.equal(result.points[0].predictedAmount,100003);
 f.rows('vehicleResidualForecastPoint')[0].matchSnapshot.interpolation.lowerPointId='forged';await assert.rejects(f.service.detail(f.tx,curveFinance,f.row.id),curveError('FORECAST_SOURCE_INVALID'));
});

test('adoption is same-parent once-only, keeps predicted money, blocks void and preserves archive history',async()=>{
 const f=await savedForecast(),point=f.row.points[0],body={...forecastCommand(),amount:12345,reason:'明确人工采用'};
 await assert.rejects(f.serial(tx=>f.service.adopt(tx,curveFinance,f.row.id,point.id,body)),curveError('FORBIDDEN'));await assert.rejects(f.serial(tx=>f.service.adopt(tx,curveOperator,f.row.id,'foreign-point',body)),curveError('FORECAST_POINT_MISMATCH'));await assert.rejects(f.serial(tx=>f.service.adopt(tx,curveOperator,f.row.id,f.row.points[3].id,body)),curveError('FORECAST_POINT_UNSUPPORTED'));
 const adopted=await f.serial(tx=>f.service.adopt(tx,curveOperator,f.row.id,point.id,body));assert.equal(adopted.status,'ADOPTED');assert.equal(adopted.points[0].predictedAmount,100003);assert.equal(adopted.points[0].adoptedAmount,12345);assert.deepEqual(await f.serial(tx=>f.service.adopt(tx,curveOperator,f.row.id,point.id,body)),adopted);
 await assert.rejects(f.serial(tx=>f.service.adopt(tx,curveOperator,f.row.id,point.id,{...body,...forecastCommand(1)})),curveError('FORECAST_POINT_ADOPTED'));await assert.rejects(f.serial(tx=>f.service.void(tx,curveOperator,f.row.id,{...forecastCommand(1),reason:'不得抹除采用'})),curveError('FORECAST_IN_USE'));
 const archived=await f.serial(tx=>f.service.archive(tx,curveOperator,f.row.id,{...forecastCommand(1),reason:'历史归档'}));assert.equal(archived.status,'ARCHIVED');assert.equal(archived.points[0].adoptedAmount,12345);assert.ok(f.writes.every(w=>['vehicleResidualCurve','vehicleResidualCurvePoint','vehicleResidualForecast','vehicleResidualForecastPoint','archiveCommand','auditLog'].includes(w.table)));
});

test('forecast cannot void an approved valuation reference, routes keep one resource and current role guards',async()=>{
 const f=await savedForecast();f.seed('vehicleValuationReview',{id:'approved',status:'APPROVED',vehicleId:'vehicle',forecastPointId:f.row.points[0].id});await assert.rejects(f.serial(tx=>f.service.void(tx,curveOperator,f.row.id,{...forecastCommand(),reason:'不能作废已批准依据'})),curveError('FORECAST_IN_USE'));
 assert.equal(Reflect.getMetadata('path',ResidualForecastsController),'admin/residual-forecasts');assert.equal(Reflect.getMetadata('path',ResidualForecastsController.prototype.preview),'preview');
});

test('forecast rejects NUL route IDs before lookup and unsafe pagination offsets',async()=>{
 const f=await savedForecast();await assert.rejects(f.service.detail(f.tx,curveFinance,'bad\0id'),error=>error instanceof ZodError);await assert.rejects(f.serial(tx=>f.service.archive(tx,curveOperator,'bad\0id',{...forecastCommand(),reason:'检查编号'})),error=>error instanceof ZodError);assert.equal(forecastListInput.safeParse({page:21474838,pageSize:100}).success,false);
});

test('forecast transaction retries only the exact command reservation race, at most once',async()=>{
 const expected={id:'cached'},target=['actorId','resourceId','action','key'],race={code:'P2002',meta:{modelName:'ArchiveCommand',target}};let calls=0;assert.deepEqual(await residualForecastTransaction({serial:async(operation:any)=>{if(++calls===1)throw race;return operation({});}} as any,async()=>expected),expected);assert.equal(calls,2);
 for(const error of [{code:'P2002',meta:{target:['dimensionHash']}},{code:'P2002',meta:{modelName:'Other',target}},new Error('unknown')]){calls=0;await assert.rejects(residualForecastTransaction({serial:async()=>{calls++;throw error;}} as any,async()=>expected),caught=>caught===error);assert.equal(calls,1);}
 calls=0;await assert.rejects(residualForecastTransaction({serial:async()=>{calls++;throw race;}} as any,async()=>expected),caught=>caught===race);assert.equal(calls,2);
});
