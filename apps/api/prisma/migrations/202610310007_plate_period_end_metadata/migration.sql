BEGIN;
-- A nullable SQL comparison evaluates to UNKNOWN, which CHECK accepts.
-- Require end time, actor and reason to be absent or present together.
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_end_metadata" CHECK (
 ("validUntil" IS NULL)=("endedBy" IS NULL)
 AND ("validUntil" IS NULL)=("endReason" IS NULL)
);
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_end_metadata" CHECK (
 ("validUntil" IS NULL)=("endedBy" IS NULL)
 AND ("validUntil" IS NULL)=("endReason" IS NULL)
);
COMMIT;
