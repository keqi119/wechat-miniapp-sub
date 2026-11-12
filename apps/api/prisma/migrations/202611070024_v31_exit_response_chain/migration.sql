-- Existing021 rows and immutable confirmations are preserved byte-for-byte.
ALTER TABLE "OrderExitAmountResponse" ADD COLUMN "bindingHash" TEXT, ADD COLUMN "responseVersion" INTEGER, ADD COLUMN "predecessorId" TEXT REFERENCES "OrderExitAmountResponse"("id");
CREATE UNIQUE INDEX "OrderExitAmountResponse_predecessorId_key" ON "OrderExitAmountResponse" ("predecessorId");
CREATE UNIQUE INDEX "OrderExitAmountResponse_orderId_bindingHash_responseVersion_key" ON "OrderExitAmountResponse" ("orderId","bindingHash","responseVersion");
CREATE FUNCTION ninda_v31_exit_response_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n INTEGER; p "OrderExitAmountResponse";
BEGIN
 IF (NEW."bindingHash" IS NOT NULL AND NEW."responseVersion">0 AND NEW."bindingHash"=NEW.source->>'bindingHash') IS NOT TRUE THEN RAISE EXCEPTION 'exit response binding required'; END IF;
 PERFORM id FROM "Order" WHERE id=NEW."orderId" FOR UPDATE;
 SELECT COUNT(*) INTO n FROM "OrderExitAmountResponse" WHERE "orderId"=NEW."orderId" AND source->>'bindingHash'=NEW."bindingHash";
 SELECT * INTO p FROM "OrderExitAmountResponse" WHERE "orderId"=NEW."orderId" AND source->>'bindingHash'=NEW."bindingHash" ORDER BY "responseVersion" DESC NULLS LAST,"confirmedAt" DESC,id DESC LIMIT 1;
 IF NEW."responseVersion"<>n+1 OR NEW."predecessorId" IS DISTINCT FROM p.id OR (p.id IS NOT NULL AND NEW."confirmedAt"<p."confirmedAt") THEN RAISE EXCEPTION 'exit response predecessor mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderExitAmountResponse_chain" BEFORE INSERT ON "OrderExitAmountResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_exit_response_chain();
