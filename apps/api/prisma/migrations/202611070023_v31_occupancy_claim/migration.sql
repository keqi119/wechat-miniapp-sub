CREATE TABLE "OrderOccupancyClaim" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"), "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "status" TEXT NOT NULL DEFAULT 'PROPOSED' CHECK ("status" IN ('PROPOSED','VERIFIED','REJECTED')), "responsibility" TEXT NOT NULL CHECK ("responsibility" IN ('CUSTOMER','OWNER','PLATFORM','DISPUTED')),
 "sourceHash" TEXT NOT NULL, "source" JSONB NOT NULL, "createdBy" TEXT NOT NULL REFERENCES "AdminUser"("id"), "createdAt" TIMESTAMP(3) NOT NULL,
 "reviewedBy" TEXT REFERENCES "AdminUser"("id"), "reviewedAt" TIMESTAMP(3), "reviewReason" TEXT, "reviewPolicy" TEXT,
 "idempotencyKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL, UNIQUE ("createdBy","idempotencyKey")
);
CREATE INDEX "OrderOccupancyClaim_order" ON "OrderOccupancyClaim" ("orderId","createdAt");
CREATE FUNCTION ninda_v31_occupancy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PROPOSED' OR NEW.status NOT IN ('VERIFIED','REJECTED') OR NEW."reviewedBy" IS NULL OR NEW."reviewedAt" IS NULL OR
 (to_jsonb(NEW)-'status'-'reviewedBy'-'reviewedAt'-'reviewReason'-'reviewPolicy') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reviewedBy'-'reviewedAt'-'reviewReason'-'reviewPolicy') THEN RAISE EXCEPTION 'occupancy evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OrderOccupancyClaim_immutable" BEFORE UPDATE OR DELETE ON "OrderOccupancyClaim" FOR EACH ROW EXECUTE FUNCTION ninda_v31_occupancy_immutable();
