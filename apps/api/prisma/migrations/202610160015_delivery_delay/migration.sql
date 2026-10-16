-- CreateEnum
CREATE TYPE "OrderChangeStatus" AS ENUM ('DRAFT', 'REVIEW_PENDING', 'REVIEWED', 'AWAITING_CONFIRMATION', 'AWAITING_SIGNATURE', 'AWAITING_FINANCE', 'READY', 'APPLIED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DelayQuoteStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "effectiveTermsVersionId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "delayQuoteId" TEXT;

-- CreateTable
CREATE TABLE "OrderChange" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DELIVERY_DELAY',
    "status" "OrderChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "priorTermsHash" TEXT NOT NULL,
    "priorTerms" JSONB NOT NULL,
    "originalContractId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "activeQuoteId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelayQuote" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "DelayQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "commercialHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "fundsSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "confirmedAt" TIMESTAMP(3),
    "financePreparedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelayQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceObligation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceBillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chargeBillId" TEXT,
    "chargeAmount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTermsVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderChange_customerId_createdAt_idx" ON "OrderChange"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderChange_orderId_idempotencyKey_key" ON "OrderChange"("orderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DelayQuote_changeId_revision_key" ON "DelayQuote"("changeId", "revision");

-- CreateIndex
CREATE INDEX "ServiceObligation_orderId_active_sequence_idx" ON "ServiceObligation"("orderId", "active", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceObligation_quoteId_sequence_key" ON "ServiceObligation"("quoteId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_obligationId_key" ON "PaymentAllocation"("paymentId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTermsVersion_quoteId_key" ON "OrderTermsVersion"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTermsVersion_orderId_version_key" ON "OrderTermsVersion"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_delayQuoteId_key" ON "Contract"("delayQuoteId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_delayQuoteId_fkey" FOREIGN KEY ("delayQuoteId") REFERENCES "DelayQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelayQuote" ADD CONSTRAINT "DelayQuote_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "OrderChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceObligation" ADD CONSTRAINT "ServiceObligation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceObligation" ADD CONSTRAINT "ServiceObligation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "DelayQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "ServiceObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTermsVersion" ADD CONSTRAINT "OrderTermsVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTermsVersion" ADD CONSTRAINT "OrderTermsVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "DelayQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OrderChange_one_active" ON "OrderChange"("orderId") WHERE status NOT IN ('APPLIED','CANCELLED','REJECTED');
ALTER TABLE "ServiceObligation" ADD CONSTRAINT "ServiceObligation_nonnegative" CHECK (amount >= 0 AND "chargeAmount" >= 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_positive" CHECK (amount > 0);
