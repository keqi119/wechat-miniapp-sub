-- Freeze the original command's exact funds without rewriting legacy responses.
-- The existing SwapFactAmountResponse_immutable trigger protects this column too.
ALTER TABLE "SwapFactAmountResponse" ADD COLUMN "fundsSnapshot" JSONB;
