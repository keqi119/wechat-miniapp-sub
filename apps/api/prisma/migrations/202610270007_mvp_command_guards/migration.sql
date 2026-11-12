BEGIN;
-- Preserve historical records. Duplicate VINs require an explicit operator correction before migration.
ALTER TABLE "Vehicle" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Vehicle_vin_normalized_unique" ON "Vehicle" (upper(btrim("vin"))) WHERE "vin" IS NOT NULL AND btrim("vin") <> '';
ALTER TABLE "Payment" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "PaymentReconciliation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "paymentId" TEXT NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT,
 "status" TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK ("status" IN ('SUBMITTED','APPROVED','REJECTED')),
 "resolution" TEXT NOT NULL CHECK ("resolution" IN ('APPLY_TO_BILL','REFUNDED')),
 "note" TEXT NOT NULL,
 "evidenceFileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "paymentSnapshot" JSONB NOT NULL,
 "submittedBy" TEXT NOT NULL,
 "reviewedBy" TEXT,
 "reviewedAt" TIMESTAMP(3),
 "reviewNote" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PaymentReconciliation_paymentId_status_idx" ON "PaymentReconciliation"("paymentId","status");
CREATE UNIQUE INDEX "PaymentReconciliation_one_pending" ON "PaymentReconciliation"("paymentId") WHERE "status"='SUBMITTED';
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_kind_quantity_check" CHECK (("kind"='DESCRIPTION' AND "totalQuantity" IS NULL AND "unit" IS NULL) OR ("kind"='COUNT' AND "totalQuantity">0 AND length(btrim("unit"))>0));
ALTER TABLE "EntitlementReservation" ADD CONSTRAINT "EntitlementReservation_quantity_positive" CHECK ("quantity">0);
ALTER TABLE "EntitlementLedger" ADD CONSTRAINT "EntitlementLedger_quantity_positive" CHECK ("quantity">0 OR ("quantity"=0 AND "type" IN ('GRANT','EXPIRE')));

COMMIT;
