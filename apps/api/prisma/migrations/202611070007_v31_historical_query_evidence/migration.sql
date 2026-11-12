ALTER TABLE "ElectronicSigningParty" ADD COLUMN "enrichmentQueryEvidenceHash" TEXT;
CREATE FUNCTION electronic_actual_time_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."providerSignedAt" IS NOT NULL AND NEW."providerSignedAt" IS DISTINCT FROM OLD."providerSignedAt") OR
 (OLD."providerSignedAtRaw" IS NOT NULL AND NEW."providerSignedAtRaw" IS DISTINCT FROM OLD."providerSignedAtRaw") OR
 (OLD."providerSignedAtPrecisionMs" IS NOT NULL AND NEW."providerSignedAtPrecisionMs" IS DISTINCT FROM OLD."providerSignedAtPrecisionMs") OR
 (OLD."originalQueryEvidenceHash" IS NOT NULL AND NEW."originalQueryEvidenceHash" IS DISTINCT FROM OLD."originalQueryEvidenceHash") OR
 (OLD."enrichmentQueryEvidenceHash" IS NOT NULL AND NEW."enrichmentQueryEvidenceHash" IS DISTINCT FROM OLD."enrichmentQueryEvidenceHash") THEN RAISE EXCEPTION 'Actual signing evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER electronic_actual_time_immutable_trigger BEFORE UPDATE ON "ElectronicSigningParty" FOR EACH ROW EXECUTE FUNCTION electronic_actual_time_immutable();
