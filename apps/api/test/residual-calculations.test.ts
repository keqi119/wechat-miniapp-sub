import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalHash} from '../src/customers/types';
import {addResidualMonths,buildResidualCurve,forecastResidual,meanFen,observationConfidence,pointConfidence,quantileFen,sampleCalendarAgeMonths,vehicleCompletedAgeMonths,type ResidualObservation} from '../src/residual-market/calculations';
import {normalizeResidualDimension,observationDedupeKey,residualDimensionHash} from '../src/residual-market/dimensions';

const error=(code:string)=>(e:any)=>e.getResponse?.().error?.code===code;
const dimension={modelDefinitionId:'model-A',modelYear:2026,trim:null,batteryOwnership:null,batteryCapacityKwh:null};
function observation(id:string,extra:Partial<ResidualObservation>={}):ResidualObservation{return{id,revision:0,status:'ACTIVE',modelDefinitionId:'model-A',modelYear:2026,brand:'合成',series:null,model:'EV',trim:null,source:'MANUAL',sourceListingId:null,observedOn:'2027-01-01',registrationDate:'2026-01-31',vehicleAgeMonths:null,priceType:'TRANSACTION',priceAmount:10001,batteryOwnership:'OWNED',batteryCapacityKwh:null,mileageKm:0,city:null,accidentFlag:null,batteryHealthPercent:null,confidenceScore:100,...extra};}
function curveInput(observations:ResidualObservation[]){return{dimension,modelRevision:2,observations};}
const point=(id:string,ageMonth:number,amount:number,confidenceScore=80)=>({id,ageMonth,predictedResidualAmount:amount,lowerBoundAmount:Math.max(0,amount-10),upperBoundAmount:amount+10,confidenceScore});

test('sample age keeps calendar-month semantics while vehicle forecast age counts completed months',()=>{
 for(const [at,sample,vehicle] of [['2027-02-01',13,12],['2027-01-30',12,11],['2027-01-31',12,12],['2025-12-31',null,0]] as const){assert.equal(sampleCalendarAgeMonths({observedOn:at,registrationDate:'2026-01-31'}),sample);assert.equal(vehicleCompletedAgeMonths(at,'2026-01-31'),vehicle);}
 assert.equal(sampleCalendarAgeMonths({observedOn:'2026-01-01',registrationDate:'2026-01-31'}),0);assert.equal(sampleCalendarAgeMonths({observedOn:'2027-01-01',vehicleAgeMonths:0}),0);assert.equal(sampleCalendarAgeMonths({observedOn:'2027-01-01',vehicleAgeMonths:-1}),null);assert.equal(sampleCalendarAgeMonths({observedOn:'2027-01-01'}),null);
 assert.equal(vehicleCompletedAgeMonths('2025-02-28','2024-02-29'),11);assert.equal(sampleCalendarAgeMonths({observedOn:'2025-02-28',registrationDate:'2024-02-29'}),12);
 for(const date of ['2027-02-29','2026-13-01','2026-01-00','2026-01-01T00:00:00Z','0000-01-01'])assert.throws(()=>vehicleCompletedAgeMonths(date,'2024-01-01'));
 assert.throws(()=>sampleCalendarAgeMonths({vehicleAgeMonths:1.5}));
});

test('calendar addition clamps leap and month-end dates without rolling years 1..99 or using local time',()=>{
 assert.equal(addResidualMonths('2024-01-31',1),'2024-02-29');assert.equal(addResidualMonths('2023-01-31',1),'2023-02-28');assert.equal(addResidualMonths('2024-01-31',2),'2024-03-31');assert.equal(addResidualMonths('0099-12-31',2),'0100-02-28');assert.equal(addResidualMonths('2000-02-29',12),'2001-02-28');
 assert.throws(()=>addResidualMonths('9999-12-31',1));assert.throws(()=>addResidualMonths('0001-01-01',-1));assert.throws(()=>addResidualMonths('2027-01-01',0.5));
});

test('quantiles and mean use rounded integer fen for odd, even, singleton, half-fen and maximum Int samples',()=>{
 const input=[130,100,101,102],before=[...input];assert.equal(quantileFen(input,0.25),101);assert.equal(quantileFen(input,0.5),102);assert.equal(quantileFen(input,0.75),109);assert.equal(meanFen(input),108);assert.deepEqual(input,before);
 assert.equal(quantileFen([7],0.5),7);assert.equal(quantileFen([1,2],0.5),2);assert.equal(meanFen([1,2]),2);assert.equal(quantileFen([9,1,4],0.5),4);assert.equal(meanFen(Array(10000).fill(2147483647)),2147483647);assert.equal(quantileFen([2147483646,2147483647],0.5),2147483647);
 for(const bad of [[],[-1],[0.1],[2147483648],[NaN],[Infinity]]){assert.throws(()=>meanFen(bad));assert.throws(()=>quantileFen(bad,0.5));}assert.throws(()=>quantileFen([1,2],0.2 as any));
});

test('point confidence preserves null fallback, explicit zero, sample bonus cap and the original fractional rounding',()=>{
 assert.equal(pointConfidence([null]),35);assert.equal(pointConfidence([0,0,0]),15);assert.equal(pointConfidence([50,51,52]),46);assert.equal(pointConfidence(Array(8).fill(100)),100);assert.equal(pointConfidence([99,100]),70);assert.throws(()=>pointConfidence([]));assert.throws(()=>pointConfidence([101]));
 assert.equal(observationConfidence({}),40);assert.equal(observationConfidence({brand:'合成',model:'EV',observedOn:'2027-01-01',priceAmount:1,mileageKm:0,vehicleAgeMonths:0,batteryCapacityKwh:'0',city:'沪'}),100);assert.equal(observationConfidence({mileageKm:0,vehicleAgeMonths:0,batteryCapacityKwh:null}),60);
});

test('curve groups only default five ACTIVE price types, keeps min-three and reports missing age and undersized groups',()=>{
 const observations=[observation('a',{priceType:'TRANSACTION',priceAmount:100}),observation('b',{priceType:'AUCTION',priceAmount:101}),observation('c',{priceType:'DEALER_QUOTE',priceAmount:102}),observation('d',{priceType:'INTERNAL_SALE',priceAmount:130}),observation('e',{priceType:'LISTING',priceAmount:140}),observation('estimate',{priceType:'ESTIMATE',priceAmount:999999}),observation('ignored',{status:'IGNORED',priceAmount:999999}),observation('voided',{status:'VOIDED'}),observation('missing',{registrationDate:null}),observation('short-a',{vehicleAgeMonths:13}),observation('short-b',{vehicleAgeMonths:13})];
 const result=buildResidualCurve(curveInput(observations));assert.equal(result.sampleCount,8);assert.equal(result.skippedSampleCount,3);assert.deepEqual(result.skippedReasons,[{reason:'AGE_MONTH_MISSING',count:1},{reason:'MIN_SAMPLE_PER_POINT',ageMonth:13,count:2,minSamplePerPoint:3}]);assert.equal(result.points.length,1);
 assert.deepEqual(result.points.map(p=>[p.ageMonth,p.sampleCount,p.predictedResidualAmount,p.lowerBoundAmount,p.upperBoundAmount,p.averagePriceAmount,p.confidenceScore]),[[12,5,102,101,130,115,85]]);assert.deepEqual(result.sourceSnapshot.filters.priceTypes,['TRANSACTION','AUCTION','DEALER_QUOTE','INTERNAL_SALE','LISTING']);assert.equal(result.confidenceScore,85);assert.equal(result.points[0].predictedResidualRateBps,null);
 const custom=buildResidualCurve({...curveInput(observations),minSamplePerPoint:1,priceTypes:['ESTIMATE'],referencePriceAmount:2000000});assert.equal(custom.points[0].predictedResidualAmount,999999);assert.equal(custom.points[0].predictedResidualRateBps,5000);
 assert.throws(()=>buildResidualCurve({...curveInput([observation('huge',{priceAmount:2147483647})]),minSamplePerPoint:1,referencePriceAmount:1}),error('RESIDUAL_RATE_OVERFLOW'));
});

test('curve filters dimensions and inclusive dates, does not invent an accident discount or mileage bucket',()=>{
 const observations=[observation('a',{priceAmount:100,batteryCapacityKwh:'75.000',mileageKm:999999,accidentFlag:true}),observation('b',{priceAmount:200,batteryCapacityKwh:'75',observedOn:'2027-01-02'}),observation('wrong-capacity',{batteryCapacityKwh:'100'}),observation('wrong-model',{modelDefinitionId:'other'}),observation('wrong-year',{modelYear:2025}),observation('unknown',{batteryOwnership:'UNKNOWN',batteryCapacityKwh:'75'}),observation('early',{observedOn:'2026-12-31',batteryCapacityKwh:'75'})];
 const result=buildResidualCurve({...curveInput(observations),dimension:{...dimension,batteryCapacityKwh:'075.000',batteryOwnership:'OWNED'},minSamplePerPoint:1,sampleStartDate:'2027-01-01',sampleEndDate:'2027-01-02'});assert.equal(result.sampleCount,2);assert.equal(result.points[0].predictedResidualAmount,150);assert.deepEqual(result.points[0].sampleObservationIds,['a','b']);
 assert.throws(()=>buildResidualCurve({...curveInput(observations),sampleStartDate:'2027-01-03',sampleEndDate:'2027-01-02'}));assert.throws(()=>buildResidualCurve({...curveInput(observations),minSamplePerPoint:0}));assert.throws(()=>buildResidualCurve({...curveInput(observations),priceTypes:[]}));
});

test('curve freezes canonical provenance independently of input ordering and later mutation, but source revisions change its hash',()=>{
 const rows=[observation('c'),observation('a'),observation('b')],before=structuredClone(rows),input=curveInput(rows),result=buildResidualCurve(input);
 assert.equal(result.algorithmVersion,'RESIDUAL_STATISTICAL_V1');assert.equal(result.referenceCommit,'db4b48c55890f11f52c4fc52c29242d7c0d150be');assert.equal(result.sourceHash,canonicalHash(result.sourceSnapshot));assert.equal(result.sourceHash,buildResidualCurve(curveInput([...rows].reverse())).sourceHash);assert.deepEqual(rows,before);assert.ok(Object.isFrozen(result.sourceSnapshot));assert.ok(Object.isFrozen(result.sourceSnapshot.observations[0]));
 rows[0].priceAmount=1;assert.equal(result.sourceSnapshot.observations.find(row=>row.id==='c')?.priceAmount,10001);
 for(const field of ['revision','mileageKm','confidenceScore'] as const){const changed=structuredClone(before);changed[0][field]=(changed[0][field]??0)+(field==='confidenceScore'?-1:1);assert.notEqual(buildResidualCurve(curveInput(changed)).sourceHash,result.sourceHash);}
 const changed=structuredClone(before);changed[0].status='IGNORED';assert.notEqual(buildResidualCurve(curveInput(changed)).sourceHash,result.sourceHash);assert.notEqual(buildResidualCurve({...curveInput(before),modelRevision:3}).sourceHash,result.sourceHash);
 assert.throws(()=>buildResidualCurve(curveInput([before[0],before[0]])),error('RESIDUAL_DUPLICATE_SAMPLE'));
});

test('forecast uses exact points or integer interpolation, preserves descending half-fen rounding and never extrapolates',()=>{
 const points=[point('upper',14,100),point('lower',12,101)],before=structuredClone(points),result=forecastResidual({asOfDate:'2027-01-31',registrationDate:'2026-01-31',points,horizonMonths:[0,1,2,3],purchasePriceAmount:200});
 assert.equal(result.vehicleAgeMonths,12);assert.deepEqual(result.points.map(p=>[p.targetDate,p.targetAgeMonth,p.interpolationMethod,p.predictedResidualAmount,p.lowerBoundAmount,p.upperBoundAmount]),[['2027-01-31',12,'EXACT',101,91,111],['2027-02-28',13,'LINEAR_INTERPOLATION',101,91,111],['2027-03-31',14,'EXACT',100,90,110],['2027-04-30',15,'UNSUPPORTED_OUT_OF_RANGE',null,null,null]]);assert.equal(result.points[1].predictedResidualRateBps,5050);assert.equal(result.points[3].pointStatus,'UNSUPPORTED');assert.deepEqual(result.points[1].interpolation,{lowerPointId:'lower',upperPointId:'upper',numerator:1,denominator:2});assert.deepEqual(points,before);
 const nullBounds=forecastResidual({asOfDate:'2027-01-31',registrationDate:'2026-01-31',points:[{...point('a',12,1),lowerBoundAmount:null},{...point('b',15,2),confidenceScore:null}],horizonMonths:[1]});assert.equal(nullBounds.points[0].predictedResidualAmount,1);assert.equal(nullBounds.points[0].lowerBoundAmount,null);assert.equal(nullBounds.points[0].confidenceScore,null);assert.equal(nullBounds.points[0].predictedResidualRateBps,null);
});

test('forecast defaults and unsupported records remain explicit and invalid or ambiguous inputs are rejected',()=>{
 const base={asOfDate:'2027-01-01',registrationDate:'2026-01-31',points:[point('only',12,100)]};const result=forecastResidual(base);assert.deepEqual(result.points.map(p=>p.horizonMonth),[0,6,12,24,36]);assert.ok(result.points.every(p=>p.pointStatus==='UNSUPPORTED'&&p.predictedResidualAmount===null));
 assert.throws(()=>forecastResidual({...base,horizonMonths:[0,0]}));assert.throws(()=>forecastResidual({...base,horizonMonths:[]}));assert.throws(()=>forecastResidual({...base,horizonMonths:[-1]}));assert.throws(()=>forecastResidual({...base,horizonMonths:[121]}));assert.throws(()=>forecastResidual({...base,points:[point('a',12,1),point('b',12,2)]}));assert.throws(()=>forecastResidual({...base,points:[point('a',12,2147483648)]}));assert.throws(()=>forecastResidual({...base,asOfDate:'9999-12-31',horizonMonths:[1]}));
});

test('dimension normalization is deterministic for nulls, case, decimal capacity and preserves case-sensitive model IDs',()=>{
 const normalized=normalizeResidualDimension({...dimension,trim:'  Sport  ',batteryOwnership:'OWNED',batteryCapacityKwh:'075.000'});assert.deepEqual(normalized,{modelDefinitionId:'model-A',modelYear:2026,trim:'sport',batteryOwnership:'OWNED',batteryCapacityKwh:'75'});assert.equal(residualDimensionHash(normalized),residualDimensionHash({...normalized,batteryCapacityKwh:'75.0',trim:'SPORT'}));assert.equal(residualDimensionHash(dimension),residualDimensionHash({...dimension,trim:' '}));assert.notEqual(residualDimensionHash(dimension),residualDimensionHash({...dimension,modelDefinitionId:'model-a'}));
 for(const extra of [{modelDefinitionId:''},{modelYear:1},{batteryOwnership:'UNKNOWN'},{batteryCapacityKwh:'1e2'},{batteryCapacityKwh:'75.0001'},{batteryCapacityKwh:'-1'}])assert.throws(()=>normalizeResidualDimension({...dimension,...extra} as any));
});

test('dedupe retains source listing precedence and normalized old fields while tagged tuples prevent colon collisions',()=>{
 const base=observation('ignored-id'),key=observationDedupeKey(base);assert.equal(key,observationDedupeKey({...base,id:'different',revision:9,brand:' 合成 ',model:'ev',city:' ',priceAmount:10001}));assert.notEqual(key,observationDedupeKey({...base,priceAmount:10002}));
 assert.equal(observationDedupeKey({...base,sourceListingId:' LIST:1 '}),observationDedupeKey({...base,sourceListingId:'list:1',priceAmount:20000,observedOn:'2027-02-01'}));assert.notEqual(observationDedupeKey({...base,sourceListingId:'list:1'}),observationDedupeKey({...base,source:'AUCTION',sourceListingId:'list:1'}));
 assert.notEqual(observationDedupeKey({...base,brand:'A:B',series:'C'}),observationDedupeKey({...base,brand:'A',series:'B:C'}));assert.notEqual(observationDedupeKey({...base,sourceListingId:'a:b'}),observationDedupeKey({...base,sourceListingId:null,brand:'a:b'}));assert.match(key,/^[a-f0-9]{64}$/);
});
