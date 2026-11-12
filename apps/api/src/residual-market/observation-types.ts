import {z} from 'zod';
import {commandFields,dateInput,revision,reasonInput} from '../asset-costs/types';
import {normalizeBatteryCapacity,RESIDUAL_PRICE_SOURCES,RESIDUAL_PRICE_TYPES} from './dimensions';

export const residualTextSafe=(value:string)=>!value.includes('\u0000');
const textError='文本不可包含 NUL 字符';
export const residualId=z.string().trim().min(1).max(128).refine(residualTextSafe,textError);
const optionalText=z.string().trim().max(500).refine(residualTextSafe,textError).nullable();
export const residualCommandFields={...commandFields,idempotencyKey:commandFields.idempotencyKey.refine(residualTextSafe,textError)};
export const residualPaging={page:z.coerce.number().int().min(1).max(2147483647).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)};
export const validResidualOffset=(value:{page:number;pageSize:number})=>(value.page-1)*value.pageSize<=2147483647;
export const observationFields={
 modelDefinitionId:residualId,modelRevision:revision,source:z.enum(RESIDUAL_PRICE_SOURCES),sourceListingId:optionalText,
 observedOn:dateInput,priceType:z.enum(RESIDUAL_PRICE_TYPES),priceAmount:z.number().int().min(1).max(2147483647),
 batteryOwnership:z.enum(['UNKNOWN','OWNED','BAAS']),batteryCapacityKwh:z.string().trim().max(100).regex(/^\d+(?:\.\d{1,3})?$/).refine(value=>value.split('.')[0].replace(/^0+/,'').length<=5,'容量超出范围').transform(normalizeBatteryCapacity).nullable(),
 mileageKm:revision.nullable(),registrationDate:dateInput.nullable(),vehicleAgeMonths:revision.nullable(),province:z.string().trim().max(100).refine(residualTextSafe,textError),city:z.string().trim().max(100).refine(residualTextSafe,textError),trim:z.string().trim().max(500).refine(residualTextSafe,textError),conditionGrade:z.string().trim().max(100).refine(residualTextSafe,textError),
 batteryHealthPercent:z.number().int().min(0).max(100).nullable(),accidentFlag:z.boolean().nullable(),sourceUrl:z.string().trim().max(2000).url().refine(value=>/^https?:\/\//i.test(value),'来源链接仅支持 http(s)').refine(residualTextSafe,textError).nullable(),sourceNote:reasonInput.refine(residualTextSafe,textError),correctionOfId:residualId.nullable(),
};
export const observationFactInput=z.object(observationFields).strict();
export const observationCreateInput=observationFactInput.extend({...residualCommandFields,revision:z.literal(0)}).strict();
export type ObservationFactInput=z.infer<typeof observationFactInput>;
export const observationStateInput=z.object({...residualCommandFields,reason:reasonInput.refine(residualTextSafe,textError)}).strict();
export const observationListInput=z.object({...residualPaging,modelDefinitionId:residualId.optional(),source:z.enum(RESIDUAL_PRICE_SOURCES).optional(),priceType:z.enum(RESIDUAL_PRICE_TYPES).optional(),status:z.enum(['ACTIVE','IGNORED','VOIDED']).optional(),observedFrom:dateInput.optional(),observedTo:dateInput.optional()}).strict().refine(validResidualOffset,'分页范围过大').refine(value=>!value.observedFrom||!value.observedTo||value.observedFrom<=value.observedTo,'观察日期范围无效');
