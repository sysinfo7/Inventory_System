-- Remove the experimental trigger from migration 012. Account deactivation
-- revokes sessions explicitly in its authorized application transaction.
DROP TRIGGER IF EXISTS app_users_revoke_sessions_on_access_change ON app_users;
DROP FUNCTION IF EXISTS revoke_user_sessions_on_access_change();
REVOKE DELETE ON app_sessions FROM inventory_function_owner;
