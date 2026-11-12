import {z} from 'zod';
import {money} from '../common/data';

const text=(max:number,min=1)=>z.string().trim().min(min).max(max).refine(value=>!value.includes('\0'),'文字不得含空字符');
const revision=z.number().int().min(0).max(2147483647);
const timestamp=z.iso.datetime({offset:true}).refine(value=>{
 const date=new Date(value);
 return /^[0-9]{4}-/.test(value)&&!value.startsWith('0000-')&&Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999;
},'须为真实带时区时间');

/** The source hash is the existing ListedProductSnapshot.sourceHash, not a quote hash. */
export const offlineSwapTargetInput=z.object({
 targetListingId:text(128),
 targetListingRevision:revision,
 targetSourceHash:z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

/** Deposit/other explicit facts remain separate from automatic subscription price differences.
 * The quote command must still check current authority, expiry, physical facts and customer consent.
 */
export const offlineSwapQuoteInput=z.object({
 pricingVersion:z.literal(2),revision,idempotencyKey:text(128,8),
 // Optional only for historical/internal v2 compatibility; the new PC route requires it.
 previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 ...offlineSwapTargetInput.shape,
 plannedReturnAt:timestamp,plannedDeliveryAt:timestamp,
 depositAmount:money,depositBasis:text(500),
 insuranceResponsibility:text(500),downtimeArrangement:text(500),settlementExplanation:text(500),
 handoverArrangement:text(500),cancellationTerms:text(500),reason:text(500),expiresAt:timestamp,
 externalCompensationRequired:z.literal(false)
}).strict().refine(input=>new Date(input.plannedDeliveryAt)>=new Date(input.plannedReturnAt),{
 path:['plannedDeliveryAt'],message:'计划新车交付不得早于旧车归还'
});

export type OfflineSwapTargetInput=z.infer<typeof offlineSwapTargetInput>;
export type OfflineSwapQuoteInput=z.infer<typeof offlineSwapQuoteInput>;

/** V31 swaps preserve original collateral and term; no arbitrary price/deposit/period editor. */
export const electronicSwapQuoteInput=z.object({pricingVersion:z.literal(3),revision,idempotencyKey:text(128,8),previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),...offlineSwapTargetInput.shape,plannedReturnAt:timestamp,plannedDeliveryAt:timestamp,handoverArrangement:text(500),reason:text(500),expiresAt:timestamp}).strict().refine(v=>new Date(v.plannedDeliveryAt)>=new Date(v.plannedReturnAt),'计划交付不得早于归还');
