ALTER TABLE "Refund" ADD COLUMN "reconciliationId" text;
ALTER TABLE "PaymentReconciliation" ADD COLUMN "usedRefundId" text;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "PaymentReconciliation"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_usedRefundId_fkey" FOREIGN KEY ("usedRefundId") REFERENCES "Refund"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE FUNCTION protect_refund_authorization_use() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "PaymentReconciliation"; r "Refund";
BEGIN
 IF TG_TABLE_NAME='PaymentReconciliation' THEN
  IF TG_OP='DELETE' THEN
   IF OLD."usedRefundId" IS NOT NULL THEN RAISE EXCEPTION 'permanent refund authorization use'; END IF;
   RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD."usedRefundId" IS NOT NULL AND (NEW."usedRefundId" IS DISTINCT FROM OLD."usedRefundId" OR NEW.status IS DISTINCT FROM OLD.status) THEN RAISE EXCEPTION 'permanent refund authorization use'; END IF;
  IF NEW."usedRefundId" IS NOT NULL THEN
   SELECT * INTO r FROM "Refund" WHERE id=NEW."usedRefundId";
   IF NEW.resolution<>'REFUND_ONLY' OR NEW.status<>'APPROVED' OR r."paymentId" IS DISTINCT FROM NEW."paymentId" OR (OLD."usedRefundId" IS NULL AND r."reconciliationId" IS DISTINCT FROM NEW.id) THEN RAISE EXCEPTION 'invalid refund authorization use'; END IF;
  END IF;
 ELSE
  IF NEW."reconciliationId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."reconciliationId" IS DISTINCT FROM OLD."reconciliationId") THEN
   SELECT * INTO a FROM "PaymentReconciliation" WHERE id=NEW."reconciliationId";
   IF a.id IS NULL OR a.resolution<>'REFUND_ONLY' OR a.status<>'APPROVED' OR a."paymentId" IS DISTINCT FROM NEW."paymentId" OR (a."usedRefundId" IS NOT NULL AND a."usedRefundId"<>NEW.id) OR (a."paymentSnapshot"->'refundAuthorization'->>'obligationId') IS DISTINCT FROM NEW."obligationId" OR (a."paymentSnapshot"->'refundAuthorization'->>'amount') IS DISTINCT FROM NEW.amount::text THEN RAISE EXCEPTION 'invalid refund authorization binding'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PaymentReconciliation_permanent_refund_use" BEFORE INSERT OR UPDATE OR DELETE ON "PaymentReconciliation" FOR EACH ROW EXECUTE FUNCTION protect_refund_authorization_use();
CREATE TRIGGER "Refund_exact_authorization" BEFORE INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_refund_authorization_use();
