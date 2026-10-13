-- Add catalog details and a transactionally maintained balance to the original schema.
-- The migration runner applies this file in a transaction and records its checksum.

CREATE TABLE IF NOT EXISTS categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  CONSTRAINT categories_name_unique UNIQUE (name)
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_normalized_unique
  ON categories (lower(trim(name)));

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_id bigint REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS sale_price numeric(12, 2) CHECK (sale_price IS NULL OR sale_price >= 0),
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- A case-insensitive SKU index blocks duplicates even when callers differ in casing.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower(trim(sku)) FROM products GROUP BY lower(trim(sku)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize SKUs: existing products contain case-insensitive duplicates';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_normalized_unique ON products (lower(trim(sku)));

-- Stock rows are the serialization point for writers; movement history remains the ledger.
CREATE TABLE IF NOT EXISTS inventory_stock (
  product_id bigint NOT NULL REFERENCES products(id),
  location_id bigint NOT NULL REFERENCES locations(id),
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, location_id)
);

-- Preserve legacy balances while initializing the locked balance rows.
INSERT INTO inventory_stock (product_id, location_id, quantity)
SELECT product_id, location_id, sum(quantity_delta)::bigint
FROM stock_movements
GROUP BY product_id, location_id
HAVING sum(quantity_delta) >= 0
ON CONFLICT (product_id, location_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM stock_movements GROUP BY product_id, location_id HAVING sum(quantity_delta) < 0) THEN
    RAISE EXCEPTION 'Cannot initialize stock: legacy movement history has a negative balance';
  END IF;
END $$;

-- The original aggregate view depends on the delta column. Drop that derived
-- object before widening the column, then recreate it below over the balance projection.
DROP VIEW IF EXISTS stock_balances;

ALTER TABLE stock_movements
  ALTER COLUMN quantity_delta TYPE bigint,
  ADD COLUMN IF NOT EXISTS movement_type text NOT NULL DEFAULT 'adjustment'
    CHECK (movement_type IN ('receiving', 'sale', 'return', 'adjustment')),
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();

-- The old timestamp is retained; occurred_at records the effective event time going forward.
CREATE INDEX IF NOT EXISTS stock_movements_product_time ON stock_movements(product_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS stock_movements_location_time ON stock_movements(location_id, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_request_id_unique ON stock_movements(request_id) WHERE request_id IS NOT NULL;

-- Capture catalog changes and stock events without storing names, email, or other PII.
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'stock_movement')),
  entity_id bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'movement')),
  actor_id uuid,
  request_id uuid,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_audit_entity_time ON inventory_audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS inventory_audit_request_id ON inventory_audit_log(request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION audit_product_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_row jsonb;
  v_entity_id bigint;
BEGIN
  -- Keep the full before/after product state so a metadata change can be reviewed later.
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
    v_entity_id := OLD.id;
  ELSE
    v_row := to_jsonb(NEW);
    v_entity_id := NEW.id;
  END IF;

  INSERT INTO inventory_audit_log(entity_type, entity_id, action, actor_id, request_id, before_data, after_data)
  VALUES ('product', v_entity_id,
          CASE TG_OP WHEN 'INSERT' THEN 'insert' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
          nullif(current_setting('app.actor_id', true), '')::uuid,
          nullif(current_setting('app.request_id', true), '')::uuid,
          CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS products_audit_change ON products;
CREATE TRIGGER products_audit_change AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_product_change();

CREATE OR REPLACE FUNCTION audit_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO inventory_audit_log(entity_type, entity_id, action, actor_id, request_id, after_data)
  VALUES ('stock_movement', NEW.id, 'movement', NEW.actor_id, NEW.request_id, to_jsonb(NEW));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_movements_audit_insert ON stock_movements;
CREATE TRIGGER stock_movements_audit_insert AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION audit_stock_movement();

CREATE OR REPLACE FUNCTION reject_inventory_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory audit history is append-only';
END $$;
DROP TRIGGER IF EXISTS inventory_audit_immutable ON inventory_audit_log;
CREATE TRIGGER inventory_audit_immutable BEFORE UPDATE OR DELETE ON inventory_audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_inventory_audit_mutation();

-- Catch accidental table-wide clears too; only an administrator can disable this guard.
CREATE OR REPLACE FUNCTION reject_inventory_history_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory history cannot be truncated';
END $$;
DROP TRIGGER IF EXISTS stock_movements_no_truncate ON stock_movements;
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_history_truncate();
DROP TRIGGER IF EXISTS inventory_audit_no_truncate ON inventory_audit_log;
CREATE TRIGGER inventory_audit_no_truncate BEFORE TRUNCATE ON inventory_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_history_truncate();

CREATE OR REPLACE VIEW stock_balances AS
  SELECT s.product_id, s.location_id, s.quantity
  FROM inventory_stock AS s;

-- Prevent edits to the ledger. Corrections are represented by a compensating movement.
CREATE OR REPLACE FUNCTION reject_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movement history is append-only; record a compensating movement instead';
END $$;
DROP TRIGGER IF EXISTS stock_movements_immutable ON stock_movements;
CREATE TRIGGER stock_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION reject_stock_movement_mutation();

-- The only supported stock write path. A row lock serializes simultaneous deductions.
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_balance bigint;
  v_movement_id bigint;
  v_existing stock_movements%ROWTYPE;
BEGIN
  IF p_quantity_delta = 0 THEN RAISE EXCEPTION 'Quantity delta must not be zero'; END IF;
  IF p_movement_type NOT IN ('receiving', 'sale', 'return', 'adjustment') THEN
    RAISE EXCEPTION 'Unsupported movement type';
  END IF;
  IF p_movement_type = 'sale' AND p_quantity_delta >= 0 THEN RAISE EXCEPTION 'Sales must deduct stock'; END IF;
  IF p_movement_type IN ('receiving', 'return') AND p_quantity_delta <= 0 THEN
    RAISE EXCEPTION 'Receiving and returns must add stock';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;

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

  INSERT INTO inventory_stock (product_id, location_id, quantity)
  VALUES (p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;
  SELECT quantity INTO v_balance FROM inventory_stock
  WHERE product_id = p_product_id AND location_id = p_location_id FOR UPDATE;
  IF v_balance + p_quantity_delta < 0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;

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

-- Separate login role is provisioned by the operator and receives only required access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inventory_app') THEN
    CREATE ROLE inventory_app NOLOGIN;
  END IF;
END $$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stock_movements, inventory_stock FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION record_stock_movement(bigint,bigint,bigint,text,text,uuid,uuid,numeric) FROM PUBLIC;
GRANT SELECT ON products, categories, locations, stock_movements, stock_balances TO inventory_app;
GRANT EXECUTE ON FUNCTION record_stock_movement(bigint,bigint,bigint,text,text,uuid,uuid,numeric) TO inventory_app;
GRANT SELECT ON inventory_audit_log TO inventory_app;
