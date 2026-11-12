BEGIN;

-- Separately evidenced mutual cancellation agreement. No historical business facts are rewritten.
ALTER TABLE "OrderRenewalCancellation"
 ADD COLUMN "mutuallyAgreedAt" TIMESTAMP(3),
 ADD COLUMN "mutualAgreementVerifiedBy" TEXT,
 ADD COLUMN "mutualAgreementVerifiedAt" TIMESTAMP(3),
 ADD COLUMN "mutualAgreementEvidenceFileIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "mutualAgreementNote" TEXT,
 ADD COLUMN "mutualAgreementHash" TEXT;

ALTER TABLE "OrderRenewalCancellation"
 ADD CONSTRAINT "RenewalCancellation_mutual_agreement_complete_check" CHECK ((
  ("mutuallyAgreedAt" IS NULL AND "mutualAgreementVerifiedBy" IS NULL AND "mutualAgreementVerifiedAt" IS NULL
   AND cardinality("mutualAgreementEvidenceFileIds")=0 AND "mutualAgreementNote" IS NULL AND "mutualAgreementHash" IS NULL)
  OR
  ("mutuallyAgreedAt" IS NOT NULL AND "mutualAgreementVerifiedBy" IS NOT NULL AND length(btrim("mutualAgreementVerifiedBy"))>0
   AND "mutualAgreementVerifiedAt" IS NOT NULL AND "mutuallyAgreedAt"<="mutualAgreementVerifiedAt"
   AND cardinality("mutualAgreementEvidenceFileIds") BETWEEN 1 AND 20
   AND array_position("mutualAgreementEvidenceFileIds",NULL) IS NULL
   AND array_to_string("mutualAgreementEvidenceFileIds",E'\n') !~ E'(^|\n)[[:space:]]*(\n|$)'
   AND "mutualAgreementNote" IS NOT NULL AND length(btrim("mutualAgreementNote")) BETWEEN 1 AND 2000
   AND "mutualAgreementHash" ~ '^[a-f0-9]{64}$')
 ) IS TRUE),
 ADD CONSTRAINT "OrderRenewalCancellation_mutualAgreementVerifiedBy_fkey"
 FOREIGN KEY ("mutualAgreementVerifiedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
