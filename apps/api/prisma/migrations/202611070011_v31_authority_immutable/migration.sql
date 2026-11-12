CREATE FUNCTION ninda_v31_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.basis IS NOT NULL AND ROW(NEW."ownerId",NEW."providerAuthorityId",NEW.scope,NEW."scopeHash",NEW.basis,NEW."acceptedBy",NEW."acceptedAt",NEW."businessEvidenceHash") IS DISTINCT FROM ROW(OLD."ownerId",OLD."providerAuthorityId",OLD.scope,OLD."scopeHash",OLD.basis,OLD."acceptedBy",OLD."acceptedAt",OLD."businessEvidenceHash") THEN RAISE EXCEPTION 'Confirmed enterprise authority evidence is immutable'; END IF;
 IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN RAISE EXCEPTION 'Authority revocation is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ElectronicAutoAuthority_v31_guard" BEFORE UPDATE ON "ElectronicAutoAuthority" FOR EACH ROW EXECUTE FUNCTION ninda_v31_authority_guard();
