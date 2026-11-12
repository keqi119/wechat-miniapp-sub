-- Preserve every lifecycle/source constraint; replace only the obsolete renewal floor.
ALTER TABLE "OrderServiceStage" DROP CONSTRAINT "OrderServiceStage_shape";
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_shape" CHECK ((
 "sequence">0 AND "revision">=0 AND "endDate">"startDate"
 AND "months" BETWEEN 1 AND 120 AND "firstPeriodSequence">0
 AND "lastPeriodSequence"::BIGINT-"firstPeriodSequence"::BIGINT+1="months"::BIGINT
 AND "snapshotHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("snapshot")='object'
 AND ("previousStageId" IS NULL OR "previousStageId"<>"id")
 AND (
   ("kind"='INITIAL' AND "sequence"=1 AND "previousStageId" IS NULL AND "changeId" IS NULL AND "quoteId" IS NULL
     AND "termsVersionId" IS NULL AND "approvedArchiveVersionId" IS NULL AND "status" IN ('ACTIVE','ENDED') AND "activatedAt" IS NOT NULL)
   OR
   ("kind"='RENEWAL' AND "sequence">1 AND "months">=3 AND "previousStageId" IS NOT NULL AND "changeId" IS NOT NULL AND "quoteId" IS NOT NULL
     AND "approvedArchiveVersionId" IS NOT NULL AND "ownerId" IS NOT NULL AND "listingId" IS NOT NULL AND "productVersionId" IS NOT NULL
     AND "subscriptionPlanId" IS NOT NULL AND "createdBy" IS NOT NULL
     AND (("status" IN ('PREPARED','SCHEDULED','VOIDED') AND "termsVersionId" IS NULL AND "activatedAt" IS NULL AND "activatedBy" IS NULL)
       OR ("status" IN ('ACTIVE','ENDED') AND "termsVersionId" IS NOT NULL AND "activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL)))
 )
 AND (("status"='PREPARED' AND "scheduledAt" IS NULL AND "scheduledBy" IS NULL)
   OR ("kind"='INITIAL') OR ("status"='VOIDED')
   OR ("status" IN ('SCHEDULED','ACTIVE','ENDED') AND "scheduledAt" IS NOT NULL AND "scheduledBy" IS NOT NULL))
 AND (("status"='ENDED' AND "endedAt" IS NOT NULL) OR ("status"<>'ENDED' AND "endedAt" IS NULL))
 AND (("status"='VOIDED' AND "voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND length(btrim("voidReason"))>0)
   OR ("status"<>'VOIDED' AND "voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL))
) IS TRUE);
