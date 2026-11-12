BEGIN;
-- Business dates use the exact ISO calendar domain accepted by service-stage readers.
-- This is a separate migration because 015 has already been applied in the isolated test database.
ALTER TABLE "OrderServiceStage" ADD CONSTRAINT "OrderServiceStage_date_domain" CHECK (
 isfinite("startDate") AND isfinite("endDate")
 AND "startDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
 AND "endDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
);
COMMIT;
