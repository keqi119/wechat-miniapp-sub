ALTER TABLE "PartnerCooperationDraft" ADD COLUMN "editorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PartnerCooperationSubmission" ADD COLUMN "editorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PartnerPortalCandidate" ADD COLUMN "editedByIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
