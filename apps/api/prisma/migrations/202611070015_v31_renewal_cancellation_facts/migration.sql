ALTER TABLE "OrderRenewalCancellation" ADD COLUMN "lifecycleState" TEXT CHECK ("lifecycleState" IN ('CLAIM','NEED_MORE','REJECTED','VERIFIED','CORRECTED','FINANCE_CLOSED'));
CREATE TABLE "RenewalCancellationFact" (
 "id" TEXT PRIMARY KEY, "cancellationId" TEXT NOT NULL REFERENCES "OrderRenewalCancellation"("id"),
 "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "changeId" TEXT NOT NULL REFERENCES "OrderChange"("id"), "quoteId" TEXT NOT NULL REFERENCES "DelayQuote"("id"),
 "stageId" TEXT REFERENCES "OrderServiceStage"("id"), "contractId" TEXT NOT NULL REFERENCES "Contract"("id"),
 "archiveVersionId" TEXT NOT NULL REFERENCES "ArchiveVersion"("id"),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('CLAIM','NEED_MORE','REJECTED','VERIFIED','CORRECTED','DEPENDENCY_DISPOSITION','FINANCE_CLOSED')),
 "revision" INTEGER NOT NULL CHECK ("revision">0), "predecessorId" TEXT UNIQUE REFERENCES "RenewalCancellationFact"("id"),
 "predecessorHash" TEXT, "sourceHash" TEXT NOT NULL CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
 "payload" JSONB NOT NULL, "factHash" TEXT NOT NULL CHECK ("factHash" ~ '^[a-f0-9]{64}$'),
 "occurredAt" TIMESTAMP(3) NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "AdminUser"("id"), UNIQUE ("cancellationId","revision"),
 CHECK ("occurredAt"<="recordedAt"), CHECK (("revision"=1 AND "predecessorId" IS NULL AND "predecessorHash" IS NULL) OR ("revision">1 AND "predecessorId" IS NOT NULL AND "predecessorHash" ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX "RenewalCancellationFact_changeId_kind_idx" ON "RenewalCancellationFact"("changeId","kind");
CREATE FUNCTION ninda_v31_renewal_fact_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "OrderRenewalCancellation"; p "RenewalCancellationFact";
BEGIN
 SELECT * INTO c FROM "OrderRenewalCancellation" WHERE "id"=NEW."cancellationId";
 IF (NEW."orderId",NEW."customerId",NEW."changeId",NEW."quoteId",NEW."stageId",NEW."sourceHash") IS DISTINCT FROM (c."orderId",c."customerId",c."changeId",c."quoteId",c."serviceStageId",c."sourceHash") THEN RAISE EXCEPTION 'Renewal fact scope mismatch'; END IF;
 IF NEW."predecessorId" IS NOT NULL THEN
 SELECT * INTO p FROM "RenewalCancellationFact" WHERE "id"=NEW."predecessorId";
 IF p."cancellationId"<>NEW."cancellationId" OR p."revision"+1<>NEW."revision" OR p."factHash"<>NEW."predecessorHash" THEN RAISE EXCEPTION 'Renewal fact predecessor mismatch'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Contract" WHERE "id"=NEW."contractId" AND "delayQuoteId"=NEW."quoteId" AND "orderId"=NEW."orderId" AND "customerId"=NEW."customerId") THEN RAISE EXCEPTION 'Renewal fact contract mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RenewalCancellationFact_scope" BEFORE INSERT ON "RenewalCancellationFact" FOR EACH ROW EXECUTE FUNCTION ninda_v31_renewal_fact_scope();
CREATE TRIGGER "RenewalCancellationFact_immutable" BEFORE UPDATE OR DELETE ON "RenewalCancellationFact" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
