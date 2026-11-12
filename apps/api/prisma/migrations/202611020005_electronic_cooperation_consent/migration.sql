ALTER TABLE "ElectronicSigningParty" ADD COLUMN "documentConsent" JSONB, ADD COLUMN "documentConsentHash" TEXT;
ALTER TABLE "ElectronicSigningParty" ADD CONSTRAINT "ElectronicParty_document_consent_pair" CHECK (("documentConsent" IS NULL AND "documentConsentHash" IS NULL) OR ("documentConsent" IS NOT NULL AND "documentConsentHash" ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION ninda_electronic_cooperation_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t RECORD;
BEGIN
 IF TG_OP='UPDATE' AND OLD."documentConsentHash" IS NOT NULL AND ROW(NEW."documentConsent",NEW."documentConsentHash") IS DISTINCT FROM ROW(OLD."documentConsent",OLD."documentConsentHash") THEN RAISE EXCEPTION 'Cooperation document consent is immutable'; END IF;
 IF NEW."role"='OWNER' AND NEW."mode"='AUTO' AND NEW."attemptedAt" IS NOT NULL THEN
  SELECT "kind","sourceSha256","businessHash" INTO t FROM "ElectronicSigningTask" WHERE id=NEW."taskId";
  IF t."kind" LIKE 'COOPERATION%' AND (NEW."documentConsentHash" IS NULL OR (NEW."documentConsent"->>'taskId') IS DISTINCT FROM NEW."taskId" OR (NEW."documentConsent"->>'sourceSha256') IS DISTINCT FROM t."sourceSha256" OR (NEW."documentConsent"->>'businessHash') IS DISTINCT FROM t."businessHash" OR (NEW."documentConsent"->>'identityHash') IS DISTINCT FROM NEW."identityHash") THEN RAISE EXCEPTION 'Automatic cooperation signing needs this owner document consent'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ElectronicParty_cooperation_consent_guard" BEFORE INSERT OR UPDATE ON "ElectronicSigningParty" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_cooperation_consent_guard();
