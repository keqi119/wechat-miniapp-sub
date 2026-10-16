-- CreateEnum
CREATE TYPE "CreditBand" AS ENUM ('GE750', 'B700_749', 'B650_699', 'LT650', 'UNVERIFIABLE');

-- CreateEnum
CREATE TYPE "CreditConsentStatus" AS ENUM ('ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "creditRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "creditBand" "CreditBand",
ADD COLUMN     "creditRevision" INTEGER,
ADD COLUMN     "creditRuleVersion" TEXT,
ADD COLUMN     "creditVerificationId" TEXT;

-- CreateTable
CREATE TABLE "CreditConsent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CreditConsentStatus" NOT NULL,
    "revision" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalKey" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditVerification" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "band" "CreditBand" NOT NULL,
    "revision" INTEGER NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "verifiedBy" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "CreditVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditConsent_applicationId_idempotencyKey_key" ON "CreditConsent"("applicationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditConsent_applicationId_revision_key" ON "CreditConsent"("applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CreditVerification_applicationId_idempotencyKey_key" ON "CreditVerification"("applicationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditVerification_applicationId_revision_key" ON "CreditVerification"("applicationId", "revision");

-- AddForeignKey
ALTER TABLE "FinalPlan" ADD CONSTRAINT "FinalPlan_creditVerificationId_fkey" FOREIGN KEY ("creditVerificationId") REFERENCES "CreditVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditConsent" ADD CONSTRAINT "CreditConsent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditVerification" ADD CONSTRAINT "CreditVerification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditVerification" ADD CONSTRAINT "CreditVerification_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "CreditConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
