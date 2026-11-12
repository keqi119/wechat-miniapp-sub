-- CreateTable
CREATE TABLE "PartnerRevenueRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentApprovedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerRevenueRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerRevenueRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "cooperationVersionId" TEXT NOT NULL,
    "vehicleIds" TEXT[],
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "terms" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerRevenueRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAccountVersion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAccountVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "accountVersionId" TEXT NOT NULL,
    "accountSnapshot" JSONB NOT NULL,
    "accountHash" TEXT NOT NULL,
    "payableAmount" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT,
    "category" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceShareAmount" INTEGER NOT NULL DEFAULT 0,
    "payableAmount" INTEGER NOT NULL,
    "ruleVersionId" TEXT,
    "ruleSnapshot" JSONB,
    "sourceSnapshot" JSONB,
    "originalSettlementLineId" TEXT,
    "explanation" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlementPayment" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "amount" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "accountVersionId" TEXT NOT NULL,
    "accountHash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "recordedBy" TEXT NOT NULL,
    "reconciledBy" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "reconciliationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlementPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlementFeedback" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlementFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSettlementFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSettlementFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleReceiptEvent" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "revision" INTEGER NOT NULL,
    "previousEventId" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "readingKm" INTEGER NOT NULL,
    "storageLocation" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "correctionReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "VehicleReceiptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineCancellationReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "paperStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "businessSnapshotHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "OfflineCancellationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerRevenueRule_ownerId_idx" ON "PartnerRevenueRule"("ownerId");

-- CreateIndex
CREATE INDEX "PartnerRevenueRuleVersion_ownerId_status_idx" ON "PartnerRevenueRuleVersion"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRevenueRuleVersion_ruleId_version_key" ON "PartnerRevenueRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "PartnerAccountVersion_ownerId_status_idx" ON "PartnerAccountVersion"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccountVersion_ownerId_version_key" ON "PartnerAccountVersion"("ownerId", "version");

-- CreateIndex
CREATE INDEX "PartnerSettlement_ownerId_status_idx" ON "PartnerSettlement"("ownerId", "status");

-- CreateIndex
CREATE INDEX "PartnerSettlementLine_settlementId_idx" ON "PartnerSettlementLine"("settlementId");

-- CreateIndex
CREATE INDEX "PartnerSettlementLine_sourceType_sourceId_idx" ON "PartnerSettlementLine"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSettlementPayment_settlementId_version_key" ON "PartnerSettlementPayment"("settlementId", "version");

-- CreateIndex
CREATE INDEX "PartnerSettlementFeedback_settlementId_status_idx" ON "PartnerSettlementFeedback"("settlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSettlementFile_fileId_key" ON "PartnerSettlementFile"("fileId");

-- CreateIndex
CREATE INDEX "PartnerSettlementFile_ownerId_idx" ON "PartnerSettlementFile"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleReceiptEvent_previousEventId_key" ON "VehicleReceiptEvent"("previousEventId");

-- CreateIndex
CREATE INDEX "VehicleReceiptEvent_orderId_isCurrent_idx" ON "VehicleReceiptEvent"("orderId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleReceiptEvent_handoverId_revision_key" ON "VehicleReceiptEvent"("handoverId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleReceiptEvent_createdBy_idempotencyKey_key" ON "VehicleReceiptEvent"("createdBy", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OfflineCancellationReview_orderId_isCurrent_idx" ON "OfflineCancellationReview"("orderId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineCancellationReview_orderId_revision_key" ON "OfflineCancellationReview"("orderId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineCancellationReview_orderId_idempotencyKey_key" ON "OfflineCancellationReview"("orderId", "idempotencyKey");

CREATE UNIQUE INDEX "VehicleReceiptEvent_one_current" ON "VehicleReceiptEvent"("handoverId") WHERE "isCurrent"=true;
CREATE UNIQUE INDEX "OfflineCancellationReview_one_current" ON "OfflineCancellationReview"("orderId") WHERE "isCurrent"=true;
