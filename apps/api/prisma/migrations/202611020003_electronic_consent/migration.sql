ALTER TABLE "ElectronicSigningParty" ADD COLUMN "manualConsent" JSONB, ADD COLUMN "manualConsentHash" TEXT;
CREATE FUNCTION electronic_manual_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."attemptedAt" IS NOT NULL AND ROW(NEW."manualConsent",NEW."manualConsentHash") IS DISTINCT FROM ROW(OLD."manualConsent",OLD."manualConsentHash") THEN RAISE EXCEPTION 'Issued signing consent is immutable'; END IF;
 IF NEW.mode='MANUAL' AND NEW."attemptedAt" IS NOT NULL AND (NEW."manualConsent" IS NULL OR NEW."manualConsentHash" IS NULL OR NEW."manualConsentHash" !~ '^[a-f0-9]{64}$' OR NEW."manualConsent"->>'role' IS DISTINCT FROM NEW.role OR NEW."manualConsent"->>'taskId' IS DISTINCT FROM NEW."taskId" OR NEW."manualConsent"->>'actorId' IS NULL OR NEW."manualConsent"->>'sourceSha256' IS DISTINCT FROM (SELECT "sourceSha256" FROM "ElectronicSigningTask" WHERE id=NEW."taskId")) THEN RAISE EXCEPTION 'Personal signing consent is required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER electronic_manual_consent_guard_trigger BEFORE INSERT OR UPDATE ON "ElectronicSigningParty" FOR EACH ROW EXECUTE FUNCTION electronic_manual_consent_guard();
