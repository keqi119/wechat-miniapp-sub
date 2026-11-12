CREATE TABLE "AddonProduct" (
 "id" TEXT PRIMARY KEY,"kind" TEXT NOT NULL CHECK ("kind" IN ('MILEAGE_PACK','SWAP_CREDIT')),"name" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision">=0),"createdBy" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AddonProductVersion" (
 "id" TEXT PRIMARY KEY,"productId" TEXT NOT NULL REFERENCES "AddonProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('MILEAGE_PACK','SWAP_CREDIT')),"name" TEXT NOT NULL,"version" INTEGER NOT NULL CHECK ("version">0),
 "revision" INTEGER NOT NULL DEFAULT 0,"status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','PUBLISHED','SUSPENDED','RETIRED')),
 "scopePrices" JSONB NOT NULL,"sourceHash" TEXT,"createdBy" TEXT NOT NULL,"publishedBy" TEXT,"publishedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("status"='DRAFT' OR ("sourceHash" IS NOT NULL AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "publishedBy" IS NOT NULL AND "publishedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "AddonProductVersion_productId_version_key" ON "AddonProductVersion"("productId","version");
CREATE INDEX "AddonProductVersion_kind_status_idx" ON "AddonProductVersion"("kind","status");
ALTER TABLE "MileagePurchase" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "MileagePurchase" ADD COLUMN "ruleVersion" TEXT NOT NULL DEFAULT 'MILEAGE_PACK_V1',
 ADD COLUMN "applicablePeriodId" TEXT REFERENCES "UsagePeriod"("id"),
 ADD COLUMN "serviceStageId" TEXT REFERENCES "OrderServiceStage"("id"),
 ADD COLUMN "assignmentId" TEXT REFERENCES "VehicleAssignment"("id"),
 ADD COLUMN "modelDefinitionId" TEXT REFERENCES "ModelDefinition"("id"),
 ADD COLUMN "addonVersionId" TEXT REFERENCES "AddonProductVersion"("id"),
 ADD COLUMN "sourceHash" TEXT,ADD COLUMN "pricingSnapshot" JSONB,ADD COLUMN "expiresAt" TIMESTAMP(3),
 ADD COLUMN "sourcePaymentId" TEXT REFERENCES "Payment"("id");
CREATE UNIQUE INDEX "MileagePurchase_sourcePaymentId_key" ON "MileagePurchase"("sourcePaymentId");
CREATE INDEX "MileagePurchase_applicablePeriodId_idx" ON "MileagePurchase"("applicablePeriodId");
ALTER TABLE "MileagePurchase" ADD CONSTRAINT "MileagePurchase_rule_source" CHECK (
 ("ruleVersion"='MILEAGE_PACK_V1' AND "productId" IS NOT NULL AND "applicablePeriodId" IS NULL AND "addonVersionId" IS NULL)
 OR ("ruleVersion"='MILEAGE_PACK_V2' AND "productId" IS NULL AND "applicablePeriodId" IS NOT NULL AND "addonVersionId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "modelDefinitionId" IS NOT NULL AND "sourceHash" IS NOT NULL AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "pricingSnapshot" IS NOT NULL AND "expiresAt" IS NOT NULL)
);
-- Keep both historical price sources exact; independent V3 adds its own strict branch.
ALTER TABLE "SwapCreditPurchase" DROP CONSTRAINT "SwapCreditPurchase_amount_check";
ALTER TABLE "SwapCreditPurchase" ADD CONSTRAINT "SwapCreditPurchase_amount_check" CHECK (
 ("pricingSnapshot" IS NULL AND "amount"=80000)
 OR ("pricingSnapshot" IS NOT NULL AND "amount">0 AND COALESCE(
  jsonb_typeof("pricingSnapshot")='object'
  AND "pricingSnapshot"->>'policyVersion'='SWAP_TERM_V2'
  AND "pricingSnapshot"->>'sourceHash' ~ '^[a-f0-9]{64}$'
  AND "pricingSnapshot"->'quantity'='1'::JSONB
  AND "pricingSnapshot"->>'currency'='CNY'
  AND jsonb_typeof("pricingSnapshot"->'amount')='number'
  AND "pricingSnapshot"->>'amount' ~ '^[0-9]+$'
  AND ("pricingSnapshot"->>'amount')::NUMERIC="amount"::NUMERIC,false))
 OR ("pricingSnapshot" IS NOT NULL AND "amount">0 AND COALESCE(
  jsonb_typeof("pricingSnapshot")='object'
  AND "pricingSnapshot"->'version'='3'::JSONB
  AND "pricingSnapshot"->>'sku'='SWAP_CREDIT_ADDON_1'
  AND "pricingSnapshot"->>'policyVersion'='SWAP_ADDON_V1'
  AND "pricingSnapshot"->>'sourceHash' ~ '^[a-f0-9]{64}$'
  AND length("pricingSnapshot"->>'productId')>0
  AND length("pricingSnapshot"->>'versionId')>0
  AND length("pricingSnapshot"->>'targetModelDefinitionId')>0
  AND length("pricingSnapshot"->>'targetBrand')>0
  AND "pricingSnapshot"->'quantity'='1'::JSONB
  AND "pricingSnapshot"->>'currency'='CNY'
  AND jsonb_typeof("pricingSnapshot"->'amount')='number'
  AND "pricingSnapshot"->>'amount' ~ '^[0-9]+$'
  AND ("pricingSnapshot"->>'amount')::NUMERIC="amount"::NUMERIC
  AND "pricingSnapshot"->'quote'->'quantity'='1'::JSONB
  AND "pricingSnapshot"->'quote'->>'currency'='CNY'
  AND "pricingSnapshot"->'quote'->>'amount' ~ '^[0-9]+$'
  AND ("pricingSnapshot"->'quote'->>'amount')::NUMERIC="amount"::NUMERIC
  AND "pricingSnapshot"->'source'->>'kind'='SWAP_CREDIT'
  AND jsonb_typeof("pricingSnapshot"->'source'->'scopePrices')='array'
  AND "pricingSnapshot"->'serviceSource'->>'orderId'="orderId"
  AND "pricingSnapshot"->'serviceSource'->>'customerId'="customerId"
  AND "pricingSnapshot"->>'serviceSourceHash' ~ '^[a-f0-9]{64}$'
 ,false))
);
