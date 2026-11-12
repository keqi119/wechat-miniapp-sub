-- DRY RUN ONLY. Replace ONLY exact IDs root has inspected; empty by default.
-- Do not execute against old databases. No DELETE, UPDATE, TRUNCATE or fresh mode.
BEGIN TRANSACTION READ ONLY;
PREPARE task11_orders(text[]) AS
SELECT o.id,o."applicationId",o."customerId",o."vehicleId",o.status,
 b.id AS "billId",b.amount,b.status AS "billStatus",
 p.id AS "paymentId",p.amount AS "paymentAmount",p.status AS "paymentStatus",p."providerTransactionId",
 r.id AS "refundId",r.amount AS "refundAmount",r.status AS "refundStatus"
FROM "Order" o LEFT JOIN "Bill" b ON b."orderId"=o.id
LEFT JOIN "Payment" p ON p."billId"=b.id LEFT JOIN "Refund" r ON r."paymentId"=p.id
WHERE o.id=ANY($1);
EXECUTE task11_orders(ARRAY[]::text[]);
PREPARE task11_documents(text[]) AS
SELECT id,kind,status,"orderId","ownerId","sourceFileId","finalFileId","archiveVersionId","sourceSha256","finalSha256"
FROM "ElectronicSigningTask" WHERE id=ANY($1);
EXECUTE task11_documents(ARRAY[]::text[]);
ROLLBACK;
-- Retain: source/final StoredFile bytes, Archive/ArchiveVersion/relations, all parent
-- application/order/customer/vehicle/product/partner/legal identities/templates,
-- Payment/Refund/provider callbacks/audits and signed grant/cooperation dependencies.
-- This SELECT inventory is not a deletion manifest authorization. Root must freeze exact
-- IDs/fileRefs and classify genuine money/legal effects before any separate cleanup.
