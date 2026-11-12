-- AlterTable
ALTER TABLE "AssetCostPlan" ADD COLUMN     "workOrderCostId" TEXT;

-- AlterTable
ALTER TABLE "AssetPrivateFile" ADD COLUMN     "workOrderCostId" TEXT,
ADD COLUMN     "workOrderId" TEXT;

-- CreateTable
CREATE TABLE "AssetWorkOrder" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "workOrderNo" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceServiceRequestId" TEXT,
    "sourceServiceSnapshot" JSONB,
    "relatedWorkOrderId" TEXT,
    "assignedStaffId" TEXT,
    "providerName" TEXT,
    "contact" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "costConfirmationRequired" BOOLEAN NOT NULL,
    "noCostReason" TEXT,
    "solution" TEXT,
    "submissionSnapshot" JSONB,
    "submissionEvidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedRevision" INTEGER,
    "acceptanceSnapshot" JSONB,
    "acceptanceEvidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedRevision" INTEGER,
    "acceptedEventId" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "accidentAt" TIMESTAMP(3),
    "accidentLocation" TEXT,
    "accidentDescription" TEXT,
    "insurerName" TEXT,
    "claimNumber" TEXT,
    "claimStatus" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetWorkOrderEvent" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beforeRevision" INTEGER,
    "afterRevision" INTEGER NOT NULL,
    "detailSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,

    CONSTRAINT "AssetWorkOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleOperationalRestriction" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "vehicleId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "scopes" TEXT[],
    "reason" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "evidenceSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "releaseEvidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "releaseEvidenceSnapshot" JSONB,

    CONSTRAINT "VehicleOperationalRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMaintenanceSchedule" (
    "vehicleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceWorkOrderId" TEXT,
    "lastCompletedOn" DATE,
    "lastMileageKm" INTEGER,
    "nextDueDate" DATE,
    "nextDueMileageKm" INTEGER,
    "reason" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenanceSchedule_pkey" PRIMARY KEY ("vehicleId")
);

-- CreateTable
CREATE TABLE "AssetWorkOrderCost" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "workOrderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "amount" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "supplierName" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceSnapshot" JSONB,
    "sourceHash" TEXT,
    "replacesCostId" TEXT,
    "frozenBy" TEXT,
    "frozenAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetWorkOrderCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRecoveryRecord" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "workOrderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "costEntryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "kind" TEXT NOT NULL DEFAULT 'INSURANCE_RECEIPT',
    "amount" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceFileIds" TEXT[],
    "evidenceSnapshot" JSONB NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "AssetRecoveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrder_workOrderNo_key" ON "AssetWorkOrder"("workOrderNo");

-- CreateIndex
CREATE INDEX "AssetWorkOrder_vehicleId_status_occurredAt_idx" ON "AssetWorkOrder"("vehicleId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "AssetWorkOrder_assignedStaffId_status_idx" ON "AssetWorkOrder"("assignedStaffId", "status");

-- CreateIndex
CREATE INDEX "AssetWorkOrder_sourceServiceRequestId_idx" ON "AssetWorkOrder"("sourceServiceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrder_id_vehicleId_key" ON "AssetWorkOrder"("id", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderEvent_workOrderId_sequence_key" ON "AssetWorkOrderEvent"("workOrderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderEvent_id_workOrderId_key" ON "AssetWorkOrderEvent"("id", "workOrderId");

-- CreateIndex
CREATE INDEX "VehicleOperationalRestriction_vehicleId_status_idx" ON "VehicleOperationalRestriction"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleOperationalRestriction_workOrderId_status_idx" ON "VehicleOperationalRestriction"("workOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderCost_replacesCostId_key" ON "AssetWorkOrderCost"("replacesCostId");

-- CreateIndex
CREATE INDEX "AssetWorkOrderCost_workOrderId_status_idx" ON "AssetWorkOrderCost"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "AssetWorkOrderCost_vehicleId_occurredOn_idx" ON "AssetWorkOrderCost"("vehicleId", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderCost_id_vehicleId_key" ON "AssetWorkOrderCost"("id", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderCost_id_workOrderId_vehicleId_key" ON "AssetWorkOrderCost"("id", "workOrderId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetWorkOrderCost_replacesCostId_workOrderId_vehicleId_key" ON "AssetWorkOrderCost"("replacesCostId", "workOrderId", "vehicleId");

-- CreateIndex
CREATE INDEX "AssetRecoveryRecord_workOrderId_status_idx" ON "AssetRecoveryRecord"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "AssetRecoveryRecord_costEntryId_status_idx" ON "AssetRecoveryRecord"("costEntryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostPlan_workOrderCostId_key" ON "AssetCostPlan"("workOrderCostId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCostEntry_id_vehicleId_key" ON "AssetCostEntry"("id", "vehicleId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_workOrderId_idx" ON "AssetPrivateFile"("workOrderId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_workOrderCostId_idx" ON "AssetPrivateFile"("workOrderCostId");

-- AddForeignKey
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_workOrderCostId_vehicleId_fkey" FOREIGN KEY ("workOrderCostId", "vehicleId") REFERENCES "AssetWorkOrderCost"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "AssetWorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_workOrderCostId_fkey" FOREIGN KEY ("workOrderCostId") REFERENCES "AssetWorkOrderCost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_sourceServiceRequestId_fkey" FOREIGN KEY ("sourceServiceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_relatedWorkOrderId_vehicleId_fkey" FOREIGN KEY ("relatedWorkOrderId", "vehicleId") REFERENCES "AssetWorkOrder"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_acceptedEventId_id_fkey" FOREIGN KEY ("acceptedEventId", "id") REFERENCES "AssetWorkOrderEvent"("id", "workOrderId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetWorkOrderEvent" ADD CONSTRAINT "AssetWorkOrderEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "AssetWorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOperationalRestriction" ADD CONSTRAINT "VehicleOperationalRestriction_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOperationalRestriction" ADD CONSTRAINT "VehicleOperationalRestriction_workOrderId_vehicleId_fkey" FOREIGN KEY ("workOrderId", "vehicleId") REFERENCES "AssetWorkOrder"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceSchedule" ADD CONSTRAINT "VehicleMaintenanceSchedule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceSchedule" ADD CONSTRAINT "VehicleMaintenanceSchedule_sourceWorkOrderId_vehicleId_fkey" FOREIGN KEY ("sourceWorkOrderId", "vehicleId") REFERENCES "AssetWorkOrder"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetWorkOrderCost" ADD CONSTRAINT "AssetWorkOrderCost_workOrderId_vehicleId_fkey" FOREIGN KEY ("workOrderId", "vehicleId") REFERENCES "AssetWorkOrder"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetWorkOrderCost" ADD CONSTRAINT "AssetWorkOrderCost_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetWorkOrderCost" ADD CONSTRAINT "AssetWorkOrderCost_replacesCostId_workOrderId_vehicleId_fkey" FOREIGN KEY ("replacesCostId", "workOrderId", "vehicleId") REFERENCES "AssetWorkOrderCost"("id", "workOrderId", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_workOrderId_vehicleId_fkey" FOREIGN KEY ("workOrderId", "vehicleId") REFERENCES "AssetWorkOrder"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_costEntryId_vehicleId_fkey" FOREIGN KEY ("costEntryId", "vehicleId") REFERENCES "AssetCostEntry"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Guard the new facts at the database boundary. No historical facts are backfilled.
ALTER TABLE "AssetWorkOrder" ALTER COLUMN "submissionEvidenceFileIds" SET NOT NULL,
 ALTER COLUMN "acceptanceEvidenceFileIds" SET NOT NULL;
ALTER TABLE "VehicleOperationalRestriction" ALTER COLUMN scopes SET NOT NULL,
 ALTER COLUMN "evidenceFileIds" SET NOT NULL, ALTER COLUMN "releaseEvidenceFileIds" SET NOT NULL;
ALTER TABLE "AssetRecoveryRecord" ALTER COLUMN "evidenceFileIds" SET NOT NULL;

ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_values" CHECK (
 revision>=0 AND "eventSequence">=0 AND kind IN ('ACCIDENT_REPAIR','REPAIR','MAINTENANCE')
 AND status IN ('PENDING','IN_PROGRESS','WAITING_EXTERNAL','PENDING_ACCEPTANCE','PENDING_COST_CONFIRMATION','CLOSED','CANCELLED')
 AND priority IN ('LOW','NORMAL','HIGH','URGENT') AND length(trim(title))>0 AND length(trim(description))>0
 AND length(trim("workOrderNo"))>0 AND length(trim("createdBy"))>0 AND length(trim("updatedBy"))>0
 AND (("costConfirmationRequired" AND "noCostReason" IS NULL) OR (NOT "costConfirmationRequired" AND "noCostReason" IS NOT NULL AND length(trim("noCostReason"))>0))
 AND ("relatedWorkOrderId" IS NULL OR "relatedWorkOrderId"<>id)
 AND (("sourceServiceRequestId" IS NULL AND "sourceServiceSnapshot" IS NULL)
  OR ("sourceServiceRequestId" IS NOT NULL AND "sourceServiceSnapshot" IS NOT NULL AND jsonb_typeof("sourceServiceSnapshot")='object' AND "sourceServiceSnapshot"<>'{}'::jsonb))
);
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_accident" CHECK (
 (kind='ACCIDENT_REPAIR' AND "accidentAt" IS NOT NULL AND "accidentLocation" IS NOT NULL AND length(trim("accidentLocation"))>0
  AND "accidentDescription" IS NOT NULL AND length(trim("accidentDescription"))>0 AND "claimStatus" IS NOT NULL
  AND "claimStatus" IN ('NOT_REPORTED','REPORTED','PROCESSING','SETTLED','REJECTED','WITHDRAWN'))
 OR (kind<>'ACCIDENT_REPAIR' AND num_nonnulls("accidentAt","accidentLocation","accidentDescription","insurerName","claimNumber","claimStatus")=0)
);
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_submission" CHECK (
 array_position("submissionEvidenceFileIds",NULL) IS NULL AND array_position("submissionEvidenceFileIds",'') IS NULL
 AND ((num_nonnulls(solution,"submissionSnapshot","submittedBy","submittedAt","submittedRevision")=0 AND cardinality("submissionEvidenceFileIds")=0)
  OR (num_nonnulls(solution,"submissionSnapshot","submittedBy","submittedAt","submittedRevision")=5
   AND length(trim(solution))>0 AND length(trim("submittedBy"))>0 AND "submittedRevision" BETWEEN 0 AND revision
   AND jsonb_typeof("submissionSnapshot")='object' AND "submissionSnapshot"<>'{}'::jsonb AND cardinality("submissionEvidenceFileIds") BETWEEN 1 AND 20))
 AND (status NOT IN ('PENDING_ACCEPTANCE','PENDING_COST_CONFIRMATION','CLOSED') OR "submittedAt" IS NOT NULL)
);
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_acceptance" CHECK (
 array_position("acceptanceEvidenceFileIds",NULL) IS NULL AND array_position("acceptanceEvidenceFileIds",'') IS NULL
 AND ((num_nonnulls("acceptanceSnapshot","acceptedBy","acceptedAt","acceptedRevision","acceptedEventId")=0 AND cardinality("acceptanceEvidenceFileIds")=0)
  OR (num_nonnulls("acceptanceSnapshot","acceptedBy","acceptedAt","acceptedRevision","acceptedEventId")=5 AND "submittedAt" IS NOT NULL
   AND length(trim("acceptedBy"))>0 AND "acceptedRevision" BETWEEN 0 AND revision
   AND jsonb_typeof("acceptanceSnapshot")='object' AND "acceptanceSnapshot"<>'{}'::jsonb AND cardinality("acceptanceEvidenceFileIds") BETWEEN 1 AND 20))
 AND (status NOT IN ('PENDING_COST_CONFIRMATION','CLOSED') OR "acceptedAt" IS NOT NULL)
);
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_terminal" CHECK (
 ((status='CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL AND length(trim("closedBy"))>0)
  OR (status<>'CLOSED' AND "closedAt" IS NULL AND "closedBy" IS NULL))
 AND ((status='CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND length(trim("cancelledBy"))>0 AND "cancelReason" IS NOT NULL AND length(trim("cancelReason"))>0)
  OR (status<>'CANCELLED' AND num_nonnulls("cancelledAt","cancelledBy","cancelReason")=0))
);
ALTER TABLE "AssetWorkOrderEvent" ADD CONSTRAINT "AssetWorkOrderEvent_values" CHECK (
 sequence>0 AND "afterRevision">=0 AND ("beforeRevision" IS NULL OR ("beforeRevision">=0 AND "afterRevision">"beforeRevision"))
 AND length(trim(action))>0 AND length(trim("actorId"))>0 AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("detailSnapshot")='object' AND "detailSnapshot"<>'{}'::jsonb
);
ALTER TABLE "VehicleOperationalRestriction" ADD CONSTRAINT "VehicleOperationalRestriction_values" CHECK (
 revision>=0 AND status IN ('ACTIVE','RELEASED') AND cardinality(scopes) BETWEEN 1 AND 2
 AND scopes<@ARRAY['ALLOCATION','DELIVERY']::text[] AND array_position(scopes,NULL) IS NULL
 AND scopes<>ARRAY['ALLOCATION','ALLOCATION']::text[] AND scopes<>ARRAY['DELIVERY','DELIVERY']::text[]
 AND length(trim(reason))>0 AND length(trim("createdBy"))>0
 AND cardinality("evidenceFileIds") BETWEEN 1 AND 20 AND array_position("evidenceFileIds",NULL) IS NULL AND array_position("evidenceFileIds",'') IS NULL
 AND jsonb_typeof("evidenceSnapshot")='array' AND "evidenceSnapshot"<>'[]'::jsonb AND NOT ("evidenceSnapshot" @> '[null]'::jsonb)
);
ALTER TABLE "VehicleOperationalRestriction" ADD CONSTRAINT "VehicleOperationalRestriction_release" CHECK (
 array_position("releaseEvidenceFileIds",NULL) IS NULL AND array_position("releaseEvidenceFileIds",'') IS NULL
 AND ((status='ACTIVE' AND num_nonnulls("releasedBy","releasedAt","releaseReason","releaseEvidenceSnapshot")=0 AND cardinality("releaseEvidenceFileIds")=0)
  OR (status='RELEASED' AND num_nonnulls("releasedBy","releasedAt","releaseReason","releaseEvidenceSnapshot")=4
   AND length(trim("releasedBy"))>0 AND length(trim("releaseReason"))>0 AND cardinality("releaseEvidenceFileIds") BETWEEN 1 AND 20
   AND jsonb_typeof("releaseEvidenceSnapshot")='array' AND "releaseEvidenceSnapshot"<>'[]'::jsonb AND NOT ("releaseEvidenceSnapshot" @> '[null]'::jsonb)))
);
ALTER TABLE "VehicleMaintenanceSchedule" ADD CONSTRAINT "VehicleMaintenanceSchedule_values" CHECK (
 revision>=0 AND length(trim(reason))>0 AND length(trim("updatedBy"))>0
 AND ((num_nonnulls("sourceWorkOrderId","lastCompletedOn","lastMileageKm")=0) OR (num_nonnulls("sourceWorkOrderId","lastCompletedOn","lastMileageKm")=3 AND "lastMileageKm">=0))
 AND ("nextDueMileageKm" IS NULL OR ("nextDueMileageKm">=0 AND ("lastMileageKm" IS NULL OR "nextDueMileageKm">"lastMileageKm")))
 AND ("nextDueDate" IS NULL OR "lastCompletedOn" IS NULL OR "nextDueDate">"lastCompletedOn")
);
ALTER TABLE "AssetWorkOrderCost" ADD CONSTRAINT "AssetWorkOrderCost_values" CHECK (
 revision>=0 AND amount>0 AND category IN ('REPAIR','MAINTENANCE','TOWING') AND status IN ('DRAFT','FROZEN')
 AND length(trim("supplierName"))>0 AND length(trim("referenceNo"))>0 AND length(trim(reason))>0
 AND length(trim("createdBy"))>0 AND length(trim("updatedBy"))>0 AND ("replacesCostId" IS NULL OR "replacesCostId"<>id)
 AND ((status='DRAFT' AND num_nonnulls("sourceSnapshot","sourceHash","frozenBy","frozenAt")=0)
  OR (status='FROZEN' AND num_nonnulls("sourceSnapshot","sourceHash","frozenBy","frozenAt")=4 AND length(trim("frozenBy"))>0
   AND jsonb_typeof("sourceSnapshot")='object' AND "sourceSnapshot"<>'{}'::jsonb AND "sourceHash" ~ '^[a-f0-9]{64}$'))
);
ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_values" CHECK (
 revision>=0 AND amount>0 AND kind='INSURANCE_RECEIPT' AND status IN ('RECORDED','VOIDED')
 AND length(trim("referenceNo"))>0 AND length(trim(reason))>0 AND length(trim("recordedBy"))>0
 AND cardinality("evidenceFileIds") BETWEEN 1 AND 20 AND array_position("evidenceFileIds",NULL) IS NULL AND array_position("evidenceFileIds",'') IS NULL
 AND jsonb_typeof("evidenceSnapshot")='array' AND "evidenceSnapshot"<>'[]'::jsonb AND NOT ("evidenceSnapshot" @> '[null]'::jsonb)
);
ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_void" CHECK (
 (status='RECORDED' AND num_nonnulls("voidedBy","voidedAt","voidReason")=0)
 OR (status='VOIDED' AND num_nonnulls("voidedBy","voidedAt","voidReason")=3 AND length(trim("voidedBy"))>0 AND length(trim("voidReason"))>0)
);

ALTER TABLE "AssetCostPlan" DROP CONSTRAINT "AssetCostPlan_values";
ALTER TABLE "AssetCostPlan" ADD CONSTRAINT "AssetCostPlan_values" CHECK (
 "revision">=0 AND "sourceRevision">=0 AND "amount">=0 AND "periodStart"<="periodEnd"
 AND "costPeriod"=to_char("periodStart",'YYYY-MM') AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("sourceSnapshot")='object' AND "status" IN ('SCHEDULED','CONFIRMED','VOIDED')
 AND (("sourceKind"='BAAS' AND "baasContractId" IS NOT NULL AND "depreciationPolicyId" IS NULL AND "workOrderCostId" IS NULL AND "amount">0 AND "dueDate" IS NOT NULL)
  OR ("sourceKind"='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL AND "baasContractId" IS NULL AND "workOrderCostId" IS NULL AND "dueDate" IS NULL)
  OR ("sourceKind"='WORK_ORDER' AND "workOrderCostId" IS NOT NULL AND "baasContractId" IS NULL AND "depreciationPolicyId" IS NULL AND "amount">0 AND "dueDate" IS NULL AND "periodStart"="periodEnd"))
);
ALTER TABLE "AssetCostEntry" DROP CONSTRAINT "AssetCostEntry_values";
ALTER TABLE "AssetCostEntry" ADD CONSTRAINT "AssetCostEntry_values" CHECK (
 "revision">=0 AND "amount">=0 AND "periodStart"<="periodEnd"
 AND "category" IN ('BAAS_RENT','DEPRECIATION','REPAIR','MAINTENANCE','TOWING') AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND ("category" NOT IN ('REPAIR','MAINTENANCE','TOWING') OR "amount">0)
 AND jsonb_typeof("sourceSnapshot")='object'
 AND (("effect"='COST' AND "reversalOfId" IS NULL)
  OR ("effect"='REVERSAL' AND "reversalOfId" IS NOT NULL AND "reversalOfId"<>"id" AND length(trim("reason"))>0))
 AND (("lockedAt" IS NULL AND "lockedBy" IS NULL) OR ("lockedAt" IS NOT NULL AND "lockedBy" IS NOT NULL))
);
ALTER TABLE "AssetPrivateFile" DROP CONSTRAINT "AssetPrivateFile_scope";
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_scope" CHECK (
 sha256 ~ '^[a-f0-9]{64}$' AND num_nonnulls("baasContractId","depreciationPolicyId","costEntryId","licensePlateId","observationId","valuationReviewId","workOrderId","workOrderCostId")=1
 AND ((kind='BAAS' AND "baasContractId" IS NOT NULL) OR (kind='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL)
 OR (kind='COST' AND "costEntryId" IS NOT NULL) OR (kind='PLATE' AND "licensePlateId" IS NOT NULL)
 OR (kind='RESIDUAL_OBSERVATION' AND "observationId" IS NOT NULL) OR (kind='VALUATION' AND "valuationReviewId" IS NOT NULL)
 OR (kind='WORK_ORDER' AND "workOrderId" IS NOT NULL) OR (kind='WORK_ORDER_COST' AND "workOrderCostId" IS NOT NULL))
);

ALTER TABLE "AssetRecoveryRecord" ADD CONSTRAINT "AssetRecoveryRecord_dates" CHECK (("receivedOn" IS NULL OR (isfinite("receivedOn") AND "receivedOn" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("recordedAt" IS NULL OR (isfinite("recordedAt") AND "recordedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("voidedAt" IS NULL OR (isfinite("voidedAt") AND "voidedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
ALTER TABLE "AssetWorkOrder" ADD CONSTRAINT "AssetWorkOrder_dates" CHECK (("occurredAt" IS NULL OR (isfinite("occurredAt") AND "occurredAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("scheduledAt" IS NULL OR (isfinite("scheduledAt") AND "scheduledAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("submittedAt" IS NULL OR (isfinite("submittedAt") AND "submittedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("acceptedAt" IS NULL OR (isfinite("acceptedAt") AND "acceptedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("closedAt" IS NULL OR (isfinite("closedAt") AND "closedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("cancelledAt" IS NULL OR (isfinite("cancelledAt") AND "cancelledAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("accidentAt" IS NULL OR (isfinite("accidentAt") AND "accidentAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("createdAt" IS NULL OR (isfinite("createdAt") AND "createdAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("updatedAt" IS NULL OR (isfinite("updatedAt") AND "updatedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
ALTER TABLE "AssetWorkOrderCost" ADD CONSTRAINT "AssetWorkOrderCost_dates" CHECK (("occurredOn" IS NULL OR (isfinite("occurredOn") AND "occurredOn" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("frozenAt" IS NULL OR (isfinite("frozenAt") AND "frozenAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("createdAt" IS NULL OR (isfinite("createdAt") AND "createdAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("updatedAt" IS NULL OR (isfinite("updatedAt") AND "updatedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
ALTER TABLE "AssetWorkOrderEvent" ADD CONSTRAINT "AssetWorkOrderEvent_dates" CHECK (("actorAt" IS NULL OR (isfinite("actorAt") AND "actorAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
ALTER TABLE "VehicleMaintenanceSchedule" ADD CONSTRAINT "VehicleMaintenanceSchedule_dates" CHECK (("lastCompletedOn" IS NULL OR (isfinite("lastCompletedOn") AND "lastCompletedOn" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("nextDueDate" IS NULL OR (isfinite("nextDueDate") AND "nextDueDate" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("updatedAt" IS NULL OR (isfinite("updatedAt") AND "updatedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
ALTER TABLE "VehicleOperationalRestriction" ADD CONSTRAINT "VehicleOperationalRestriction_dates" CHECK (("createdAt" IS NULL OR (isfinite("createdAt") AND "createdAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')) AND ("releasedAt" IS NULL OR (isfinite("releasedAt") AND "releasedAt" BETWEEN TIMESTAMP '0001-01-01 00:00:00' AND TIMESTAMP '9999-12-31 23:59:59.999')));
