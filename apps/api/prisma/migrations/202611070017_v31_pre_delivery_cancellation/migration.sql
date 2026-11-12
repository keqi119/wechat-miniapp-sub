CREATE TABLE "OrderPreDeliveryCancellation" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "ownerId" TEXT NOT NULL REFERENCES "VehicleOwner"("id"), "originalContractId" TEXT NOT NULL REFERENCES "Contract"("id"),
 "originalTaskId" TEXT NOT NULL REFERENCES "ElectronicSigningTask"("id"), "originalArchiveVersionId" TEXT NOT NULL REFERENCES "ArchiveVersion"("id"),
 "version" INTEGER NOT NULL CHECK ("version">0), "revision" INTEGER NOT NULL DEFAULT 0,
 "state" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("state" IN ('PROPOSED','VERIFIED','REJECTED','CONFIRMED','EFFECTIVE','ARCHIVED')),
 "sourceHash" TEXT NOT NULL, "sourceSnapshot" JSONB NOT NULL, "proposalHash" TEXT NOT NULL, "proposal" JSONB NOT NULL,
 "contractId" TEXT UNIQUE NOT NULL REFERENCES "Contract"("id"), "createdBy" TEXT NOT NULL REFERENCES "AdminUser"("id"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("orderId","version")
);
CREATE TABLE "PreDeliveryCancellationFact" (
 "id" TEXT PRIMARY KEY, "cancellationId" TEXT NOT NULL REFERENCES "OrderPreDeliveryCancellation"("id"),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('PROPOSED','VERIFIED','REJECTED','CONFIRMED','EFFECTIVE','ARCHIVED')),
 "revision" INTEGER NOT NULL CHECK ("revision">0), "predecessorId" TEXT UNIQUE REFERENCES "PreDeliveryCancellationFact"("id"),
 "predecessorHash" TEXT, "sourceHash" TEXT NOT NULL, "proposalHash" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "factHash" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL,
 "actorId" TEXT NOT NULL, UNIQUE ("cancellationId","revision"), CHECK ("occurredAt"<="recordedAt")
);
CREATE FUNCTION ninda_v31_cancellation04_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "OrderPreDeliveryCancellation"; p "PreDeliveryCancellationFact";
BEGIN
 SELECT * INTO c FROM "OrderPreDeliveryCancellation" WHERE id=NEW."cancellationId";
 IF (NEW."sourceHash",NEW."proposalHash") IS DISTINCT FROM (c."sourceHash",c."proposalHash") THEN RAISE EXCEPTION '04 source mismatch'; END IF;
 IF NEW."revision"=1 THEN
 IF NEW."kind"<>'PROPOSED' OR NEW."predecessorId" IS NOT NULL OR NEW."predecessorHash" IS NOT NULL THEN RAISE EXCEPTION '04 first fact mismatch'; END IF;
 ELSE
 SELECT * INTO p FROM "PreDeliveryCancellationFact" WHERE id=NEW."predecessorId";
 IF p.id IS NULL OR p."cancellationId"<>NEW."cancellationId" OR p."revision"+1<>NEW."revision" OR p."factHash"<>NEW."predecessorHash" THEN RAISE EXCEPTION '04 predecessor mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PreDeliveryCancellationFact_scope" BEFORE INSERT ON "PreDeliveryCancellationFact" FOR EACH ROW EXECUTE FUNCTION ninda_v31_cancellation04_fact();
CREATE TRIGGER "PreDeliveryCancellationFact_immutable" BEFORE UPDATE OR DELETE ON "PreDeliveryCancellationFact" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
CREATE FUNCTION ninda_v31_cancellation04_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'revision'-'state') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'state') THEN RAISE EXCEPTION '04 immutable commercial source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderPreDeliveryCancellation_immutable" BEFORE UPDATE ON "OrderPreDeliveryCancellation" FOR EACH ROW EXECUTE FUNCTION ninda_v31_cancellation04_case();
