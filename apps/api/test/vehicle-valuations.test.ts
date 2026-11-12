import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {VehicleValuationsService} from '../src/vehicle-valuations/service';
import {VehicleValuationsController} from '../src/vehicle-valuations/controller';
import {valuationCreateInput,valuationApproveInput} from '../src/vehicle-valuations/types';
import {valuationTransaction} from '../src/vehicle-valuations/command';
import {curveError,curveFinance,curveNow,curveOperator,seedValuationEvidence,forecastCommand,savedForecast} from './residual-forecasts-fixture';

async function reviewSetup(source:'MANUAL'|'FORECAST'='FORECAST'){
 const f=await savedForecast(),valuations=new VehicleValuationsService(()=>new Date('2027-01-31T00:10:00+08:00'));
 const body={...forecastCommand(),vehicleId:'vehicle',vehicleRevision:0,source,forecastPointId:source==='FORECAST'?f.row.points[0].id:null,forecastRevision:source==='FORECAST'?0:null,requestedAmount:12345,reason:'明确估值申请'},review=await f.serial(tx=>valuations.create(tx,curveOperator,body));return{...f,valuations,reviewBody:body,review};
}

test('valuation strict DTO rejects forged manual links, missing forecast revision, unsafe money and duplicate evidence',()=>{
 const body={...forecastCommand(),vehicleId:'vehicle',vehicleRevision:0,source:'MANUAL',forecastPointId:null,forecastRevision:null,requestedAmount:1,reason:'真实理由'};assert.equal(valuationCreateInput.safeParse(body).success,true);
 for(const change of [{source:'FORECAST'},{forecastPointId:'point'},{requestedAmount:0},{requestedAmount:2147483648},{reason:'bad\0reason'}])assert.equal(valuationCreateInput.safeParse({...body,...change}).success,false);
 assert.equal(valuationApproveInput.safeParse({...forecastCommand(),vehicleRevision:0,approvedAmount:1,reason:'审核',fileIds:['same','same']}).success,false);
});

test('manual review keeps independent requested amount and finance approval requires same-parent evidence and month-end review date',async()=>{
 const f=await reviewSetup('MANUAL'),input={...forecastCommand(),vehicleRevision:0,approvedAmount:15000,reason:'财务核验',fileIds:['evidence']};
 await assert.rejects(f.serial(tx=>f.valuations.approve(tx,curveOperator,f.review.id,input)),curveError('FORBIDDEN'));await assert.rejects(f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,input)),curveError('ASSET_FILE_INVALID'));
 seedValuationEvidence(f,f.review.id);const approved=await f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,input));assert.equal(approved.status,'APPROVED');assert.equal(approved.requestedAmount,12345);assert.equal(approved.approvedAmount,15000);assert.equal(approved.nextReviewDate,'2027-04-30');assert.deepEqual(approved.evidenceFileIds,['evidence']);assert.equal(approved.sourceSnapshot.forecast,null);
 const before=f.writes.length;assert.deepEqual(await f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,input)),approved);assert.equal(f.writes.length,before);await assert.rejects(f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,{...input,...forecastCommand(1)})),curveError('VALUATION_STATE'));
});

test('forecast review requires same vehicle real supported point, explicit parent revision and a single pending review',async()=>{
 const f=await reviewSetup();assert.equal(f.review.requestedAmount,12345);assert.notEqual(f.review.requestedAmount,f.row.points[0].predictedAmount);assert.equal(f.review.sourceSnapshot.forecast.id,f.row.id);
 for(const [change,code] of [[{},'VALUATION_PENDING_EXISTS'],[{forecastRevision:1},'REVISION_CONFLICT'],[{forecastPointId:f.row.points[3].id},'FORECAST_POINT_UNSUPPORTED']] as const)await assert.rejects(f.serial(tx=>f.valuations.create(tx,curveFinance,{...f.reviewBody,...change,idempotencyKey:randomUUID()})),curveError(code));
 f.seed('vehicle',{...f.rows('vehicle')[0],id:'other'});await assert.rejects(f.serial(tx=>f.valuations.create(tx,curveFinance,{...f.reviewBody,vehicleId:'other',idempotencyKey:randomUUID()})),curveError('FORECAST_POINT_MISMATCH'));
});

test('pending forecast review rejects approval after source void while rejection or owner cancellation remains possible',async()=>{
 for(const action of ['reject','cancel'] as const){const f=await reviewSetup();await f.serial(tx=>f.service.void(tx,curveOperator,f.row.id,{...forecastCommand(),reason:'撤回错误预测'}));seedValuationEvidence(f,f.review.id);
  await assert.rejects(f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,{...forecastCommand(),vehicleRevision:0,approvedAmount:12345,reason:'不能批准',fileIds:['evidence']})),curveError('FORECAST_SOURCE_VOIDED'));
  const result=await f.serial(tx=>f.valuations[action](tx,action==='reject'?curveFinance:curveOperator,f.review.id,{...forecastCommand(),reason:'保留失效来源结论'}));assert.equal(result.status,action==='reject'?'REJECTED':'CANCELLED');assert.equal(result.approvedAmount,null);
 }
});

test('valuation role/owner checks precede cached replay and source history never follows current vehicle naming',async()=>{
 const f=await reviewSetup('MANUAL');await assert.rejects(f.serial(tx=>f.valuations.cancel(tx,curveFinance,f.review.id,{...forecastCommand(),reason:'非本人'})),curveError('FORBIDDEN'));
 f.rows('vehicle')[0].title='后来车名';assert.equal((await f.valuations.detail(f.tx,curveFinance,f.review.id)).beforeSnapshot.vehicle.title,'冻结车辆');assert.deepEqual(await f.serial(tx=>f.valuations.create(tx,curveOperator,f.reviewBody)),f.review);
 seedValuationEvidence(f,f.review.id);const input={...forecastCommand(),vehicleRevision:0,approvedAmount:20000,reason:'独立复核',fileIds:['evidence']};await f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,input));f.rows('adminUser').find(row=>row.id===curveFinance.id).role='OPERATIONS';await assert.rejects(f.serial(tx=>f.valuations.approve(tx,{...curveFinance,role:'OPERATIONS'},f.review.id,input)),curveError('FORBIDDEN'));
 assert.equal(Reflect.getMetadata('path',VehicleValuationsController),'admin/vehicle-valuations');assert.ok(f.writes.every(w=>['vehicleResidualCurve','vehicleResidualCurvePoint','vehicleResidualForecast','vehicleResidualForecastPoint','vehicleValuationReview','archiveCommand','auditLog'].includes(w.table)));
});

test('valuation frozen source tampering and foreign-parent evidence fail without partial approval',async()=>{
 const f=await reviewSetup();seedValuationEvidence(f,'different-review');await assert.rejects(f.serial(tx=>f.valuations.approve(tx,curveFinance,f.review.id,{...forecastCommand(),vehicleRevision:0,approvedAmount:1,reason:'归属不符',fileIds:['evidence']})),curveError('ASSET_FILE_INVALID'));
 f.rows('vehicleValuationReview')[0].sourceSnapshot.forecast.points[0].predictedAmount++;await assert.rejects(f.valuations.detail(f.tx,curveFinance,f.review.id),curveError('VALUATION_SOURCE_INVALID'));assert.equal(f.rows('vehicleValuationReview')[0].status,'PENDING');
});

test('valuation rejects NUL route IDs before lookup and only retries known pending-point or command races',async()=>{
 const f=await reviewSetup('MANUAL');await assert.rejects(f.valuations.detail(f.tx,curveFinance,'bad\0id'),error=>error instanceof ZodError);await assert.rejects(f.serial(tx=>f.valuations.cancel(tx,curveOperator,'bad\0id',{...forecastCommand(),reason:'检查编号'})),error=>error instanceof ZodError);
 for(const race of [{code:'P2002',meta:{modelName:'VehicleValuationReview',target:['forecastPointId']}},{code:'P2002',meta:{modelName:'ArchiveCommand',target:['actorId','resourceId','action','key']}}]){let calls=0;const expected={id:'known'};assert.deepEqual(await valuationTransaction({serial:async(operation:any)=>{if(++calls===1)throw race;return operation({});}} as any,async()=>expected),expected);assert.equal(calls,2);}
 const error={code:'P2002',meta:{modelName:'OtherModel',target:['forecastPointId']}};let calls=0;await assert.rejects(valuationTransaction({serial:async()=>{calls++;throw error;}} as any,async()=>({})),caught=>caught===error);assert.equal(calls,1);
});
