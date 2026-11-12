ALTER TABLE "ArchiveVersion" ADD COLUMN "createdBy" TEXT,
ADD COLUMN "editorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ArchiveFeedback" ADD COLUMN "source" TEXT,
ADD COLUMN "recordedBy" TEXT;
