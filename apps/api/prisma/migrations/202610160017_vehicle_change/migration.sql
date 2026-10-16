-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('OPEN', 'REVIEW_PENDING', 'READY', 'FROZEN');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('HELD', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "SwapCreditSource" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "SwapReservationStatus" AS ENUM ('RESERVED', 'RELEASED', 'CONSUMED');

-- AlterEnum
ALTER TYPE "OrderChangeStatus" ADD VALUE 'SWAP_RETURNED';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "holdId" TEXT,
ADD COLUMN     "plateNumber" TEXT,
ADD COLUMN     "vin" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "currentAssignmentId" TEXT;

-- AlterTable
ALTER TABLE "Handover" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "changeId" TEXT,
ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "Mileage" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "segmentId" TEXT;

-- AlterTable
ALTER TABLE "OrderChange" ADD COLUMN     "actualCompletedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryHandoverId" TEXT,
ADD COLUMN     "returnHandoverId" TEXT,
ADD COLUMN     "targetVehicleId" TEXT;

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "changeId" TEXT,
    "deliveryHandoverId" TEXT,
    "returnHandoverId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startReadingKm" INTEGER NOT NULL,
    "endReadingKm" INTEGER,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSegment" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startReadingKm" INTEGER,
    "endReadingKm" INTEGER,
    "readingId" TEXT,
    "endHandoverId" TEXT,
    "status" "SegmentStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "frozenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleHold" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "VehicleHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapCredit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "source" "SwapCreditSource" NOT NULL,
    "cycleSequence" INTEGER,
    "sourcePaymentId" TEXT,
    "consumedChangeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "status" "SwapReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapLedger" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "source" "SwapCreditSource" NOT NULL,
    "cycleSequence" INTEGER,
    "type" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "actualAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAssignment_deliveryHandoverId_key" ON "VehicleAssignment"("deliveryHandoverId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAssignment_returnHandoverId_key" ON "VehicleAssignment"("returnHandoverId");

-- CreateIndex
CREATE INDEX "VehicleAssignment_orderId_startAt_idx" ON "VehicleAssignment"("orderId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageSegment_periodId_assignmentId_key" ON "UsageSegment"("periodId", "assignmentId");

-- CreateIndex
CREATE INDEX "VehicleHold_changeId_status_idx" ON "VehicleHold"("changeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SwapCredit_sourcePaymentId_key" ON "SwapCredit"("sourcePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapCredit_consumedChangeId_key" ON "SwapCredit"("consumedChangeId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapCredit_orderId_cycleSequence_key" ON "SwapCredit"("orderId", "cycleSequence");

-- CreateIndex
CREATE INDEX "SwapReservation_changeId_status_idx" ON "SwapReservation"("changeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SwapLedger_sourceKey_key" ON "SwapLedger"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_holdId_key" ON "Vehicle"("holdId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_currentAssignmentId_key" ON "Order"("currentAssignmentId");

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSegment" ADD CONSTRAINT "UsageSegment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "UsagePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSegment" ADD CONSTRAINT "UsageSegment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "VehicleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapReservation" ADD CONSTRAINT "SwapReservation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "SwapCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "VehicleAssignment_active_order" ON "VehicleAssignment"("orderId") WHERE "status"='ACTIVE';
CREATE UNIQUE INDEX "VehicleAssignment_active_vehicle" ON "VehicleAssignment"("vehicleId") WHERE "status"='ACTIVE';
CREATE UNIQUE INDEX "VehicleHold_active_vehicle" ON "VehicleHold"("vehicleId") WHERE "status"='HELD';
CREATE UNIQUE INDEX "SwapReservation_active_credit" ON "SwapReservation"("creditId") WHERE "status"='RESERVED';
ALTER TABLE "SwapCredit" ADD CONSTRAINT "SwapCredit_source" CHECK (("source"='FREE' AND "cycleSequence">0 AND "sourcePaymentId" IS NULL) OR ("source"='PAID' AND "cycleSequence" IS NULL AND "sourcePaymentId" IS NOT NULL));
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_readings" CHECK ("startReadingKm">=0 AND ("endReadingKm" IS NULL OR "endReadingKm">="startReadingKm") AND ("endAt" IS NULL OR "endAt">="startAt"));
ALTER TABLE "UsageSegment" ADD CONSTRAINT "UsageSegment_readings" CHECK (("startReadingKm" IS NULL OR "startReadingKm">=0) AND ("endReadingKm" IS NULL OR "startReadingKm" IS NULL OR "endReadingKm">="startReadingKm"));
