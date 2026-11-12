-- Existing contracts, costs and files remain unchanged. History is written only
-- when a real correction closes the original revision interval.
CREATE UNIQUE INDEX "VehicleBaasContract_id_vehicleId_key" ON "VehicleBaasContract"("id","vehicleId");
CREATE TABLE "VehicleBaasContractRevision" (
 "id" TEXT PRIMARY KEY,
 "contractId" TEXT NOT NULL,
 "vehicleId" TEXT NOT NULL,
 "fromRevision" INTEGER NOT NULL CHECK ("fromRevision">=0),
 "toRevision" INTEGER NOT NULL CHECK ("toRevision">="fromRevision"),
 "termsHash" TEXT NOT NULL CHECK ("termsHash" ~ '^[a-f0-9]{64}$'),
 "termsSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("termsSnapshot")='object'),
 "firstCostPeriod" TEXT CHECK ("firstCostPeriod" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 "createdBy" TEXT NOT NULL CHECK (length(btrim("createdBy"))>0),
 "changeReason" TEXT NOT NULL CHECK (length(btrim("changeReason"))>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("contractId","vehicleId") REFERENCES "VehicleBaasContract"("id","vehicleId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "VehicleBaasContractRevision_contractId_fromRevision_key" ON "VehicleBaasContractRevision"("contractId","fromRevision");
CREATE INDEX "VehicleBaasContractRevision_contractId_toRevision_idx" ON "VehicleBaasContractRevision"("contractId","toRevision");

CREATE FUNCTION "guardBaasContractRevision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision INTEGER; last_revision INTEGER;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  RAISE EXCEPTION 'BaaS contract history is immutable' USING ERRCODE='23514';
 END IF;
 SELECT "revision" INTO current_revision FROM "VehicleBaasContract" WHERE "id"=NEW."contractId" FOR UPDATE;
 SELECT max("toRevision") INTO last_revision FROM "VehicleBaasContractRevision" WHERE "contractId"=NEW."contractId";
 IF NEW."fromRevision" <> coalesce(last_revision+1,0) OR NEW."toRevision">current_revision THEN
  RAISE EXCEPTION 'BaaS history must close a contiguous existing revision interval' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "VehicleBaasContractRevision_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "VehicleBaasContractRevision" FOR EACH ROW EXECUTE FUNCTION "guardBaasContractRevision"();

ALTER TABLE "AssetPrivateFile"
 ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidedBy" TEXT, ADD COLUMN "voidReason" TEXT,
 ADD COLUMN "removedAt" TIMESTAMP(3), ADD COLUMN "removedBy" TEXT, ADD COLUMN "removeReason" TEXT;
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_baas_disposition" CHECK (
 ("kind"='BAAS' OR ("voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL AND "removedAt" IS NULL AND "removedBy" IS NULL AND "removeReason" IS NULL))
 AND (("voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL)
   OR ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND length(btrim("voidedBy"))>0 AND "voidReason" IS NOT NULL AND length(btrim("voidReason"))>0))
 AND (("removedAt" IS NULL AND "removedBy" IS NULL AND "removeReason" IS NULL)
   OR ("removedAt" IS NOT NULL AND "removedBy" IS NOT NULL AND length(btrim("removedBy"))>0 AND "removeReason" IS NOT NULL AND length(btrim("removeReason"))>0))
);
