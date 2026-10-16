CREATE TABLE "SmsChallenge" (
  "id" TEXT NOT NULL,
  "mobile" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SmsChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SmsChallenge_mobile_sentAt_idx" ON "SmsChallenge"("mobile", "sentAt");
