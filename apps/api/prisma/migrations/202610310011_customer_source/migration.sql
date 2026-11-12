-- Historical customers remain unclassified. This version is independent from
-- the reviewed identity/profile version and must not invalidate qualification.
ALTER TABLE "Customer"
 ADD COLUMN "sourceChannel" TEXT,
 ADD COLUMN "sourceRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_source_values" CHECK (
 "sourceRevision" >= 0 AND (
  "sourceChannel" IS NULL OR (
   char_length("sourceChannel") <= 64 AND
   char_length(btrim("sourceChannel", E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
  )
 )
);
