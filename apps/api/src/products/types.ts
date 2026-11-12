import {customerBaasInput} from '../contract-terms/types';
import {termMonthsInput,validTermMonths} from '../service-calendar/rules';
import { z } from 'zod';
import { key, money, text } from '../common/data';
export type ProductActor={id:string;role:string;authVersion?:number};
export const commandInput=z.object({revision:z.number().int().nonnegative(),idempotencyKey:key}).strict();
const scope=z.array(z.string().trim().min(1).max(100)).max(1000).refine(v=>new Set(v).size===v.length,'范围不可重复');
const base=z.object({kind:z.literal('BASE_SUBSCRIPTION')}).strict();
const item=z.object({kind:z.literal('BENEFIT'),benefitVersionId:text}).strict();
const commonDraft={customerBaas:customerBaasInput.optional(),name:text,months:termMonthsInput,minimumTermMonths:termMonthsInput.optional(),conditions:text,vehicleIds:scope,modelDefinitionIds:scope,items:z.array(z.discriminatedUnion('kind',[base,item])).min(1).max(51)};
export const swapPolicyInput=z.object({version:z.literal(2),period:z.literal('TERM'),includedCount:money,extraFeeAmount:money.positive()}).strict();
export const SELF_PAID_ENERGY='充换电费用由客户自付';
export const productV1DraftInput=z.object({...commonDraft,configurationVersion:z.literal(1).optional(),monthlyFeeAmount:money.positive(),mileagePerMonthKm:z.literal(1500),excessMileagePriceAmount:z.literal(150),energyDescription:text}).strict();
const v2Draft=z.object({...commonDraft,configurationVersion:z.literal(2),baseFeeAmount:money,mileageMonthlyFeeAmount:money,mileagePerMonthKm:money,excessMileagePriceAmount:money,swapPolicy:swapPolicyInput}).strict();
const validTotal=(value:{baseFeeAmount:number;mileageMonthlyFeeAmount:number})=>value.baseFeeAmount+value.mileageMonthlyFeeAmount>0&&value.baseFeeAmount+value.mileageMonthlyFeeAmount<=2147483647;
export const productV2DraftInput=v2Draft.refine(validTotal,'合计月费必须为正整数分且不超过金额上限');
export const productDraftInput=z.union([productV1DraftInput,productV2DraftInput]).refine(v=>validTermMonths(v.months,v.minimumTermMonths),'实际期限不得小于最短期限');
export const draftCommandInput=z.union([productV1DraftInput.extend(commandInput.shape).strict(),v2Draft.extend(commandInput.shape).strict().refine(validTotal,'合计月费必须为正整数分且不超过金额上限')]).refine(v=>validTermMonths(v.months,v.minimumTermMonths),'实际期限不得小于最短期限');
export const benefitInput=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('DESCRIPTION'),name:text,description:text,provider:text,conditions:text,validity:z.literal('ORDER'),unit:z.null().default(null),totalQuantity:z.null().default(null)}).strict(),
 z.object({kind:z.literal('COUNT'),name:text,description:text,provider:text,conditions:text,validity:z.literal('ORDER'),unit:text.refine(v=>!['公里','km','月'].includes(v),'服务次数不可重复里程额度'),totalQuantity:z.number().int().positive().max(100000)}).strict()
]);
export type ProductDraft=z.infer<typeof productDraftInput>;
export type BenefitSnapshot={benefitVersionId:string;definitionId:string;version:number;name:string;description:string;provider:string;conditions:string;kind:'DESCRIPTION'|'COUNT';unit:string|null;totalQuantity:number|null;validity:'ORDER'};
export type SwapPolicy=z.infer<typeof swapPolicyInput>;
export type ProductSnapshot={productId:string;productVersionId:string;version:number;name:string;months:number;minimumTermMonths?:number;customerBaas?:z.infer<typeof customerBaasInput>;monthlyFeeAmount:number;mileagePerMonthKm:number;excessMileagePriceAmount:number;energyDescription:string;conditions:string;vehicleIds:string[];modelDefinitionIds:string[];benefits:BenefitSnapshot[]}&({configurationVersion?:1}|{configurationVersion:2;baseFeeAmount:number;mileageMonthlyFeeAmount:number;swapPolicy:SwapPolicy});
export type ListedProductSnapshot=ProductSnapshot&{listingId:string;listingRevision:number;sourceHash:string};
export type ProductVersionView=Record<string,any>;
export const productVersionInclude={items:{orderBy:{position:'asc' as const},include:{benefitVersion:true}}};
