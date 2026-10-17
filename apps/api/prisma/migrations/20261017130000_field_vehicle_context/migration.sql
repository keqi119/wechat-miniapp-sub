ALTER TABLE "FieldHandoverTask" ADD COLUMN "vehicleId" TEXT, ADD COLUMN "vehicleAssignmentId" TEXT, ADD COLUMN "materialGeneration" INTEGER NOT NULL DEFAULT 0;
UPDATE "FieldHandoverTask" t SET "vehicleId"=o."vehicleId", "vehicleAssignmentId"=o."currentAssignmentId" FROM "Order" o WHERE t."orderId"=o."id";
ALTER TABLE "FieldHandoverTask" ALTER COLUMN "vehicleId" SET NOT NULL;
ALTER TABLE "StoredFile" ADD COLUMN "fieldTaskGeneration" INTEGER;
UPDATE "StoredFile" SET "fieldTaskGeneration"=0 WHERE "fieldTaskId" IS NOT NULL;
