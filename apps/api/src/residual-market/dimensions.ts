import {z} from 'zod';
import {canonicalHash} from '../customers/types';
import {ensure} from '../common/errors';
import {parseDate} from '../asset-costs/calendar';

export const RESIDUAL_PRICE_TYPES=['LISTING','TRANSACTION','AUCTION','DEALER_QUOTE','INTERNAL_SALE','ESTIMATE'] as const;
export const RESIDUAL_PRICE_SOURCES=['MANUAL','CSV_IMPORT','INTERNAL_DISPOSAL','DEALER_QUOTE','AUCTION','USED_CAR_PLATFORM','OTHER'] as const;
export type ResidualPriceType=typeof RESIDUAL_PRICE_TYPES[number];
export type ResidualPriceSource=typeof RESIDUAL_PRICE_SOURCES[number];
export type BatteryOwnership='UNKNOWN'|'OWNED'|'BAAS';
export type ResidualDimensionInput={modelDefinitionId:string;modelYear?:number|null;trim?:string|null;batteryOwnership?:Exclude<BatteryOwnership,'UNKNOWN'>|null;batteryCapacityKwh?:string|null};
export type ResidualDimension=Readonly<{modelDefinitionId:string;modelYear:number|null;trim:string|null;batteryOwnership:Exclude<BatteryOwnership,'UNKNOWN'>|null;batteryCapacityKwh:string|null}>;
const optionalText=z.string().trim().max(500).nullable().optional();
const dimensionSchema=z.object({modelDefinitionId:z.string().trim().min(1).max(500),modelYear:z.number().int().min(1900).max(2100).nullable().optional(),trim:optionalText,batteryOwnership:z.enum(['OWNED','BAAS']).nullable().optional(),batteryCapacityKwh:optionalText}).strict();

/** Decimal(8,3) values are canonical strings, never binary floating point. */
export function normalizeBatteryCapacity(value:string|null|undefined):string|null{
 if(value===null||value===undefined)return null;
 ensure(typeof value==='string',400,'RESIDUAL_DIMENSION','电池容量须为十进制字符串');const text=value.trim();if(!text)return null;
 ensure(/^\d+(?:\.\d{1,3})?$/.test(text),400,'RESIDUAL_DIMENSION','电池容量须为非负数且最多三位小数');
 const [rawWhole,rawFraction='']=text.split('.'),whole=rawWhole.replace(/^0+(?=\d)/,''),fraction=rawFraction.replace(/0+$/,'');
 ensure(whole.length<=5,400,'RESIDUAL_DIMENSION','电池容量超出 Decimal(8,3) 范围');return whole+(fraction?'.'+fraction:'');
}
export function normalizeResidualDimension(raw:ResidualDimensionInput):ResidualDimension{
 const value=dimensionSchema.parse(raw);return Object.freeze({modelDefinitionId:value.modelDefinitionId,modelYear:value.modelYear??null,trim:value.trim?.toLowerCase()||null,batteryOwnership:value.batteryOwnership??null,batteryCapacityKwh:normalizeBatteryCapacity(value.batteryCapacityKwh)});
}
export function residualDimensionHash(raw:ResidualDimensionInput):string{return canonicalHash({version:1,dimension:normalizeResidualDimension(raw)});}

export type ResidualObservationIdentity={source:ResidualPriceSource;sourceListingId?:string|null;observedOn:string;brand:string;series?:string|null;model:string;modelDefinitionId:string;modelYear?:number|null;mileageKm?:number|null;city?:string|null;priceType:ResidualPriceType;priceAmount:number};
function keyPart(value:unknown):string{return value===null||value===undefined||value===''?'-':String(value).trim().toLowerCase()||'-';}
/** The old field order, source-listing precedence and '-' null semantics are
 * retained. A tagged tuple prevents ambiguity from ':' inside field values. */
export function observationDedupeKey<T extends ResidualObservationIdentity>(fields:T):string{
 const source=z.enum(RESIDUAL_PRICE_SOURCES).parse(typeof fields.source==='string'?fields.source.trim().toUpperCase():fields.source),listing=optionalText.parse(fields.sourceListingId);
 if(listing)return canonicalHash({version:1,identity:['listing',keyPart(source),keyPart(listing)]});
 parseDate(fields.observedOn);z.number().int().min(1).max(2147483647).parse(fields.priceAmount);z.enum(RESIDUAL_PRICE_TYPES).parse(fields.priceType);
 for(const value of [fields.brand,fields.model,fields.modelDefinitionId])z.string().trim().min(1).max(500).parse(value);
 z.number().int().min(1900).max(2100).nullable().optional().parse(fields.modelYear);z.number().int().min(0).max(2147483647).nullable().optional().parse(fields.mileageKm);
 optionalText.parse(fields.series);optionalText.parse(fields.city);
 return canonicalHash({version:1,identity:['fields',...[source,fields.observedOn,fields.brand,fields.series,fields.model,fields.modelDefinitionId,fields.modelYear,fields.mileageKm,fields.city,fields.priceType,fields.priceAmount].map(keyPart)]});
}
