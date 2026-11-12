CREATE FUNCTION ninda_electronic_number_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."contractNumber" IS DISTINCT FROM OLD."contractNumber" AND EXISTS(SELECT 1 FROM "ElectronicSigningTask" WHERE "archiveVersionId"=OLD.id) THEN RAISE EXCEPTION 'Prepared electronic document number is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ArchiveVersion_electronic_number_guard" BEFORE UPDATE ON "ArchiveVersion" FOR EACH ROW EXECUTE FUNCTION ninda_electronic_number_guard();
