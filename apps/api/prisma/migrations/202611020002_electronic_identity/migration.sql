ALTER TABLE "ESignAccount" ADD COLUMN "certValidFrom" TIMESTAMP(3), ADD COLUMN "certValidUntil" TIMESTAMP(3), ADD COLUMN "certEvidenceHash" TEXT, ADD COLUMN "certCheckedAt" TIMESTAMP(3);
ALTER TABLE "OwnerESignAccount" ADD COLUMN "certValidFrom" TIMESTAMP(3), ADD COLUMN "certValidUntil" TIMESTAMP(3), ADD COLUMN "certEvidenceHash" TEXT, ADD COLUMN "certCheckedAt" TIMESTAMP(3);
CREATE TABLE "ElectronicAutoAuthority" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "VehicleOwner"("id"),
 "providerAuthorityId" TEXT NOT NULL REFERENCES "OwnerAutoAuthority"("id"),
 "scope" JSONB NOT NULL, "scopeHash" TEXT NOT NULL CHECK("scopeHash" ~ '^[a-f0-9]{64}$'),
 "acceptedBy" TEXT NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL, "businessEvidenceHash" TEXT NOT NULL CHECK("businessEvidenceHash" ~ '^[a-f0-9]{64}$'),
 "enabled" BOOLEAN NOT NULL DEFAULT false, "revokedAt" TIMESTAMP(3), "revision" INTEGER NOT NULL DEFAULT 0,
 "channelGranteeOwnerId" TEXT, "channelGranteeName" TEXT, "channelEvidenceFileId" TEXT REFERENCES "StoredFile"("id"),
 "channelEvidenceHash" TEXT, "channelReviewedBy" TEXT, "channelReviewedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK(NOT "enabled" OR ("revokedAt" IS NULL AND "channelGranteeOwnerId" IS NOT NULL AND "channelGranteeName"='上海宁达信息科技有限公司' AND "channelEvidenceFileId" IS NOT NULL AND "channelEvidenceHash" IS NOT NULL AND "channelEvidenceHash" ~ '^[a-f0-9]{64}$' AND "channelReviewedBy" IS NOT NULL AND "channelReviewedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ElectronicAutoAuthority_providerAuthorityId_scopeHash_key" ON "ElectronicAutoAuthority"("providerAuthorityId","scopeHash");
CREATE INDEX "ElectronicAutoAuthority_ownerId_enabled_idx" ON "ElectronicAutoAuthority"("ownerId","enabled");
CREATE FUNCTION electronic_authority_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."ownerId",NEW."providerAuthorityId",NEW.scope,NEW."scopeHash",NEW."acceptedBy",NEW."acceptedAt",NEW."businessEvidenceHash") IS DISTINCT FROM ROW(OLD."ownerId",OLD."providerAuthorityId",OLD.scope,OLD."scopeHash",OLD."acceptedBy",OLD."acceptedAt",OLD."businessEvidenceHash") THEN RAISE EXCEPTION 'Electronic authority business scope is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "OwnerAutoAuthority" g WHERE g.id=NEW."providerAuthorityId" AND g."ownerId"=NEW."ownerId" AND g."requestedBy"=NEW."acceptedBy" AND g.method='PROVIDER_AUTO_GRANT') THEN RAISE EXCEPTION 'Electronic authority requires the actual provider grant'; END IF;
 IF NEW."enabled" AND NOT EXISTS(SELECT 1 FROM "StoredFile" f WHERE f.id=NEW."channelEvidenceFileId" AND f.sha256=NEW."channelEvidenceHash") THEN RAISE EXCEPTION 'Electronic channel evidence mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER electronic_authority_binding_trigger BEFORE INSERT OR UPDATE ON "ElectronicAutoAuthority" FOR EACH ROW EXECUTE FUNCTION electronic_authority_binding();
