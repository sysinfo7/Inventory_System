-- Store application identities, role assignments, and revocable server sessions.
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'clerk', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_email_normalized_unique ON app_users (lower(trim(email)));

CREATE TABLE app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_sessions_user_expiry ON app_sessions(user_id, expires_at);

-- Keep table reads and writes behind narrowly scoped functions where practical.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO inventory_function_owner;

-- Authentication tables are available only to the application login; clients cannot
-- read password hashes or write session records directly.
REVOKE ALL ON app_users, app_sessions FROM PUBLIC, inventory_app;
GRANT SELECT, INSERT, UPDATE ON app_users TO inventory_app;
GRANT SELECT, INSERT, DELETE ON app_sessions TO inventory_app;
GRANT USAGE ON SCHEMA public TO inventory_app;
