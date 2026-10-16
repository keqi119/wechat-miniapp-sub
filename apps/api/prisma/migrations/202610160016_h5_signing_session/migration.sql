CREATE TABLE "H5SigningSession" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "csrfToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "H5SigningSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "H5SigningSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "H5SigningSession_customerId_expiresAt_idx" ON "H5SigningSession"("customerId", "expiresAt");
