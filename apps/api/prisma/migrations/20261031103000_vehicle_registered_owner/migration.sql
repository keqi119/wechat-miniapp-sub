-- Registration-certificate owner is independent of cooperation and plate ownership.
-- Existing vehicles remain unknown until staff records the actual certificate fact.
ALTER TABLE "VehicleAssetProfile" ADD COLUMN "registeredOwnerName" TEXT;
ALTER TABLE "VehicleAssetProfile" ADD CONSTRAINT "VehicleAssetProfile_registeredOwnerName_check"
  CHECK ("registeredOwnerName" IS NULL OR
    (length("registeredOwnerName") BETWEEN 1 AND 200 AND
     "registeredOwnerName" = btrim("registeredOwnerName")));
