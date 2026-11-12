BEGIN;
-- CreateTable
CREATE TABLE "VehicleAssetProfile" (
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "batteryOwnership" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "firstRegistrationDate" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleAssetProfile_pkey" PRIMARY KEY ("vehicleId")
);

-- CreateTable
CREATE TABLE "VehicleBaasContract" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "previousContractId" TEXT,
    "provider" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "supplierContractNumber" TEXT NOT NULL DEFAULT '',
    "batteryPackage" TEXT NOT NULL,
    "batterySerialNumber" TEXT NOT NULL DEFAULT '',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "rentalAmount" INTEGER NOT NULL,
    "paymentDayOfMonth" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "invoiceRequired" BOOLEAN NOT NULL DEFAULT false,
    "taxIncluded" BOOLEAN,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "firstCostPeriod" TEXT,
    "termsHash" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleBaasContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDepreciationPolicy" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "previousPolicyId" TEXT,
    "method" TEXT NOT NULL,
    "basisAmount" INTEGER NOT NULL,
    "basisSource" TEXT NOT NULL,
    "basisEvidence" TEXT NOT NULL,
    "residualAmount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "usefulLifeMonths" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "termsHash" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "notes" TEXT NOT NULL DEFAULT '',
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDepreciationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCostPlan" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceKind" TEXT NOT NULL,
    "baasContractId" TEXT,
    "depreciationPolicyId" TEXT,
    "costPeriod" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "sourceRevision" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCostPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCostEntry" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "planId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'COST',
    "amount" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "evidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetManualPaymentRecord" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "amount" INTEGER NOT NULL,
    "paidAt" DATE NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "AssetManualPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPrivateFile" (
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baasContractId" TEXT,
    "depreciationPolicyId" TEXT,
    "costEntryId" TEXT,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetPrivateFile_pkey" PRIMARY KEY ("fileId")
);

-- CreateIndex
CREATE INDEX "VehicleBaasContract_vehicleId_status_idx" ON "VehicleBaasContract"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleDepreciationPolicy_vehicleId_status_idx" ON "VehicleDepreciationPolicy"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "AssetCostPlan_vehicleId_sourceKind_costPeriod_idx" ON "AssetCostPlan"("vehicleId", "sourceKind", "costPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostPlan_baasContractId_costPeriod_key" ON "AssetCostPlan"("baasContractId", "costPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostPlan_depreciationPolicyId_costPeriod_key" ON "AssetCostPlan"("depreciationPolicyId", "costPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostEntry_sourceKey_key" ON "AssetCostEntry"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostEntry_reversalOfId_key" ON "AssetCostEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "AssetCostEntry_vehicleId_category_periodStart_idx" ON "AssetCostEntry"("vehicleId", "category", "periodStart");

-- CreateIndex
CREATE INDEX "AssetManualPaymentRecord_entryId_status_idx" ON "AssetManualPaymentRecord"("entryId", "status");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_baasContractId_idx" ON "AssetPrivateFile"("baasContractId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_depreciationPolicyId_idx" ON "AssetPrivateFile"("depreciationPolicyId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_costEntryId_idx" ON "AssetPrivateFile"("costEntryId");

-- AddForeignKey
ALTER TABLE "VehicleAssetProfile" ADD CONSTRAINT "VehicleAssetProfile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_previousContractId_fkey" FOREIGN KEY ("previousContractId") REFERENCES "VehicleBaasContract"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VehicleDepreciationPolicy" ADD CONSTRAINT "VehicleDepreciationPolicy_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDepreciationPolicy" ADD CONSTRAINT "VehicleDepreciationPolicy_previousPolicyId_fkey" FOREIGN KEY ("previousPolicyId") REFERENCES "VehicleDepreciationPolicy"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_baasContractId_fkey" FOREIGN KEY ("baasContractId") REFERENCES "VehicleBaasContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_depreciationPolicyId_fkey" FOREIGN KEY ("depreciationPolicyId") REFERENCES "VehicleDepreciationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCostEntry" ADD CONSTRAINT "AssetCostEntry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCostEntry" ADD CONSTRAINT "AssetCostEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AssetCostPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCostEntry" ADD CONSTRAINT "AssetCostEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "AssetCostEntry"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetManualPaymentRecord" ADD CONSTRAINT "AssetManualPaymentRecord_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AssetCostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_baasContractId_fkey" FOREIGN KEY ("baasContractId") REFERENCES "VehicleBaasContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_depreciationPolicyId_fkey" FOREIGN KEY ("depreciationPolicyId") REFERENCES "VehicleDepreciationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_costEntryId_fkey" FOREIGN KEY ("costEntryId") REFERENCES "AssetCostEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VehicleAssetProfile" ADD CONSTRAINT "VehicleAssetProfile_values" CHECK (
 "revision">=0 AND "batteryOwnership" IN ('UNKNOWN','OWNED','BAAS')
);
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_values" CHECK (
 "revision">=0 AND "status" IN ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','ARCHIVED')
 AND "billingCycle" IN ('MONTHLY','QUARTERLY','YEARLY') AND "currency"='CNY'
 AND "rentalAmount">0 AND "paymentDayOfMonth" BETWEEN 1 AND 31 AND "graceDays" BETWEEN 0 AND 365
 AND "effectiveFrom"<="effectiveTo" AND "termsHash" ~ '^[a-f0-9]{64}$'
 AND ("previousContractId" IS NULL OR "previousContractId"<>"id")
 AND ("firstCostPeriod" IS NULL OR "firstCostPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "VehicleBaasContract_one_active" ON "VehicleBaasContract"("vehicleId") WHERE "status"='ACTIVE';
ALTER TABLE "VehicleDepreciationPolicy" ADD CONSTRAINT "VehicleDepreciationPolicy_values" CHECK (
 "revision">=0 AND "status" IN ('DRAFT','ACTIVE','SUPERSEDED','ARCHIVED')
 AND "method" IN ('STRAIGHT_LINE','MANUAL','NONE') AND "currency"='CNY'
 AND "basisAmount">=0 AND "residualAmount">=0 AND "residualAmount"<="basisAmount"
 AND (("method"='STRAIGHT_LINE' AND "usefulLifeMonths" IS NOT NULL AND "usefulLifeMonths" BETWEEN 1 AND 120)
   OR ("method" IN ('MANUAL','NONE') AND "usefulLifeMonths" IS NULL))
 AND "termsHash" ~ '^[a-f0-9]{64}$' AND ("previousPolicyId" IS NULL OR "previousPolicyId"<>"id")
);
CREATE UNIQUE INDEX "VehicleDepreciationPolicy_one_active" ON "VehicleDepreciationPolicy"("vehicleId") WHERE "status"='ACTIVE';
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_values" CHECK (
 "revision">=0 AND "sourceRevision">=0 AND "amount">=0 AND "periodStart"<="periodEnd"
 AND "costPeriod"=to_char("periodStart",'YYYY-MM') AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("sourceSnapshot")='object' AND "status" IN ('SCHEDULED','CONFIRMED','VOIDED')
 AND (("sourceKind"='BAAS' AND "baasContractId" IS NOT NULL AND "depreciationPolicyId" IS NULL AND "amount">0 AND "dueDate" IS NOT NULL)
  OR ("sourceKind"='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL AND "baasContractId" IS NULL AND "dueDate" IS NULL))
);
ALTER TABLE "AssetCostEntry" ADD CONSTRAINT "AssetCostEntry_values" CHECK (
 "revision">=0 AND "amount">=0 AND "periodStart"<="periodEnd"
 AND "category" IN ('BAAS_RENT','DEPRECIATION') AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("sourceSnapshot")='object'
 AND (("effect"='COST' AND "reversalOfId" IS NULL)
  OR ("effect"='REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId"<>"id" AND length(trim("reason"))>0))
 AND (("lockedAt" IS NULL AND "lockedBy" IS NULL) OR ("lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL))
);
CREATE UNIQUE INDEX "AssetCostEntry_one_cost_per_plan" ON "AssetCostEntry"("planId") WHERE "effect"='COST';
ALTER TABLE "AssetManualPaymentRecord" ADD CONSTRAINT "AssetManualPaymentRecord_values" CHECK (
 "revision">=0 AND "amount">0 AND length(trim("referenceNo"))>0 AND length(trim("reason"))>0
 AND cardinality("evidenceFileIds")>0 AND "status" IN ('RECORDED','VOIDED')
 AND (("status"='RECORDED' AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
  OR ("status"='VOIDED' AND "voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND "voidReason" IS NOT NULL AND length(trim("voidReason"))>0))
);
CREATE UNIQUE INDEX "AssetManualPaymentRecord_one_active" ON "AssetManualPaymentRecord"("entryId") WHERE "status"='RECORDED';
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_scope" CHECK (
 "sha256" ~ '^[a-f0-9]{64}$' AND (
  ("kind"='BAAS' AND "baasContractId" IS NOT NULL AND "depreciationPolicyId" IS NULL AND "costEntryId" IS NULL)
  OR ("kind"='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL AND "baasContractId" IS NULL AND "costEntryId" IS NULL)
  OR ("kind"='COST' AND "costEntryId" IS NOT NULL AND "baasContractId" IS NULL AND "depreciationPolicyId" IS NULL)
 )
);
COMMIT;

