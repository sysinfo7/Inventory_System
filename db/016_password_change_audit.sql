-- Record password changes without storing credentials and revoke every session.
CREATE TABLE app_security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'password_changed'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX app_security_events_user_time
  ON app_security_events(user_id, occurred_at DESC, id DESC);

-- Preserve the subject UUID even if an account is later removed; this table is
-- not an inventory ledger and intentionally stores no email or credential data.
CREATE OR REPLACE FUNCTION record_password_change_security_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    INSERT INTO app_security_events(user_id, event_type)
    VALUES (NEW.id, 'password_changed');
    DELETE FROM app_sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_password_change_security_event() OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION record_password_change_security_event() FROM PUBLIC, inventory_app;
GRANT INSERT ON app_security_events TO inventory_function_owner;
GRANT USAGE, SELECT ON SEQUENCE app_security_events_id_seq TO inventory_function_owner;

CREATE TRIGGER app_users_password_change_security_event
AFTER UPDATE OF password_hash ON app_users
FOR EACH ROW
WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
EXECUTE FUNCTION record_password_change_security_event();

-- Password-change events are written only by the restricted trigger owner.
REVOKE ALL ON app_security_events FROM PUBLIC, inventory_app;

CREATE OR REPLACE FUNCTION reject_app_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Application security events are append-only';
END;
$$;

CREATE TRIGGER app_security_events_immutable
BEFORE UPDATE OR DELETE ON app_security_events
FOR EACH ROW EXECUTE FUNCTION reject_app_security_event_mutation();

CREATE TRIGGER app_security_events_no_truncate
BEFORE TRUNCATE ON app_security_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_app_security_event_mutation();
