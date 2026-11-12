-- Preserve existing saleable plans as explicitly identified legacy goods.
-- No new vehicle/product combinations are inferred from product scopes.
BEGIN;
CREATE TABLE "VehicleListing" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "productVersionId" TEXT NOT NULL,
  "subscriptionPlanId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'EXPLICIT',
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "productSourceHash" TEXT,
  "snapshot" JSONB,
  "createdBy" TEXT NOT NULL,
  "publishedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "withdrawnBy" TEXT,
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleListing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VehicleListing_state_check" CHECK ("status" IN ('DRAFT','PUBLISHED','WITHDRAWN')),
  CONSTRAINT "VehicleListing_source_check" CHECK ("source" IN ('EXPLICIT','LEGACY_MIGRATED')),
  CONSTRAINT "VehicleListing_revision_check" CHECK ("revision" >= 0 AND "sortOrder" >= 0),
  CONSTRAINT "VehicleListing_explicit_snapshot_check" CHECK ("source" = 'LEGACY_MIGRATED' OR ("productSourceHash" IS NOT NULL AND "snapshot" IS NOT NULL))
);

CREATE UNIQUE INDEX "VehicleListing_subscriptionPlanId_key" ON "VehicleListing"("subscriptionPlanId");
CREATE UNIQUE INDEX "VehicleListing_vehicleId_productVersionId_key" ON "VehicleListing"("vehicleId","productVersionId");
CREATE INDEX "VehicleListing_status_visible_sortOrder_idx" ON "VehicleListing"("status","visible","sortOrder");
ALTER TABLE "VehicleListing" ADD CONSTRAINT "VehicleListing_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleListing" ADD CONSTRAINT "VehicleListing_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleListing" ADD CONSTRAINT "VehicleListing_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A duplicate existing active pair must be reviewed; do not pick one silently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SubscriptionPlan" p JOIN "ProductVersion" v ON v."id" = p."productVersionId"
    WHERE p."active" = true AND v."status" = 'PUBLISHED'
    GROUP BY p."vehicleId",p."productVersionId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'EXPLICIT_GOODS_DUPLICATE_ACTIVE_PAIR: reconcile duplicate active plans before migration';
  END IF;
END $$;

INSERT INTO "VehicleListing" ("id","vehicleId","productVersionId","subscriptionPlanId","status","source","createdBy","createdAt","updatedAt")
SELECT 'legacy-listing-' || p."id",p."vehicleId",p."productVersionId",p."id",'PUBLISHED','LEGACY_MIGRATED','SYSTEM_MIGRATION',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "SubscriptionPlan" p JOIN "ProductVersion" v ON v."id" = p."productVersionId"
WHERE p."active" = true AND v."status" = 'PUBLISHED';
COMMIT;
