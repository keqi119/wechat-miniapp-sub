CREATE TYPE "SwapCreditStatus" AS ENUM ('ACTIVE','FROZEN','EXPIRED','REFUNDED');
CREATE TYPE "SwapPurchaseStatus" AS ENUM ('PENDING_PAYMENT','ACTIVE','CONSUMED','EXPIRED','PAYMENT_REVIEW','REFUND_PENDING','REFUNDED','VOID');
ALTER TABLE "SwapCredit" ADD COLUMN "status" "SwapCreditStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "SwapLedger" ALTER COLUMN "changeId" DROP NOT NULL;
ALTER TABLE "SwapLedger" ADD COLUMN "purchaseId" TEXT;
CREATE TABLE "SwapCreditPurchase" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "orderId" TEXT NOT NULL REFERENCES "Order"("id"),
 "customerId" TEXT NOT NULL REFERENCES "Customer"("id"),
 "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity"=1),
 "amount" INTEGER NOT NULL DEFAULT 80000 CHECK ("amount"=80000),
 "currency" TEXT NOT NULL DEFAULT 'CNY' CHECK ("currency"='CNY'),
 "status" "SwapPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
 "billId" TEXT NOT NULL UNIQUE REFERENCES "Bill"("id"),
 "paymentId" TEXT UNIQUE REFERENCES "Payment"("id"),
 "creditId" TEXT UNIQUE REFERENCES "SwapCredit"("id"),
 "termsSnapshot" JSONB NOT NULL,
 "acceptedAt" TIMESTAMP(3) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "paidAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SwapCreditPurchase_orderId_idempotencyKey_key" ON "SwapCreditPurchase"("orderId","idempotencyKey");
CREATE INDEX "SwapCreditPurchase_customerId_status_idx" ON "SwapCreditPurchase"("customerId","status");
ALTER TABLE "SwapLedger" ADD CONSTRAINT "SwapLedger_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "SwapCreditPurchase"("id");
