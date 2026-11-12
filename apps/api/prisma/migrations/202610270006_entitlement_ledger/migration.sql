-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "benefitVersionId" TEXT,
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DESCRIPTION',
ADD COLUMN     "productVersionId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceHash" TEXT,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "sourceSnapshot" JSONB,
ADD COLUMN     "totalQuantity" INTEGER,
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "entitlementId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EntitlementReservation" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceRequestId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reservedBy" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "EntitlementReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementLedger" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceRequestId" TEXT,
    "reservationId" TEXT,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "originalEntryId" TEXT,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementCommand" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementReservation_serviceRequestId_key" ON "EntitlementReservation"("serviceRequestId");

-- CreateIndex
CREATE INDEX "EntitlementReservation_entitlementId_status_idx" ON "EntitlementReservation"("entitlementId", "status");

-- CreateIndex
CREATE INDEX "EntitlementReservation_orderId_status_idx" ON "EntitlementReservation"("orderId", "status");

-- CreateIndex
CREATE INDEX "EntitlementLedger_entitlementId_createdAt_idx" ON "EntitlementLedger"("entitlementId", "createdAt");

-- CreateIndex
CREATE INDEX "EntitlementLedger_originalEntryId_idx" ON "EntitlementLedger"("originalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementLedger_entitlementId_type_idempotencyKey_key" ON "EntitlementLedger"("entitlementId", "type", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementCommand_entitlementId_action_idempotencyKey_key" ON "EntitlementCommand"("entitlementId", "action", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_orderId_sourceKey_key" ON "Entitlement"("orderId", "sourceKey");
