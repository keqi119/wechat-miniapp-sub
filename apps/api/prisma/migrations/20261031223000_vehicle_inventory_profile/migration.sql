BEGIN;

ALTER TABLE "VehicleAssetProfile"
  ADD COLUMN "engineNumber" TEXT,
  ADD COLUMN "bodyColor" TEXT,
  ADD COLUMN "initialMileageKm" INTEGER,
  ADD COLUMN "purchaseAmount" INTEGER,
  ADD COLUMN "purchaserName" TEXT,
  ADD COLUMN "purchaseDate" DATE,
  ADD COLUMN "nextInspectionDate" DATE;

ALTER TABLE "VehicleAssetProfile"
  ADD CONSTRAINT "VehicleAssetProfile_engineNumber_valid" CHECK ("engineNumber" IS NULL OR (length(btrim("engineNumber")) BETWEEN 1 AND 200)),
  ADD CONSTRAINT "VehicleAssetProfile_bodyColor_valid" CHECK ("bodyColor" IS NULL OR (length(btrim("bodyColor")) BETWEEN 1 AND 100)),
  ADD CONSTRAINT "VehicleAssetProfile_purchaserName_valid" CHECK ("purchaserName" IS NULL OR (length(btrim("purchaserName")) BETWEEN 1 AND 200)),
  ADD CONSTRAINT "VehicleAssetProfile_initialMileageKm_nonnegative" CHECK ("initialMileageKm" IS NULL OR "initialMileageKm" >= 0),
  ADD CONSTRAINT "VehicleAssetProfile_purchaseAmount_nonnegative" CHECK ("purchaseAmount" IS NULL OR "purchaseAmount" >= 0);

COMMIT;
