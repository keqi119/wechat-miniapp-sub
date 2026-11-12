BEGIN;
-- Required evidence arrays must not use SQL NULL to bypass cardinality CHECKs.
-- Invalid preexisting rows deliberately block migration; never fabricate proof.
ALTER TABLE "PlateOwnershipPeriod" ALTER COLUMN "evidenceFileIds" SET NOT NULL;
ALTER TABLE "PlateVehicleBinding" ALTER COLUMN "evidenceFileIds" SET NOT NULL;
ALTER TABLE "AssetManualPaymentRecord" ALTER COLUMN "evidenceFileIds" SET NOT NULL;
ALTER TABLE "PlateOwnershipPeriod" ADD CONSTRAINT "PlateOwnershipPeriod_evidence_elements" CHECK (
 array_position("evidenceFileIds",NULL) IS NULL
);
ALTER TABLE "PlateVehicleBinding" ADD CONSTRAINT "PlateVehicleBinding_evidence_elements" CHECK (
 array_position("evidenceFileIds",NULL) IS NULL
);
ALTER TABLE "AssetManualPaymentRecord" ADD CONSTRAINT "AssetManualPaymentRecord_evidence_elements" CHECK (
 cardinality("evidenceFileIds")<=20 AND array_position("evidenceFileIds",NULL) IS NULL
);
COMMIT;
