-- Nullable references preserve historical electronic contracts without inventing signatures.
ALTER TYPE "OrderChangeStatus" ADD VALUE 'AWAITING_ARCHIVE';
ALTER TABLE "OrderChange" ADD COLUMN "originalArchiveVersionId" TEXT, ADD COLUMN "priorTermsVersionId" TEXT;
ALTER TABLE "DelayQuote" ADD COLUMN "approvedArchiveVersionId" TEXT;
ALTER TABLE "OrderTermsVersion" ADD COLUMN "offlineArchiveVersionId" TEXT;
ALTER TABLE "DocumentArchive" ADD COLUMN "quoteId" TEXT;

CREATE UNIQUE INDEX "OrderTermsVersion_id_orderId_key" ON "OrderTermsVersion"(id,"orderId");
CREATE UNIQUE INDEX "DocumentArchive_quoteId_key" ON "DocumentArchive"("quoteId");
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_originalArchiveVersionId_fkey" FOREIGN KEY ("originalArchiveVersionId") REFERENCES "ArchiveVersion"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_priorTermsVersionId_orderId_fkey" FOREIGN KEY ("priorTermsVersionId","orderId") REFERENCES "OrderTermsVersion"(id,"orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DelayQuote" ADD CONSTRAINT "DelayQuote_approvedArchiveVersionId_fkey" FOREIGN KEY ("approvedArchiveVersionId") REFERENCES "ArchiveVersion"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OrderTermsVersion" ADD CONSTRAINT "OrderTermsVersion_offlineArchiveVersionId_fkey" FOREIGN KEY ("offlineArchiveVersionId") REFERENCES "ArchiveVersion"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "DelayQuote"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- status::text allows adding the enum label and the check in the same migration.
ALTER TABLE "OrderChange" ADD CONSTRAINT "OrderChange_offline_origin" CHECK ((("priorTermsVersionId" IS NULL AND status::text <> 'AWAITING_ARCHIVE') OR "originalArchiveVersionId" IS NOT NULL) IS TRUE);
ALTER TABLE "DelayQuote" ADD CONSTRAINT "DelayQuote_offline_approval" CHECK (("approvedArchiveVersionId" IS NULL OR (status::text IN ('CONFIRMED','SUPERSEDED') AND "confirmedAt" IS NOT NULL)) IS TRUE);
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_quote_scope" CHECK ((("quoteId" IS NULL AND kind <> 'ORDER_AMENDMENT' AND "subjectType" <> 'ORDER_CHANGE_QUOTE') OR ("quoteId" IS NOT NULL AND kind = 'ORDER_AMENDMENT' AND "subjectType" = 'ORDER_CHANGE_QUOTE' AND "subjectId" = "quoteId" AND "orderId" IS NOT NULL AND "ownerId" IS NOT NULL AND "handoverId" IS NULL)) IS TRUE);
