ALTER TABLE "Payment" ADD COLUMN "requestSnapshot" JSONB;
ALTER TABLE "Refund" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Refund_requestedBy_idempotencyKey_key" ON "Refund"("requestedBy", "idempotencyKey");
