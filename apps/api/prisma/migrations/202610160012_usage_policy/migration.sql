-- CreateEnum
CREATE TYPE "UsagePeriodStatus" AS ENUM ('OPEN', 'AWAITING_READING', 'REVIEW_PENDING', 'READY', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackAccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MileagePurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "ReturnSettlementStatus" AS ENUM ('READINGS_REQUIRED', 'PENDING_PAYMENT', 'DISPUTED', 'COMPLETED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'SETTLING';

-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "usagePolicyVersion" TEXT;

-- AlterTable
ALTER TABLE "Handover" ADD COLUMN     "actualAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Mileage" ADD COLUMN     "periodId" TEXT;

-- CreateTable
CREATE TABLE "UsageAccount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "startedOn" DATE NOT NULL,
    "returnedOn" DATE,
    "returnReadingKm" INTEGER,
    "packStatus" "PackAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsagePeriod" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "effectiveEndDate" DATE NOT NULL,
    "status" "UsagePeriodStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startReadingKm" INTEGER,
    "endReadingKm" INTEGER,
    "readingId" TEXT,
    "usedKm" INTEGER,
    "baseUsedKm" INTEGER,
    "packUsedKm" INTEGER,
    "excessKm" INTEGER,
    "excessAmount" INTEGER,
    "billId" TEXT,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "settledAt" TIMESTAMP(3),
    "settlementKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsagePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileagePackProduct" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "km" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MileagePackProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileagePurchase" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersion" INTEGER NOT NULL,
    "applicableFromSequence" INTEGER NOT NULL,
    "km" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "remainingKm" INTEGER NOT NULL DEFAULT 0,
    "status" "MileagePurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "billId" TEXT NOT NULL,
    "termsSnapshot" JSONB NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MileagePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileageLedger" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "periodId" TEXT,
    "type" TEXT NOT NULL,
    "deltaKm" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MileageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnSettlement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "returnedOn" DATE NOT NULL,
    "status" "ReturnSettlementStatus" NOT NULL DEFAULT 'READINGS_REQUIRED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "disputeReason" TEXT NOT NULL DEFAULT '',
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageAccount_orderId_key" ON "UsageAccount"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "UsagePeriod_billId_key" ON "UsagePeriod"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "UsagePeriod_orderId_sequence_key" ON "UsagePeriod"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MileagePurchase_billId_key" ON "MileagePurchase"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "MileagePurchase_orderId_idempotencyKey_key" ON "MileagePurchase"("orderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MileageLedger_sourceKey_key" ON "MileageLedger"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnSettlement_accountId_key" ON "ReturnSettlement"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnSettlement_orderId_key" ON "ReturnSettlement"("orderId");

-- AddForeignKey
ALTER TABLE "Mileage" ADD CONSTRAINT "Mileage_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "UsagePeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageAccount" ADD CONSTRAINT "UsageAccount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsagePeriod" ADD CONSTRAINT "UsagePeriod_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "UsageAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileagePurchase" ADD CONSTRAINT "MileagePurchase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "UsageAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileagePurchase" ADD CONSTRAINT "MileagePurchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MileagePackProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageLedger" ADD CONSTRAINT "MileageLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "UsageAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageLedger" ADD CONSTRAINT "MileageLedger_packId_fkey" FOREIGN KEY ("packId") REFERENCES "MileagePurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnSettlement" ADD CONSTRAINT "ReturnSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "UsageAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Fixed approved catalogue; API has no general mutation route for purchased allowance.
INSERT INTO "MileagePackProduct" ("id","version","km","amount","active") VALUES
('mileage-1000-v1',1,1000,80000,true),('mileage-2000-v1',1,2000,150000,true),('mileage-3000-v1',1,3000,200000,true);
ALTER TABLE "MileagePurchase" ADD CONSTRAINT "MileagePurchase_nonnegative_balance" CHECK ("remainingKm" >= 0 AND "remainingKm" <= "km");
ALTER TABLE "MileageLedger" ADD CONSTRAINT "MileageLedger_type" CHECK ("type" IN ('GRANT','CONSUME','EXPIRE'));
