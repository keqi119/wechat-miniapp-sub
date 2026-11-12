BEGIN;

ALTER TABLE "VehicleBaasContract"
  ALTER COLUMN "provider" DROP NOT NULL,
  ALTER COLUMN "batteryPackage" DROP NOT NULL,
  ALTER COLUMN "effectiveFrom" DROP NOT NULL,
  ALTER COLUMN "effectiveTo" DROP NOT NULL,
  ALTER COLUMN "billingCycle" DROP NOT NULL,
  ALTER COLUMN "rentalAmount" DROP NOT NULL,
  ALTER COLUMN "paymentDayOfMonth" DROP NOT NULL,
  ADD COLUMN "supplierOrderNumber" TEXT,
  ADD COLUMN "batteryBrand" TEXT,
  ADD COLUMN "lesseeName" TEXT,
  ADD COLUMN "lesseeCreditCode" TEXT,
  ADD COLUMN "lessorCollectionAccountInfo" TEXT;

ALTER TABLE "VehicleBaasContract" DROP CONSTRAINT "VehicleBaasContract_values";
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_values" CHECK (
  "revision" >= 0
  AND "status" IN ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','ARCHIVED')
  AND "currency" = 'CNY'
  AND ("billingCycle" IS NULL OR "billingCycle" IN ('MONTHLY','QUARTERLY','YEARLY'))
  AND ("rentalAmount" IS NULL OR "rentalAmount" > 0)
  AND ("paymentDayOfMonth" IS NULL OR "paymentDayOfMonth" BETWEEN 1 AND 31)
  AND "graceDays" BETWEEN 0 AND 365
  AND ("provider" IS NULL OR length(btrim("provider")) BETWEEN 1 AND 500)
  AND ("batteryPackage" IS NULL OR length(btrim("batteryPackage")) BETWEEN 1 AND 500)
  AND ("effectiveFrom" IS NULL OR (isfinite("effectiveFrom") AND "effectiveFrom" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'))
  AND ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'))
  AND ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
  AND "termsHash" ~ '^[a-f0-9]{64}$'
  AND ("previousContractId" IS NULL OR "previousContractId" <> "id")
  AND ("firstCostPeriod" IS NULL OR "firstCostPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- Incomplete source facts are allowed only for records which have never been active.
-- A null end is a valid open-ended term, including for active contracts.
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_active_terms_complete" CHECK (
  ("status" IN ('DRAFT','ARCHIVED') AND "activatedAt" IS NULL)
  OR ("provider" IS NOT NULL AND "batteryPackage" IS NOT NULL AND "effectiveFrom" IS NOT NULL
      AND "billingCycle" IS NOT NULL AND "rentalAmount" IS NOT NULL AND "paymentDayOfMonth" IS NOT NULL)
);
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_inventory_metadata" CHECK (
  ("supplierOrderNumber" IS NULL OR length(btrim("supplierOrderNumber")) BETWEEN 1 AND 500)
  AND ("batteryBrand" IS NULL OR length(btrim("batteryBrand")) BETWEEN 1 AND 200)
  AND ("lesseeName" IS NULL OR length(btrim("lesseeName")) BETWEEN 1 AND 200)
  AND ("lesseeCreditCode" IS NULL OR "lesseeCreditCode" ~ '^[A-Z0-9]{18}$')
  AND ("lessorCollectionAccountInfo" IS NULL OR length(btrim("lessorCollectionAccountInfo")) BETWEEN 1 AND 2000)
);

COMMIT;
