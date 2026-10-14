-- Revoke every login session when an account is disabled or its role changes.
-- The trigger enforces this for every update path, not only the admin UI.
GRANT DELETE ON app_sessions TO inventory_function_owner;

CREATE OR REPLACE FUNCTION revoke_user_sessions_on_access_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR (OLD.active AND NOT NEW.active) THEN
    DELETE FROM app_sessions WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION revoke_user_sessions_on_access_change() OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION revoke_user_sessions_on_access_change() FROM PUBLIC, inventory_app;

CREATE TRIGGER app_users_revoke_sessions_on_access_change
AFTER UPDATE OF role, active ON app_users
FOR EACH ROW
EXECUTE FUNCTION revoke_user_sessions_on_access_change();
