-- CreateTable
CREATE TABLE "VehicleOwner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creditCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerMember" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedSerialNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerInvitation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "mobileHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerESignAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "verificationTransactionNo" TEXT,
    "verificationUrlCiphertext" TEXT,
    "managerCiphertext" TEXT,
    "managerCustomerId" TEXT,
    "consentSnapshot" JSONB,
    "consentedAt" TIMESTAMP(3),
    "realNameStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "certStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "certSerialNo" TEXT,
    "evidenceHash" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerESignAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSeal" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL,
    "providerSignatureId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "imageHash" TEXT NOT NULL,
    "imageCiphertext" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "selectedBy" TEXT,
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerSeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerVehicle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "evidenceFileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleOwner_creditCode_key" ON "VehicleOwner"("creditCode");

-- CreateIndex
CREATE INDEX "OwnerMember_customerId_status_idx" ON "OwnerMember"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerMember_ownerId_customerId_key" ON "OwnerMember"("ownerId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerInvitation_tokenHash_key" ON "OwnerInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnerInvitation_ownerId_expiresAt_idx" ON "OwnerInvitation"("ownerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerESignAccount_ownerId_key" ON "OwnerESignAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerESignAccount_providerCustomerId_key" ON "OwnerESignAccount"("providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerESignAccount_verificationTransactionNo_key" ON "OwnerESignAccount"("verificationTransactionNo");

-- CreateIndex
CREATE INDEX "OwnerSeal_ownerId_status_idx" ON "OwnerSeal"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSeal_providerCustomerId_providerSignatureId_key" ON "OwnerSeal"("providerCustomerId", "providerSignatureId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerVehicle_vehicleId_key" ON "OwnerVehicle"("vehicleId");

-- AddForeignKey
ALTER TABLE "OwnerMember" ADD CONSTRAINT "OwnerMember_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerMember" ADD CONSTRAINT "OwnerMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerInvitation" ADD CONSTRAINT "OwnerInvitation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerESignAccount" ADD CONSTRAINT "OwnerESignAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerSeal" ADD CONSTRAINT "OwnerSeal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerVehicle" ADD CONSTRAINT "OwnerVehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerVehicle" ADD CONSTRAINT "OwnerVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
