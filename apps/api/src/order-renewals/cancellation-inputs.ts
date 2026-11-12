import {z} from 'zod';
import {renewalHash,renewalId,renewalKey,renewalRevision,renewalText} from './types';

const base=z.object({revision:renewalRevision,orderRevision:renewalRevision,previewHash:renewalHash,idempotencyKey:renewalKey}).strict();
const evidenceIds=z.array(renewalId).min(1).max(20).refine(v=>new Set(v).size===v.length,'证据不可重复');
export const cancellationMutualAgreement=z.object({mutuallyAgreedAt:z.iso.datetime({offset:true}),evidenceFileIds:evidenceIds,note:renewalText}).strict();
export const cancellationOpenInput=base.extend({reason:renewalText,mutualAgreement:cancellationMutualAgreement.optional()}).strict();
const existing=base.extend({cancellationId:renewalId,cancellationRevision:renewalRevision}).strict();
export const cancellationMutualInput=existing.extend(cancellationMutualAgreement.shape).strict();
export const cancellationSignatureInput=existing.extend({signatureState:z.enum(['SIGNED','UNSIGNED']),evidenceFileIds:evidenceIds,note:renewalText}).strict();
export const cancellationRefundInput=existing.extend({paymentId:renewalId,reason:renewalText}).strict();
export const cancellationLateRefundInput=z.object({cancellationId:renewalId,cancellationRevision:renewalRevision,orderRevision:renewalRevision,previewHash:renewalHash,paymentId:renewalId,reason:renewalText,idempotencyKey:renewalKey}).strict();
export const cancellationLatePaymentsQuery=z.object({page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict();
export const cancellationCompleteInput=existing.extend({reason:renewalText}).strict();
