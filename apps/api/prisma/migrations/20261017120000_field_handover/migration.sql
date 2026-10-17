ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FIELD';
CREATE TABLE "FieldHandoverTask" (
 "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT,
 "type" TEXT NOT NULL CHECK ("type" IN ('DELIVERY','RETURN')),
 "assigneeId" TEXT NOT NULL REFERENCES "AdminUser"("id") ON DELETE RESTRICT,
 "status" TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK ("status" IN ('ASSIGNED','CANCELLED')),
 "version" INTEGER NOT NULL DEFAULT 0, "note" TEXT NOT NULL DEFAULT '', "draft" JSONB NOT NULL DEFAULT '{}',
 "currentHandoverId" TEXT, "lastPublishKey" TEXT, "lastPublishVersion" INTEGER,
 "createdBy" TEXT NOT NULL, "updatedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FieldHandoverTask_orderId_type_key" UNIQUE ("orderId","type")
);
CREATE INDEX "FieldHandoverTask_assigneeId_status_idx" ON "FieldHandoverTask"("assigneeId","status");
ALTER TABLE "StoredFile" ADD COLUMN "fieldTaskId" TEXT REFERENCES "FieldHandoverTask"("id") ON DELETE RESTRICT;
ALTER TABLE "Handover" ADD COLUMN "fieldTaskId" TEXT REFERENCES "FieldHandoverTask"("id") ON DELETE RESTRICT;
