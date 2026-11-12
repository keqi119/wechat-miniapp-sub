ALTER TABLE "Refund" ADD COLUMN "replacesRefundId" text;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_replacesRefundId_fkey" FOREIGN KEY ("replacesRefundId") REFERENCES "Refund"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "Refund_replacesRefundId_key" ON "Refund"("replacesRefundId");
CREATE FUNCTION protect_refund_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Refund";
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."replacesRefundId" IS NOT NULL THEN RAISE EXCEPTION 'immutable refund replacement'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW."replacesRefundId" IS DISTINCT FROM OLD."replacesRefundId" THEN RAISE EXCEPTION 'immutable refund replacement'; END IF;
 IF TG_OP='INSERT' AND NEW."replacesRefundId" IS NOT NULL THEN
  SELECT * INTO p FROM "Refund" WHERE id=NEW."replacesRefundId" FOR UPDATE;
  IF p.id IS NULL OR p.status<>'FAILED' OR p.method<>'WECHAT_ORIGINAL' OR p."bankExecution" IS NOT NULL OR p."obligationId" IS NULL OR p."channelEvidence"->>'nativeStatus' IS DISTINCT FROM 'CLOSED' OR p."channelEvidence"->>'evidenceSource' NOT IN ('QUERY','CALLBACK') OR p."channelEvidence"->>'providerRefundId' IS DISTINCT FROM p."providerRefundId" OR p."providerRefundId" IS NULL OR p."paymentId"<>NEW."paymentId" OR p."customerId"<>NEW."customerId" OR p."amount"<>NEW."amount" OR p."obligationId" IS DISTINCT FROM NEW."obligationId" OR p."preDeliveryCancellationId" IS DISTINCT FROM NEW."preDeliveryCancellationId" OR p."preDeliveryCancellationSourceHash" IS DISTINCT FROM NEW."preDeliveryCancellationSourceHash" OR p."renewalCancellationId" IS DISTINCT FROM NEW."renewalCancellationId" OR p."renewalCancellationOrderId" IS DISTINCT FROM NEW."renewalCancellationOrderId" OR p."renewalCancellationStageId" IS DISTINCT FROM NEW."renewalCancellationStageId" OR p."renewalCancellationBillId" IS DISTINCT FROM NEW."renewalCancellationBillId" THEN RAISE EXCEPTION 'invalid refund replacement source'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_replacement_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_refund_replacement();
