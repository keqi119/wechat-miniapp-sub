BEGIN;
-- AlterTable
ALTER TABLE "VehicleAssetProfile" ADD COLUMN     "batteryCapacityKwh" DECIMAL(8,3);

-- AlterTable
ALTER TABLE "AssetPrivateFile" ADD COLUMN     "observationId" TEXT,
ADD COLUMN     "valuationReviewId" TEXT;

-- CreateTable
CREATE TABLE "MarketPriceObservation" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "modelDefinitionId" TEXT NOT NULL,
    "modelSnapshot" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "sourceListingId" TEXT,
    "observedOn" DATE NOT NULL,
    "priceType" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "batteryOwnership" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "batteryCapacityKwh" DECIMAL(8,3),
    "mileageKm" INTEGER,
    "registrationDate" DATE,
    "vehicleAgeMonths" INTEGER,
    "province" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "trim" TEXT NOT NULL DEFAULT '',
    "conditionGrade" TEXT NOT NULL DEFAULT '',
    "batteryHealthPercent" INTEGER,
    "accidentFlag" BOOLEAN,
    "sourceUrl" TEXT,
    "sourceNote" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "correctionOfId" TEXT,
    "importBatchId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketPriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPriceImportBatch" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "csvHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "importedCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "rowResults" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPriceImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleResidualCurve" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "modelDefinitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dimensionHash" TEXT NOT NULL,
    "dimensionSnapshot" JSONB NOT NULL,
    "filterSnapshot" JSONB NOT NULL,
    "referencePriceAmount" INTEGER,
    "algorithmVersion" TEXT NOT NULL,
    "referenceCommit" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "skippedReasons" JSONB NOT NULL,
    "effectiveFrom" DATE,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "supersededAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleResidualCurve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleResidualCurvePoint" (
    "id" TEXT NOT NULL,
    "curveId" TEXT NOT NULL,
    "ageMonth" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "medianPriceAmount" INTEGER NOT NULL,
    "p25PriceAmount" INTEGER NOT NULL,
    "p75PriceAmount" INTEGER NOT NULL,
    "averagePriceAmount" INTEGER NOT NULL,
    "minPriceAmount" INTEGER NOT NULL,
    "maxPriceAmount" INTEGER NOT NULL,
    "predictedResidualRateBps" INTEGER,
    "confidenceScore" INTEGER NOT NULL,
    "sampleSnapshot" JSONB NOT NULL,

    CONSTRAINT "VehicleResidualCurvePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleResidualForecast" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "vehicleId" TEXT NOT NULL,
    "curveId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "vehicleRevision" INTEGER NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "curveRevision" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "curveSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleResidualForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleResidualForecastPoint" (
    "id" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "horizonMonth" INTEGER NOT NULL,
    "targetDate" DATE NOT NULL,
    "targetAgeMonth" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "interpolationMethod" TEXT NOT NULL,
    "predictedAmount" INTEGER,
    "lowerAmount" INTEGER,
    "upperAmount" INTEGER,
    "predictedResidualRateBps" INTEGER,
    "matchSnapshot" JSONB NOT NULL,
    "adoptedAmount" INTEGER,
    "adoptReason" TEXT,
    "adoptedBy" TEXT,
    "adoptedAt" TIMESTAMP(3),

    CONSTRAINT "VehicleResidualForecastPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleValuationReview" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "vehicleId" TEXT NOT NULL,
    "forecastPointId" TEXT,
    "source" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeSnapshot" JSONB NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAmount" INTEGER,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "nextReviewDate" DATE,
    "evidenceFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceSnapshot" JSONB,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleValuationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketPriceObservation_modelDefinitionId_status_observedOn_idx" ON "MarketPriceObservation"("modelDefinitionId", "status", "observedOn");

-- CreateIndex
CREATE INDEX "MarketPriceObservation_importBatchId_idx" ON "MarketPriceObservation"("importBatchId");

-- CreateIndex
CREATE INDEX "MarketPriceObservation_dedupeKey_idx" ON "MarketPriceObservation"("dedupeKey");

-- CreateIndex
CREATE INDEX "MarketPriceImportBatch_createdAt_idx" ON "MarketPriceImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "VehicleResidualCurve_modelDefinitionId_status_idx" ON "VehicleResidualCurve"("modelDefinitionId", "status");

-- CreateIndex
CREATE INDEX "VehicleResidualCurve_dimensionHash_idx" ON "VehicleResidualCurve"("dimensionHash");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleResidualCurvePoint_curveId_ageMonth_key" ON "VehicleResidualCurvePoint"("curveId", "ageMonth");

-- CreateIndex
CREATE INDEX "VehicleResidualForecast_vehicleId_status_createdAt_idx" ON "VehicleResidualForecast"("vehicleId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleResidualForecast_curveId_idx" ON "VehicleResidualForecast"("curveId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleResidualForecastPoint_forecastId_horizonMonth_key" ON "VehicleResidualForecastPoint"("forecastId", "horizonMonth");

-- CreateIndex
CREATE INDEX "VehicleValuationReview_vehicleId_status_createdAt_idx" ON "VehicleValuationReview"("vehicleId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleValuationReview_forecastPointId_idx" ON "VehicleValuationReview"("forecastPointId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_observationId_idx" ON "AssetPrivateFile"("observationId");

-- CreateIndex
CREATE INDEX "AssetPrivateFile_valuationReviewId_idx" ON "AssetPrivateFile"("valuationReviewId");

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MarketPriceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_valuationReviewId_fkey" FOREIGN KEY ("valuationReviewId") REFERENCES "VehicleValuationReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceObservation" ADD CONSTRAINT "MarketPriceObservation_modelDefinitionId_fkey" FOREIGN KEY ("modelDefinitionId") REFERENCES "ModelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPriceObservation" ADD CONSTRAINT "MarketPriceObservation_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "MarketPriceObservation"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MarketPriceObservation" ADD CONSTRAINT "MarketPriceObservation_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "MarketPriceImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleResidualCurve" ADD CONSTRAINT "VehicleResidualCurve_modelDefinitionId_fkey" FOREIGN KEY ("modelDefinitionId") REFERENCES "ModelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleResidualCurvePoint" ADD CONSTRAINT "VehicleResidualCurvePoint_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "VehicleResidualCurve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleResidualForecast" ADD CONSTRAINT "VehicleResidualForecast_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleResidualForecast" ADD CONSTRAINT "VehicleResidualForecast_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "VehicleResidualCurve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleResidualForecastPoint" ADD CONSTRAINT "VehicleResidualForecastPoint_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "VehicleResidualForecast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleValuationReview" ADD CONSTRAINT "VehicleValuationReview_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleValuationReview" ADD CONSTRAINT "VehicleValuationReview_forecastPointId_fkey" FOREIGN KEY ("forecastPointId") REFERENCES "VehicleResidualForecastPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "VehicleAssetProfile" ADD CONSTRAINT "VehicleAssetProfile_capacity" CHECK ("batteryCapacityKwh" IS NULL OR "batteryCapacityKwh" BETWEEN 0 AND 99999.999);

ALTER TABLE "MarketPriceObservation" ADD CONSTRAINT "MarketPriceObservation_values" CHECK (
 revision>=0 AND "priceAmount">0 AND "confidenceScore" BETWEEN 0 AND 100
 AND source IN ('MANUAL','CSV_IMPORT','INTERNAL_DISPOSAL','DEALER_QUOTE','AUCTION','USED_CAR_PLATFORM','OTHER')
 AND "priceType" IN ('LISTING','TRANSACTION','AUCTION','DEALER_QUOTE','INTERNAL_SALE','ESTIMATE')
 AND status IN ('ACTIVE','IGNORED','VOIDED') AND "batteryOwnership" IN ('UNKNOWN','OWNED','BAAS')
 AND ("batteryCapacityKwh" IS NULL OR "batteryCapacityKwh" BETWEEN 0 AND 99999.999)
 AND ("mileageKm" IS NULL OR "mileageKm">=0) AND ("vehicleAgeMonths" IS NULL OR "vehicleAgeMonths">=0)
 AND ("batteryHealthPercent" IS NULL OR "batteryHealthPercent" BETWEEN 0 AND 100)
 AND length(btrim("sourceNote"))>0 AND "dedupeKey" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("modelSnapshot")='object' AND ("correctionOfId" IS NULL OR "correctionOfId"<>id)
);
CREATE UNIQUE INDEX "MarketPriceObservation_one_current_key" ON "MarketPriceObservation"("dedupeKey") WHERE status IN ('ACTIVE','IGNORED');

ALTER TABLE "MarketPriceImportBatch" ADD CONSTRAINT "MarketPriceImportBatch_values" CHECK (
 revision>=0 AND "csvHash" ~ '^[a-f0-9]{64}$' AND length(btrim("fileName"))>0
 AND source IN ('MANUAL','CSV_IMPORT','INTERNAL_DISPOSAL','DEALER_QUOTE','AUCTION','USED_CAR_PLATFORM','OTHER')
 AND "rowCount" BETWEEN 1 AND 1000 AND "importedCount">=0 AND "duplicateCount">=0 AND "failedCount">=0
 AND "rowCount"="importedCount"+"duplicateCount"+"failedCount" AND jsonb_typeof("rowResults")='array'
 AND ((status='COMPLETED' AND "failedCount"=0) OR (status='PARTIAL_FAILED' AND "failedCount">0 AND "failedCount"<"rowCount") OR (status='FAILED' AND "failedCount"="rowCount"))
);

ALTER TABLE "VehicleResidualCurve" ADD CONSTRAINT "VehicleResidualCurve_values" CHECK (
 revision>=0 AND length(btrim(name))>0 AND "dimensionHash" ~ '^[a-f0-9]{64}$' AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND "referenceCommit" ~ '^[a-f0-9]{40}$' AND length(btrim("algorithmVersion"))>0
 AND "pointCount">0 AND "sampleCount">="pointCount" AND "confidenceScore" BETWEEN 0 AND 100
 AND ("referencePriceAmount" IS NULL OR "referencePriceAmount">0)
 AND jsonb_typeof("dimensionSnapshot")='object' AND jsonb_typeof("filterSnapshot")='object'
 AND jsonb_typeof("sourceSnapshot")='object' AND jsonb_typeof("skippedReasons")='array'
 AND (("activatedAt" IS NULL AND "activatedBy" IS NULL AND "effectiveFrom" IS NULL) OR
 ("activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL AND length(btrim("activatedBy"))>0 AND "effectiveFrom" IS NOT NULL))
 AND ((status='DRAFT' AND "activatedAt" IS NULL AND "supersededAt" IS NULL AND "archivedAt" IS NULL)
 OR (status='ACTIVE' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NULL AND "archivedAt" IS NULL)
 OR (status='SUPERSEDED' AND "activatedAt" IS NOT NULL AND "supersededAt" IS NOT NULL AND "archivedAt" IS NULL)
 OR (status='ARCHIVED' AND "archivedAt" IS NOT NULL AND ("supersededAt" IS NULL OR "activatedAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "VehicleResidualCurve_one_active_dimension" ON "VehicleResidualCurve"("dimensionHash") WHERE status='ACTIVE';

ALTER TABLE "VehicleResidualCurvePoint" ADD CONSTRAINT "VehicleResidualCurvePoint_values" CHECK (
 "ageMonth">=0 AND "sampleCount">0 AND "confidenceScore" BETWEEN 0 AND 100
 AND "minPriceAmount">0 AND "minPriceAmount"<="p25PriceAmount" AND "p25PriceAmount"<="medianPriceAmount"
 AND "medianPriceAmount"<="p75PriceAmount" AND "p75PriceAmount"<="maxPriceAmount"
 AND "averagePriceAmount" BETWEEN "minPriceAmount" AND "maxPriceAmount"
 AND ("predictedResidualRateBps" IS NULL OR "predictedResidualRateBps">=0) AND jsonb_typeof("sampleSnapshot")='array'
);

ALTER TABLE "VehicleResidualForecast" ADD CONSTRAINT "VehicleResidualForecast_values" CHECK (
 revision>=0 AND "vehicleRevision">=0 AND "assetRevision">=0 AND "curveRevision">=0
 AND status IN ('GENERATED','ADOPTED','ARCHIVED','VOIDED') AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("inputSnapshot")='object' AND jsonb_typeof("curveSnapshot")='object'
);

ALTER TABLE "VehicleResidualForecastPoint" ADD CONSTRAINT "VehicleResidualForecastPoint_values" CHECK (
 "horizonMonth" BETWEEN 0 AND 120 AND "targetAgeMonth">=0 AND jsonb_typeof("matchSnapshot")='object'
 AND ("predictedResidualRateBps" IS NULL OR "predictedResidualRateBps">=0)
 AND ((status='UNSUPPORTED' AND "interpolationMethod"='UNSUPPORTED' AND "predictedAmount" IS NULL AND "lowerAmount" IS NULL AND "upperAmount" IS NULL AND "predictedResidualRateBps" IS NULL)
 OR (status IN ('GENERATED','ADOPTED') AND "interpolationMethod" IN ('EXACT','LINEAR_INTERPOLATION')
 AND "predictedAmount" IS NOT NULL AND "lowerAmount" IS NOT NULL AND "upperAmount" IS NOT NULL
 AND "lowerAmount">0 AND "lowerAmount"<="predictedAmount" AND "predictedAmount"<="upperAmount"))
 AND ((status='ADOPTED' AND "adoptedAmount" IS NOT NULL AND "adoptedAmount">0 AND "adoptReason" IS NOT NULL AND length(btrim("adoptReason"))>0 AND "adoptedBy" IS NOT NULL AND length(btrim("adoptedBy"))>0 AND "adoptedAt" IS NOT NULL)
 OR (status<>'ADOPTED' AND "adoptedAmount" IS NULL AND "adoptReason" IS NULL AND "adoptedBy" IS NULL AND "adoptedAt" IS NULL))
);

ALTER TABLE "VehicleValuationReview" ALTER COLUMN "evidenceFileIds" SET NOT NULL;
ALTER TABLE "VehicleValuationReview" ADD CONSTRAINT "VehicleValuationReview_values" CHECK (
 revision>=0 AND "requestedAmount">0 AND length(btrim(reason))>0 AND "sourceHash" ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof("beforeSnapshot")='object' AND jsonb_typeof("sourceSnapshot")='object'
 AND ((source='MANUAL' AND "forecastPointId" IS NULL) OR (source='FORECAST' AND "forecastPointId" IS NOT NULL))
 AND cardinality("evidenceFileIds") BETWEEN 0 AND 20 AND array_position("evidenceFileIds",NULL) IS NULL
 AND ((status='PENDING' AND "approvedAmount" IS NULL AND "decidedAt" IS NULL AND "decidedBy" IS NULL AND "decisionReason" IS NULL AND "nextReviewDate" IS NULL AND cardinality("evidenceFileIds")=0 AND "evidenceSnapshot" IS NULL)
 OR (status IN ('APPROVED','REJECTED','CANCELLED') AND "decidedAt" IS NOT NULL AND "decidedBy" IS NOT NULL AND length(btrim("decidedBy"))>0 AND "decisionReason" IS NOT NULL AND length(btrim("decisionReason"))>0
 AND ((status='APPROVED' AND "approvedAmount" IS NOT NULL AND "approvedAmount">0 AND "nextReviewDate" IS NOT NULL AND cardinality("evidenceFileIds") BETWEEN 1 AND 20 AND "evidenceSnapshot" IS NOT NULL AND jsonb_typeof("evidenceSnapshot")='array' AND jsonb_array_length("evidenceSnapshot")=cardinality("evidenceFileIds"))
 OR (status IN ('REJECTED','CANCELLED') AND "approvedAmount" IS NULL AND "nextReviewDate" IS NULL AND cardinality("evidenceFileIds")=0 AND "evidenceSnapshot" IS NULL))))
);
CREATE UNIQUE INDEX "VehicleValuationReview_one_pending_point" ON "VehicleValuationReview"("forecastPointId") WHERE status='PENDING' AND "forecastPointId" IS NOT NULL;

ALTER TABLE "AssetPrivateFile" DROP CONSTRAINT "AssetPrivateFile_scope";
ALTER TABLE "AssetPrivateFile" ADD CONSTRAINT "AssetPrivateFile_scope" CHECK (
 sha256 ~ '^[a-f0-9]{64}$' AND num_nonnulls("baasContractId","depreciationPolicyId","costEntryId","licensePlateId","observationId","valuationReviewId")=1
 AND ((kind='BAAS' AND "baasContractId" IS NOT NULL) OR (kind='DEPRECIATION' AND "depreciationPolicyId" IS NOT NULL)
 OR (kind='COST' AND "costEntryId" IS NOT NULL) OR (kind='PLATE' AND "licensePlateId" IS NOT NULL)
 OR (kind='RESIDUAL_OBSERVATION' AND "observationId" IS NOT NULL) OR (kind='VALUATION' AND "valuationReviewId" IS NOT NULL))
);

ALTER TABLE "MarketPriceObservation" ADD CONSTRAINT "MarketPriceObservation_dates" CHECK (("observedOn" IS NULL OR (isfinite("observedOn") AND "observedOn" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')) AND ("registrationDate" IS NULL OR (isfinite("registrationDate") AND "registrationDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')));
ALTER TABLE "VehicleResidualCurve" ADD CONSTRAINT "VehicleResidualCurve_dates" CHECK (("effectiveFrom" IS NULL OR (isfinite("effectiveFrom") AND "effectiveFrom" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')));
ALTER TABLE "VehicleResidualForecast" ADD CONSTRAINT "VehicleResidualForecast_dates" CHECK (("asOfDate" IS NULL OR (isfinite("asOfDate") AND "asOfDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')));
ALTER TABLE "VehicleResidualForecastPoint" ADD CONSTRAINT "VehicleResidualForecastPoint_dates" CHECK (("targetDate" IS NULL OR (isfinite("targetDate") AND "targetDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')));
ALTER TABLE "VehicleValuationReview" ADD CONSTRAINT "VehicleValuationReview_dates" CHECK (("nextReviewDate" IS NULL OR (isfinite("nextReviewDate") AND "nextReviewDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')));
COMMIT;
