-- Additive v2.3 migration. No previous business row is deleted or auto-approved.
ALTER TABLE "VehicleOwner" ADD COLUMN "cooperationMode" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Payment" ADD COLUMN "succeededAt" TIMESTAMP(3);
ALTER TABLE "Refund" ADD COLUMN "succeededAt" TIMESTAMP(3);
ALTER TABLE "PartnerPortalAccess" ADD COLUMN "bindingMethod" TEXT,
 ADD COLUMN "boundAt" TIMESTAMP(3), ADD COLUMN "boundInvitationId" TEXT;

CREATE TABLE "PartnerAgreement" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'DRAFT', "currentVersionId" TEXT, "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PartnerAgreement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerAgreement_ownerId_status_idx" ON "PartnerAgreement"("ownerId","status");
CREATE TABLE "PartnerAgreementVersion" (
 "id" TEXT NOT NULL, "agreementId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "version" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "title" TEXT NOT NULL DEFAULT '', "referenceNumber" TEXT NOT NULL DEFAULT '',
 "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[], "vehicleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
 "partnerRateBps" INTEGER, "validFrom" TEXT, "validUntil" TEXT, "notes" TEXT NOT NULL DEFAULT '',
 "contentHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PartnerAgreementVersion_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PartnerAgreementVersion_rate_range" CHECK ("partnerRateBps" IS NULL OR "partnerRateBps" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX "PartnerAgreementVersion_agreementId_version_key" ON "PartnerAgreementVersion"("agreementId","version");
CREATE INDEX "PartnerAgreementVersion_ownerId_createdAt_idx" ON "PartnerAgreementVersion"("ownerId","createdAt");
CREATE TABLE "PartnerAgreementVehicle" (
 "vehicleId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "agreementId" TEXT NOT NULL,
 "agreementVersionId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "assignedBy" TEXT NOT NULL, "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PartnerAgreementVehicle_pkey" PRIMARY KEY ("vehicleId")
);
CREATE INDEX "PartnerAgreementVehicle_ownerId_agreementId_idx" ON "PartnerAgreementVehicle"("ownerId","agreementId");
CREATE TABLE "PartnerPortalInvitation" (
 "id" TEXT NOT NULL, "accessId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "mobileHash" TEXT NOT NULL, "codeHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "accessVersion" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "boundAt" TIMESTAMP(3), "previewTokenHash" TEXT, "previewExpiresAt" TIMESTAMP(3),
 CONSTRAINT "PartnerPortalInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartnerPortalInvitation_codeHash_key" ON "PartnerPortalInvitation"("codeHash");
CREATE UNIQUE INDEX "PartnerPortalInvitation_previewTokenHash_key" ON "PartnerPortalInvitation"("previewTokenHash");
CREATE INDEX "PartnerPortalInvitation_accessId_status_idx" ON "PartnerPortalInvitation"("accessId","status");
CREATE INDEX "PartnerPortalInvitation_mobileHash_createdAt_idx" ON "PartnerPortalInvitation"("mobileHash","createdAt");
CREATE TABLE "PartnerRevenueEvent" (
 "id" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
 "paymentId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "agreementId" TEXT NOT NULL, "agreementVersionId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL,
 "modelId" TEXT, "modelName" TEXT NOT NULL, "plateNumber" TEXT NOT NULL,
 "partnerRateBps" INTEGER NOT NULL, "amount" INTEGER NOT NULL, "partnerAmount" INTEGER NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PartnerRevenueEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PartnerRevenueEvent_rate_range" CHECK ("partnerRateBps" BETWEEN 0 AND 10000),
 CONSTRAINT "PartnerRevenueEvent_source_type" CHECK ("sourceType" IN ('PAYMENT','REFUND'))
);
CREATE UNIQUE INDEX "PartnerRevenueEvent_sourceType_sourceId_key" ON "PartnerRevenueEvent"("sourceType","sourceId");
CREATE INDEX "PartnerRevenueEvent_ownerId_occurredAt_idx" ON "PartnerRevenueEvent"("ownerId","occurredAt");
CREATE INDEX "PartnerRevenueEvent_paymentId_sourceType_idx" ON "PartnerRevenueEvent"("paymentId","sourceType");
CREATE INDEX "PartnerRevenueEvent_ownerId_agreementId_occurredAt_idx" ON "PartnerRevenueEvent"("ownerId","agreementId","occurredAt");
