-- Store short-lived, keyed login-attempt buckets without retaining raw emails or IP addresses.
CREATE TABLE auth_login_rate_limits (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^(client|email):[0-9a-f]{64}$'),
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  window_started_at timestamptz NOT NULL
);
CREATE INDEX auth_login_rate_limits_expiry ON auth_login_rate_limits(window_started_at);

REVOKE ALL ON auth_login_rate_limits FROM PUBLIC, inventory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_login_rate_limits TO inventory_function_owner;

CREATE OR REPLACE FUNCTION reserve_auth_login_attempt(p_email_digest text, p_client_digest text)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  client_count integer;
  client_start timestamptz;
  email_count integer;
  email_start timestamptz;
  retry_seconds integer := 0;
BEGIN
  IF p_email_digest !~ '^[0-9a-f]{64}$' OR p_client_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid authentication rate-limit key';
  END IF;

  -- Bound table growth by cleaning a small batch of expired hashed keys per attempt.
  WITH expired AS (
    SELECT ctid FROM auth_login_rate_limits
    WHERE window_started_at < v_now - interval '1 day'
    ORDER BY window_started_at LIMIT 100
  )
  DELETE FROM auth_login_rate_limits AS limits USING expired WHERE limits.ctid = expired.ctid;

  INSERT INTO auth_login_rate_limits AS existing(bucket_key, attempt_count, window_started_at)
  VALUES ('client:' || p_client_digest, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE SET
    attempt_count = CASE
      WHEN existing.window_started_at <= v_now - interval '15 minutes' THEN 1
      ELSE existing.attempt_count + 1
    END,
    window_started_at = CASE
      WHEN existing.window_started_at <= v_now - interval '15 minutes' THEN v_now
      ELSE existing.window_started_at
    END
  RETURNING existing.attempt_count, existing.window_started_at INTO client_count, client_start;

  IF client_count > 100 THEN
    retry_seconds := GREATEST(1, CEIL(EXTRACT(EPOCH FROM client_start + interval '15 minutes' - v_now))::integer);
    RETURN QUERY SELECT false, retry_seconds;
    RETURN;
  END IF;

  INSERT INTO auth_login_rate_limits AS existing(bucket_key, attempt_count, window_started_at)
  VALUES ('email:' || p_email_digest, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE SET
    attempt_count = CASE
      WHEN existing.window_started_at <= v_now - interval '15 minutes' THEN 1
      ELSE existing.attempt_count + 1
    END,
    window_started_at = CASE
      WHEN existing.window_started_at <= v_now - interval '15 minutes' THEN v_now
      ELSE existing.window_started_at
    END
  RETURNING existing.attempt_count, existing.window_started_at INTO email_count, email_start;

  IF email_count > 8 THEN
    retry_seconds := GREATEST(1, CEIL(EXTRACT(EPOCH FROM email_start + interval '15 minutes' - v_now))::integer);
  END IF;
  RETURN QUERY SELECT retry_seconds = 0, retry_seconds;
END;
$$;

ALTER FUNCTION reserve_auth_login_attempt(text, text) OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION reserve_auth_login_attempt(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_auth_login_attempt(text, text) TO inventory_app;

CREATE OR REPLACE FUNCTION clear_auth_login_email_attempts(p_email_digest text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_email_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid authentication rate-limit key';
  END IF;
  DELETE FROM auth_login_rate_limits WHERE bucket_key = 'email:' || p_email_digest;
END;
$$;

ALTER FUNCTION clear_auth_login_email_attempts(text) OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION clear_auth_login_email_attempts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_auth_login_email_attempts(text) TO inventory_app;
