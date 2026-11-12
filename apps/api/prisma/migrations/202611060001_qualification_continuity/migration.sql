ALTER TABLE "CustomerQualificationVersion" ADD COLUMN "profileSnapshot" JSONB;
CREATE TABLE "OrderQualificationConfirmation" (
 "id" TEXT PRIMARY KEY,
 "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "qualificationId" TEXT NOT NULL REFERENCES "CustomerQualificationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "qualificationRevision" INTEGER NOT NULL CHECK ("qualificationRevision" > 0),
 "profileContentHash" TEXT NOT NULL CHECK ("profileContentHash" ~ '^[a-f0-9]{64}$'),
 "originalScopeHash" TEXT NOT NULL CHECK ("originalScopeHash" ~ '^[a-f0-9]{64}$'),
 "orderRevision" INTEGER NOT NULL CHECK ("orderRevision" >= 0),
 "reviewedBy" TEXT NOT NULL CHECK (length("reviewedBy") > 0),
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) BETWEEN 2 AND 500),
 "sameCustomerConfirmed" BOOLEAN NOT NULL CHECK ("sameCustomerConfirmed"),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OrderQualificationConfirmation_order_qualification_created_idx" ON "OrderQualificationConfirmation"("orderId","qualificationId","createdAt");
