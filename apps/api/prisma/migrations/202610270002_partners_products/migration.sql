-- AlterTable
ALTER TABLE "OwnerH5Session" ADD COLUMN     "identitySnapshot" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "productVersionId" TEXT;

-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "priceAdjustmentReason" TEXT,
ADD COLUMN     "productSnapshot" JSONB,
ADD COLUMN     "reviewStatus" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "VehicleOwner" ADD COLUMN     "subjectType" TEXT NOT NULL DEFAULT 'ENTERPRISE',
ALTER COLUMN "creditCode" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerVerification" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "profileRevision" INTEGER NOT NULL,
    "subjectType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "identityBindingId" TEXT NOT NULL,
    "identityBindingRevision" INTEGER NOT NULL,
    "evidenceFileIds" TEXT[],
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerIdentityBinding" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "profileRevision" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "evidenceFileIds" TEXT[],
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerIdentityBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerVehicleBindingHistory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "bindingRevision" INTEGER NOT NULL,
    "evidenceFileId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,

    CONSTRAINT "PartnerVehicleBindingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerVehicleBindingProposal" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "bindingRevision" INTEGER NOT NULL,
    "evidenceFileId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerVehicleBindingProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "monthlyFeeAmount" INTEGER NOT NULL,
    "mileagePerMonthKm" INTEGER NOT NULL,
    "excessMileagePriceAmount" INTEGER NOT NULL,
    "energyDescription" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "vehicleIds" TEXT[],
    "modelDefinitionIds" TEXT[],
    "createdBy" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredBy" TEXT,
    "retiredAt" TIMESTAMP(3),
    "retirementReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitDefinitionVersion" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" TEXT,
    "totalQuantity" INTEGER,
    "validity" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCombinationItem" (
    "id" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "benefitVersionId" TEXT,

    CONSTRAINT "ProductCombinationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCommand" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerVerification_ownerId_revision_key" ON "PartnerVerification"("ownerId", "revision");

-- CreateIndex
CREATE INDEX "PartnerIdentityBinding_customerId_status_idx" ON "PartnerIdentityBinding"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerIdentityBinding_ownerId_customerId_key" ON "PartnerIdentityBinding"("ownerId", "customerId");

-- CreateIndex
CREATE INDEX "PartnerVehicleBindingHistory_ownerId_vehicleId_idx" ON "PartnerVehicleBindingHistory"("ownerId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerVehicleBindingHistory_vehicleId_bindingRevision_key" ON "PartnerVehicleBindingHistory"("vehicleId", "bindingRevision");

-- CreateIndex
CREATE INDEX "PartnerVehicleBindingProposal_vehicleId_status_idx" ON "PartnerVehicleBindingProposal"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "ProductVersion_status_idx" ON "ProductVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_productId_version_key" ON "ProductVersion"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitDefinitionVersion_definitionId_version_key" ON "BenefitDefinitionVersion"("definitionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCombinationItem_productVersionId_position_key" ON "ProductCombinationItem"("productVersionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCommand_actorId_resourceId_action_key_key" ON "ProductCommand"("actorId", "resourceId", "action", "key");

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitDefinitionVersion" ADD CONSTRAINT "BenefitDefinitionVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BenefitDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCombinationItem" ADD CONSTRAINT "ProductCombinationItem_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCombinationItem" ADD CONSTRAINT "ProductCombinationItem_benefitVersionId_fkey" FOREIGN KEY ("benefitVersionId") REFERENCES "BenefitDefinitionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
