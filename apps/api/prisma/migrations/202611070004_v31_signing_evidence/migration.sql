ALTER TABLE "ESignAccount" ADD COLUMN "certSubjectHash" TEXT;
ALTER TABLE "OwnerESignAccount" ADD COLUMN "certSubjectHash" TEXT;
ALTER TABLE "ElectronicSigningParty" ADD COLUMN "providerSignedAt" TIMESTAMP(3), ADD COLUMN "providerSignedAtRaw" TEXT, ADD COLUMN "providerSignedAtPrecisionMs" INTEGER;
ALTER TABLE "ElectronicSigningTask" ADD COLUMN "stopStatus" TEXT, ADD COLUMN "finalVerification" JSONB, ADD COLUMN "legalCompletedAt" TIMESTAMP(3), ADD COLUMN "stoppedEvidenceId" TEXT;
CREATE UNIQUE INDEX "ElectronicSigningTask_stoppedEvidenceId_key" ON "ElectronicSigningTask"("stoppedEvidenceId");
CREATE TABLE "ElectronicStoppedEvidence" ("id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL UNIQUE REFERENCES "ElectronicSigningTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, "finalFileId" TEXT NOT NULL REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, "proof" JSONB NOT NULL, "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
