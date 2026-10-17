-- CreateTable
CREATE TABLE "OwnerAutoAuthority" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sealId" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSignatureId" TEXT NOT NULL,
    "certificateSerialNo" TEXT NOT NULL,
    "providerContractId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "consentSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerAutoAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSigningTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "providerContractId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "ownerSealId" TEXT NOT NULL,
    "authorityId" TEXT,
    "ownerMode" TEXT NOT NULL DEFAULT 'UNSELECTED',
    "manualBy" TEXT,
    "ownerDispatchAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "signedFileId" TEXT,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerSigningTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSigningParty" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSignatureId" TEXT,
    "transactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "queryEvidenceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerSigningParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAutoAuthority_providerContractId_key" ON "OwnerAutoAuthority"("providerContractId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAutoAuthority_providerTransactionId_key" ON "OwnerAutoAuthority"("providerTransactionId");

-- CreateIndex
CREATE INDEX "OwnerAutoAuthority_ownerId_status_idx" ON "OwnerAutoAuthority"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerAutoAuthority_ownerId_idempotencyKey_key" ON "OwnerAutoAuthority"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSigningTask_providerContractId_key" ON "OwnerSigningTask"("providerContractId");

-- CreateIndex
CREATE INDEX "OwnerSigningTask_ownerId_status_idx" ON "OwnerSigningTask"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSigningTask_kind_resourceId_documentHash_key" ON "OwnerSigningTask"("kind", "resourceId", "documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSigningParty_transactionId_key" ON "OwnerSigningParty"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSigningParty_taskId_role_key" ON "OwnerSigningParty"("taskId", "role");

-- AddForeignKey
ALTER TABLE "OwnerAutoAuthority" ADD CONSTRAINT "OwnerAutoAuthority_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerSigningTask" ADD CONSTRAINT "OwnerSigningTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerSigningParty" ADD CONSTRAINT "OwnerSigningParty_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "OwnerSigningTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OwnerAutoAuthority_one_enabled_per_owner" ON "OwnerAutoAuthority" ("ownerId") WHERE "enabled" = true;
