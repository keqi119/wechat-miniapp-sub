ALTER TYPE "MileagePurchaseStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "MileagePurchaseStatus" ADD VALUE 'REFUNDED';
ALTER TABLE "MileageLedger" DROP CONSTRAINT "MileageLedger_type";
ALTER TABLE "MileageLedger" ADD CONSTRAINT "MileageLedger_type" CHECK ("type" IN ('GRANT','CONSUME','EXPIRE','REFUND'));
