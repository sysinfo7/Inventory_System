-- Preserve authenticated actor identity on audited catalog and stock changes.
CREATE OR REPLACE FUNCTION save_product(
  p_product_id bigint,
  p_sku text,
  p_name text,
  p_category_id bigint,
  p_sale_price numeric(12, 2),
  p_reorder_point integer,
  p_active boolean,
  p_request_id uuid,
  p_actor_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_product_id bigint;
BEGIN
  IF p_sku IS NULL OR length(trim(p_sku)) = 0 OR length(trim(p_sku)) > 100 THEN RAISE EXCEPTION 'SKU must contain between 1 and 100 characters'; END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 OR length(trim(p_name)) > 200 THEN RAISE EXCEPTION 'Product name must contain between 1 and 200 characters'; END IF;
  IF p_reorder_point IS NULL OR p_reorder_point < 0 THEN RAISE EXCEPTION 'Reorder point must be a nonnegative whole number'; END IF;
  IF p_active IS NULL THEN RAISE EXCEPTION 'Product status is required'; END IF;
  IF p_sale_price IS NOT NULL AND p_sale_price < 0 THEN RAISE EXCEPTION 'Sale price must be zero or more'; END IF;

  -- The application supplies this UUID only from its verified server session.
  PERFORM set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  PERFORM set_config('app.request_id', coalesce(p_request_id::text, ''), true);
  IF p_product_id IS NULL THEN
    INSERT INTO products (sku, name, category_id, sale_price, reorder_point, active)
    VALUES (trim(p_sku), trim(p_name), p_category_id, p_sale_price, p_reorder_point, p_active)
    RETURNING id INTO v_product_id;
  ELSE
    UPDATE products SET sku = trim(p_sku), name = trim(p_name), category_id = p_category_id,
      sale_price = p_sale_price, reorder_point = p_reorder_point, active = p_active
    WHERE id = p_product_id RETURNING id INTO v_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
  END IF;
  RETURN v_product_id;
END $$;

-- Preserve the migration/demo seeding API. Application requests use the actor-aware overload.
CREATE OR REPLACE FUNCTION save_product(
  p_product_id bigint, p_sku text, p_name text, p_category_id bigint,
  p_sale_price numeric(12, 2), p_reorder_point integer, p_active boolean, p_request_id uuid
)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT save_product(p_product_id, p_sku, p_name, p_category_id, p_sale_price,
                      p_reorder_point, p_active, p_request_id, NULL::uuid)
$$;

REVOKE ALL ON FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid) FROM PUBLIC;
ALTER FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid) OWNER TO inventory_function_owner;
GRANT EXECUTE ON FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid) TO inventory_function_owner;
REVOKE ALL ON FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid,uuid) FROM PUBLIC;
ALTER FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid,uuid) OWNER TO inventory_function_owner;
GRANT EXECUTE ON FUNCTION save_product(bigint,text,text,bigint,numeric,integer,boolean,uuid,uuid) TO inventory_app;
