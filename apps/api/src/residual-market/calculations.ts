import {z} from 'zod';
import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {addMonths,dateAtDay,monthsBetween,parseDate} from '../asset-costs/calendar';
import {normalizeBatteryCapacity,normalizeResidualDimension,RESIDUAL_PRICE_SOURCES,RESIDUAL_PRICE_TYPES,type BatteryOwnership,type ResidualDimensionInput,type ResidualDimension,type ResidualPriceSource,type ResidualPriceType} from './dimensions';

export const RESIDUAL_ALGORITHM_VERSION='RESIDUAL_STATISTICAL_V1' as const;
export const RESIDUAL_REFERENCE_COMMIT='db4b48c55890f11f52c4fc52c29242d7c0d150be' as const;
export const DEFAULT_RESIDUAL_PRICE_TYPES:readonly ResidualPriceType[]=Object.freeze(['TRANSACTION','AUCTION','DEALER_QUOTE','INTERNAL_SALE','LISTING']);
export const DEFAULT_RESIDUAL_HORIZONS:readonly number[]=Object.freeze([0,6,12,24,36]);
const int=z.number().int().min(0).max(2147483647),fen=int,confidence=int.max(100),nullableText=z.string().trim().max(500).nullable();
const date=z.string().refine(value=>{try{parseDate(value);return true;}catch{return false;}},'日期须为有效 YYYY-MM-DD');
const roundRatio=(numerator:bigint,denominator:bigint):bigint=>{
 ensure(numerator>=0n&&denominator>0n,400,'RESIDUAL_CALCULATION','残值计算只接受非负分子和正分母');return numerator/denominator+(numerator%denominator*2n>=denominator?1n:0n);
};
function rateBps(amount:number|null,reference:number|null):number|null{
 if(amount===null||reference===null||reference===0)return null;
 const result=roundRatio(BigInt(amount)*10000n,BigInt(reference));ensure(result<=2147483647n,400,'RESIDUAL_RATE_OVERFLOW','残值率超出整数基点范围');return Number(result);
}
function freeze<T>(value:T):Readonly<T>{
 if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}

export function sampleCalendarAgeMonths(input:{observedOn?:string|null;registrationDate?:string|null;vehicleAgeMonths?:number|null}):number|null{
 if(input.observedOn!=null)parseDate(input.observedOn);if(input.registrationDate!=null)parseDate(input.registrationDate);
 if(input.vehicleAgeMonths!=null){ensure(Number.isInteger(input.vehicleAgeMonths)&&Math.abs(input.vehicleAgeMonths)<=2147483647,400,'RESIDUAL_AGE','样本车龄须为整数');return input.vehicleAgeMonths>=0?input.vehicleAgeMonths:null;}
 if(!input.observedOn||!input.registrationDate)return null;const months=monthsBetween(input.registrationDate.slice(0,7),input.observedOn.slice(0,7));return months>=0?months:null;
}
export function vehicleCompletedAgeMonths(asOfDate:string,registrationDate:string):number{
 const at=parseDate(asOfDate),registered=parseDate(registrationDate);return Math.max(0,monthsBetween(registrationDate.slice(0,7),asOfDate.slice(0,7))-(at.day<registered.day?1:0));
}
export function addResidualMonths(value:string,months:number):string{const parsed=parseDate(value);return dateAtDay(addMonths(value.slice(0,7),months),parsed.day);}

export function quantileFen(values:readonly number[],quantile:0.25|0.5|0.75):number{
 ensure(Array.isArray(values)&&values.length>0,400,'RESIDUAL_SAMPLES','分位数至少需要一个金额');ensure([0.25,0.5,0.75].includes(quantile),400,'RESIDUAL_QUANTILE','仅支持 P25/P50/P75');
 const sorted=values.map(value=>fen.parse(value)).sort((a,b)=>a-b),quarters=BigInt(quantile*4),position=BigInt(sorted.length-1)*quarters,low=Number(position/4n),fraction=position%4n;
 const left=BigInt(sorted[low]),right=BigInt(sorted[Math.min(low+1,sorted.length-1)]);return Number(roundRatio(left*(4n-fraction)+right*fraction,4n));
}
export function meanFen(values:readonly number[]):number{
 ensure(Array.isArray(values)&&values.length>0,400,'RESIDUAL_SAMPLES','平均数至少需要一个金额');return Number(roundRatio(values.reduce((sum,value)=>sum+BigInt(fen.parse(value)),0n),BigInt(values.length)));
}
export function pointConfidence(values:readonly (number|null)[]):number{
 ensure(Array.isArray(values)&&values.length>0,400,'RESIDUAL_SAMPLES','置信度至少需要一个样本');const count=BigInt(values.length),total=values.reduce<bigint>((sum,value)=>sum+BigInt(value===null?50:confidence.parse(value)),0n),bonus=BigInt(Math.min(values.length*5,40));
 return Math.min(100,Number(roundRatio(total*3n+bonus*count*5n,count*5n)));
}
export function observationConfidence(input:{brand?:string|null;model?:string|null;observedOn?:string|null;priceAmount?:number|null;mileageKm?:number|null;registrationDate?:string|null;vehicleAgeMonths?:number|null;batteryCapacityKwh?:string|null;city?:string|null}):number{
 let score=40;if(input.brand?.trim()&&input.model?.trim())score+=10;
 if(input.observedOn!=null){parseDate(input.observedOn);score+=10;}if(input.priceAmount!=null&&fen.parse(input.priceAmount)>0)score+=10;
 if(input.mileageKm!=null){int.parse(input.mileageKm);score+=10;}if(input.registrationDate!=null)parseDate(input.registrationDate);if(input.vehicleAgeMonths!=null)int.parse(input.vehicleAgeMonths);
 if(input.registrationDate!=null||input.vehicleAgeMonths!=null)score+=10;if(normalizeBatteryCapacity(input.batteryCapacityKwh)!==null)score+=5;if(input.city?.trim())score+=5;return Math.min(score,100);
}

export type ResidualObservation={id:string;revision:number;status:'ACTIVE'|'IGNORED'|'VOIDED';modelDefinitionId:string;modelYear:number|null;brand:string;series:string|null;model:string;trim:string|null;source:ResidualPriceSource;sourceListingId:string|null;observedOn:string;registrationDate:string|null;vehicleAgeMonths:number|null;priceType:ResidualPriceType;priceAmount:number;batteryOwnership:BatteryOwnership;batteryCapacityKwh:string|null;mileageKm:number|null;city:string|null;accidentFlag:boolean|null;batteryHealthPercent:number|null;confidenceScore:number|null};
const observationSchema=z.object({id:z.string().trim().min(1).max(500),revision:int,status:z.enum(['ACTIVE','IGNORED','VOIDED']),modelDefinitionId:z.string().trim().min(1).max(500),modelYear:z.number().int().min(1900).max(2100).nullable(),brand:z.string().trim().min(1).max(500),series:nullableText,model:z.string().trim().min(1).max(500),trim:nullableText,source:z.enum(RESIDUAL_PRICE_SOURCES),sourceListingId:nullableText,observedOn:date,registrationDate:date.nullable(),vehicleAgeMonths:z.number().int().min(-2147483647).max(2147483647).nullable(),priceType:z.enum(RESIDUAL_PRICE_TYPES),priceAmount:fen.min(1),batteryOwnership:z.enum(['UNKNOWN','OWNED','BAAS']),batteryCapacityKwh:nullableText,mileageKm:int.nullable(),city:nullableText,accidentFlag:z.boolean().nullable(),batteryHealthPercent:confidence.nullable(),confidenceScore:confidence.nullable()}).strict();
export type ResidualCurveInput={dimension:ResidualDimensionInput;modelRevision:number;observations:readonly ResidualObservation[];priceTypes?:readonly ResidualPriceType[];minSamplePerPoint?:number;referencePriceAmount?:number|null;sampleStartDate?:string|null;sampleEndDate?:string|null};
export type ResidualCurvePoint={ageMonth:number;sampleCount:number;predictedResidualAmount:number;medianPriceAmount:number;p25PriceAmount:number;p75PriceAmount:number;lowerBoundAmount:number;upperBoundAmount:number;averagePriceAmount:number;minPriceAmount:number;maxPriceAmount:number;predictedResidualRateBps:number|null;confidenceScore:number;sampleObservationIds:string[];sourcePriceAmounts:number[]};
export type ResidualSkipReason={reason:'AGE_MONTH_MISSING';count:number}|{reason:'MIN_SAMPLE_PER_POINT';ageMonth:number;count:number;minSamplePerPoint:number};
export type ResidualCurveSourceSnapshot={version:1;algorithmVersion:typeof RESIDUAL_ALGORITHM_VERSION;referenceCommit:typeof RESIDUAL_REFERENCE_COMMIT;modelRevision:number;dimension:ResidualDimension;filters:{priceTypes:ResidualPriceType[];minSamplePerPoint:number;referencePriceAmount:number|null;sampleStartDate:string|null;sampleEndDate:string|null};observations:ResidualObservation[]};
export type ResidualCurveResult={algorithmVersion:typeof RESIDUAL_ALGORITHM_VERSION;referenceCommit:typeof RESIDUAL_REFERENCE_COMMIT;points:ResidualCurvePoint[];sampleCount:number;skippedSampleCount:number;skippedReasons:ResidualSkipReason[];confidenceScore:number|null;sourceSnapshot:Readonly<ResidualCurveSourceSnapshot>;sourceHash:string};

export function buildResidualCurve(input:ResidualCurveInput):ResidualCurveResult{
 const dimension=normalizeResidualDimension(input.dimension),modelRevision=int.parse(input.modelRevision),minSamplePerPoint=int.min(1).max(1000).parse(input.minSamplePerPoint??3),referencePriceAmount=input.referencePriceAmount==null?null:fen.min(1).parse(input.referencePriceAmount);
 const requested=input.priceTypes===undefined?[...DEFAULT_RESIDUAL_PRICE_TYPES]:z.array(z.enum(RESIDUAL_PRICE_TYPES)).min(1).max(6).parse(input.priceTypes);ensure(new Set(requested).size===requested.length,400,'RESIDUAL_FILTER','价格类型不得重复');
 const priceTypes=[...DEFAULT_RESIDUAL_PRICE_TYPES,'ESTIMATE' as const].filter(type=>requested.includes(type)),sampleStartDate=input.sampleStartDate==null?null:date.parse(input.sampleStartDate),sampleEndDate=input.sampleEndDate==null?null:date.parse(input.sampleEndDate);
 ensure(!sampleStartDate||!sampleEndDate||sampleStartDate<=sampleEndDate,400,'RESIDUAL_FILTER','样本开始日不能晚于结束日');ensure(Array.isArray(input.observations),400,'RESIDUAL_SAMPLES','样本须为数组');
 const ids=new Set<string>(),normalized=input.observations.map(raw=>{
  const row=observationSchema.parse(raw);ensure(!ids.has(row.id),400,'RESIDUAL_DUPLICATE_SAMPLE','同一观察样本不得重复参与统计');ids.add(row.id);return{...row,batteryCapacityKwh:normalizeBatteryCapacity(row.batteryCapacityKwh)};
 });
 const observations=normalized.filter(row=>row.status==='ACTIVE'&&row.modelDefinitionId===dimension.modelDefinitionId&&(dimension.modelYear===null||row.modelYear===dimension.modelYear)&&(!dimension.trim||row.trim?.toLowerCase()===dimension.trim)&&(dimension.batteryOwnership===null||row.batteryOwnership===dimension.batteryOwnership)&&(dimension.batteryCapacityKwh===null||row.batteryCapacityKwh===dimension.batteryCapacityKwh)&&priceTypes.includes(row.priceType)&&(!sampleStartDate||row.observedOn>=sampleStartDate)&&(!sampleEndDate||row.observedOn<=sampleEndDate)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const sourceSnapshot:ResidualCurveSourceSnapshot={version:1,algorithmVersion:RESIDUAL_ALGORITHM_VERSION,referenceCommit:RESIDUAL_REFERENCE_COMMIT,modelRevision,dimension,filters:{priceTypes,minSamplePerPoint,referencePriceAmount,sampleStartDate,sampleEndDate},observations};
 const groups=new Map<number,ResidualObservation[]>(),skippedReasons:ResidualSkipReason[]=[],points:ResidualCurvePoint[]=[];let missing=0,skippedSampleCount=0;
 for(const row of observations){const age=sampleCalendarAgeMonths(row);if(age===null){missing++;continue;}const group=groups.get(age)??[];group.push(row);groups.set(age,group);}
 if(missing){skippedReasons.push({reason:'AGE_MONTH_MISSING',count:missing});skippedSampleCount+=missing;}
 for(const [ageMonth,samples]of [...groups.entries()].sort(([a],[b])=>a-b)){
  if(samples.length<minSamplePerPoint){skippedReasons.push({reason:'MIN_SAMPLE_PER_POINT',ageMonth,count:samples.length,minSamplePerPoint});skippedSampleCount+=samples.length;continue;}
  const prices=samples.map(row=>row.priceAmount).sort((a,b)=>a-b),median=quantileFen(prices,0.5),p25=quantileFen(prices,0.25),p75=quantileFen(prices,0.75);
  points.push({ageMonth,sampleCount:samples.length,predictedResidualAmount:median,medianPriceAmount:median,p25PriceAmount:p25,p75PriceAmount:p75,lowerBoundAmount:p25,upperBoundAmount:p75,averagePriceAmount:meanFen(prices),minPriceAmount:prices[0],maxPriceAmount:prices[prices.length-1],predictedResidualRateBps:rateBps(median,referencePriceAmount),confidenceScore:pointConfidence(samples.map(row=>row.confidenceScore)),sampleObservationIds:samples.map(row=>row.id),sourcePriceAmounts:prices});
 }
 return{algorithmVersion:RESIDUAL_ALGORITHM_VERSION,referenceCommit:RESIDUAL_REFERENCE_COMMIT,points,sampleCount:observations.length,skippedSampleCount,skippedReasons,confidenceScore:points.length?meanFen(points.map(point=>point.confidenceScore)):null,sourceSnapshot:freeze(sourceSnapshot),sourceHash:canonicalHash(sourceSnapshot)};
}

export type ResidualForecastCurvePoint={id:string;ageMonth:number;predictedResidualAmount:number|null;lowerBoundAmount:number|null;upperBoundAmount:number|null;confidenceScore:number|null};
export type ResidualForecastInput={asOfDate:string;registrationDate:string;points:readonly ResidualForecastCurvePoint[];horizonMonths?:readonly number[];purchasePriceAmount?:number|null};
export type ResidualForecastPoint={horizonMonth:number;targetDate:string;targetAgeMonth:number;pointStatus:'GENERATED'|'UNSUPPORTED';interpolationMethod:'EXACT'|'LINEAR_INTERPOLATION'|'UNSUPPORTED_OUT_OF_RANGE';predictedResidualAmount:number|null;lowerBoundAmount:number|null;upperBoundAmount:number|null;predictedResidualRateBps:number|null;confidenceScore:number|null;matchedCurvePointAgeMonth:number|null;interpolation:{lowerPointId:string;upperPointId:string;numerator:number;denominator:number}|null};
export type ResidualForecastResult={algorithmVersion:typeof RESIDUAL_ALGORITHM_VERSION;referenceCommit:typeof RESIDUAL_REFERENCE_COMMIT;vehicleAgeMonths:number;points:ResidualForecastPoint[]};
function interpolate(left:number|null,right:number|null,numerator:number,denominator:number):number|null{
 if(left===null||right===null)return null;return Number(roundRatio(BigInt(left)*BigInt(denominator-numerator)+BigInt(right)*BigInt(numerator),BigInt(denominator)));
}
export function forecastResidual(input:ResidualForecastInput):ResidualForecastResult{
 const vehicleAgeMonths=vehicleCompletedAgeMonths(input.asOfDate,input.registrationDate),horizons=z.array(int.max(120)).min(1).max(10).parse(input.horizonMonths??DEFAULT_RESIDUAL_HORIZONS),reference=input.purchasePriceAmount==null?null:fen.parse(input.purchasePriceAmount);
 ensure(new Set(horizons).size===horizons.length,400,'RESIDUAL_HORIZON','预测月份不得重复');horizons.sort((a,b)=>a-b);
 const schema=z.object({id:z.string().trim().min(1).max(500),ageMonth:int,predictedResidualAmount:fen.nullable(),lowerBoundAmount:fen.nullable(),upperBoundAmount:fen.nullable(),confidenceScore:confidence.nullable()}).strict(),ages=new Set<number>(),ids=new Set<string>();
 const normalized=z.array(schema).parse(input.points);for(const point of normalized){ensure(!ages.has(point.ageMonth)&&!ids.has(point.id),400,'RESIDUAL_CURVE_POINT','曲线点年龄或 ID 不得重复');ages.add(point.ageMonth);ids.add(point.id);ensure(point.lowerBoundAmount===null||point.predictedResidualAmount===null||point.lowerBoundAmount<=point.predictedResidualAmount,400,'RESIDUAL_CURVE_POINT','曲线下界不得高于预测值');ensure(point.upperBoundAmount===null||point.predictedResidualAmount===null||point.upperBoundAmount>=point.predictedResidualAmount,400,'RESIDUAL_CURVE_POINT','曲线上界不得低于预测值');}
 const usable=normalized.filter(point=>point.predictedResidualAmount!==null).sort((a,b)=>a.ageMonth-b.ageMonth),points:ResidualForecastPoint[]=horizons.map(horizonMonth=>{
  const targetDate=addResidualMonths(input.asOfDate,horizonMonth),targetAgeMonth=vehicleAgeMonths+horizonMonth,base={horizonMonth,targetDate,targetAgeMonth},exact=usable.find(point=>point.ageMonth===targetAgeMonth);
  if(exact)return{...base,pointStatus:'GENERATED',interpolationMethod:'EXACT',predictedResidualAmount:exact.predictedResidualAmount,lowerBoundAmount:exact.lowerBoundAmount,upperBoundAmount:exact.upperBoundAmount,predictedResidualRateBps:rateBps(exact.predictedResidualAmount,reference),confidenceScore:exact.confidenceScore,matchedCurvePointAgeMonth:exact.ageMonth,interpolation:{lowerPointId:exact.id,upperPointId:exact.id,numerator:0,denominator:1}};
  const lower=[...usable].reverse().find(point=>point.ageMonth<targetAgeMonth),upper=usable.find(point=>point.ageMonth>targetAgeMonth);
  if(lower&&upper){const numerator=targetAgeMonth-lower.ageMonth,denominator=upper.ageMonth-lower.ageMonth,amount=interpolate(lower.predictedResidualAmount,upper.predictedResidualAmount,numerator,denominator);return{...base,pointStatus:'GENERATED',interpolationMethod:'LINEAR_INTERPOLATION',predictedResidualAmount:amount,lowerBoundAmount:interpolate(lower.lowerBoundAmount,upper.lowerBoundAmount,numerator,denominator),upperBoundAmount:interpolate(lower.upperBoundAmount,upper.upperBoundAmount,numerator,denominator),predictedResidualRateBps:rateBps(amount,reference),confidenceScore:interpolate(lower.confidenceScore,upper.confidenceScore,numerator,denominator),matchedCurvePointAgeMonth:null,interpolation:{lowerPointId:lower.id,upperPointId:upper.id,numerator,denominator}};}
  return{...base,pointStatus:'UNSUPPORTED',interpolationMethod:'UNSUPPORTED_OUT_OF_RANGE',predictedResidualAmount:null,lowerBoundAmount:null,upperBoundAmount:null,predictedResidualRateBps:null,confidenceScore:null,matchedCurvePointAgeMonth:null,interpolation:null};
 });
 return{algorithmVersion:RESIDUAL_ALGORITHM_VERSION,referenceCommit:RESIDUAL_REFERENCE_COMMIT,vehicleAgeMonths,points};
}
