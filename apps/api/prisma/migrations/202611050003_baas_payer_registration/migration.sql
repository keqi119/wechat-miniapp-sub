-- An explicit BaaS payer registration references the existing partner master.
-- Existing contract/partner facts and lifecycle states remain unchanged.
ALTER TABLE "VehicleBaasContract" ADD COLUMN "payerOwnerId" TEXT;
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_payerOwnerId_fkey"
 FOREIGN KEY ("payerOwnerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "VehicleBaasContract_payerOwnerId_idx" ON "VehicleBaasContract"("payerOwnerId");

-- Battery specification is optional registration metadata. Keep the original
-- lifecycle and financial schedule completeness floor for every activated row.
-- The application validates the eight business facts and dedicated PDF together.
ALTER TABLE "VehicleBaasContract" DROP CONSTRAINT "VehicleBaasContract_active_terms_complete";
ALTER TABLE "VehicleBaasContract" ADD CONSTRAINT "VehicleBaasContract_active_terms_complete" CHECK (
 ("status" IN ('DRAFT','ARCHIVED') AND "activatedAt" IS NULL)
 OR ("provider" IS NOT NULL AND "effectiveFrom" IS NOT NULL AND "billingCycle" IS NOT NULL
     AND "rentalAmount" IS NOT NULL AND "paymentDayOfMonth" IS NOT NULL)
);
