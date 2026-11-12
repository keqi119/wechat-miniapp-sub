-- CreateTable
CREATE TABLE "CollectionCase" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "asOfDate" DATE NOT NULL,
    "totalOverdueAmount" INTEGER NOT NULL,
    "maxOverdueDays" INTEGER NOT NULL,
    "level" TEXT,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "CollectionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCaseBill" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "initialDueDate" DATE NOT NULL,
    "initialAmount" INTEGER NOT NULL,
    "initialOverdueAmount" INTEGER NOT NULL,
    "initialAsOfDate" DATE NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionCaseBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "beforeRevision" INTEGER NOT NULL,
    "afterRevision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "method" TEXT,
    "actionType" TEXT,
    "result" TEXT,
    "content" TEXT,
    "promiseDate" DATE,
    "promiseAmount" INTEGER,
    "nextFollowUpDate" DATE,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionCase_status_updatedAt_idx" ON "CollectionCase"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CollectionCase_orderId_createdAt_idx" ON "CollectionCase"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCase_id_orderId_customerId_key" ON "CollectionCase"("id", "orderId", "customerId");

-- CreateIndex
CREATE INDEX "CollectionCaseBill_billId_idx" ON "CollectionCaseBill"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionCaseBill_caseId_billId_key" ON "CollectionCaseBill"("caseId", "billId");

-- CreateIndex
CREATE INDEX "CollectionAction_caseId_createdAt_idx" ON "CollectionAction"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAction_caseId_sequence_key" ON "CollectionAction"("caseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAction_caseId_afterRevision_key" ON "CollectionAction"("caseId", "afterRevision");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_customerId_key" ON "Order"("id", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_id_orderId_customerId_key" ON "Bill"("id", "orderId", "customerId");

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_orderId_customerId_fkey" FOREIGN KEY ("orderId", "customerId") REFERENCES "Order"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CollectionCaseBill" ADD CONSTRAINT "CollectionCaseBill_caseId_orderId_customerId_fkey" FOREIGN KEY ("caseId", "orderId", "customerId") REFERENCES "CollectionCase"("id", "orderId", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CollectionCaseBill" ADD CONSTRAINT "CollectionCaseBill_billId_orderId_customerId_fkey" FOREIGN KEY ("billId", "orderId", "customerId") REFERENCES "Bill"("id", "orderId", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_caseId_orderId_customerId_fkey" FOREIGN KEY ("caseId", "orderId", "customerId") REFERENCES "CollectionCase"("id", "orderId", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- One current case per order, while preserving all closed cases.
CREATE UNIQUE INDEX "CollectionCase_one_active_order" ON "CollectionCase" ("orderId") WHERE status='ACTIVE';

ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_values" CHECK ((
 revision >= 1 AND status IN ('ACTIVE','CLOSED') AND
 "asOfDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND
 "totalOverdueAmount" >= 0 AND "maxOverdueDays" >= 0 AND
 (("totalOverdueAmount"=0 AND "maxOverdueDays"=0 AND level IS NULL) OR
  ("totalOverdueAmount">0 AND "maxOverdueDays">0 AND level=CASE
   WHEN "maxOverdueDays"<=3 THEN 'D1' WHEN "maxOverdueDays"<=7 THEN 'D2'
   WHEN "maxOverdueDays"<=15 THEN 'D3' WHEN "maxOverdueDays"<=30 THEN 'D4' ELSE 'D5' END)) AND
 jsonb_typeof("sourceSnapshot")='object' AND "sourceSnapshot"<>'{}'::jsonb AND
 "sourceHash" ~ '^[a-f0-9]{64}$' AND length(btrim("createdBy"))>0 AND length(btrim("updatedBy"))>0
) IS TRUE);
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_close" CHECK ((
 (status='ACTIVE' AND "closedAt" IS NULL AND "closedBy" IS NULL AND "closeReason" IS NULL) OR
 (status='CLOSED' AND "totalOverdueAmount"=0 AND "maxOverdueDays"=0 AND level IS NULL AND "closedAt" IS NOT NULL AND length(btrim("closedBy"))>0 AND
  length(btrim("closeReason")) BETWEEN 1 AND 2000)
) IS TRUE);

ALTER TABLE "CollectionCaseBill" ADD CONSTRAINT "CollectionCaseBill_values" CHECK ((
 "initialAmount">0 AND "initialOverdueAmount">0 AND "initialOverdueAmount"<="initialAmount" AND
 "initialDueDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND
 "initialAsOfDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "initialAsOfDate">"initialDueDate" AND
 jsonb_typeof("sourceSnapshot")='object' AND "sourceSnapshot"<>'{}'::jsonb AND
 "sourceHash" ~ '^[a-f0-9]{64}$' AND length(btrim("linkedBy"))>0
) IS TRUE);

ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_values" CHECK ((
 sequence>=1 AND "beforeRevision">=0 AND "afterRevision">=1 AND
 "afterRevision"::bigint="beforeRevision"::bigint+1 AND
 kind IN ('CREATE','REFRESH','CONTACT','CLOSE') AND
 ((kind='CREATE' AND sequence=1 AND "beforeRevision"=0) OR (kind<>'CREATE' AND "beforeRevision">=1)) AND
 length(btrim(reason)) BETWEEN 1 AND 2000 AND length(btrim("actorId"))>0 AND
 jsonb_typeof("sourceSnapshot")='object' AND "sourceSnapshot"<>'{}'::jsonb AND "sourceHash" ~ '^[a-f0-9]{64}$'
) IS TRUE);
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_contact" CHECK ((
 (kind<>'CONTACT' AND method IS NULL AND "actionType" IS NULL AND result IS NULL AND content IS NULL AND
  "promiseDate" IS NULL AND "promiseAmount" IS NULL AND "nextFollowUpDate" IS NULL) OR
 (kind='CONTACT' AND method IN ('PHONE','SMS','WECHAT','EMAIL','OFFLINE','OTHER') AND
  "actionType" IN ('REMINDER','FOLLOW_UP','PROMISE_TO_PAY','CUSTOMER_DISPUTE','ESCALATION') AND
  result IN ('SUCCESS','NO_ANSWER','CUSTOMER_PROMISED','CUSTOMER_REFUSED','DISPUTED','INVALID_CONTACT','OTHER') AND
  length(btrim(content)) BETWEEN 1 AND 4000 AND
  (("promiseDate" IS NULL AND "promiseAmount" IS NULL) OR
   ("promiseDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND "promiseAmount">0)) AND
  ("nextFollowUpDate" IS NULL OR "nextFollowUpDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'))
) IS TRUE);
