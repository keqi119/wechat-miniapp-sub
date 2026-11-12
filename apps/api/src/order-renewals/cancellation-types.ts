/** Internal facts only. Controllers must project a role-specific view; this includes frozen private document text. */
export type RenewalCancellationReadInput={changeId:string;customerId?:string;timingPurpose?:'PREVIEW'|'RECORD_MUTUAL_AGREEMENT'};
export type CancellationRefundFact={method?:string;receiptIdentity?:string|null;id:string;paymentId:string;customerId:string;amount:number;status:string;providerRefundId:string|null;succeededAt:string|null;renewalCancellationId:string|null;renewalCancellationOrderId:string|null;renewalCancellationStageId:string|null;renewalCancellationBillId:string|null;createdAt:string|null;updatedAt:string|null};
export type CancellationPaymentFact={id:string;billId:string;customerId:string;revision:number;status:string;amount:number;providerTransactionId:string|null;succeededAt:string|null;reconciliationRequired:boolean;refunds:CancellationRefundFact[];receivedAmount:number|null;refundedAmount:number|null;remainingRefundAmount:number|null;blockers:string[]};
export type CancellationBillFact={id:string;orderId:string;customerId:string;serviceStageId:string;sequence:number;stageSequence:number;amount:number;paidAmount:number;dueDate:string;status:string;idempotencyKey:string};
export type CancellationObligationFact={id:string;orderId:string;quoteId:string;serviceStageId:string;sequence:number;stageSequence:number;amount:number;chargeAmount:number;chargeBillId:string;sourceBillIds:string[];startDate:string;endDate:string;dueDate:string;active:boolean};
export type CancellationSignatureVersion={id:string;version:number;status:string;sourceFileId:string|null;fileIds:string[];fileManifestHash:string|null;submittedAt:string|null;reviewedAt:string|null;invalidatedAt:string|null};
export type RenewalCancellationFacts={
 version:1;observedOn:string;
 order:{id:string;customerId:string;revision:number;status:string};change:{id:string;revision:number;status:string};
 quote:{id:string;revision:number;status:string;commercialHash:string;confirmedAt:string;financePreparedAt:string|null;document:{id:string;type:string;version:number;templateHash:string;bodyHash:string;content:string}};
 ownerId:string;period:{startDate:string;endDate:string;months:number};
 original:{contractId:string;archiveVersionId:string;archiveHash:string;priorTermsVersionId:string|null;priorTermsHash:string};
 stage:null|{id:string;revision:number;status:string;snapshotHash:string};
 timing:{mutualAgreementVerified:boolean;requiresMutualAgreement:boolean;blockers:string[]};
 sourceSnapshot:{version:1;frozenQuoteSource:Record<string,any>;observed:Record<string,any>};sourceHash:string;
 signature:{archiveId:string|null;currentApprovedVersionId:string|null;hasHistoricalSignedUpload:boolean;cancellationArchiveId:string|null;hasCancellationSignedUpload:boolean;canDeclareUnsigned:boolean;versions:CancellationSignatureVersion[];historyHash:string;blockers:string[]};
 funding:{bills:CancellationBillFact[];obligations:CancellationObligationFact[];payments:CancellationPaymentFact[];receivedAmount:number|null;refundedAmount:number|null;remainingRefundAmount:number|null;refundRequired:boolean;fundsClear:boolean;sourceHash:string;blockers:string[]};
 blockers:string[];
};
