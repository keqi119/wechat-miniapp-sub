-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reconciliationReason" TEXT,
ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "renewalOfPolicyId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changeKind" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "policyholder" TEXT NOT NULL,
    "insuredParty" TEXT NOT NULL,
    "vehicleIds" TEXT[],
    "coverageItems" JSONB NOT NULL,
    "premiumAmount" INTEGER,
    "terms" TEXT NOT NULL,
    "fileIds" TEXT[],
    "requirementVersionIds" TEXT[],
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewChecks" JSONB,
    "reviewReason" TEXT,
    "editedByIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicyFile" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "vehicleIds" TEXT[],
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicyFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRequirement" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CoverageRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRequirementVersion" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageRequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceRenewalReminder" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceRenewalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCommand" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCoverageReviewTask" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceCoverageReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerQualificationVersion" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "profileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "verificationSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "identityFileIds" TEXT[],
    "drivingLicenseFileIds" TEXT[],
    "evidenceHash" TEXT NOT NULL,
    "identityExpiresAt" TIMESTAMP(3) NOT NULL,
    "drivingLicenseExpiresAt" TIMESTAMP(3) NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supplementaryInstructions" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerQualificationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationRiskReview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "applicationRevision" INTEGER NOT NULL,
    "profileHash" TEXT NOT NULL,
    "applicationProfileHash" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "qualificationRevision" INTEGER NOT NULL,
    "finalPlanId" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "commercialHash" TEXT NOT NULL,
    "planInputHash" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleInputHash" TEXT NOT NULL,
    "creditConsentId" TEXT NOT NULL,
    "creditConsentRevision" INTEGER NOT NULL,
    "creditConsentVersion" INTEGER NOT NULL,
    "creditVerificationId" TEXT NOT NULL,
    "creditVerificationRevision" INTEGER NOT NULL,
    "creditRevision" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supplementaryInstructions" TEXT NOT NULL DEFAULT '',
    "identityChecked" BOOLEAN NOT NULL,
    "drivingQualificationChecked" BOOLEAN NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "ApplicationRiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_insurer_policyNumber_key" ON "InsurancePolicy"("insurer", "policyNumber");

-- CreateIndex
CREATE INDEX "InsurancePolicyVersion_status_endAt_idx" ON "InsurancePolicyVersion"("status", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicyVersion_policyId_version_key" ON "InsurancePolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicyFile_fileId_key" ON "InsurancePolicyFile"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRequirement_scopeType_scopeId_key" ON "CoverageRequirement"("scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRequirementVersion_requirementId_version_key" ON "CoverageRequirementVersion"("requirementId", "version");

-- CreateIndex
CREATE INDEX "InsuranceRenewalReminder_status_dueAt_idx" ON "InsuranceRenewalReminder"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceRenewalReminder_vehicleId_policyVersionId_threshol_key" ON "InsuranceRenewalReminder"("vehicleId", "policyVersionId", "thresholdDays");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceCommand_actorId_resourceId_action_key_key" ON "InsuranceCommand"("actorId", "resourceId", "action", "key");

-- CreateIndex
CREATE INDEX "InsuranceCoverageReviewTask_status_dueAt_idx" ON "InsuranceCoverageReviewTask"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceCoverageReviewTask_vehicleId_policyVersionId_requi_key" ON "InsuranceCoverageReviewTask"("vehicleId", "policyVersionId", "requirementVersionId");

-- CreateIndex
CREATE INDEX "CustomerQualificationVersion_customerId_status_idx" ON "CustomerQualificationVersion"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerQualificationVersion_customerId_revision_key" ON "CustomerQualificationVersion"("customerId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerQualificationVersion_customerId_idempotencyKey_key" ON "CustomerQualificationVersion"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApplicationRiskReview_customerId_reviewedAt_idx" ON "ApplicationRiskReview"("customerId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationRiskReview_applicationId_revision_key" ON "ApplicationRiskReview"("applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationRiskReview_applicationId_idempotencyKey_key" ON "ApplicationRiskReview"("applicationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "InsurancePolicyVersion" ADD CONSTRAINT "InsurancePolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicyFile" ADD CONSTRAINT "InsurancePolicyFile_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRequirementVersion" ADD CONSTRAINT "CoverageRequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CoverageRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
