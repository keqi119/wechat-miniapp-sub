CREATE TABLE "OwnerH5Session" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "csrfToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerH5Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerH5Session_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OwnerH5Session_customerId_expiresAt_idx" ON "OwnerH5Session"("customerId", "expiresAt");

CREATE TABLE "OwnerLegalRepresentative" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mobileHash" TEXT NOT NULL,
  "maskedMobile" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerLegalRepresentative_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerLegalRepresentative_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "VehicleOwner"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OwnerLegalRepresentative_ownerId_key" ON "OwnerLegalRepresentative"("ownerId");
CREATE INDEX "OwnerLegalRepresentative_mobileHash_idx" ON "OwnerLegalRepresentative"("mobileHash");
