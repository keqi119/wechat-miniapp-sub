import {z} from 'zod';
import {ensure} from '../common/errors';
import {hash} from '../common/data';
import {canonicalHash} from '../customers/types';
export const renewalId=z.string().min(1).max(500).refine(v=>v.trim()===v&&!v.includes('\0'),'标识无效');
export const renewalText=z.string().trim().min(1).max(2000).refine(v=>!v.includes('\0')&&!/待补齐|待填写|另行通知|\{\{|\}\}/.test(v),'请填写明确内容');
export const renewalHash=z.string().regex(/^[a-f0-9]{64}$/);
export const renewalRevision=z.number().int().min(0).max(2147483647);
export const renewalKey=z.string().min(8).max(120).refine(v=>!v.includes('\0'));
export const renewalCommand=z.object({revision:renewalRevision,idempotencyKey:renewalKey}).strict();
export const renewalPreviewInput=z.object({listingId:renewalId,listingRevision:renewalRevision,productVersionId:renewalId,listingSourceHash:renewalHash,orderRevision:renewalRevision,accountRevision:renewalRevision,reason:renewalText,expiresAt:z.iso.datetime({offset:true}),settlementExplanation:renewalText,cancellationTerms:renewalText}).strict();
export const renewalCreateInput=renewalPreviewInput.extend({previewHash:renewalHash,idempotencyKey:renewalKey}).strict();
export const renewalQuoteInput=renewalCreateInput.extend({revision:renewalRevision}).strict();
export const renewalReviewInput=renewalCommand.extend({decision:z.enum(['APPROVED','REJECTED']),note:renewalText}).strict();
export const renewalConfirmInput=renewalCommand.extend({quoteId:renewalId,quoteRevision:renewalRevision.min(1),commercialHash:renewalHash,bodyHash:renewalHash,lessorHash:renewalHash,noticeHash:renewalHash,sharingAccepted:z.literal(true)}).strict();
export const renewalRejectInput=renewalCommand.extend({reason:renewalText}).strict();
export const renewalPrepareInput=renewalCommand.extend({orderRevision:renewalRevision,accountRevision:renewalRevision,previewHash:renewalHash}).strict();
export const renewalScheduleInput=renewalPrepareInput.extend({stageId:renewalId,stageRevision:renewalRevision}).strict();
export const renewalActivationInput=renewalScheduleInput.extend({previousStageRevision:renewalRevision,assignmentId:renewalId}).strict();
export const renewalGoodsQuery=z.object({keyword:z.string().trim().max(100).refine(v=>!v.includes('\0')).default(''),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
export type RenewalPreviewInput=z.infer<typeof renewalPreviewInput>;
export const previewFields=(v:RenewalPreviewInput):RenewalPreviewInput=>renewalPreviewInput.parse(Object.fromEntries(Object.keys(renewalPreviewInput.shape).map(k=>[k,(v as any)[k]])));

/** Pure frozen-evidence helpers: shared paper readers can import without a context/readiness cycle. */
export function renewalSourceHash(s:any){
 const input={...s.input},source={...s.source},terms={...s.renewalTerms};delete input.orderRevision;delete source.orderRevision;delete terms.commercialHash;delete terms.amendmentContractId;
 return canonicalHash({kind:s.kind,...(s.executionMode?{executionMode:s.executionMode}:{}),startDate:s.startDate,endDate:s.endDate,newStartDate:s.newStartDate,newEndDate:s.newEndDate,expiresAt:s.expiresAt,originalAssignmentId:s.originalAssignmentId,originalArchiveVersionId:s.originalArchiveVersionId,priorTermsVersionId:s.priorTermsVersionId,months:s.months,monthlyFeeAmount:s.monthlyFeeAmount,depositAmount:s.depositAmount,totalAmount:s.totalAmount,periods:s.periods,usagePricing:s.usagePricing,swapPolicy:s.swapPolicy,product:s.product,renewalTerms:terms,source,input});
}
export function assertRenewalFrozenQuote(change:any,q:any){
 const s=q?.snapshot;
 const record=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 ensure(record(change)&&record(q)&&record(s)&&record(s.source)&&record(s.input)&&record(s.renewalTerms)&&record(change.priorTerms),409,'RENEWAL_QUOTE_SOURCE','续期冻结来源结构不完整');
 ensure(change.kind==='SUBSCRIPTION_EXTENSION'&&q.changeId===change.id&&s.kind==='SUBSCRIPTION_EXTENSION'&&s.source.orderId===change.orderId&&s.source.customerId===change.customerId&&s.source.originalContractId===change.originalContractId&&s.source.originalArchiveVersionId===change.originalArchiveVersionId&&(s.source.priorTermsVersionId??null)===(change.priorTermsVersionId??null)&&s.source.priorTermsHash===change.priorTermsHash&&hash(change.priorTerms)===change.priorTermsHash,409,'RENEWAL_QUOTE_SOURCE','续期报价与原条款来源不一致');
 ensure(s.sourceHash===renewalSourceHash(s)&&s.renewalTerms.serviceStageId===`renewal:${change.orderId}:${s.source.nextStageSequence}`,409,'RENEWAL_QUOTE_SOURCE','续期冻结来源摘要不一致');return s;
}
/** Current commands must additionally bind the current quote; historical readers must not invent that pointer. */
export function assertRenewalQuote(change:any,q:any){const s=assertRenewalFrozenQuote(change,q);ensure(change.activeQuoteId===q.id,409,'RENEWAL_QUOTE_SOURCE','续期报价已被替换');return s;}
export function renewalCommercialHash(change:any,s:any,templateHash:string,contractId:string,offlineSource:any){
 const {document:_document,offlineSource:_source,customerAcceptance:_acceptance,...before}=s,terms={...s.renewalTerms};delete terms.commercialHash;delete terms.amendmentContractId;
 // JSONB may reorder every object, including the newly constructed offlineSource.
 // The signed commercial identity binds values, never JavaScript insertion order.
 return canonicalHash({priorTermsHash:change.priorTermsHash,snapshot:{...before,renewalTerms:terms,document:null},templateHash,contractId,offlineSource});
}
