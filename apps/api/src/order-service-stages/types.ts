import type {ServiceAnchor} from '../service-calendar/types';
import type {UsagePricing} from '../usage/pricing';
import type {SwapTermPolicy} from '../swap-purchases/policy';

export type StageKind='INITIAL'|'RENEWAL';
export type StageStatus='PREPARED'|'SCHEDULED'|'ACTIVE'|'ENDED'|'VOIDED';
export type StageBillingRow={sequence:number;stageSequence:number;startDate:string;endDate:string;dueDate:string;amount:number};
export type StageDocument={id:string;type:'OFFLINE_ORDER_AMENDMENT'|'ELECTRONIC_V31_RENEWAL';version:number;templateHash:string;bodyHash:string;content:string};
/** Internal frozen evidence, never a customer/partner/FIELD projection. */
export type StageSnapshotV1={
 version:1;kind:StageKind;serviceAnchor?:ServiceAnchor;
 identity:{serviceStageId:string;orderId:string;customerId:string;sequence:number;previousStageId:string|null;vehicleId:string;assignmentId:string;ownerId:string|null};
 period:{startDate:string;endDate:string;months:number;firstPeriodSequence:number;lastPeriodSequence:number};
 termsSnapshot:Record<string,any>;usagePricing:UsagePricing;swapPolicy:SwapTermPolicy|null;billingSchedule:StageBillingRow[];
 source:{originalTermsHash:string;product:null|{listingId:string;listingRevision:number;productVersionId:string;subscriptionPlanId:string;sourceHash:string};agreement:{originalContractId:string|null;originalArchiveVersionId:string|null;originalArchiveHash:string|null;priorTermsVersionId:string|null;priorTermsHash:string;changeId:string|null;quoteId:string|null;quoteRevision:number|null;commercialHash:string;approvedArchiveVersionId:string|null;approvedArchiveHash:string|null;document:StageDocument|null}};
};
export type StageRead={stage:Record<string,any>;snapshot:StageSnapshotV1};
