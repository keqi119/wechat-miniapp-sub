-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "partnerCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "staffPersonId" TEXT;

-- AlterTable
ALTER TABLE "VehicleOwner" ADD COLUMN     "contactRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ordinaryContactPhone" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PartnerRevenueRuleVersion" ALTER COLUMN "cooperationVersionId" DROP NOT NULL,
ALTER COLUMN "validFrom" DROP NOT NULL,
ALTER COLUMN "validUntil" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PartnerSettlementFeedback" ADD COLUMN     "recordedBy" TEXT,
ADD COLUMN     "source" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerCooperationDraft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "payload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCooperationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCooperationSubmission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "representatives" JSONB NOT NULL,
    "subjectEvidenceFileIds" TEXT[],
    "domainVersions" JSONB NOT NULL,
    "submissionHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "completedActions" JSONB NOT NULL,
    "legacyVerificationId" TEXT,
    "legacyIdentityBindingId" TEXT,

    CONSTRAINT "PartnerCooperationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPortalAccess" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "accessVersion" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "displayName" TEXT NOT NULL DEFAULT '',
    "mobileHash" TEXT,
    "mobileCiphertext" TEXT,
    "maskedMobile" TEXT NOT NULL DEFAULT '',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPortalCandidate" (
    "id" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "displayName" TEXT NOT NULL,
    "mobileHash" TEXT NOT NULL,
    "mobileCiphertext" TEXT NOT NULL,
    "maskedMobile" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "submittedBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPortalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPortalChallenge" (
    "id" TEXT NOT NULL,
    "mobileHash" TEXT NOT NULL,
    "maskedMobile" TEXT NOT NULL,
    "smsChallengeId" TEXT,
    "scopeSnapshot" JSONB NOT NULL,
    "scopeDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPortalChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPortalSession" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PARTNER_READONLY',
    "mobileHash" TEXT NOT NULL,
    "maskedMobile" TEXT NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "consentSnapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCooperationDraft_ownerId_key" ON "PartnerCooperationDraft"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCooperationSubmission_legacyVerificationId_key" ON "PartnerCooperationSubmission"("legacyVerificationId");

-- CreateIndex
CREATE INDEX "PartnerCooperationSubmission_ownerId_status_idx" ON "PartnerCooperationSubmission"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCooperationSubmission_ownerId_revision_key" ON "PartnerCooperationSubmission"("ownerId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPortalAccess_ownerId_key" ON "PartnerPortalAccess"("ownerId");

-- CreateIndex
CREATE INDEX "PartnerPortalAccess_mobileHash_status_idx" ON "PartnerPortalAccess"("mobileHash", "status");

-- CreateIndex
CREATE INDEX "PartnerPortalCandidate_accessId_status_createdAt_idx" ON "PartnerPortalCandidate"("accessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPortalChallenge_smsChallengeId_key" ON "PartnerPortalChallenge"("smsChallengeId");

-- CreateIndex
CREATE INDEX "PartnerPortalChallenge_mobileHash_createdAt_idx" ON "PartnerPortalChallenge"("mobileHash", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerPortalSession_mobileHash_expiresAt_idx" ON "PartnerPortalSession"("mobileHash", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminUser_staffPersonId_idx" ON "AdminUser"("staffPersonId");

CREATE UNIQUE INDEX "PartnerPortalCandidate_one_pending" ON "PartnerPortalCandidate"("accessId") WHERE "status" IN ('DRAFT','SUBMITTED');
