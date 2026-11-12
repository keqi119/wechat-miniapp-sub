-- CHECK accepts NULL unless the complete paired expression must be TRUE.
ALTER TABLE "Refund" DROP CONSTRAINT "Refund_cancellation04_pair";
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cancellation04_pair" CHECK ((("preDeliveryCancellationId" IS NULL AND "preDeliveryCancellationSourceHash" IS NULL) OR ("preDeliveryCancellationId" IS NOT NULL AND "preDeliveryCancellationSourceHash" ~ '^[a-f0-9]{64}$')) IS TRUE);
