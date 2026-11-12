BEGIN;

-- Additive structure only. No historical order, quote, stage, archive, money or policy is rewritten.
CREATE TABLE "OrderRenewalCancellation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "serviceStageId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "sourceSnapshot" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "signatureState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "signatureVerifiedBy" TEXT,
  "signatureVerifiedAt" TIMESTAMP(3),
  "signatureEvidenceFileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "signatureNote" TEXT,
  "terminationArchiveId" TEXT,
  "approvedArchiveVersionId" TEXT,
  "terminationArchiveHash" TEXT,
  "completionSnapshot" JSONB,
  "completionHash" TEXT,
  "completedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderRenewalCancellation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DocumentArchive" ADD COLUMN "renewalCancellationId" TEXT;
ALTER TABLE "Refund"
  ADD COLUMN "renewalCancellationId" TEXT,
  ADD COLUMN "renewalCancellationOrderId" TEXT,
  ADD COLUMN "renewalCancellationStageId" TEXT,
  ADD COLUMN "renewalCancellationBillId" TEXT;

CREATE UNIQUE INDEX "OrderChange_cancellation_source_key" ON "OrderChange"("id","orderId","customerId");
CREATE UNIQUE INDEX "OrderServiceStage_cancellation_source_key" ON "OrderServiceStage"("id","orderId","customerId","changeId","quoteId","ownerId");
CREATE UNIQUE INDEX "OrderRenewalCancellation_quoteId_key" ON "OrderRenewalCancellation"("quoteId");
CREATE UNIQUE INDEX "RenewalCancellation_archive_source_key" ON "OrderRenewalCancellation"("id","orderId","ownerId");
CREATE UNIQUE INDEX "RenewalCancellation_refund_source_key" ON "OrderRenewalCancellation"("id","orderId","customerId","serviceStageId");
CREATE INDEX "OrderRenewalCancellation_orderId_status_idx" ON "OrderRenewalCancellation"("orderId","status");
CREATE UNIQUE INDEX "DocumentArchive_renewalCancellationId_key" ON "DocumentArchive"("renewalCancellationId");
CREATE UNIQUE INDEX "DocumentArchive_cancellation_source_key" ON "DocumentArchive"("id","renewalCancellationId","orderId","ownerId");
CREATE UNIQUE INDEX "ArchiveVersion_id_archiveId_key" ON "ArchiveVersion"("id","archiveId");
CREATE UNIQUE INDEX "Payment_cancellation_source_key" ON "Payment"("id","billId","customerId");
CREATE UNIQUE INDEX "Bill_cancellation_source_key" ON "Bill"("id","orderId","customerId","serviceStageId");

ALTER TABLE "OrderRenewalCancellation"
  ADD CONSTRAINT "RenewalCancellation_order_source_fkey" FOREIGN KEY ("orderId","customerId") REFERENCES "Order"("id","customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OrderRenewalCancellation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "RenewalCancellation_change_source_fkey" FOREIGN KEY ("changeId","orderId","customerId") REFERENCES "OrderChange"("id","orderId","customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "RenewalCancellation_quote_source_fkey" FOREIGN KEY ("quoteId","changeId") REFERENCES "DelayQuote"("id","changeId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "RenewalCancellation_stage_source_fkey" FOREIGN KEY ("serviceStageId","orderId","customerId","changeId","quoteId","ownerId") REFERENCES "OrderServiceStage"("id","orderId","customerId","changeId","quoteId","ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OrderRenewalCancellation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OrderRenewalCancellation_signatureVerifiedBy_fkey" FOREIGN KEY ("signatureVerifiedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OrderRenewalCancellation_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The optional stage deliberately uses MATCH SIMPLE: confirmed quotes can precede finance preparation.
-- Required order/change/quote identities remain independently bound even when serviceStageId is NULL.
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_renewal_cancellation_fkey"
  FOREIGN KEY ("renewalCancellationId","orderId","ownerId") REFERENCES "OrderRenewalCancellation"("id","orderId","ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OrderRenewalCancellation"
  ADD CONSTRAINT "RenewalCancellation_archive_source_fkey" FOREIGN KEY ("terminationArchiveId","id","orderId","ownerId") REFERENCES "DocumentArchive"("id","renewalCancellationId","orderId","ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "RenewalCancellation_archive_version_fkey" FOREIGN KEY ("approvedArchiveVersionId","terminationArchiveId") REFERENCES "ArchiveVersion"("id","archiveId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_renewal_cancellation_source_fkey" FOREIGN KEY ("renewalCancellationId","renewalCancellationOrderId","customerId","renewalCancellationStageId") REFERENCES "OrderRenewalCancellation"("id","orderId","customerId","serviceStageId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Refund_renewal_payment_source_fkey" FOREIGN KEY ("paymentId","renewalCancellationBillId","customerId") REFERENCES "Payment"("id","billId","customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Refund_renewal_bill_source_fkey" FOREIGN KEY ("renewalCancellationBillId","renewalCancellationOrderId","customerId","renewalCancellationStageId") REFERENCES "Bill"("id","orderId","customerId","serviceStageId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OrderRenewalCancellation" ADD CONSTRAINT "RenewalCancellation_shape" CHECK ((
  "revision">=0 AND "status" IN ('OPEN','COMPLETED')
  AND "id" ~ '[^[:space:]]' AND "orderId" ~ '[^[:space:]]' AND "customerId" ~ '[^[:space:]]'
  AND "ownerId" ~ '[^[:space:]]' AND "changeId" ~ '[^[:space:]]' AND "quoteId" ~ '[^[:space:]]'
  AND ("serviceStageId" IS NULL OR "serviceStageId" ~ '[^[:space:]]')
  AND "createdBy" ~ '[^[:space:]]' AND "reason" ~ '[^[:space:]]'
  AND jsonb_typeof("sourceSnapshot")='object' AND "sourceHash" ~ '^[a-f0-9]{64}$'
) IS TRUE);

ALTER TABLE "OrderRenewalCancellation" ADD CONSTRAINT "RenewalCancellation_signature_evidence" CHECK ((
  ("signatureState"='UNKNOWN' AND "signatureVerifiedBy" IS NULL AND "signatureVerifiedAt" IS NULL
    AND cardinality("signatureEvidenceFileIds")=0 AND "signatureNote" IS NULL)
  OR
  ("signatureState" IN ('UNSIGNED','SIGNED') AND "signatureVerifiedBy" IS NOT NULL AND "signatureVerifiedBy" ~ '[^[:space:]]'
    AND "signatureVerifiedAt" IS NOT NULL AND "signatureNote" IS NOT NULL AND "signatureNote" ~ '[^[:space:]]'
    AND cardinality("signatureEvidenceFileIds")>0 AND array_position("signatureEvidenceFileIds",NULL) IS NULL
    AND array_to_string("signatureEvidenceFileIds",E'\n') !~ E'(^|\n)[[:space:]]*(\n|$)')
) IS TRUE);

ALTER TABLE "OrderRenewalCancellation" ADD CONSTRAINT "RenewalCancellation_archive_pin" CHECK ((
  ("terminationArchiveId" IS NULL AND "approvedArchiveVersionId" IS NULL AND "terminationArchiveHash" IS NULL)
  OR
  ("signatureState"='SIGNED' AND "terminationArchiveId" IS NOT NULL AND "terminationArchiveId" ~ '[^[:space:]]'
    AND "approvedArchiveVersionId" IS NOT NULL AND "approvedArchiveVersionId" ~ '[^[:space:]]'
    AND "terminationArchiveHash" IS NOT NULL AND "terminationArchiveHash" ~ '^[a-f0-9]{64}$')
) IS TRUE);

ALTER TABLE "OrderRenewalCancellation" ADD CONSTRAINT "RenewalCancellation_completion_evidence" CHECK ((
  ("status"='OPEN' AND "completedBy" IS NULL AND "completedAt" IS NULL AND "completionSnapshot" IS NULL AND "completionHash" IS NULL)
  OR
  ("status"='COMPLETED' AND "signatureState" IN ('SIGNED','UNSIGNED')
    AND "completedBy" IS NOT NULL AND "completedBy" ~ '[^[:space:]]' AND "completedAt" IS NOT NULL
    AND "completionSnapshot" IS NOT NULL AND jsonb_typeof("completionSnapshot")='object'
    AND "completionHash" IS NOT NULL AND "completionHash" ~ '^[a-f0-9]{64}$'
    AND ("signatureState"='UNSIGNED' OR ("terminationArchiveId" IS NOT NULL AND "approvedArchiveVersionId" IS NOT NULL AND "terminationArchiveHash" IS NOT NULL)))
) IS TRUE);

ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_renewal_cancellation_scope" CHECK ((
  ("renewalCancellationId" IS NULL AND "kind"<>'RENEWAL_CANCELLATION' AND "subjectType"<>'ORDER_RENEWAL_CANCELLATION')
  OR
  ("renewalCancellationId" IS NOT NULL AND "renewalCancellationId" ~ '[^[:space:]]'
    AND "kind"='RENEWAL_CANCELLATION' AND "subjectType"='ORDER_RENEWAL_CANCELLATION' AND "subjectId"="renewalCancellationId"
    AND "orderId" IS NOT NULL AND "orderId" ~ '[^[:space:]]' AND "ownerId" IS NOT NULL AND "ownerId" ~ '[^[:space:]]'
    AND "quoteId" IS NULL AND "handoverId" IS NULL)
) IS TRUE);

-- Legacy refunds keep all four columns NULL; new linked refunds cannot skip an FK through a partial NULL group.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_renewal_cancellation_scope" CHECK ((
  ("renewalCancellationId" IS NULL AND "renewalCancellationOrderId" IS NULL AND "renewalCancellationStageId" IS NULL AND "renewalCancellationBillId" IS NULL)
  OR
  ("renewalCancellationId" IS NOT NULL AND "renewalCancellationOrderId" IS NOT NULL AND "renewalCancellationStageId" IS NOT NULL AND "renewalCancellationBillId" IS NOT NULL
    AND "renewalCancellationId" ~ '[^[:space:]]' AND "renewalCancellationOrderId" ~ '[^[:space:]]'
    AND "renewalCancellationStageId" ~ '[^[:space:]]' AND "renewalCancellationBillId" ~ '[^[:space:]]')
) IS TRUE);

-- Neither an FK nor a CHECK can prove archived signatures, exact refund amounts, or final cash reconciliation.
-- The future domain command must recheck those live facts under the order lock; this migration sets no monetary policy.
COMMIT;
