ALTER TABLE "Vehicle" ADD COLUMN "documentRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_documentRevision_nonnegative" CHECK ("documentRevision" >= 0);

CREATE TABLE "VehicleDocumentFile" (
 "fileId" TEXT NOT NULL,
 "vehicleId" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "sourceRelativePath" TEXT NOT NULL,
 "sha256" TEXT NOT NULL,
 "uploadedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VehicleDocumentFile_pkey" PRIMARY KEY ("fileId"),
 CONSTRAINT "VehicleDocumentFile_category" CHECK ("category" IN ('REGISTRATION','DRIVING_LICENSE','PURCHASE','INSURANCE','BAAS','PAYMENT','INSPECTION','PHOTO','OTHER')),
 CONSTRAINT "VehicleDocumentFile_digest" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "VehicleDocumentFile_source_path" CHECK (
  length("sourceRelativePath") BETWEEN 1 AND 1000
  AND "sourceRelativePath" !~ '(^/|(^|/)\.\.?(/|$)|[[:cntrl:]:\\])'
  AND "sourceRelativePath" !~ '//'
  AND "sourceRelativePath" !~ '/$'
 ),
 CONSTRAINT "VehicleDocumentFile_uploader" CHECK (length(trim("uploadedBy")) > 0),
 CONSTRAINT "VehicleDocumentFile_file_digest_fkey" FOREIGN KEY ("fileId","sha256") REFERENCES "StoredFile"("id","sha256") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "VehicleDocumentFile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VehicleDocumentFile_vehicleId_sourceRelativePath_key" ON "VehicleDocumentFile"("vehicleId","sourceRelativePath");
CREATE INDEX "VehicleDocumentFile_vehicleId_createdAt_idx" ON "VehicleDocumentFile"("vehicleId","createdAt");
