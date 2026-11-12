-- Old paper/electronic tasks keep their actual facts. No historical quote or terms is invented.
ALTER TABLE "FieldHandoverTask" ADD COLUMN "batchKey" TEXT, ADD COLUMN "changeId" TEXT, ADD COLUMN "termsVersionId" TEXT, ADD COLUMN "quoteId" TEXT;
UPDATE "FieldHandoverTask" SET "batchKey"='LEGACY:'||id;

-- Only orders that have never acquired changed terms can prove the initial delivery batch.
UPDATE "FieldHandoverTask" t SET "batchKey"='DELIVERY:INITIAL'
FROM "Order" o WHERE t."orderId"=o.id AND t.type='DELIVERY' AND o."effectiveTermsVersionId" IS NULL
AND NOT EXISTS (SELECT 1 FROM "OrderTermsVersion" v WHERE v."orderId"=o.id);

-- A return batch is resolved only from an unambiguous, same-order physical assignment.
-- Suspicious/missing links stay LEGACY and require explicit operational review.
WITH candidate AS (
 SELECT t.id, a.id AS assignment_id
 FROM "FieldHandoverTask" t
 JOIN "Order" o ON o.id=t."orderId"
 LEFT JOIN "Handover" h ON h.id=t."currentHandoverId"
 JOIN "VehicleAssignment" a ON a."orderId"=o.id AND a."customerId"=o."customerId" AND a."vehicleId"=t."vehicleId"
  AND ((t."vehicleAssignmentId" IS NOT NULL AND a.id=t."vehicleAssignmentId")
   OR (t."vehicleAssignmentId" IS NULL AND h."assignmentId" IS NOT NULL AND a.id=h."assignmentId")
   OR (t."vehicleAssignmentId" IS NULL AND h."assignmentId" IS NULL AND a."returnHandoverId"=h.id))
 JOIN "Handover" d ON d.id=a."deliveryHandoverId" AND d."orderId"=a."orderId" AND d."customerId"=a."customerId"
  AND d."vehicleId"=a."vehicleId" AND d."assignmentId"=a.id AND d.status='COMPLETED' AND d."actualAt"=a."startAt" AND d."readingKm"=a."startReadingKm"
 LEFT JOIN "OrderChange" c ON c.id=a."changeId"
 WHERE t.type='RETURN' AND a."startReadingKm">=0
 AND ((a."changeId" IS NULL AND d.type='DELIVERY' AND d."changeId" IS NULL)
  OR (a."changeId" IS NOT NULL AND d.type='SWAP_DELIVERY' AND d."changeId"=a."changeId" AND c.kind='VEHICLE_CHANGE' AND c.status='APPLIED' AND c."orderId"=o.id AND c."customerId"=o."customerId" AND c."targetVehicleId"=a."vehicleId" AND c."deliveryHandoverId"=d.id))
 AND (t."currentHandoverId" IS NULL OR (h.id IS NOT NULL AND h.type='RETURN' AND h."changeId" IS NULL AND h."orderId"=o.id AND h."customerId"=o."customerId" AND h."vehicleId"=a."vehicleId" AND (h."fieldTaskId" IS NULL OR h."fieldTaskId"=t.id) AND (h."assignmentId" IS NULL OR h."assignmentId"=a.id)))
 AND ((a.status='ACTIVE' AND a."endAt" IS NULL AND a."endReadingKm" IS NULL AND a."returnHandoverId" IS NULL)
  OR (a.status='CLOSED' AND h.id=a."returnHandoverId" AND h.status='COMPLETED' AND h."actualAt"=a."endAt" AND h."readingKm"=a."endReadingKm" AND a."endAt">=a."startAt" AND a."endReadingKm">=a."startReadingKm"))
), resolved AS (SELECT id,MIN(assignment_id) AS assignment_id FROM candidate GROUP BY id HAVING COUNT(*)=1)
UPDATE "FieldHandoverTask" t SET "batchKey"='FINAL_RETURN:'||r.assignment_id,"vehicleAssignmentId"=r.assignment_id FROM resolved r WHERE t.id=r.id;

ALTER TABLE "FieldHandoverTask" ALTER COLUMN "batchKey" SET NOT NULL;
ALTER TABLE "FieldHandoverTask" DROP CONSTRAINT "FieldHandoverTask_orderId_type_key";
ALTER TABLE "FieldHandoverTask" DROP CONSTRAINT "FieldHandoverTask_type_check";
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_type_check" CHECK (type IN ('DELIVERY','RETURN','SWAP_RETURN','SWAP_DELIVERY'));
CREATE UNIQUE INDEX "FieldHandoverTask_orderId_batchKey_key" ON "FieldHandoverTask"("orderId","batchKey");
CREATE UNIQUE INDEX "OrderChange_id_orderId_key" ON "OrderChange"(id,"orderId");
CREATE UNIQUE INDEX "DelayQuote_id_changeId_key" ON "DelayQuote"(id,"changeId");
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_changeId_orderId_fkey" FOREIGN KEY ("changeId","orderId") REFERENCES "OrderChange"(id,"orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_termsVersionId_orderId_fkey" FOREIGN KEY ("termsVersionId","orderId") REFERENCES "OrderTermsVersion"(id,"orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_quoteId_changeId_fkey" FOREIGN KEY ("quoteId","changeId") REFERENCES "DelayQuote"(id,"changeId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_batch_scope" CHECK ((
 (type IN ('DELIVERY','RETURN') AND "changeId" IS NULL AND "quoteId" IS NULL AND "termsVersionId" IS NULL AND "batchKey"='LEGACY:'||id)
 OR (type='DELIVERY' AND "changeId" IS NULL AND "quoteId" IS NULL AND "batchKey"='DELIVERY:'||COALESCE("termsVersionId",'INITIAL'))
 OR (type='RETURN' AND "changeId" IS NULL AND "quoteId" IS NULL AND "termsVersionId" IS NULL AND "vehicleAssignmentId" IS NOT NULL AND "batchKey"='FINAL_RETURN:'||"vehicleAssignmentId")
 OR (type IN ('SWAP_RETURN','SWAP_DELIVERY') AND "changeId" IS NOT NULL AND "quoteId" IS NOT NULL AND "termsVersionId" IS NULL AND (type<>'SWAP_RETURN' OR "vehicleAssignmentId" IS NOT NULL) AND "batchKey"='CHANGE:'||"changeId"||CASE WHEN type='SWAP_RETURN' THEN ':RETURN' ELSE ':DELIVERY' END)
) IS TRUE AND length(btrim("batchKey"))>0);
