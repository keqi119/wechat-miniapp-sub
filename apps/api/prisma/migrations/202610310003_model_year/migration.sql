BEGIN;
ALTER TABLE "ModelDefinition"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "modelYear" INTEGER;
ALTER TABLE "ModelDefinition" ADD CONSTRAINT "ModelDefinition_modelYear_check"
  CHECK ("modelYear" IS NULL OR "modelYear" BETWEEN 1900 AND 2100);
ALTER TABLE "ModelDefinition" ADD CONSTRAINT "ModelDefinition_revision_check"
  CHECK ("revision" >= 0);
-- Registration years and names are not evidence of a model year: no backfill.
COMMIT;
