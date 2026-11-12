BEGIN;
-- CreateEnum
CREATE TYPE "OrderServiceStageKind" AS ENUM ('INITIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "OrderServiceStageStatus" AS ENUM ('PREPARED', 'SCHEDULED', 'ACTIVE', 'ENDED', 'VOIDED');

-- AlterEnum
ALTER TYPE "OrderChangeStatus" ADD VALUE 'SCHEDULED';

-- DropIndex
DROP INDEX "SwapCredit_orderId_termSequence_key";

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "serviceStageId" TEXT;

-- AlterTable
ALTER TABLE "UsagePeriod" ADD COLUMN     "serviceStageId" TEXT,
ADD COLUMN     "stageSequence" INTEGER;

-- AlterTable
ALTER TABLE "ServiceObligation" ADD COLUMN     "serviceStageId" TEXT,
ADD COLUMN     "stageSequence" INTEGER;

-- AlterTable
ALTER TABLE "SwapCredit" ADD COLUMN     "serviceStageId" TEXT;

-- AlterTable
ALTER TABLE "SwapCreditPurchase" ADD COLUMN     "serviceStageId" TEXT;

-- CreateTable
CREATE TABLE "OrderServiceStage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "OrderServiceStageKind" NOT NULL,
    "status" "OrderServiceStageStatus" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "previousStageId" TEXT,
    "changeId" TEXT,
    "quoteId" TEXT,
    "priorTermsVersionId" TEXT,
    "termsVersionId" TEXT,
    "approvedArchiveVersionId" TEXT,
    "vehicleId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "ownerId" TEXT,
    "listingId" TEXT,
    "productVersionId" TEXT,
    "subscriptionPlanId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "months" INTEGER NOT NULL,
    "firstPeriodSequence" INTEGER NOT NULL,
    "lastPeriodSequence" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" TEXT,
    "scheduledBy" TEXT,
    "activatedBy" TEXT,
    "voidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderServiceStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_changeId_key" ON "OrderServiceStage"("changeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_quoteId_key" ON "OrderServiceStage"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_termsVersionId_key" ON "OrderServiceStage"("termsVersionId");

-- CreateIndex
CREATE INDEX "OrderServiceStage_status_startDate_idx" ON "OrderServiceStage"("status", "startDate");

-- CreateIndex
CREATE INDEX "OrderServiceStage_orderId_status_idx" ON "OrderServiceStage"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_orderId_sequence_key" ON "OrderServiceStage"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_id_orderId_key" ON "OrderServiceStage"("id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_id_orderId_customerId_key" ON "OrderServiceStage"("id", "orderId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_changeId_orderId_key" ON "OrderServiceStage"("changeId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_quoteId_changeId_key" ON "OrderServiceStage"("quoteId", "changeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderServiceStage_termsVersionId_orderId_key" ON "OrderServiceStage"("termsVersionId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "UsagePeriod_serviceStageId_stageSequence_key" ON "UsagePeriod"("serviceStageId", "stageSequence");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceObligation_serviceStageId_stageSequence_key" ON "ServiceObligation"("serviceStageId", "stageSequence");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAssignment_id_orderId_customerId_vehicleId_key" ON "VehicleAssignment"("id", "orderId", "customerId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapCredit_serviceStageId_termSequence_key" ON "SwapCredit"("serviceStageId", "termSequence");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_serviceStageId_orderId_customerId_fkey" FOREIGN KEY ("serviceStageId", "orderId", "customerId") REFERENCES "OrderServiceStage"("id", "orderId", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UsagePeriod" ADD CONSTRAINT "UsagePeriod_serviceStageId_orderId_fkey" FOREIGN KEY ("serviceStageId", "orderId") REFERENCES "OrderServiceStage"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ServiceObligation" ADD CONSTRAINT "ServiceObligation_serviceStageId_orderId_fkey" FOREIGN KEY ("serviceStageId", "orderId") REFERENCES "OrderServiceStage"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_orderId_customerId_fkey" FOREIGN KEY ("orderId", "customerId") REFERENCES "Order"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_previousStageId_orderId_fkey" FOREIGN KEY ("previousStageId", "orderId") REFERENCES "OrderServiceStage"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_changeId_orderId_fkey" FOREIGN KEY ("changeId", "orderId") REFERENCES "OrderChange"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_quoteId_changeId_fkey" FOREIGN KEY ("quoteId", "changeId") REFERENCES "DelayQuote"("id", "changeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_priorTermsVersionId_orderId_fkey" FOREIGN KEY ("priorTermsVersionId", "orderId") REFERENCES "OrderTermsVersion"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_termsVersionId_orderId_fkey" FOREIGN KEY ("termsVersionId", "orderId") REFERENCES "OrderTermsVersion"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_approvedArchiveVersionId_fkey" FOREIGN KEY ("approvedArchiveVersionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_assignmentId_orderId_customerId_vehicleI_fkey" FOREIGN KEY ("assignmentId", "orderId", "customerId", "vehicleId") REFERENCES "VehicleAssignment"("id", "orderId", "customerId", "vehicleId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "VehicleListing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_scheduledBy_fkey" FOREIGN KEY ("scheduledBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_activatedBy_fkey" FOREIGN KEY ("activatedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SwapCredit" ADD CONSTRAINT "SwapCredit_serviceStageId_orderId_fkey" FOREIGN KEY ("serviceStageId", "orderId") REFERENCES "OrderServiceStage"("id", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SwapCreditPurchase" ADD CONSTRAINT "SwapCreditPurchase_serviceStageId_orderId_customerId_fkey" FOREIGN KEY ("serviceStageId", "orderId", "customerId") REFERENCES "OrderServiceStage"("id", "orderId", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve legacy null-stage TERM uniqueness; different service stages get distinct grants.
CREATE UNIQUE INDEX "SwapCredit_legacy_order_term_key" ON "SwapCredit"("orderId","termSequence") WHERE "serviceStageId" IS NULL;
CREATE UNIQUE INDEX "OrderServiceStage_one_future" ON "OrderServiceStage"("orderId") WHERE "status" IN ('PREPARED','SCHEDULED');
CREATE UNIQUE INDEX "OrderServiceStage_one_active" ON "OrderServiceStage"("orderId") WHERE "status"='ACTIVE';

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
   ("kind"='RENEWAL' AND "sequence">1 AND "months">=12 AND "previousStageId" IS NOT NULL AND "changeId" IS NOT NULL AND "quoteId" IS NOT NULL
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

ALTER TABLE "UsagePeriod" ADD CONSTRAINT "UsagePeriod_stage_source" CHECK (
 ("serviceStageId" IS NULL AND "stageSequence" IS NULL)
 OR ("serviceStageId" IS NOT NULL AND "stageSequence" IS NOT NULL AND "stageSequence">0 AND "pricingSnapshot" IS NOT NULL)
);
ALTER TABLE "ServiceObligation" ADD CONSTRAINT "ServiceObligation_stage_source" CHECK (
 ("serviceStageId" IS NULL AND "stageSequence" IS NULL)
 OR ("serviceStageId" IS NOT NULL AND "stageSequence" IS NOT NULL AND "stageSequence">0)
);
-- No historical amount, price snapshot, term, payment, grant or settled period is rewritten.
COMMIT;

