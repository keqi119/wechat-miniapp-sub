CREATE TABLE "SwapReceiptEvent" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "changeId" TEXT NOT NULL REFERENCES "OrderChange"("id"), "quoteId" TEXT NOT NULL REFERENCES "DelayQuote"("id"),
 "assignmentId" TEXT NOT NULL REFERENCES "VehicleAssignment"("id"), "vehicleId" TEXT NOT NULL REFERENCES "Vehicle"("id"),
 "handoverId" TEXT NOT NULL REFERENCES "Handover"("id"), "handoverRevision" INTEGER NOT NULL CHECK ("handoverRevision">0),
 "manifestHash" TEXT NOT NULL, "fieldTaskId" TEXT REFERENCES "FieldHandoverTask"("id"), "materialGeneration" INTEGER,
 "revision" INTEGER NOT NULL CHECK ("revision">0), "previousEventId" TEXT REFERENCES "SwapReceiptEvent"("id"),
 "receivedAt" TIMESTAMP(3) NOT NULL, "readingKm" INTEGER NOT NULL CHECK ("readingKm">=0), "storageLocation" TEXT NOT NULL,
 "evidenceFileIds" TEXT[] NOT NULL, "evidence" JSONB NOT NULL, "correctionReason" TEXT, "createdBy" TEXT NOT NULL REFERENCES "AdminUser"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "factHash" TEXT NOT NULL,
 UNIQUE ("changeId","revision"), UNIQUE ("createdBy","idempotencyKey")
);
CREATE INDEX "SwapReceiptEvent_changeId_createdAt_idx" ON "SwapReceiptEvent"("changeId","createdAt");
CREATE TABLE "SwapReceiptReview" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL UNIQUE REFERENCES "SwapReceiptEvent"("id"), "changeId" TEXT NOT NULL REFERENCES "OrderChange"("id"),
 "decision" TEXT NOT NULL CHECK ("decision" IN ('APPROVE','REJECT','REQUEST_EVIDENCE')),
 "disposition" TEXT NOT NULL CHECK ("disposition" IN ('APPLIED','REQUIRES_FINANCIAL_REVIEW','REJECTED','NEEDS_EVIDENCE')),
 "reason" TEXT NOT NULL, "sourceSnapshot" JSONB NOT NULL, "sourceHash" TEXT NOT NULL, "reviewedBy" TEXT NOT NULL REFERENCES "AdminUser"("id"),
 "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 UNIQUE ("reviewedBy","idempotencyKey")
);
CREATE INDEX "SwapReceiptReview_changeId_disposition_idx" ON "SwapReceiptReview"("changeId","disposition");
CREATE TABLE "SwapReceiptResponse" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL UNIQUE REFERENCES "SwapReceiptEvent"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "decision" TEXT NOT NULL CHECK ("decision" IN ('CONFIRM','OBJECT')), "reason" TEXT NOT NULL, "evidenceFileIds" TEXT[] NOT NULL,
 "factHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 UNIQUE ("customerId","idempotencyKey")
);
CREATE FUNCTION ninda_v31_swap_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Swap receipt evidence is append only'; END $$;
CREATE TRIGGER "SwapReceiptEvent_immutable" BEFORE UPDATE OR DELETE ON "SwapReceiptEvent" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE TRIGGER "SwapReceiptReview_immutable" BEFORE UPDATE OR DELETE ON "SwapReceiptReview" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE TRIGGER "SwapReceiptResponse_immutable" BEFORE UPDATE OR DELETE ON "SwapReceiptResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
