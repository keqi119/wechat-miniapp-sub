ALTER TABLE "InsurancePolicyVersion"
 ADD COLUMN "policyType" TEXT,
 ADD COLUMN "insurerSnapshot" TEXT,
 ADD COLUMN "policyNumberSnapshot" TEXT,
 ADD COLUMN "registeredBy" TEXT,
 ADD COLUMN "registeredAt" TIMESTAMP(3),
 ADD COLUMN "registrationSnapshot" JSONB,
 ADD COLUMN "changeReason" TEXT;

-- Identity was immutable in the legacy workflow. Preserve the known identity before any new correction.
-- Historical policy types and pre-normalization raw text are unknown and must not be invented.
UPDATE "InsurancePolicyVersion" v SET "insurerSnapshot"=p."insurer", "policyNumberSnapshot"=p."policyNumber"
 FROM "InsurancePolicy" p WHERE p."id"=v."policyId";

ALTER TABLE "InsurancePolicyVersion" ADD CONSTRAINT "InsurancePolicyVersion_policyType_valid"
 CHECK ("policyType" IS NULL OR "policyType" IN ('COMPULSORY_TRAFFIC','COMMERCIAL','DRIVER_PASSENGER','OTHER'));
ALTER TABLE "InsurancePolicyVersion" ADD CONSTRAINT "InsurancePolicyVersion_registration_evidence"
 CHECK (("status" <> 'REGISTERED' AND "registeredBy" IS NULL AND "registeredAt" IS NULL AND "registrationSnapshot" IS NULL)
 OR ("status"='REGISTERED' AND "registeredBy" IS NOT NULL AND length("registeredBy")>0 AND "registeredAt" IS NOT NULL
 AND "registrationSnapshot" IS NOT NULL AND ("registrationSnapshot"->>'confirmed'='true') IS TRUE
 AND "policyType" IS NOT NULL AND "insurerSnapshot" IS NOT NULL AND "policyNumberSnapshot" IS NOT NULL
 AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "startAt"<"endAt"));
