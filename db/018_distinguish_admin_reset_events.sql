-- Mark forced temporary credentials as reset events even for local seed tooling
-- that has no signed-in administrator actor to record.
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

    IF NEW.password_change_required THEN
      v_event_type := 'admin_password_reset';
    ELSE
      v_event_type := 'password_changed';
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
