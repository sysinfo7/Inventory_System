-- Require users created with a temporary credential to replace it before use.
ALTER TABLE app_users
  ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;

-- Keep the account subject and administrator actor in an append-only history.
ALTER TABLE app_security_events
  DROP CONSTRAINT app_security_events_event_type_check;

ALTER TABLE app_security_events
  ADD COLUMN actor_id uuid,
  ADD CONSTRAINT app_security_events_event_type_check
    CHECK (event_type IN ('password_changed', 'admin_password_reset'));

CREATE INDEX app_security_events_actor_time
  ON app_security_events(actor_id, occurred_at DESC, id DESC)
  WHERE actor_id IS NOT NULL;

-- A transaction-local actor comes from the server-authenticated user-management
-- route. Self-service changes fall back to the password owner as their actor.
CREATE OR REPLACE FUNCTION record_password_change_security_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_text text := NULLIF(current_setting('inventory.security_actor_id', true), '');
  v_actor_id uuid;
  v_event_type text := 'password_changed';
BEGIN
  IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    IF v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      v_actor_id := v_actor_text::uuid;
    END IF;

    IF NEW.password_change_required AND v_actor_id IS NOT NULL AND v_actor_id <> NEW.id THEN
      v_event_type := 'admin_password_reset';
    ELSE
      v_actor_id := COALESCE(v_actor_id, NEW.id);
    END IF;

    INSERT INTO app_security_events(user_id, actor_id, event_type)
    VALUES (NEW.id, v_actor_id, v_event_type);
    DELETE FROM app_sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_password_change_security_event() OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION record_password_change_security_event() FROM PUBLIC, inventory_app;
