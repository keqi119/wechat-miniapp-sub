BEGIN;
ALTER TABLE "SwapCredit" ADD COLUMN "termSequence" INTEGER, ADD COLUMN "policySnapshot" JSONB;
ALTER TABLE "SwapCreditPurchase" ADD COLUMN "pricingSnapshot" JSONB;
CREATE UNIQUE INDEX "SwapCredit_orderId_termSequence_key" ON "SwapCredit"("orderId","termSequence");

ALTER TABLE "SwapCredit" DROP CONSTRAINT "SwapCredit_source";
ALTER TABLE "SwapCredit" ADD CONSTRAINT "SwapCredit_source" CHECK (
  ("source"='FREE' AND "sourcePaymentId" IS NULL AND (
    ("policySnapshot" IS NULL AND "termSequence" IS NULL AND "cycleSequence" IS NOT NULL AND "cycleSequence">0)
    OR ("policySnapshot" IS NOT NULL AND "cycleSequence" IS NULL AND "termSequence" IS NOT NULL AND "termSequence">0)
  )) OR ("source"='PAID' AND "cycleSequence" IS NULL AND "termSequence" IS NULL AND "sourcePaymentId" IS NOT NULL)
);
ALTER TABLE "SwapCredit" ADD CONSTRAINT "SwapCredit_policy_shape" CHECK (
  "policySnapshot" IS NULL OR COALESCE(
    jsonb_typeof("policySnapshot")='object'
    AND "policySnapshot"->>'policyVersion'='SWAP_TERM_V2'
    AND "policySnapshot"->>'sourceHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("policySnapshot"->'includedCount')='number'
    AND "policySnapshot"->>'includedCount' ~ '^[0-9]+$'
    AND ("policySnapshot"->>'includedCount')::NUMERIC BETWEEN 0 AND 2147483647
    AND jsonb_typeof("policySnapshot"->'extraFeeAmount')='number'
    AND "policySnapshot"->>'extraFeeAmount' ~ '^[0-9]+$'
    AND ("policySnapshot"->>'extraFeeAmount')::NUMERIC BETWEEN 1 AND 2147483647
    AND ("termSequence" IS NULL OR "termSequence" <= ("policySnapshot"->>'includedCount')::NUMERIC), false)
);

ALTER TABLE "SwapCreditPurchase" DROP CONSTRAINT "SwapCreditPurchase_amount_check";
ALTER TABLE "SwapCreditPurchase" ADD CONSTRAINT "SwapCreditPurchase_amount_check" CHECK (
  ("pricingSnapshot" IS NULL AND "amount"=80000) OR (
    "pricingSnapshot" IS NOT NULL AND "amount">0 AND COALESCE(
      jsonb_typeof("pricingSnapshot")='object'
      AND "pricingSnapshot"->>'policyVersion'='SWAP_TERM_V2'
      AND "pricingSnapshot"->>'sourceHash' ~ '^[a-f0-9]{64}$'
      AND "pricingSnapshot"->'quantity'='1'::JSONB
      AND "pricingSnapshot"->>'currency'='CNY'
      AND jsonb_typeof("pricingSnapshot"->'amount')='number'
      AND "pricingSnapshot"->>'amount' ~ '^[0-9]+$'
      AND ("pricingSnapshot"->>'amount')::NUMERIC="amount"::NUMERIC, false)
  )
);
-- Historical records keep NULL snapshots and their original annual/80000-cent rules.
-- Existing active-reservation and payment/consumption/source-key unique indexes stay intact.
COMMIT;
