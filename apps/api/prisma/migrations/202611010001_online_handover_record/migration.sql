ALTER TABLE "Handover" ADD COLUMN "confirmationMode" TEXT NOT NULL DEFAULT 'SEPARATE_DOCUMENT';
ALTER TABLE "Handover" ADD COLUMN "onlineRecordSnapshot" JSONB;
ALTER TABLE "Handover" ADD COLUMN "onlineConfirmation" JSONB;
