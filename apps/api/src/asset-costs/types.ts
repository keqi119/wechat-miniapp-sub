import {z} from 'zod';
import {key as baseKey,text as baseText} from '../common/data';
const clean=(value:string)=>!value.includes('\0');
const key=baseKey.refine(clean,'文字不得含空字符'),text=baseText.refine(clean,'文字不得含空字符');
export const assetCostId=text;
import {parseDate,parsePeriod} from './calendar';

export const revision=z.number().int().min(0).max(2147483647);
export const dateInput=z.string().refine(value=>{try{parseDate(value);return true;}catch{return false;}},'须为有效 YYYY-MM-DD 日期');
export const periodInput=z.string().refine(value=>{try{parsePeriod(value);return true;}catch{return false;}},'须为有效 YYYY-MM 账期');
export const reasonInput=z.string().trim().min(1).max(1000).refine(clean);
export const evidenceInput=z.array(text).min(1).max(20).refine(value=>new Set(value).size===value.length,'证据文件不得重复');
export const commandFields={revision,idempotencyKey:key};
export const previewHashInput=z.string().regex(/^[a-f0-9]{64}$/);
export const costCommandInput=z.object({...commandFields,reason:reasonInput}).strict();
export const reopenPlanInput=costCommandInput.extend({sourceRevision:revision,previewHash:previewHashInput}).strict();
export const confirmCostsInput=z.object({plans:z.array(z.object({id:text,revision}).strict()).min(1).max(120).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'确认计划不得重复'),idempotencyKey:key}).strict();
export const manualPaymentInput=costCommandInput.extend({paidAt:dateInput,referenceNo:z.string().trim().min(1).max(200).refine(clean),fileIds:evidenceInput}).strict();
export const voidPaymentInput=costCommandInput.extend({recordRevision:revision}).strict();
export const pagingFields={page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)};
export const planListInput=z.object({...pagingFields,vehicleId:text.optional(),sourceKind:z.enum(['BAAS','DEPRECIATION','WORK_ORDER']).optional(),costPeriod:periodInput.optional(),status:z.enum(['SCHEDULED','CONFIRMED','VOIDED']).optional()}).strict().refine(value=>(value.page-1)*value.pageSize<=1000000,'分页偏移过大');
export const costListInput=z.object({...pagingFields,vehicleId:text.optional(),category:z.enum(['BAAS_RENT','DEPRECIATION','REPAIR','MAINTENANCE','TOWING']).optional(),effect:z.enum(['COST','REVERSAL']).optional(),costPeriod:periodInput.optional()}).strict().refine(value=>(value.page-1)*value.pageSize<=1000000,'分页偏移过大');
export type AssetSourceKind='BAAS'|'DEPRECIATION'|'WORK_ORDER';
export type AssetPlanSource={sourceKind:'BAAS';baasContractId:string}|{sourceKind:'DEPRECIATION';depreciationPolicyId:string}|{sourceKind:'WORK_ORDER';workOrderCostId:string};
export function storedDate(value:string):Date{parseDate(value);return new Date(value+'T00:00:00.000Z');}
export function dateOnly(value:Date|string):string{const result=value instanceof Date?value.toISOString().slice(0,10):value;parseDate(result);return result;}
