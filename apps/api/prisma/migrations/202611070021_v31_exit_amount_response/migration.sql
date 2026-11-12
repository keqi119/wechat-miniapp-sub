CREATE TABLE "OrderExitAmountResponse" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "terminationId" TEXT REFERENCES "OrderTermination"("id"), "sourceHash" TEXT NOT NULL, "source" JSONB NOT NULL,
 "decision" TEXT NOT NULL CHECK ("decision" IN ('CONFIRM','OBJECT')), "reason" TEXT NOT NULL,
 "confirmedAt" TIMESTAMP(3) NOT NULL, "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 UNIQUE ("customerId","idempotencyKey")
);
CREATE INDEX "OrderExitAmountResponse_order" ON "OrderExitAmountResponse" ("orderId","confirmedAt");
CREATE TRIGGER "OrderExitAmountResponse_immutable" BEFORE UPDATE OR DELETE ON "OrderExitAmountResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE FUNCTION ninda_v31_exit_amount_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id=NEW."orderId" AND "customerId"=NEW."customerId") OR
 (NEW."terminationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "OrderTermination" WHERE id=NEW."terminationId" AND "orderId"=NEW."orderId" AND "customerId"=NEW."customerId")) THEN RAISE EXCEPTION 'exit amount ownership mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderExitAmountResponse_scope" BEFORE INSERT ON "OrderExitAmountResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_exit_amount_scope();
