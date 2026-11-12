CREATE TABLE "ElectronicFileQuarantine" (
 "id" TEXT PRIMARY KEY, "taskId" TEXT NOT NULL REFERENCES "ElectronicSigningTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "archiveVersionId" TEXT NOT NULL REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "providerContractId" TEXT NOT NULL, "sourceSha256" TEXT NOT NULL, "snapshotHash" TEXT NOT NULL,
 "fileId" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL,
 "rejectionCode" TEXT NOT NULL, "verificationReceiptHash" TEXT, "checkedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("taskId","sha256"), FOREIGN KEY("fileId","sha256") REFERENCES "StoredFile"("id","sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK("sha256" ~ '^[a-f0-9]{64}$' AND "sourceSha256" ~ '^[a-f0-9]{64}$' AND "snapshotHash" ~ '^[a-f0-9]{64}$'),
 CHECK("rejectionCode" ~ '^[A-Z0-9_]{1,100}$'), CHECK("verificationReceiptHash" IS NULL OR "verificationReceiptHash" ~ '^[a-f0-9]{64}$')
);
CREATE FUNCTION electronic_quarantine_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Quarantine evidence is immutable'; END IF;
 PERFORM id FROM "ElectronicSigningTask" WHERE id=NEW."taskId" FOR UPDATE;
 IF (SELECT count(*) FROM "ElectronicFileQuarantine" WHERE "taskId"=NEW."taskId") >= 3 THEN RAISE EXCEPTION 'Quarantine retention limit reached'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "ElectronicSigningTask" t JOIN "StoredFile" f ON f.id=NEW."fileId" WHERE t.id=NEW."taskId" AND t."archiveVersionId"=NEW."archiveVersionId" AND t."providerContractId"=NEW."providerContractId" AND t."sourceSha256"=NEW."sourceSha256" AND t."snapshotHash"=NEW."snapshotHash" AND f."sha256"=NEW."sha256" AND f.purpose='electronic-quarantine' AND f."customerId" IS NULL AND f.size <= 20971520) THEN RAISE EXCEPTION 'Quarantine binding mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER electronic_quarantine_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON "ElectronicFileQuarantine" FOR EACH ROW EXECUTE FUNCTION electronic_quarantine_guard();
