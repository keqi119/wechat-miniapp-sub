BEGIN;
ALTER TABLE "ProductVersion"
  ADD COLUMN "configurationVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "baseFeeAmount" INTEGER,
  ADD COLUMN "mileageMonthlyFeeAmount" INTEGER,
  ADD COLUMN "swapPolicy" JSONB;
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_configuration_check" CHECK (
  "configurationVersion" IN (1,2) AND (
    "configurationVersion" = 1 OR (
      "baseFeeAmount" IS NOT NULL AND "baseFeeAmount" >= 0 AND
      "mileageMonthlyFeeAmount" IS NOT NULL AND "mileageMonthlyFeeAmount" >= 0 AND
      "monthlyFeeAmount" > 0 AND
      "baseFeeAmount"::BIGINT + "mileageMonthlyFeeAmount"::BIGINT = "monthlyFeeAmount"::BIGINT AND
      "mileagePerMonthKm" >= 0 AND "excessMileagePriceAmount" >= 0 AND
      "swapPolicy" IS NOT NULL AND jsonb_typeof("swapPolicy") = 'object'
    )
  )
);
-- Old orders and periods keep their original V1 meaning; no fabricated snapshots.
ALTER TABLE "UsageAccount" ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "UsagePeriod" ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "UsageAccount" ADD CONSTRAINT "UsageAccount_pricing_shape_check" CHECK ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object');
ALTER TABLE "UsagePeriod" ADD CONSTRAINT "UsagePeriod_pricing_shape_check" CHECK ("pricingSnapshot" IS NULL OR jsonb_typeof("pricingSnapshot") = 'object');
COMMIT;
