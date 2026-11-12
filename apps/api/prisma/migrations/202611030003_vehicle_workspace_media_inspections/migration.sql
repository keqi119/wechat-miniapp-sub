CREATE TABLE "VehicleInspection" (
 "id" TEXT PRIMARY KEY, "vehicleId" TEXT NOT NULL REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0), "title" TEXT NOT NULL CHECK (length(trim("title")) BETWEEN 1 AND 200),
 "provider" TEXT, "inspectedAt" TEXT, "description" TEXT NOT NULL DEFAULT '', "imageFileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "createdBy" TEXT NOT NULL, "updatedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "VehicleInspection_content" CHECK (length("description")<=10000 AND cardinality("imageFileIds")<=20 AND (length(trim("description"))>0 OR cardinality("imageFileIds")>0)),
 CONSTRAINT "VehicleInspection_date" CHECK ("inspectedAt" IS NULL OR "inspectedAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 CONSTRAINT "VehicleInspection_provider" CHECK ("provider" IS NULL OR length(trim("provider")) BETWEEN 1 AND 200)
);
CREATE INDEX "VehicleInspection_vehicleId_createdAt_id_idx" ON "VehicleInspection"("vehicleId","createdAt","id");
CREATE TABLE "VehicleInspectionFile" (
 "fileId" TEXT PRIMARY KEY, "vehicleId" TEXT NOT NULL REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'), "uploadedBy" TEXT NOT NULL CHECK (length(trim("uploadedBy"))>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VehicleInspectionFile_file_digest_fkey" FOREIGN KEY ("fileId","sha256") REFERENCES "StoredFile"("id","sha256") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "VehicleInspectionFile_vehicleId_createdAt_idx" ON "VehicleInspectionFile"("vehicleId","createdAt");
CREATE UNIQUE INDEX "VehicleInspectionFile_fileId_sha256_key" ON "VehicleInspectionFile"("fileId","sha256");
ALTER TABLE "VehicleListing" ADD COLUMN "inspectionSnapshots" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "VehicleListing" ADD CONSTRAINT "VehicleListing_inspectionSnapshots_array" CHECK (jsonb_typeof("inspectionSnapshots")='array' AND jsonb_array_length("inspectionSnapshots")<=20);
ALTER TABLE "VehicleDocumentFile" DROP CONSTRAINT "VehicleDocumentFile_category";
ALTER TABLE "VehicleDocumentFile" ADD CONSTRAINT "VehicleDocumentFile_category" CHECK ("category" IN ('REGISTRATION','DRIVING_LICENSE','PURCHASE','PURCHASE_CONTRACT','INVOICE','INSURANCE','BAAS','PAYMENT','INSPECTION','PHOTO','OTHER'));
