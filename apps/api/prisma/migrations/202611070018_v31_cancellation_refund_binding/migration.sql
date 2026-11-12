ALTER TABLE "Refund" ADD COLUMN "preDeliveryCancellationId" TEXT REFERENCES "OrderPreDeliveryCancellation"("id"), ADD COLUMN "preDeliveryCancellationSourceHash" TEXT;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cancellation04_pair" CHECK (("preDeliveryCancellationId" IS NULL AND "preDeliveryCancellationSourceHash" IS NULL) OR ("preDeliveryCancellationId" IS NOT NULL AND "preDeliveryCancellationSourceHash" ~ '^[a-f0-9]{64}$'));
CREATE FUNCTION ninda_v31_cancellation04_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "OrderPreDeliveryCancellation";
BEGIN
 IF TG_OP='UPDATE' AND (NEW."preDeliveryCancellationId",NEW."preDeliveryCancellationSourceHash",NEW."paymentId",NEW."customerId",NEW."amount") IS DISTINCT FROM (OLD."preDeliveryCancellationId",OLD."preDeliveryCancellationSourceHash",OLD."paymentId",OLD."customerId",OLD."amount") AND (OLD."preDeliveryCancellationId" IS NOT NULL OR NEW."preDeliveryCancellationId" IS NOT NULL) THEN RAISE EXCEPTION '04 refund immutable source'; END IF;
 IF NEW."preDeliveryCancellationId" IS NOT NULL THEN
 SELECT * INTO c FROM "OrderPreDeliveryCancellation" WHERE id=NEW."preDeliveryCancellationId";
 IF c."proposalHash"<>NEW."preDeliveryCancellationSourceHash" OR c."customerId"<>NEW."customerId" OR NOT EXISTS(SELECT 1 FROM "Payment" p JOIN "Bill" b ON b.id=p."billId" WHERE p.id=NEW."paymentId" AND p."customerId"=c."customerId" AND b."orderId"=c."orderId") OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.proposal->'money'->'payments') p WHERE p->>'paymentId'=NEW."paymentId") OR NOT EXISTS(SELECT 1 FROM "PreDeliveryCancellationFact" f WHERE f."cancellationId"=c.id AND f.kind='EFFECTIVE') THEN RAISE EXCEPTION '04 refund source mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_cancellation04_source" BEFORE INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION ninda_v31_cancellation04_refund();
