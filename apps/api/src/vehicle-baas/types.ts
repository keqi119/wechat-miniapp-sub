import {z} from 'zod';
import {money,text} from '../common/data';
import {commandFields,dateInput,pagingFields,periodInput,previewHashInput,reasonInput,revision} from '../asset-costs/types';

const clean=(value:string)=>!value.includes('\0');
const safeText=text.refine(clean,'文字不得含空字符');
const optionalText=z.string().trim().max(500).refine(clean,'文字不得含空字符');
// Commands accept legacy empty/无 selections without changing the persisted 16-field parser.
// Normalize to null only inside the idempotent operation, after the original request was hashed.
const commandPreviousId=z.string().trim().max(500).refine(clean,'文字不得含空字符').nullable();
const nullableText=(max:number)=>z.string().trim().max(max).refine(clean,'文字不得含空字符').transform(value=>value||null).nullable();
// Keep the original 16-field order: persisted command hashes use JSON.stringify.
const draftFields={provider:nullableText(500),contractNumber:safeText,supplierContractNumber:optionalText,batteryPackage:nullableText(500),batterySerialNumber:optionalText,effectiveFrom:dateInput.nullable(),effectiveTo:dateInput.nullable(),billingCycle:z.enum(['MONTHLY','QUARTERLY','YEARLY']).nullable(),rentalAmount:money.positive().nullable(),paymentDayOfMonth:z.number().int().min(1).max(31).nullable(),graceDays:z.number().int().min(0).max(365),invoiceRequired:z.boolean(),taxIncluded:z.boolean().nullable(),currency:z.literal('CNY'),notes:z.string().max(5000).refine(clean,'文字不得含空字符'),previousContractId:safeText.nullable()};
export const baasMetadataFields={supplierOrderNumber:nullableText(500).optional(),batteryBrand:nullableText(200).optional(),lesseeName:nullableText(200).optional(),lesseeCreditCode:nullableText(18).refine(value=>value===null||/^[A-Z0-9]{18}$/.test(value),'统一信用代码须为18位大写字母数字').optional(),lessorCollectionAccountInfo:nullableText(2000).optional(),payerOwnerId:safeText.nullable().optional()};
export const baasMetadataInput=z.object(baasMetadataFields).strict();
export const baasRequiredFields=['provider','batteryPackage','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'] as const;
export function baasMissingFields(value:any){return baasRequiredFields.filter(field=>value[field]===null||value[field]===undefined||value[field]==='');}
export const financialScheduleRequiredFields=['provider','effectiveFrom','billingCycle','rentalAmount','paymentDayOfMonth'] as const;
export function financialMissingFields(value:any){return financialScheduleRequiredFields.filter(field=>value[field]===null||value[field]===undefined||value[field]==='');}
const validDates=(value:{effectiveFrom?:string|null;effectiveTo?:string|null})=>!value.effectiveFrom||!value.effectiveTo||value.effectiveFrom<=value.effectiveTo;
export const baasDraftInput=z.object(draftFields).strict().refine(validDates,'合同结束日期不得早于开始日期');
// Optional new values are normalized only inside apply; omitted keys must not change legacy request hashes.
export const baasCreateInput=z.object({...draftFields,provider:draftFields.provider.optional(),contractNumber:safeText.optional(),batteryPackage:draftFields.batteryPackage.optional(),effectiveFrom:draftFields.effectiveFrom.optional(),effectiveTo:draftFields.effectiveTo.optional(),billingCycle:draftFields.billingCycle.optional(),rentalAmount:draftFields.rentalAmount.optional(),paymentDayOfMonth:draftFields.paymentDayOfMonth.optional(),supplierContractNumber:optionalText.default(''),batterySerialNumber:optionalText.default(''),graceDays:draftFields.graceDays.default(0),invoiceRequired:z.boolean().default(false),taxIncluded:z.boolean().nullable().default(null),currency:z.literal('CNY').default('CNY'),notes:draftFields.notes.default(''),previousContractId:commandPreviousId.default(null),...commandFields,revision:z.literal(0),vehicleId:safeText,vehicleRevision:revision,assetRevision:revision,...baasMetadataFields}).strict().refine(validDates,'合同结束日期不得早于开始日期');
export const baasPatchInput=z.object({...draftFields,previousContractId:commandPreviousId,...baasMetadataFields}).partial().extend({...commandFields,changeReason:reasonInput.optional()}).strict().refine(value=>[...Object.keys(draftFields),...Object.keys(baasMetadataFields)].some(field=>Object.hasOwn(value,field)),'请提供需要修改的合同字段').refine(validDates,'合同结束日期不得早于开始日期');
export const baasTransitionInput=z.object({...commandFields,reason:reasonInput}).strict();
export const baasPreviewInput=z.object({fromPeriod:periodInput,toPeriod:periodInput}).strict().refine(value=>value.fromPeriod<=value.toPeriod,'截止账期不得早于开始账期');
export const baasGenerateInput=z.object({...commandFields,fromPeriod:periodInput,toPeriod:periodInput,previewHash:previewHashInput,acknowledgedWarningIds:z.array(z.string().regex(/^\d{4}-\d{2}:OUTSIDE_CONTRACT_(START|END)$/)).max(240).refine(values=>new Set(values).size===values.length,'警示确认不得重复')}).strict().refine(value=>value.fromPeriod<=value.toPeriod,'截止账期不得早于开始账期');
const queryText=(max:number)=>z.string().trim().min(1).max(max).refine(clean,'筛选不得含空字符');
const queryFields={provider:queryText(500).optional(),providerExact:queryText(500).optional(),lesseeName:queryText(200).optional(),lesseeNameExact:queryText(200).optional(),brand:queryText(500).optional(),brandExact:queryText(500).optional(),model:queryText(500).optional(),modelExact:queryText(500).optional()};
const oneMatchMode=(value:any)=>['provider','lesseeName','brand','model'].every(field=>value[field]===undefined||value[field+'Exact']===undefined);
export const baasListInput=z.object({...pagingFields,vehicleId:text.optional(),status:z.enum(['DRAFT','ACTIVE','SUSPENDED','TERMINATED','ARCHIVED']).optional(),group:z.enum(['CURRENT','EXPIRED','OTHER']).optional(),keyword:z.string().trim().max(100).refine(clean).optional(),...queryFields}).strict().refine(oneMatchMode,'同一筛选不可同时提供模糊和精确匹配');
export const baasOptionsInput=z.object({vehicleId:text.optional(),brand:queryFields.brand,brandExact:queryFields.brandExact}).strict().refine(oneMatchMode,'品牌不可同时提供模糊和精确匹配');
export const baasContextInput=z.object({vehicleId:safeText,contractId:safeText.optional()}).strict();
export const baasPayerOptionsInput=z.object({...pagingFields,keyword:z.string().trim().max(200).refine(clean).optional()}).strict();
export type BaasTransition='activate'|'suspend'|'resume'|'terminate'|'archive';
