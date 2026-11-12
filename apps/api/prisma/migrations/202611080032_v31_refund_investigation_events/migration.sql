-- Bounded human investigation evidence only; no new financial ledger or clearance state.
CREATE FUNCTION protect_refund_investigation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.action LIKE 'REFUND_CONFLICT_INVESTIGATION_%' OR (TG_OP='UPDATE' AND NEW.action LIKE 'REFUND_CONFLICT_INVESTIGATION_%') THEN
  RAISE EXCEPTION 'immutable refund conflict investigation event';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AuditLog_refund_investigation_immutable" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION protect_refund_investigation_event();
