BEGIN;
CREATE TABLE IF NOT EXISTS products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku text NOT NULL UNIQUE CHECK (length(trim(sku)) > 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  reorder_point integer NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(trim(name)) > 0)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id),
  location_id bigint NOT NULL REFERENCES locations(id),
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movements_product_location ON stock_movements(product_id, location_id);
CREATE OR REPLACE VIEW stock_balances AS
  SELECT product_id, location_id, sum(quantity_delta) AS quantity
  FROM stock_movements GROUP BY product_id, location_id;
COMMIT;
