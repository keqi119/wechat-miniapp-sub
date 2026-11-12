ALTER TABLE "ElectronicAutoAuthority" ADD COLUMN "basis" JSONB, ADD COLUMN "channelReview" JSONB;
ALTER TABLE "ElectronicSealGrant" DROP CONSTRAINT "ElectronicSealGrant_cooperationVersionId_key", DROP CONSTRAINT "ElectronicSealGrant_mainTaskId_key";
ALTER TABLE "ElectronicSealGrant" ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN "previousGrantId" TEXT UNIQUE REFERENCES "ElectronicSealGrant"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "ElectronicSealGrant_cooperationVersionId_version_key" ON "ElectronicSealGrant"("cooperationVersionId",version);
CREATE FUNCTION ninda_seal_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW."cooperationVersionId",NEW.version,NEW."previousGrantId",NEW."ownerId",NEW."sourceHash",NEW."sourceSnapshot",NEW."mainTaskId") IS DISTINCT FROM ROW(OLD."cooperationVersionId",OLD.version,OLD."previousGrantId",OLD."ownerId",OLD."sourceHash",OLD."sourceSnapshot",OLD."mainTaskId") OR (OLD."signedAt" IS NOT NULL AND NEW."signedAt" IS DISTINCT FROM OLD."signedAt") OR (OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt") OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")) THEN RAISE EXCEPTION 'Independent grant facts are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "ElectronicSigningTask" t WHERE t.id=NEW."mainTaskId" AND t.kind='COOPERATION' AND t."cooperationVersionId"=NEW."cooperationVersionId" AND t."ownerId"=NEW."ownerId") THEN RAISE EXCEPTION 'Independent grant main binding mismatch'; END IF;
 IF NEW."previousGrantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ElectronicSealGrant" g WHERE g.id=NEW."previousGrantId" AND g."cooperationVersionId"=NEW."cooperationVersionId" AND g.version=NEW.version-1 AND g."revokedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Independent grant predecessor mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ElectronicSealGrant_guard" BEFORE INSERT OR UPDATE ON "ElectronicSealGrant" FOR EACH ROW EXECUTE FUNCTION ninda_seal_grant_guard();
