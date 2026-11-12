-- Add nullable versioned facts only. Do not rewrite historical products, orders or snapshots.
ALTER TABLE "ProductVersion" ADD COLUMN "minimumTermMonths" INTEGER;
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_minimumTermMonths_check"
 CHECK ("minimumTermMonths" IS NULL OR ("minimumTermMonths" BETWEEN 3 AND 120 AND "months" >= "minimumTermMonths"));
ALTER TABLE "Order" ADD COLUMN "serviceAnchor" JSONB;
ALTER TABLE "OrderServiceStage" ADD COLUMN "serviceAnchor" JSONB;
