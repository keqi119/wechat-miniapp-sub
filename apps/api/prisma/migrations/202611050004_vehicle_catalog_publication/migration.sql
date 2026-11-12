-- Vehicle activation and individual plan publication do not publish a catalog item.
ALTER TABLE "Vehicle"
  ADD COLUMN "catalogPublished" BOOLEAN NOT NULL DEFAULT false;

-- Preserve only the previously configured, structurally bound public catalog intent.
-- Runtime source/hash validation remains authoritative for actual App visibility.
-- Only the new setting is initialized; old status/revision/updatedAt remain intact.
UPDATE "Vehicle" AS v
SET "catalogPublished" = true
WHERE v.status = 'PUBLISHED'
  AND EXISTS (
    SELECT 1
    FROM "VehicleListing" AS l
    JOIN "SubscriptionPlan" AS p
      ON p.id = l."subscriptionPlanId"
      AND p."vehicleId" = v.id
      AND p."productVersionId" = l."productVersionId"
    JOIN "ProductVersion" AS pv ON pv.id = l."productVersionId"
    WHERE l."vehicleId" = v.id
      AND l.status = 'PUBLISHED'
      AND l.visible = true
      AND p.active = true
      AND pv.status = 'PUBLISHED'
  );
