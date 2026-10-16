-- CreateEnum
CREATE TYPE "TechnicalRetentionStatus" AS ENUM ('RETAINED', 'REVIEW_DUE', 'HELD', 'PURGED');

-- CreateTable
CREATE TABLE "TechnicalAcceptance" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "createdBy" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "templateHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "consentSnapshot" JSONB,
    "stoppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceFileId" TEXT,
    "sourcePdfHash" TEXT,
    "slotCoordinates" JSONB,
    "signedFileId" TEXT,
    "providerTaskId" TEXT,
    "signingLeaseUntil" TIMESTAMP(3),
    "retentionDueAt" TIMESTAMP(3),
    "retentionStatus" "TechnicalRetentionStatus" NOT NULL DEFAULT 'RETAINED',
    "retentionReviewedAt" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "purgeStartedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalAcceptanceAction" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalAcceptanceAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalAcceptance_providerTaskId_key" ON "TechnicalAcceptance"("providerTaskId");

-- CreateIndex
CREATE INDEX "TechnicalAcceptance_customerId_createdAt_idx" ON "TechnicalAcceptance"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalAcceptanceAction_actorId_key_key" ON "TechnicalAcceptanceAction"("actorId", "key");

-- AddForeignKey
ALTER TABLE "TechnicalAcceptance" ADD CONSTRAINT "TechnicalAcceptance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalAcceptanceAction" ADD CONSTRAINT "TechnicalAcceptanceAction_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "TechnicalAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
