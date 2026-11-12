-- The independent archive needs this key on production before any electronic-signing migrations exist.
CREATE UNIQUE INDEX "StoredFile_vehicle_document_digest_key" ON "StoredFile"("id","sha256");
