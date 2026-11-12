CREATE TABLE "VirtualAcceptanceScope" (
 "id" TEXT PRIMARY KEY, "singleton" TEXT NOT NULL DEFAULT 'NINDA_INITIAL_VIRTUAL_20261109' UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','READY','REVOKED')),
 "revision" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3) NOT NULL,
 "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "ownerId" TEXT NOT NULL REFERENCES "VehicleOwner"("id"),
 "ownerActorCustomerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "platformId" TEXT NOT NULL REFERENCES "VehicleOwner"("id"),
 "platformActorCustomerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "productVersionId" TEXT, "productHash" TEXT, "cooperationVersionId" TEXT, "cooperationHash" TEXT,
 "subscriptionTemplateId" TEXT, "subscriptionTemplateHash" TEXT,
 "cooperationTemplateId" TEXT, "cooperationTemplateHash" TEXT,
 "grantTemplateId" TEXT, "grantTemplateHash" TEXT,
 "wrapperVersion" TEXT, "wrapperHash" TEXT, "wrapperApprovedBy" TEXT, "wrapperApprovedAt" TIMESTAMP(3),
 "testFactsHash" TEXT, "noticeHash" TEXT NOT NULL, "configurationHash" TEXT,
 "applicationId" TEXT UNIQUE REFERENCES "Application"("id"), "orderId" TEXT UNIQUE REFERENCES "Order"("id"),
 "months" INTEGER NOT NULL DEFAULT 12 CHECK ("months"=12),
 "monthlyFeeAmount" INTEGER NOT NULL DEFAULT 100 CHECK ("monthlyFeeAmount"=100),
 "depositKind" TEXT NOT NULL DEFAULT 'FIXED' CHECK ("depositKind"='FIXED'),
 "depositAmount" INTEGER NOT NULL DEFAULT 100 CHECK ("depositAmount"=100),
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("customerId"<>"ownerActorCustomerId" AND "customerId"<>"platformActorCustomerId" AND "ownerActorCustomerId"<>"platformActorCustomerId" AND "ownerId"<>"platformId")
);
ALTER TABLE "Vehicle" ADD COLUMN "virtualAcceptanceScopeId" TEXT UNIQUE REFERENCES "VirtualAcceptanceScope"("id") ON DELETE RESTRICT;
CREATE FUNCTION protect_virtual_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='VirtualAcceptanceScope' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VIRTUAL_SCOPE_IMMUTABLE'; END IF;
  IF OLD."status"<>'DRAFT' AND
   (to_jsonb(NEW)-ARRAY['status','applicationId','orderId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','applicationId','orderId']) THEN
   RAISE EXCEPTION 'VIRTUAL_CONFIGURATION_IMMUTABLE';
  END IF;
  IF OLD."status"='REVOKED' AND NEW."status"<>'REVOKED' OR OLD."status"='READY' AND NEW."status"='DRAFT'
   OR OLD."applicationId" IS NOT NULL AND NEW."applicationId" IS DISTINCT FROM OLD."applicationId"
   OR OLD."orderId" IS NOT NULL AND NEW."orderId" IS DISTINCT FROM OLD."orderId" THEN RAISE EXCEPTION 'VIRTUAL_BINDING_IMMUTABLE'; END IF;
 ELSIF TG_TABLE_NAME='Vehicle' THEN
  IF TG_OP='DELETE' AND OLD."virtualAcceptanceScopeId" IS NOT NULL THEN RAISE EXCEPTION 'VIRTUAL_MARKER_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND OLD."virtualAcceptanceScopeId" IS NOT NULL AND NEW."virtualAcceptanceScopeId" IS DISTINCT FROM OLD."virtualAcceptanceScopeId" THEN RAISE EXCEPTION 'VIRTUAL_MARKER_IMMUTABLE'; END IF;
  IF NEW."virtualAcceptanceScopeId" IS NOT NULL AND (NEW."status"='IN_USE' OR NEW."catalogPublished" OR NEW."vin" IS NOT NULL OR NEW."plateNumber" IS NOT NULL) THEN RAISE EXCEPTION 'VIRTUAL_REAL_ASSET_FORBIDDEN'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "Vehicle" WHERE "id"=NEW."vehicleId" AND "virtualAcceptanceScopeId" IS NOT NULL) AND
   (TG_TABLE_NAME='VehicleAssignment' OR NEW."status"::text='ACTIVE') THEN RAISE EXCEPTION 'VIRTUAL_DELIVERY_FORBIDDEN'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER virtual_scope_guard BEFORE UPDATE OR DELETE ON "VirtualAcceptanceScope" FOR EACH ROW EXECUTE FUNCTION protect_virtual_acceptance();
CREATE TRIGGER virtual_vehicle_guard BEFORE INSERT OR UPDATE OR DELETE ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION protect_virtual_acceptance();
CREATE TRIGGER virtual_order_guard BEFORE INSERT OR UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION protect_virtual_acceptance();
CREATE TRIGGER virtual_assignment_guard BEFORE INSERT OR UPDATE ON "VehicleAssignment" FOR EACH ROW EXECUTE FUNCTION protect_virtual_acceptance();
CREATE TRIGGER virtual_stage_guard BEFORE INSERT OR UPDATE ON "OrderServiceStage" FOR EACH ROW EXECUTE FUNCTION protect_virtual_acceptance();
