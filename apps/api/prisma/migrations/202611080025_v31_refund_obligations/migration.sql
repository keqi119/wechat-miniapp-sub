CREATE TABLE "RefundObligation" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"), "ownerId" TEXT NOT NULL REFERENCES "VehicleOwner"("id"), "paymentId" TEXT NOT NULL REFERENCES "Payment"("id"),
 "sourceKey" TEXT NOT NULL UNIQUE,"sourceKind" TEXT NOT NULL,"sourceId" TEXT NOT NULL,"debtKey" TEXT NOT NULL,"amount" INTEGER NOT NULL CHECK("amount">0),"factAt" TIMESTAMP(3) NOT NULL,"amountConfirmedAt" TIMESTAMP(3) NOT NULL,"triggerAt" TIMESTAMP(3) NOT NULL,"workingDays" INTEGER NOT NULL CHECK("workingDays" IN (3,7)),"policyVersion" TEXT NOT NULL,"source" JSONB NOT NULL,"sourceHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("triggerAt"=GREATEST("factAt","amountConfirmedAt")));
CREATE INDEX "RefundObligation_orderId_idx" ON "RefundObligation"("orderId");
CREATE TABLE "RefundAmountConfirmation" (
 "id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL REFERENCES "Order"("id"),"customerId" TEXT NOT NULL REFERENCES "Customer"("id"),"sourceKey" TEXT NOT NULL,"sourceHash" TEXT NOT NULL,"source" JSONB NOT NULL,"kind" TEXT NOT NULL CHECK("kind" IN ('CUSTOMER','CLAIM','VERIFIED','REJECTED')),"confirmedAt" TIMESTAMP(3) NOT NULL,"actorId" TEXT NOT NULL,"evidence" JSONB,"predecessorId" TEXT UNIQUE REFERENCES "RefundAmountConfirmation"("id"),"idempotencyKey" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("actorId","idempotencyKey"));
CREATE INDEX "RefundAmountConfirmation_orderId_sourceKey_idx" ON "RefundAmountConfirmation"("orderId","sourceKey");
CREATE TABLE "RefundObligationDeadline" ("id" TEXT PRIMARY KEY,"obligationId" TEXT NOT NULL UNIQUE REFERENCES "RefundObligation"("id"),"dueAt" TIMESTAMP(3) NOT NULL,"calculation" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION "v31_refund_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REFUND_SOURCE_IMMUTABLE'; END $$;
CREATE TRIGGER "refund_obligation_immutable" BEFORE UPDATE OR DELETE ON "RefundObligation" FOR EACH ROW EXECUTE FUNCTION "v31_refund_immutable"();
CREATE TRIGGER "refund_amount_confirmation_immutable" BEFORE UPDATE OR DELETE ON "RefundAmountConfirmation" FOR EACH ROW EXECUTE FUNCTION "v31_refund_immutable"();
CREATE TRIGGER "refund_deadline_immutable" BEFORE UPDATE OR DELETE ON "RefundObligationDeadline" FOR EACH ROW EXECUTE FUNCTION "v31_refund_immutable"();
