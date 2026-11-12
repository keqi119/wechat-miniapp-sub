-- AlterTable
ALTER TABLE "FinalPlan" ADD COLUMN     "revenueRuleSnapshot" JSONB;

ALTER TABLE "FieldHandoverTask" DROP CONSTRAINT "FieldHandoverTask_status_check";
ALTER TABLE "FieldHandoverTask" ADD CONSTRAINT "FieldHandoverTask_status_check" CHECK ("status" IN ('ASSIGNED','CANCELLED','COMPLETED'));
