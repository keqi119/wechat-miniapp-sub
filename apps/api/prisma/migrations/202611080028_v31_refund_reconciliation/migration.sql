ALTER TABLE "PaymentReconciliation" DROP CONSTRAINT "PaymentReconciliation_resolution_check";
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_resolution_check" CHECK ("resolution" IN ('APPLY_TO_BILL','REFUNDED','REFUND_ONLY','DUPLICATE_REFUND_CHANNEL_RECEIPT'));
-- A trusted additional cash receipt cannot be discarded because another review is pending.
DROP INDEX "PaymentReconciliation_one_pending";
CREATE UNIQUE INDEX "PaymentReconciliation_one_pending" ON "PaymentReconciliation"("paymentId") WHERE "status"='SUBMITTED' AND "resolution" <> 'DUPLICATE_REFUND_CHANNEL_RECEIPT';
CREATE UNIQUE INDEX "PaymentReconciliation_refund_conflict" ON "PaymentReconciliation"(("paymentSnapshot"->>'refundId')) WHERE "resolution"='DUPLICATE_REFUND_CHANNEL_RECEIPT';
CREATE FUNCTION protect_refund_reconciliation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.resolution IN ('REFUND_ONLY','DUPLICATE_REFUND_CHANNEL_RECEIPT') THEN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable refund reconciliation source'; END IF;
  IF NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR NEW.resolution IS DISTINCT FROM OLD.resolution OR NEW."paymentSnapshot" IS DISTINCT FROM OLD."paymentSnapshot" OR NEW."evidenceFileIds" IS DISTINCT FROM OLD."evidenceFileIds" OR NEW."submittedBy" IS DISTINCT FROM OLD."submittedBy" THEN RAISE EXCEPTION 'immutable refund reconciliation source'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PaymentReconciliation_refund_source_immutable" BEFORE UPDATE OR DELETE ON "PaymentReconciliation" FOR EACH ROW EXECUTE FUNCTION protect_refund_reconciliation_source();
