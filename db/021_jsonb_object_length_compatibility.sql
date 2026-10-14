-- PostgreSQL has jsonb_object_keys(jsonb), but no object-length function.
-- Purchasing routines in migration 020 use jsonb_object_length(jsonb). Supply
-- that helper without granting the runtime role direct access to it.
CREATE OR REPLACE FUNCTION public.jsonb_object_length(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(p_value)
$$;

ALTER FUNCTION public.jsonb_object_length(jsonb) OWNER TO inventory_function_owner;
REVOKE ALL ON FUNCTION public.jsonb_object_length(jsonb) FROM PUBLIC, inventory_app;
