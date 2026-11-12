BEGIN;

-- Every signed quote keeps its own immutable service obligation. A replacement
-- is prepared inactive, then the two versions switch under the same order lock.
DROP INDEX "ServiceObligation_serviceStageId_stageSequence_key";
CREATE INDEX "ServiceObligation_serviceStageId_stageSequence_idx"
  ON "ServiceObligation"("serviceStageId", "stageSequence");
CREATE UNIQUE INDEX "ServiceObligation_active_serviceStageId_stageSequence_key"
  ON "ServiceObligation"("serviceStageId", "stageSequence")
  WHERE "active" = true AND "serviceStageId" IS NOT NULL;

COMMIT;
