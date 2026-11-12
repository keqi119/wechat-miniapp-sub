-- Retain original identity and privacy mappings when a document is removed from
-- the vehicle's active cards. Historical bytes and other business files survive.
ALTER TABLE "VehicleDocumentFile"
 ADD COLUMN "removedAt" TIMESTAMP(3),
 ADD COLUMN "removedBy" TEXT;

ALTER TABLE "VehicleDocumentFile"
 ADD CONSTRAINT "VehicleDocumentFile_removal_actor_pair" CHECK (
  ("removedAt" IS NULL AND "removedBy" IS NULL)
  OR ("removedAt" IS NOT NULL AND "removedBy" IS NOT NULL AND length(trim("removedBy")) > 0)
 );
