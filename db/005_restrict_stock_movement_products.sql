-- Enforce the active-product rule inside the controlled write path as well as the UI.
-- The row lock prevents a concurrent catalog edit from deactivating the item mid-movement.
CREATE OR REPLACE FUNCTION record_stock_movement(
  p_product_id bigint,
  p_location_id bigint,
  p_quantity_delta bigint,
  p_movement_type text,
  p_reason text,
  p_actor_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_unit_price numeric(12, 2) DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_balance bigint;
  v_movement_id bigint;
  v_existing stock_movements%ROWTYPE;
  v_product_active boolean;
BEGIN
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Quantity delta must not be zero';
  END IF;
  IF p_movement_type IS NULL OR p_movement_type NOT IN ('receiving', 'sale', 'return', 'adjustment') THEN
    RAISE EXCEPTION 'Unsupported movement type';
  END IF;
  IF p_movement_type = 'sale' AND p_quantity_delta >= 0 THEN
    RAISE EXCEPTION 'Sales must deduct stock';
  END IF;
  IF p_movement_type IN ('receiving', 'return') AND p_quantity_delta <= 0 THEN
    RAISE EXCEPTION 'Receiving and returns must add stock';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  -- Repeated submissions with the same request key return the original movement.
  IF p_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    SELECT * INTO v_existing FROM stock_movements WHERE request_id = p_request_id;
    IF FOUND THEN
      IF v_existing.product_id = p_product_id AND v_existing.location_id = p_location_id
         AND v_existing.quantity_delta = p_quantity_delta AND v_existing.movement_type = p_movement_type
         AND v_existing.reason = trim(p_reason) AND v_existing.actor_id IS NOT DISTINCT FROM p_actor_id
         AND v_existing.unit_price IS NOT DISTINCT FROM p_unit_price THEN
        RETURN v_existing.id;
      END IF;
      RAISE EXCEPTION 'Request id was already used for a different stock movement';
    END IF;
  END IF;

  -- Inactive products may retain history, but cannot receive new movements.
  SELECT active INTO v_product_active
  FROM products
  WHERE id = p_product_id
  FOR SHARE;
  IF NOT FOUND OR NOT v_product_active THEN
    RAISE EXCEPTION 'Product is not active or does not exist';
  END IF;

  INSERT INTO inventory_stock (product_id, location_id, quantity)
  VALUES (p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;
  SELECT quantity INTO v_balance FROM inventory_stock
  WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
  IF v_balance + p_quantity_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock';
  END IF;

  UPDATE inventory_stock SET quantity = v_balance + p_quantity_delta, updated_at = clock_timestamp()
  WHERE product_id = p_product_id AND location_id = p_location_id;
  INSERT INTO stock_movements
    (product_id, location_id, quantity_delta, movement_type, reason, actor_id, request_id, unit_price, occurred_at)
  VALUES
    (p_product_id, p_location_id, p_quantity_delta, p_movement_type, trim(p_reason), p_actor_id,
     p_request_id, p_unit_price, clock_timestamp())
  RETURNING id INTO v_movement_id;
  RETURN v_movement_id;
END $$;

-- CREATE OR REPLACE preserves ownership and grants; state the intended grant explicitly.
REVOKE ALL ON FUNCTION record_stock_movement(bigint,bigint,bigint,text,text,uuid,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_stock_movement(bigint,bigint,bigint,text,text,uuid,uuid,numeric) TO inventory_app;
