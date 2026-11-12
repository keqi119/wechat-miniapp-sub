CREATE TABLE "SwapFactSettlement" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "changeId" TEXT NOT NULL REFERENCES "OrderChange"("id"), "quoteId" TEXT NOT NULL REFERENCES "DelayQuote"("id"),
 "receiptEventId" TEXT NOT NULL REFERENCES "SwapReceiptEvent"("id"), "deliveryHandoverId" TEXT NOT NULL REFERENCES "Handover"("id"),
 "deliveryRevision" INTEGER NOT NULL CHECK ("deliveryRevision">0), "deliveryManifestHash" TEXT NOT NULL, "termsHash" TEXT NOT NULL,
 "sourceKey" TEXT NOT NULL UNIQUE, "sourceSnapshot" JSONB NOT NULL, "sourceHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL REFERENCES "AdminUser"("id"), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SwapFactSettlement_changeId_createdAt_idx" ON "SwapFactSettlement"("changeId","createdAt");
CREATE TABLE "SwapFactAmountResponse" (
 "id" TEXT PRIMARY KEY, "settlementId" TEXT NOT NULL REFERENCES "SwapFactSettlement"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "sourceHash" TEXT NOT NULL, "fundsHash" TEXT NOT NULL, "amounts" JSONB NOT NULL, "amountHash" TEXT NOT NULL,
 "decision" TEXT NOT NULL CHECK ("decision" IN ('CONFIRM','OBJECT')), "reason" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("customerId","idempotencyKey")
);
CREATE INDEX "SwapFactAmountResponse_settlementId_createdAt_idx" ON "SwapFactAmountResponse"("settlementId","createdAt");
CREATE TABLE "SwapFactFinance" (
 "id" TEXT PRIMARY KEY, "settlementId" TEXT NOT NULL UNIQUE REFERENCES "SwapFactSettlement"("id"), "quoteId" TEXT NOT NULL UNIQUE REFERENCES "DelayQuote"("id"),
 "responseId" TEXT NOT NULL UNIQUE REFERENCES "SwapFactAmountResponse"("id"), "plan" JSONB NOT NULL, "planHash" TEXT NOT NULL,
 "preparedBy" TEXT NOT NULL REFERENCES "AdminUser"("id"), "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "ServiceObligation" ADD COLUMN "swapSettlementId" TEXT REFERENCES "SwapFactSettlement"("id"), ADD COLUMN "supersedesObligationId" TEXT REFERENCES "ServiceObligation"("id");
CREATE TRIGGER "SwapFactSettlement_immutable" BEFORE UPDATE OR DELETE ON "SwapFactSettlement" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE TRIGGER "SwapFactAmountResponse_immutable" BEFORE UPDATE OR DELETE ON "SwapFactAmountResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE TRIGGER "SwapFactFinance_immutable" BEFORE UPDATE OR DELETE ON "SwapFactFinance" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
