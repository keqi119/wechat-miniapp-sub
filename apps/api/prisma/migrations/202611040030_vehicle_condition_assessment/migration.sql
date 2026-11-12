CREATE TABLE "VehicleConditionAssessment" (
 "vehicleId" TEXT NOT NULL PRIMARY KEY,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "fireDamage" BOOLEAN NOT NULL,
 "floodDamage" BOOLEAN NOT NULL,
 "structuralDamage" BOOLEAN NOT NULL,
 "assessedBy" TEXT NOT NULL,
 "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VehicleConditionAssessment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "VehicleConditionAssessment_evidence_check" CHECK ("revision">=1 AND btrim("assessedBy")<>'' AND btrim("createdBy")<>'')
);
