-- Existing Refund remains the only customer refund ledger. JSON fields are bounded evidence, not balances.
ALTER TABLE "RefundObligation" ADD CONSTRAINT "RefundObligation_id_paymentId_customerId_key" UNIQUE ("id","paymentId","customerId");
ALTER TABLE "Refund" ADD COLUMN "obligationId" TEXT,
 ADD COLUMN "method" TEXT NOT NULL DEFAULT 'WECHAT_ORIGINAL',
 ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "dispatchedAt" TIMESTAMP(3), ADD COLUMN "acceptedAt" TIMESTAMP(3),
 ADD COLUMN "channelState" TEXT, ADD COLUMN "channelEvidence" JSONB, ADD COLUMN "failureCode" TEXT,
 ADD COLUMN "bankAccountCiphertext" TEXT, ADD COLUMN "bankAccount" JSONB,
 ADD COLUMN "bankExecution" JSONB, ADD COLUMN "bankReceiptKey" TEXT, ADD COLUMN "duplicateReceipt" JSONB;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_obligationId_paymentId_customerId_fkey" FOREIGN KEY ("obligationId","paymentId","customerId") REFERENCES "RefundObligation"("id","paymentId","customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "Refund_bankReceiptKey_key" ON "Refund"("bankReceiptKey");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_method_check" CHECK ("method" IN ('WECHAT_ORIGINAL','MANUAL_BANK'));
CREATE FUNCTION protect_refund_execution_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."obligationId" IS NOT NULL AND (NEW."obligationId" IS DISTINCT FROM OLD."obligationId" OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW.amount IS DISTINCT FROM OLD.amount) THEN RAISE EXCEPTION 'immutable refund obligation source'; END IF;
 IF OLD."dispatchedAt" IS NOT NULL AND NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt" THEN RAISE EXCEPTION 'immutable dispatch origin'; END IF;
 IF OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" THEN RAISE EXCEPTION 'immutable acceptance origin'; END IF;
 IF OLD."bankExecution"->>'status' = 'VERIFIED' AND (NEW."bankExecution" IS DISTINCT FROM OLD."bankExecution" OR NEW."bankAccount" IS DISTINCT FROM OLD."bankAccount" OR NEW."bankAccountCiphertext" IS DISTINCT FROM OLD."bankAccountCiphertext" OR NEW."bankReceiptKey" IS DISTINCT FROM OLD."bankReceiptKey" OR NEW."method" IS DISTINCT FROM OLD."method") THEN RAISE EXCEPTION 'immutable verified bank receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_execution_source_immutable" BEFORE UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_refund_execution_source();
