ALTER TABLE "CustomerQualificationVersion" ALTER COLUMN "identityExpiresAt" DROP NOT NULL;
ALTER TABLE "CustomerQualificationVersion" ALTER COLUMN "drivingLicenseExpiresAt" DROP NOT NULL;
ALTER TABLE "CustomerQualificationVersion" ADD COLUMN "identityLongTerm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerQualificationVersion" ADD COLUMN "drivingLicenseLongTerm" BOOLEAN NOT NULL DEFAULT false;
