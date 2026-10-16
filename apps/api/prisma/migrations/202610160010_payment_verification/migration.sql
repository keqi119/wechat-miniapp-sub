CREATE TYPE "PaymentVerificationStatus" AS ENUM ('AUTHORIZED','CREATING','PENDING','SUCCEEDED','CLOSED','FAILED','EXPIRED');
CREATE TABLE "PaymentVerification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdBy" TEXT NOT NULL,
  "authorizationNote" TEXT NOT NULL,
  "amount" INTEGER NOT NULL DEFAULT 1 CHECK ("amount" = 1),
  "currency" TEXT NOT NULL DEFAULT 'CNY' CHECK ("currency" = 'CNY'),
  "status" "PaymentVerificationStatus" NOT NULL DEFAULT 'AUTHORIZED',
  "tradeNo" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "providerTransactionId" TEXT,
  "requestSnapshot" JSONB,
  "clientParameters" JSONB,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "PaymentVerification_tradeNo_key" ON "PaymentVerification"("tradeNo");
CREATE UNIQUE INDEX "PaymentVerification_providerTransactionId_key" ON "PaymentVerification"("providerTransactionId");
CREATE INDEX "PaymentVerification_customerId_createdAt_idx" ON "PaymentVerification"("customerId","createdAt");
-- A channel-pending record stays active even when its authorization has expired.
CREATE UNIQUE INDEX "PaymentVerification_one_active_customer" ON "PaymentVerification"("customerId") WHERE "status" IN ('AUTHORIZED','CREATING','PENDING');
CREATE TABLE "PaymentVerificationEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "verificationId" TEXT NOT NULL REFERENCES "PaymentVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
