ALTER TABLE "PartnerAgreementVersion" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'OFFLINE', ADD COLUMN "electronicTerms" JSONB;
ALTER TABLE "PartnerAgreementVersion" ADD CONSTRAINT "ElectronicCooperation_terms" CHECK ("executionMode" <> 'ELECTRONIC' OR ("electronicTerms" IS NOT NULL AND jsonb_typeof("electronicTerms")='object' AND "fileIds"=ARRAY[]::TEXT[]));

CREATE FUNCTION ninda_electronic_cooperation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD."executionMode"='ELECTRONIC' AND ROW(NEW."agreementId",NEW."ownerId",NEW."version",NEW."executionMode",NEW."electronicTerms",NEW."title",NEW."referenceNumber",NEW."fileIds",NEW."vehicleIds",NEW."partnerRateBps",NEW."validFrom",NEW."validUntil",NEW."notes",NEW."contentHash") IS DISTINCT FROM ROW(OLD."agreementId",OLD."ownerId",OLD."version",OLD."executionMode",OLD."electronicTerms",OLD."title",OLD."referenceNumber",OLD."fileIds",OLD."vehicleIds",OLD."partnerRateBps",OLD."validFrom",OLD."validUntil",OLD."notes",OLD."contentHash") THEN RAISE EXCEPTION 'Electronic cooperation terms are immutable; create a new version'; END IF;
 IF NEW."executionMode"='ELECTRONIC' AND NEW."status" IN ('ACTIVE','TERMINATED') AND NOT EXISTS(SELECT 1 FROM "ElectronicSigningTask" t JOIN "ArchiveVersion" v ON v.id=t."archiveVersionId" WHERE t."cooperationVersionId"=NEW.id AND t."ownerId"=NEW."ownerId" AND t."businessHash"=NEW."contentHash" AND t.status='ARCHIVED' AND v.status='ARCHIVED' AND v."invalidatedAt" IS NULL AND t."retiredAt" IS NULL) THEN RAISE EXCEPTION 'Electronic cooperation requires its verified archive'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PartnerAgreementVersion_electronic_guard" BEFORE INSERT OR UPDATE ON "PartnerAgreementVersion" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_cooperation_guard();
