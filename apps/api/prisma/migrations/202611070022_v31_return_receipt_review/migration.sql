ALTER TABLE "VehicleReceiptEvent" ADD COLUMN "sourceSnapshot" JSONB, ADD COLUMN "evidenceSnapshot" JSONB, ADD COLUMN "factHash" TEXT;
CREATE TABLE "VehicleReceiptReview" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT UNIQUE NOT NULL REFERENCES "VehicleReceiptEvent"("id"), "orderId" TEXT NOT NULL REFERENCES "Order"("id"),
 "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVE','REJECT','REQUEST_EVIDENCE')), "disposition" TEXT NOT NULL CHECK ("disposition" IN ('APPLIED','REJECTED','NEEDS_EVIDENCE','REQUIRES_FINANCIAL_REVIEW')),
 "reason" TEXT NOT NULL, "source" JSONB NOT NULL, "sourceHash" TEXT NOT NULL, "reviewedBy" TEXT NOT NULL REFERENCES "AdminUser"("id"), "reviewedAt" TIMESTAMP(3) NOT NULL,
 "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, UNIQUE ("reviewedBy","idempotencyKey")
);
CREATE INDEX "VehicleReceiptReview_order" ON "VehicleReceiptReview" ("orderId","reviewedAt");
CREATE TRIGGER "VehicleReceiptReview_immutable" BEFORE UPDATE OR DELETE ON "VehicleReceiptReview" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE FUNCTION ninda_v31_return_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'isCurrent') IS DISTINCT FROM (to_jsonb(OLD)-'isCurrent') THEN RAISE EXCEPTION 'return receipt immutable facts'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "VehicleReceiptEvent_immutable" BEFORE UPDATE OR DELETE ON "VehicleReceiptEvent" FOR EACH ROW EXECUTE FUNCTION ninda_v31_return_receipt_immutable();
