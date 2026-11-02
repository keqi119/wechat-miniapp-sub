-- Additive storage only. Activation and authorized test-data reset are separate operations.
ALTER TABLE "ArchiveVersion" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'OFFLINE';
CREATE UNIQUE INDEX "StoredFile_electronic_digest_key" ON "StoredFile"("id","sha256");
CREATE UNIQUE INDEX "Contract_electronic_scope_key" ON "Contract"("id","orderId","customerId");
CREATE UNIQUE INDEX "PartnerAgreementVersion_electronic_owner_key" ON "PartnerAgreementVersion"("id","ownerId");

CREATE TABLE "ElectronicSigningTask" (
 "id" TEXT PRIMARY KEY, "archiveVersionId" TEXT NOT NULL UNIQUE,
 "contractId" TEXT UNIQUE, "orderId" TEXT, "customerId" TEXT, "cooperationVersionId" TEXT UNIQUE,
 "ownerId" TEXT NOT NULL, "platformSubjectId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "businessHash" TEXT NOT NULL, "sourceFileId" TEXT NOT NULL, "sourceSha256" TEXT NOT NULL,
 "finalFileId" TEXT UNIQUE, "finalSha256" TEXT, "providerContractId" TEXT NOT NULL UNIQUE,
 "snapshot" JSONB NOT NULL, "snapshotHash" TEXT NOT NULL, "approvedBy" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PREPARED', "uploadStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
 "uploadedAt" TIMESTAMP(3), "uploadEvidenceHash" TEXT,
 "filingStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED', "filedAt" TIMESTAMP(3), "filingEvidenceHash" TEXT,
 "archivedAt" TIMESTAMP(3), "withdrawnAt" TIMESTAMP(3), "retiredAt" TIMESTAMP(3),
 "revision" INTEGER NOT NULL DEFAULT 0, "processingToken" TEXT, "processingUntil" TIMESTAMP(3), "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ElectronicSigningTask_archiveVersionId_fkey" FOREIGN KEY ("archiveVersionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_contractId_orderId_customerId_fkey" FOREIGN KEY ("contractId","orderId","customerId") REFERENCES "Contract"("id","orderId","customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_cooperationVersionId_ownerId_fkey" FOREIGN KEY ("cooperationVersionId","ownerId") REFERENCES "PartnerAgreementVersion"("id","ownerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_sourceFileId_sourceSha256_fkey" FOREIGN KEY ("sourceFileId","sourceSha256") REFERENCES "StoredFile"("id","sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_finalFileId_finalSha256_fkey" FOREIGN KEY ("finalFileId","finalSha256") REFERENCES "StoredFile"("id","sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningTask_resource_check" CHECK (
  ("contractId" IS NOT NULL AND "orderId" IS NOT NULL AND "customerId" IS NOT NULL AND "cooperationVersionId" IS NULL AND "kind" NOT LIKE 'COOPERATION%') OR
  ("contractId" IS NULL AND "orderId" IS NULL AND "customerId" IS NULL AND "cooperationVersionId" IS NOT NULL AND "kind" LIKE 'COOPERATION%')),
 CONSTRAINT "ElectronicSigningTask_kind_check" CHECK ("kind" IN ('SUBSCRIPTION','DELIVERY_DELAY','VEHICLE_SWAP','RENEWAL','PRE_DELIVERY_CANCELLATION','EARLY_TERMINATION','RETURN_SETTLEMENT','RENEWAL_CANCELLATION','COOPERATION','COOPERATION_AMENDMENT','COOPERATION_TERMINATION')),
 CONSTRAINT "ElectronicSigningTask_hash_check" CHECK ("businessHash" ~ '^[a-f0-9]{64}$' AND "sourceSha256" ~ '^[a-f0-9]{64}$' AND "snapshotHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "ElectronicSigningTask_final_check" CHECK (("finalFileId" IS NULL AND "finalSha256" IS NULL) OR ("finalFileId" IS NOT NULL AND "finalSha256" IS NOT NULL AND "finalSha256" ~ '^[a-f0-9]{64}$' AND "finalFileId"<>"sourceFileId" AND "finalSha256"<>"sourceSha256")),
 CONSTRAINT "ElectronicSigningTask_status_check" CHECK ("status" IN ('PREPARED','SIGNING','SIGNED','FILING','ARCHIVING','ARCHIVED','WITHDRAWN','DECLINED','EXPIRED','RETIRED')),
 CONSTRAINT "ElectronicSigningTask_operation_status_check" CHECK ("uploadStatus" IN ('NOT_STARTED','REQUESTED','UNKNOWN','UPLOADED') AND "filingStatus" IN ('NOT_STARTED','REQUESTED','UNKNOWN','CONFIRMED')),
 CONSTRAINT "ElectronicSigningTask_archive_check" CHECK ("status"<>'ARCHIVED' OR ("uploadStatus"='UPLOADED' AND "uploadedAt" IS NOT NULL AND "filingStatus"='CONFIRMED' AND "filedAt" IS NOT NULL AND "filingEvidenceHash" IS NOT NULL AND "filingEvidenceHash" ~ '^[a-f0-9]{64}$' AND "finalFileId" IS NOT NULL AND "archivedAt" IS NOT NULL))
);
CREATE INDEX "ElectronicSigningTask_orderId_kind_idx" ON "ElectronicSigningTask"("orderId","kind");
CREATE UNIQUE INDEX "ElectronicSigningTask_contract_scope_key" ON "ElectronicSigningTask"("contractId","orderId","customerId");
CREATE UNIQUE INDEX "ElectronicSigningTask_cooperation_scope_key" ON "ElectronicSigningTask"("cooperationVersionId","ownerId");
CREATE INDEX "ElectronicSigningTask_ownerId_status_idx" ON "ElectronicSigningTask"("ownerId","status");
CREATE INDEX "ElectronicSigningTask_status_updatedAt_idx" ON "ElectronicSigningTask"("status","updatedAt");

CREATE TABLE "ElectronicSigningParty" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL, "role" TEXT NOT NULL,
 "subjectId" TEXT NOT NULL, "subjectType" TEXT NOT NULL, "providerCustomerId" TEXT NOT NULL,
 "certSerialNo" TEXT NOT NULL, "signatureId" TEXT, "identityVersion" INTEGER NOT NULL,
 "identityHash" TEXT NOT NULL, "identitySnapshot" JSONB NOT NULL, "transactionId" TEXT NOT NULL UNIQUE,
 "mode" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "authorityEvidenceHash" TEXT,
 "attemptedAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3), "queryEvidenceHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ElectronicSigningParty_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ElectronicSigningTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningParty_taskId_role_key" UNIQUE ("taskId","role"),
 CONSTRAINT "ElectronicSigningParty_task_key" UNIQUE ("id","taskId"),
 CONSTRAINT "ElectronicSigningParty_identity_check" CHECK ("role" IN ('CUSTOMER','OWNER','PLATFORM') AND "subjectType" IN ('INDIVIDUAL','ENTERPRISE') AND "identityVersion">0 AND "identityHash" ~ '^[a-f0-9]{64}$' AND ("subjectType"<>'ENTERPRISE' OR "signatureId" IS NOT NULL)),
 CONSTRAINT "ElectronicSigningParty_mode_check" CHECK ("mode" IN ('MANUAL','AUTO') AND ("mode"<>'AUTO' OR ("subjectType"='ENTERPRISE' AND "role"<>'CUSTOMER' AND "authorityEvidenceHash" IS NOT NULL AND "authorityEvidenceHash" ~ '^[a-f0-9]{64}$'))),
 CONSTRAINT "ElectronicSigningParty_status_check" CHECK ("status" IN ('PENDING','ISSUED','UNKNOWN','SIGNED','DECLINED','EXPIRED')),
 CONSTRAINT "ElectronicSigningParty_signed_check" CHECK ("status"<>'SIGNED' OR ("attemptedAt" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "verifiedAt">="attemptedAt" AND "queryEvidenceHash" IS NOT NULL AND "queryEvidenceHash" ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE "ElectronicSigningOperation" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL, "partyId" TEXT,
 "operationKey" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'REQUESTED',
 "token" TEXT NOT NULL UNIQUE, "requestHash" TEXT NOT NULL, "responseHash" TEXT,
 "requestedAt" TIMESTAMP(3) NOT NULL, "settledAt" TIMESTAMP(3), "errorCode" TEXT,
 CONSTRAINT "ElectronicSigningOperation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ElectronicSigningTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningOperation_partyId_taskId_fkey" FOREIGN KEY ("partyId","taskId") REFERENCES "ElectronicSigningParty"("id","taskId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "ElectronicSigningOperation_kind_check" CHECK ("kind" IN ('UPLOAD','SIGN','FILE','DOWNLOAD')),
 CONSTRAINT "ElectronicSigningOperation_status_check" CHECK ("status" IN ('REQUESTED','CONFIRMED','UNKNOWN','FAILED')),
 CONSTRAINT "ElectronicSigningOperation_scope_check" CHECK (("kind"='SIGN' AND "partyId" IS NOT NULL) OR ("kind"<>'SIGN' AND "partyId" IS NULL))
);
CREATE INDEX "ElectronicSigningOperation_taskId_status_idx" ON "ElectronicSigningOperation"("taskId","status");

CREATE FUNCTION ninda_electronic_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD; c RECORD; expected TEXT[]; signed_roles TEXT[];
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."archiveVersionId",NEW."contractId",NEW."orderId",NEW."customerId",NEW."cooperationVersionId",NEW."ownerId",NEW."platformSubjectId",NEW."kind",NEW."businessHash",NEW."sourceFileId",NEW."sourceSha256",NEW."providerContractId",NEW."snapshot",NEW."snapshotHash",NEW."approvedBy",NEW."approvedAt") IS DISTINCT FROM
     ROW(OLD."archiveVersionId",OLD."contractId",OLD."orderId",OLD."customerId",OLD."cooperationVersionId",OLD."ownerId",OLD."platformSubjectId",OLD."kind",OLD."businessHash",OLD."sourceFileId",OLD."sourceSha256",OLD."providerContractId",OLD."snapshot",OLD."snapshotHash",OLD."approvedBy",OLD."approvedAt") THEN
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
CREATE TRIGGER "ElectronicSigningTask_guard" BEFORE INSERT OR UPDATE ON "ElectronicSigningTask" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_task_guard();

CREATE FUNCTION ninda_electronic_party_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."taskId",NEW."role",NEW."subjectId",NEW."subjectType",NEW."providerCustomerId",NEW."certSerialNo",NEW."signatureId",NEW."identityVersion",NEW."identityHash",NEW."transactionId") IS DISTINCT FROM ROW(OLD."taskId",OLD."role",OLD."subjectId",OLD."subjectType",OLD."providerCustomerId",OLD."certSerialNo",OLD."signatureId",OLD."identityVersion",OLD."identityHash",OLD."transactionId") THEN RAISE EXCEPTION 'Electronic signer binding is immutable'; END IF;
 IF OLD."attemptedAt" IS NOT NULL AND ROW(NEW."mode",NEW."authorityEvidenceHash",NEW."attemptedAt",NEW."identitySnapshot") IS DISTINCT FROM ROW(OLD."mode",OLD."authorityEvidenceHash",OLD."attemptedAt",OLD."identitySnapshot") THEN RAISE EXCEPTION 'Dispatched electronic signer cannot be rebound'; END IF;
 IF OLD."status"='SIGNED' AND ROW(NEW."status",NEW."verifiedAt",NEW."queryEvidenceHash") IS DISTINCT FROM ROW(OLD."status",OLD."verifiedAt",OLD."queryEvidenceHash") THEN RAISE EXCEPTION 'Verified electronic signature is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ElectronicSigningParty_guard" BEFORE UPDATE ON "ElectronicSigningParty" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_party_guard();

CREATE FUNCTION ninda_electronic_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM "ElectronicSigningTask" WHERE "archiveVersionId"=OLD.id) AND ROW(NEW."archiveId",NEW."executionMode",NEW."templateId",NEW."templateVersion",NEW."sourceFileId",NEW."businessSnapshotHash",NEW."partiesSnapshot",NEW."requiredSigners",NEW."scopeSnapshot") IS DISTINCT FROM ROW(OLD."archiveId",OLD."executionMode",OLD."templateId",OLD."templateVersion",OLD."sourceFileId",OLD."businessSnapshotHash",OLD."partiesSnapshot",OLD."requiredSigners",OLD."scopeSnapshot") THEN RAISE EXCEPTION 'Prepared electronic document cannot be rewritten'; END IF;
 IF NEW."executionMode"='ELECTRONIC' THEN
  IF NEW."reviewedBy" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL OR NEW."partyChecks" IS NOT NULL OR NEW."originalCustodian" IS NOT NULL THEN RAISE EXCEPTION 'Electronic evidence cannot impersonate paper review'; END IF;
  IF NEW."status"='ARCHIVED' AND NOT EXISTS(SELECT 1 FROM "ElectronicSigningTask" WHERE "archiveVersionId"=NEW.id AND "status"='ARCHIVED') THEN RAISE EXCEPTION 'Electronic archive requires a verified signing task'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ArchiveVersion_electronic_guard" BEFORE INSERT OR UPDATE ON "ArchiveVersion" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_archive_guard();
