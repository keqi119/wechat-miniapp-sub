import {z} from 'zod';
import {key,money} from '../common/data';
import {dateInput,previewHashInput,reasonInput,revision} from '../asset-costs/types';
import {residualTextSafe,residualPaging,validResidualOffset} from './observation-types';
import {DEFAULT_RESIDUAL_PRICE_TYPES} from './calculations';
import {normalizeBatteryCapacity,RESIDUAL_PRICE_TYPES} from './dimensions';

export const curveIdInput=z.string().trim().min(1).max(500).refine(residualTextSafe),safeReason=reasonInput.refine(residualTextSafe),safeKey=key.refine(residualTextSafe);
const fields={modelDefinitionId:curveIdInput,modelRevision:revision,name:z.string().trim().min(1).max(200).refine(residualTextSafe),trim:z.string().trim().max(500).refine(residualTextSafe).nullable().default(null),batteryOwnership:z.enum(['OWNED','BAAS']).nullable().default(null),batteryCapacityKwh:z.string().trim().max(100).regex(/^\d+(?:\.\d{1,3})?$/).refine(value=>value.split('.')[0].replace(/^0+/,'').length<=5,'电池容量超出范围').transform(normalizeBatteryCapacity).nullable().default(null),priceTypes:z.array(z.enum(RESIDUAL_PRICE_TYPES)).min(1).max(6).refine(value=>new Set(value).size===value.length,'价格类型不得重复').default([...DEFAULT_RESIDUAL_PRICE_TYPES]),sampleStartDate:dateInput.nullable().default(null),sampleEndDate:dateInput.nullable().default(null),referencePriceAmount:money.min(1).nullable().default(null),minSamplePerPoint:z.number().int().min(1).max(1000).default(3)};
const validDates=(input:{sampleStartDate:string|null;sampleEndDate:string|null})=>!input.sampleStartDate||!input.sampleEndDate||input.sampleStartDate<=input.sampleEndDate;
export const curvePreviewInput=z.object(fields).strict().refine(validDates,'样本开始日不能晚于结束日');
export const curveCreateInput=z.object({...fields,revision:z.literal(0),idempotencyKey:safeKey,previewHash:previewHashInput}).strict().refine(validDates,'样本开始日不能晚于结束日');
export const curveActivateInput=z.object({revision,idempotencyKey:safeKey,reason:safeReason,effectiveFrom:dateInput}).strict();
export const curveArchiveInput=z.object({revision,idempotencyKey:safeKey,reason:safeReason}).strict();
export const curveListInput=z.object({...residualPaging,modelDefinitionId:curveIdInput.optional(),status:z.enum(['DRAFT','ACTIVE','SUPERSEDED','ARCHIVED']).optional()}).strict().refine(validResidualOffset,'分页范围过大');
export type CurvePreviewInput=z.output<typeof curvePreviewInput>;
