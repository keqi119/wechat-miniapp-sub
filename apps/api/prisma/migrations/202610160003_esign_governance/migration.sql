-- CreateTable
CREATE TABLE "ESignAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "registrationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "realNameStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "verificationSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "verifiedSerialNo" TEXT,
    "verificationTransactionNo" TEXT,
    "identityCiphertext" TEXT,
    "certStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "certSerialNo" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "registrationLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ESignAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseSeal" (
    "id" TEXT NOT NULL,
    "sealName" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSignatureId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "evidenceFileId" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseSeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SealAuthority" (
    "id" TEXT NOT NULL,
    "sealId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "requiresTwoPersonApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SealAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignaturePolicy" (
    "id" TEXT NOT NULL,
    "policyCode" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sealId" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'SEQUENTIAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignaturePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ESignApproval" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sourcePdfHash" TEXT NOT NULL,
    "slotCoordinates" JSONB NOT NULL,
    "policyId" TEXT NOT NULL,
    "sealId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "planHash" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ESignApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FadadaTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "sourcePdfHash" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "providerEnvelopeId" TEXT NOT NULL,
    "customerProviderId" TEXT NOT NULL,
    "platformProviderId" TEXT NOT NULL,
    "customerTransactionId" TEXT NOT NULL,
    "platformTransactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "uploadedAt" TIMESTAMP(3),
    "customerSignedAt" TIMESTAMP(3),
    "platformSignedAt" TIMESTAMP(3),
    "sealRequestedAt" TIMESTAMP(3),
    "signedFileId" TEXT,
    "signedPdfHash" TEXT,
    "processingUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FadadaTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ESignAccount_customerId_key" ON "ESignAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ESignAccount_providerCustomerId_key" ON "ESignAccount"("providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ESignAccount_verificationTransactionNo_key" ON "ESignAccount"("verificationTransactionNo");

-- CreateIndex
CREATE UNIQUE INDEX "SealAuthority_sealId_subjectType_subjectId_authorityType_key" ON "SealAuthority"("sealId", "subjectType", "subjectId", "authorityType");

-- CreateIndex
CREATE UNIQUE INDEX "SignaturePolicy_policyCode_key" ON "SignaturePolicy"("policyCode");

-- CreateIndex
CREATE UNIQUE INDEX "ESignApproval_kind_resourceId_documentHash_policyId_key" ON "ESignApproval"("kind", "resourceId", "documentHash", "policyId");

-- CreateIndex
CREATE UNIQUE INDEX "FadadaTask_approvalId_key" ON "FadadaTask"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "FadadaTask_providerEnvelopeId_key" ON "FadadaTask"("providerEnvelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "FadadaTask_customerTransactionId_key" ON "FadadaTask"("customerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FadadaTask_platformTransactionId_key" ON "FadadaTask"("platformTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FadadaTask_kind_resourceId_documentHash_key" ON "FadadaTask"("kind", "resourceId", "documentHash");

