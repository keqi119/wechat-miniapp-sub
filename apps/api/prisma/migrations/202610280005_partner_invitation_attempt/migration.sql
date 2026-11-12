CREATE TABLE "PartnerPortalInvitationAttempt" (
  "id" TEXT NOT NULL,
  "mobileHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPortalInvitationAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerPortalInvitationAttempt_mobileHash_createdAt_idx" ON "PartnerPortalInvitationAttempt"("mobileHash", "createdAt");
CREATE INDEX "PartnerPortalInvitationAttempt_codeHash_createdAt_idx" ON "PartnerPortalInvitationAttempt"("codeHash", "createdAt");
CREATE INDEX "PartnerPortalInvitationAttempt_ipHash_createdAt_idx" ON "PartnerPortalInvitationAttempt"("ipHash", "createdAt");
