BEGIN;
-- AlterTable
ALTER TABLE "AssetPrivateFile" ADD COLUMN     "licensePlateId" TEXT;

-- CreateTable
CREATE TABLE "LicensePlate" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "plateNumber" TEXT NOT NULL,
    "normalizedNumber" TEXT NOT NULL,
    "plateType" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "LicensePlate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateOwnershipPeriod" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownershipRevision" INTEGER NOT NULL DEFAULT 0,
    "previousPeriodId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "endedBy" TEXT,
    "endReason" TEXT,
    "evidenceFileIds" TEXT[],
    "evidenceSnapshot" JSONB NOT NULL,

    CONSTRAINT "PlateOwnershipPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateVehicleBinding" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "bindingRevision" INTEGER NOT NULL DEFAULT 0,
    "previousBindingId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "endedBy" TEXT,
    "endReason" TEXT,
    "evidenceFileIds" TEXT[],
    "evidenceSnapshot" JSONB NOT NULL,

    CONSTRAINT "PlateVehicleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicensePlate_normalizedNumber_key" ON "LicensePlate"("normalizedNumber");

-- CreateIndex
CREATE INDEX "PlateOwnershipPeriod_plateId_validFrom_idx" ON "PlateOwnershipPeriod"("plateId", "validFrom");

-- CreateIndex
CREATE INDEX "PlateOwnershipPeriod_ownerId_validFrom_idx" ON "PlateOwnershipPeriod"("ownerId", "validFrom");

-- CreateIndex
CREATE INDEX "PlateVehicleBinding_plateId_validFrom_idx" ON "PlateVehicleBinding"("plateId", "validFrom");

-- CreateIndex
CREATE INDEX "PlateVehicleBinding_vehicleId_validFrom_idx" ON "PlateVehicleBinding"("vehicleId", "validFrom");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_licensePlateId_idx" ON "AssetPrivateFile"("licensePlateId");

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_licensePlateId_fkey" FOREIGN KEY ("licensePlateId") REFERENCES "LicensePlate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "LicensePlate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_previousPeriodId_fkey" FOREIGN KEY ("previousPeriodId") REFERENCES "PlateOwnershipPeriod"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "LicensePlate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_previousBindingId_fkey" FOREIGN KEY ("previousBindingId") REFERENCES "PlateVehicleBinding"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "LicensePlate" ADD CONSTRAINT "LicensePlate_values" CHECK (
 "revision">=0 AND length(trim("plateNumber")) BETWEEN 1 AND 32
 AND length(trim("normalizedNumber")) BETWEEN 1 AND 32 AND "normalizedNumber"=upper("normalizedNumber")
 AND "normalizedNumber" !~ '[[:space:][:cntrl:]]' AND length(trim("plateType")) BETWEEN 1 AND 100
 AND length("region")<=100 AND length("notes")<=5000
 AND (("status"='ACTIVE' AND "archivedAt" IS NULL) OR ("status"='ARCHIVED' AND "archivedAt" IS NOT NULL))
);
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_values" CHECK (
 "ownershipRevision">=0 AND length(trim("reason"))>0 AND "previousPeriodId" IS DISTINCT FROM "id"
 AND cardinality("evidenceFileIds") BETWEEN 1 AND 20 AND jsonb_typeof("evidenceSnapshot")='array'
 AND (("validUntil" IS NULL AND "endedBy" IS NULL AND "endReason" IS NULL)
  OR ("validUntil">="validFrom" AND "endedBy" IS NOT NULL AND "endReason" IS NOT NULL AND length(trim("endReason"))>0))
);
CREATE UNIQUE INDEX "PlateOwnershipPeriod_one_current" ON "PlateOwnershipPeriod"("plateId") WHERE "validUntil" IS NULL;
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_values" CHECK (
 "bindingRevision">=0 AND length(trim("reason"))>0 AND "previousBindingId" IS DISTINCT FROM "id"
 AND cardinality("evidenceFileIds") BETWEEN 1 AND 20 AND jsonb_typeof("evidenceSnapshot")='array'
 AND (("validUntil" IS NULL AND "endedBy" IS NULL AND "endReason" IS NULL)
  OR ("validUntil">="validFrom" AND "endedBy" IS NOT NULL AND "endReason" IS NOT NULL AND length(trim("endReason"))>0))
);
CREATE UNIQUE INDEX "PlateVehicleBinding_one_current_plate" ON "PlateVehicleBinding"("plateId") WHERE "validUntil" IS NULL;
CREATE UNIQUE INDEX "PlateVehicleBinding_one_current_vehicle" ON "PlateVehicleBinding"("vehicleId") WHERE "validUntil" IS NULL;

ALTER TABLE "AssetPrivateFile" DROP CONSTRAINT "AssetPrivateFile_scope";
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_scope" CHECK (
 "sha256" ~ '^[a-f0-9]{64}$'
 AND num_nonnulls("baasContractId","depreciationPolicyId","costEntryId","licensePlateId")=1
 AND (("kind"='BAAS' AND "baasContractId" IS NOT NULL)
  OR ("kind"='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL)
  OR ("kind"='COST' AND "costEntryId" IS NOT NULL)
  OR ("kind"='PLATE' AND "licensePlateId" IS NOT NULL))
);
COMMIT;

