CREATE TABLE "ElectronicSealGrant" (
 "id" TEXT PRIMARY KEY,"cooperationVersionId" TEXT NOT NULL UNIQUE,"ownerId" TEXT NOT NULL,"sourceHash" TEXT NOT NULL,"sourceSnapshot" JSONB NOT NULL,"mainTaskId" TEXT NOT NULL UNIQUE,
 "signedAt" TIMESTAMP(3),"archivedAt" TIMESTAMP(3),"revokedAt" TIMESTAMP(3),"revision" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("cooperationVersionId","ownerId") REFERENCES "PartnerAgreementVersion"("id","ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("mainTaskId") REFERENCES "ElectronicSigningTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK ("sourceHash" ~ '^[a-f0-9]{64}$')
);
ALTER TABLE "ElectronicSigningTask" ADD COLUMN "sealGrantId" TEXT UNIQUE REFERENCES "ElectronicSealGrant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ElectronicSigningTask" DROP CONSTRAINT "ElectronicSigningTask_resource_check";
ALTER TABLE "ElectronicSigningTask" DROP CONSTRAINT "ElectronicSigningTask_kind_check";
ALTER TABLE "ElectronicSigningTask" ADD CONSTRAINT "ElectronicSigningTask_kind_check" CHECK (kind IN ('SUBSCRIPTION','DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION','RETURN_SETTLEMENT','RENEWAL_CANCELLATION','COOPERATION','COOPERATION_GRANT','COOPERATION_AMENDMENT','COOPERATION_TERMINATION'));
ALTER TABLE "ElectronicSigningTask" ADD CONSTRAINT "ElectronicSigningTask_resource_check" CHECK (
 ("contractId" IS NOT NULL AND "orderId" IS NOT NULL AND "customerId" IS NOT NULL AND "cooperationVersionId" IS NULL AND "sealGrantId" IS NULL AND kind NOT LIKE 'COOPERATION%') OR
 ("contractId" IS NULL AND "orderId" IS NULL AND "customerId" IS NULL AND (("cooperationVersionId" IS NOT NULL AND "sealGrantId" IS NULL AND kind IN ('COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION')) OR ("cooperationVersionId" IS NULL AND "sealGrantId" IS NOT NULL AND kind='COOPERATION_GRANT'))));
CREATE OR REPLACE FUNCTION ninda_electronic_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD; c RECORD; expected TEXT[]; signed_roles TEXT[];
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."sealGrantId",NEW."archiveVersionId",NEW."contractId",NEW."orderId",NEW."customerId",NEW."cooperationVersionId",NEW."ownerId",NEW."platformSubjectId",NEW."kind",NEW."businessHash",NEW."sourceFileId",NEW."sourceSha256",NEW."providerContractId",NEW."snapshot",NEW."snapshotHash",NEW."approvedBy",NEW."approvedAt") IS DISTINCT FROM
     ROW(OLD."sealGrantId",OLD."archiveVersionId",OLD."contractId",OLD."orderId",OLD."customerId",OLD."cooperationVersionId",OLD."ownerId",OLD."platformSubjectId",OLD."kind",OLD."businessHash",OLD."sourceFileId",OLD."sourceSha256",OLD."providerContractId",OLD."snapshot",OLD."snapshotHash",OLD."approvedBy",OLD."approvedAt") THEN
   RAISE EXCEPTION 'Electronic signing source binding is immutable';
  END IF;
  IF OLD."finalFileId" IS NOT NULL AND ROW(NEW."finalFileId",NEW."finalSha256") IS DISTINCT FROM ROW(OLD."finalFileId",OLD."finalSha256") THEN RAISE EXCEPTION 'Electronic signed artifact is immutable'; END IF;
  IF (OLD."uploadedAt" IS NOT NULL AND NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt") OR (OLD."filedAt" IS NOT NULL AND NEW."filedAt" IS DISTINCT FROM OLD."filedAt") OR (OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt") THEN RAISE EXCEPTION 'Electronic verified timestamps are immutable'; END IF;
 ELSE
  SELECT av."executionMode",av."sourceFileId",av."businessSnapshotHash",da."orderId",da."ownerId",da."subjectId",da."subjectType" INTO v FROM "ArchiveVersion" av JOIN "DocumentArchive" da ON da.id=av."archiveId" WHERE av.id=NEW."archiveVersionId";
  IF NOT FOUND OR v."executionMode"<>'ELECTRONIC' OR v."sourceFileId" IS DISTINCT FROM NEW."sourceFileId" OR v."businessSnapshotHash" IS DISTINCT FROM NEW."businessHash" OR v."ownerId" IS DISTINCT FROM NEW."ownerId" THEN RAISE EXCEPTION 'Electronic archive reference mismatch'; END IF;
  IF NEW."contractId" IS NOT NULL THEN
   SELECT "executionMode","orderId","customerId","documentHash","sourceFileId" INTO c FROM "Contract" WHERE id=NEW."contractId";
   IF NOT FOUND OR c."executionMode"<>'ELECTRONIC' OR c."orderId" IS DISTINCT FROM NEW."orderId" OR c."customerId" IS DISTINCT FROM NEW."customerId" OR c."documentHash" IS DISTINCT FROM NEW."businessHash" OR c."sourceFileId" IS DISTINCT FROM NEW."sourceFileId" OR v."orderId" IS DISTINCT FROM NEW."orderId" THEN RAISE EXCEPTION 'Electronic contract scope mismatch'; END IF;
  ELSIF NEW."sealGrantId" IS NOT NULL THEN
   SELECT g."ownerId",g.id,g."sourceHash",t."businessHash" INTO c FROM "ElectronicSealGrant" g JOIN "ElectronicSigningTask" t ON t.id=g."mainTaskId" WHERE g.id=NEW."sealGrantId";
   IF NOT FOUND OR c."ownerId" IS DISTINCT FROM NEW."ownerId" OR c."businessHash" IS DISTINCT FROM NEW."businessHash" OR v."subjectType"<>'ELECTRONIC_SEAL_GRANT' OR v."subjectId" IS DISTINCT FROM c.id OR v."orderId" IS NOT NULL THEN RAISE EXCEPTION 'Electronic grant scope mismatch'; END IF;
  ELSE
   SELECT "ownerId","agreementId","contentHash" INTO c FROM "PartnerAgreementVersion" WHERE id=NEW."cooperationVersionId";
   IF NOT FOUND OR c."ownerId" IS DISTINCT FROM NEW."ownerId" OR c."contentHash" IS DISTINCT FROM NEW."businessHash" OR v."subjectType"<>'PARTNER_AGREEMENT' OR v."subjectId" IS DISTINCT FROM c."agreementId" OR v."orderId" IS NOT NULL THEN RAISE EXCEPTION 'Electronic cooperation scope mismatch'; END IF;
  END IF;
 END IF;
 IF NEW."status"='ARCHIVED' THEN
  expected:=CASE WHEN NEW."kind" LIKE 'COOPERATION%' THEN ARRAY['OWNER','PLATFORM'] ELSE ARRAY['CUSTOMER','OWNER','PLATFORM'] END;
  SELECT array_agg("role" ORDER BY "role") INTO signed_roles FROM "ElectronicSigningParty" WHERE "taskId"=NEW.id AND "status"='SIGNED';
  IF signed_roles IS DISTINCT FROM expected OR (SELECT count(*) FROM "ElectronicSigningParty" WHERE "taskId"=NEW.id)<>cardinality(expected) THEN RAISE EXCEPTION 'Every required electronic party must sign before archive'; END IF;
 END IF;
 RETURN NEW;
END $$;
