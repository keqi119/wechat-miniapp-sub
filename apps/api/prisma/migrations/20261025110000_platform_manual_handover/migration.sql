ALTER TABLE "FadadaTask"
 ADD COLUMN "platformSigningMode" TEXT NOT NULL DEFAULT 'AUTO',
 ADD COLUMN "platformManualRequestedAt" TIMESTAMP(3),
 ADD COLUMN "platformManualSignerId" TEXT,
 ADD COLUMN "platformManualOwnerId" TEXT,
 ADD COLUMN "platformManualEvidence" JSONB;
ALTER TABLE "FadadaTask" ADD CONSTRAINT "FadadaTask_platformSigningMode_check"
 CHECK ("platformSigningMode" = 'AUTO' OR ("platformSigningMode" = 'MANUAL' AND "kind" = 'HANDOVER'));
