-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "lessorSnapshot" JSONB;

-- AlterTable
ALTER TABLE "OwnerSigningTask" ADD COLUMN     "signedPdfHash" TEXT;
