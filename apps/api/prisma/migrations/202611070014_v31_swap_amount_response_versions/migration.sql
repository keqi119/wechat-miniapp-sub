BEGIN;
-- Only add deterministic chain metadata; original decisions, sources and timestamps stay intact.
LOCK TABLE "SwapFactAmountResponse" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "SwapFactAmountResponse" ADD COLUMN "revision" INTEGER, ADD COLUMN "previousResponseId" TEXT;
DROP TRIGGER "SwapFactAmountResponse_immutable" ON "SwapFactAmountResponse";
WITH ordered AS (
 SELECT "id", row_number() OVER w AS revision, lag("id") OVER w AS predecessor
 FROM "SwapFactAmountResponse" WINDOW w AS (PARTITION BY "settlementId" ORDER BY "createdAt", "id")
)
UPDATE "SwapFactAmountResponse" AS response SET "revision"=ordered.revision, "previousResponseId"=ordered.predecessor FROM ordered WHERE response."id"=ordered."id";
CREATE TRIGGER "SwapFactAmountResponse_immutable" BEFORE UPDATE OR DELETE ON "SwapFactAmountResponse" FOR EACH ROW EXECUTE FUNCTION ninda_v31_swap_receipt_immutable();
ALTER TABLE "SwapFactAmountResponse" ALTER COLUMN "revision" SET NOT NULL,
 ADD CONSTRAINT "SwapFactAmountResponse_revision_check" CHECK ("revision">0 AND (("revision"=1 AND "previousResponseId" IS NULL) OR ("revision">1 AND "previousResponseId" IS NOT NULL))),
 ADD CONSTRAINT "SwapFactAmountResponse_previousResponseId_fkey" FOREIGN KEY ("previousResponseId") REFERENCES "SwapFactAmountResponse"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "SwapFactAmountResponse_previousResponseId_key" ON "SwapFactAmountResponse"("previousResponseId");
CREATE UNIQUE INDEX "SwapFactAmountResponse_settlementId_revision_key" ON "SwapFactAmountResponse"("settlementId","revision");
COMMIT;
