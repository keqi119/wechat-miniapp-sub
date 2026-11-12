-- Legacy inspection snapshots retain their existing v1 meaning and exact hashes.
-- NULL means no basic condition was frozen through the new publication command.
ALTER TABLE "VehicleListing" ADD COLUMN "basicConditionSnapshot" JSONB;
