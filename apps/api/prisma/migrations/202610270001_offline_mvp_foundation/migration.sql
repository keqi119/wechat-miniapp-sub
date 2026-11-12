-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_CONTRACT_REVIEW';

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "authVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3);
-- Existing accounts retain their original creation timestamp as the migration baseline.
UPDATE "AdminUser" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "AdminUser" ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "AdminSession" ADD COLUMN     "authVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "contractMode" TEXT NOT NULL DEFAULT 'ESIGN';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "contractMode" TEXT NOT NULL DEFAULT 'ESIGN';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'ESIGN',
ADD COLUMN     "offlineArchiveId" TEXT;

-- AlterTable
ALTER TABLE "Handover" ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'ESIGN',
ADD COLUMN     "offlineArchiveId" TEXT;

-- CreateTable
CREATE TABLE "StaffCommand" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "digestKeyVersion" TEXT NOT NULL,
    "responseSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentArchive" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "ownerId" TEXT,
    "orderId" TEXT,
    "handoverId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentApprovedVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveVersion" (
    "id" TEXT NOT NULL,
    "archiveId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "sourceFileId" TEXT,
    "businessSnapshotHash" TEXT NOT NULL,
    "partiesSnapshot" JSONB NOT NULL,
    "requiredSigners" TEXT[],
    "signedOn" TEXT,
    "contractNumber" TEXT,
    "originalCustodian" TEXT,
    "originalLocation" TEXT,
    "declaredPages" INTEGER,
    "scopeSnapshot" JSONB NOT NULL,
    "fileManifestHash" TEXT,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewChecklist" JSONB,
    "partyChecks" JSONB,
    "reviewReason" TEXT,
    "invalidatedBy" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveFile" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveFeedback" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ArchiveFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveCommand" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffCommand_actorId_targetKey_action_idempotencyKey_key" ON "StaffCommand"("actorId", "targetKey", "action", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentArchive_currentApprovedVersionId_key" ON "DocumentArchive"("currentApprovedVersionId");

-- CreateIndex
CREATE INDEX "DocumentArchive_orderId_kind_idx" ON "DocumentArchive"("orderId", "kind");

-- CreateIndex
CREATE INDEX "DocumentArchive_ownerId_kind_idx" ON "DocumentArchive"("ownerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentArchive_subjectType_subjectId_kind_key" ON "DocumentArchive"("subjectType", "subjectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveVersion_archiveId_version_key" ON "ArchiveVersion"("archiveId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveFile_versionId_position_key" ON "ArchiveFile"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveFile_versionId_fileId_key" ON "ArchiveFile"("versionId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveFile_fileId_key" ON "ArchiveFile"("fileId");

-- CreateIndex
CREATE INDEX "ArchiveFeedback_versionId_status_idx" ON "ArchiveFeedback"("versionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveCommand_actorId_resourceId_action_key_key" ON "ArchiveCommand"("actorId", "resourceId", "action", "key");

-- AddForeignKey
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_currentApprovedVersionId_fkey" FOREIGN KEY ("currentApprovedVersionId") REFERENCES "ArchiveVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "DocumentArchive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFile" ADD CONSTRAINT "ArchiveFile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFile" ADD CONSTRAINT "ArchiveFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFeedback" ADD CONSTRAINT "ArchiveFeedback_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
