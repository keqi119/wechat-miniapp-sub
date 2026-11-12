-- Keep applied030 immutable; PostgreSQL NOT IN must not accept a missing JSON field.
CREATE FUNCTION require_refund_replacement_channel_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence jsonb;
BEGIN
 IF NEW."replacesRefundId" IS NOT NULL THEN
  SELECT "channelEvidence" INTO evidence FROM "Refund" WHERE id=NEW."replacesRefundId";
  IF COALESCE(evidence->>'evidenceSource','') NOT IN ('QUERY','CALLBACK') THEN RAISE EXCEPTION 'unverified refund replacement channel source'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Refund_replacement_verified_channel" BEFORE INSERT ON "Refund" FOR EACH ROW EXECUTE FUNCTION require_refund_replacement_channel_source();
