ALTER TABLE "ESignAccount"
  ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "verifiedIdentityHash" TEXT,
  ADD COLUMN "verificationLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "verificationLeaseToken" TEXT;
-- Existing identities require a fresh provider query to bind the current ciphertext.
