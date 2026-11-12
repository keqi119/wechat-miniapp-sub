ALTER TABLE "ElectronicSigningTask" ADD COLUMN "recoveryNextCheckAt" TIMESTAMP(3), ADD COLUMN "evidenceReviewStatus" TEXT;
ALTER TABLE "ElectronicSigningParty" ADD COLUMN "evidenceCheckedAt" TIMESTAMP(3), ADD COLUMN "originalQueryEvidenceHash" TEXT;
CREATE INDEX "ElectronicSigningTask_recovery_due_idx" ON "ElectronicSigningTask"("recoveryNextCheckAt", "updatedAt") WHERE "status" IN ('WITHDRAWN','RETIRED') AND "stoppedEvidenceId" IS NULL;
