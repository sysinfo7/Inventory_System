-- Supplier and purchase-order records. The app can read these tables but writes go
-- through reviewed routines in migration 020.
CREATE SEQUENCE purchase_order_number_seq;

CREATE TABLE suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  contact_name text CHECK (contact_name IS NULL OR length(trim(contact_name)) <= 120),
  email text CHECK (email IS NULL OR length(trim(email)) <= 254),
  phone text CHECK (phone IS NULL OR length(trim(phone)) <= 40),
  notes text CHECK (notes IS NULL OR length(trim(notes)) <= 500),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_normalized_unique ON suppliers(lower(trim(name)));
CREATE INDEX suppliers_active_name ON suppliers(active, lower(name), id);

CREATE TABLE purchase_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number text NOT NULL UNIQUE DEFAULT ('PO-' || lpad(nextval('purchase_order_number_seq')::text, 8, '0')),
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  location_id bigint NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  supplier_name_snapshot text,
  location_name_snapshot text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','partially_received','received','cancelled')),
  expected_delivery_on date,
  notes text CHECK (notes IS NULL OR length(trim(notes)) <= 500),
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 1 AND 300),
  CONSTRAINT purchase_orders_cancel_fields CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
    OR (status <> 'cancelled' AND cancelled_at IS NULL AND cancel_reason IS NULL)
  ),
  CONSTRAINT purchase_orders_submit_fields CHECK ((status = 'draft' AND submitted_at IS NULL) OR (status <> 'draft' AND submitted_at IS NOT NULL) OR (status = 'cancelled' AND submitted_at IS NULL)),
  CONSTRAINT purchase_orders_submitted_snapshots CHECK (
    (submitted_at IS NULL AND supplier_name_snapshot IS NULL AND location_name_snapshot IS NULL)
    OR (submitted_at IS NOT NULL AND supplier_name_snapshot IS NOT NULL AND location_name_snapshot IS NOT NULL
      AND length(trim(supplier_name_snapshot)) BETWEEN 1 AND 160
      AND length(trim(location_name_snapshot)) > 0)
  ),
  CONSTRAINT purchase_orders_id_key UNIQUE (id)
);
CREATE INDEX purchase_orders_status_created ON purchase_orders(status, created_at DESC, id DESC);
CREATE INDEX purchase_orders_supplier_created ON purchase_orders(supplier_id, created_at DESC, id DESC);
CREATE INDEX purchase_orders_location_status ON purchase_orders(location_id, status, id DESC);

CREATE TABLE purchase_order_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku_snapshot text NOT NULL CHECK (length(trim(sku_snapshot)) BETWEEN 1 AND 100),
  product_name_snapshot text NOT NULL CHECK (length(trim(product_name_snapshot)) BETWEEN 1 AND 200),
  ordered_quantity bigint NOT NULL CHECK (ordered_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_lines_product_unique UNIQUE (purchase_order_id, product_id),
  CONSTRAINT purchase_order_lines_order_id_unique UNIQUE (purchase_order_id, id)
);
CREATE INDEX purchase_order_lines_order ON purchase_order_lines(purchase_order_id, id);
CREATE INDEX purchase_order_lines_product ON purchase_order_lines(product_id, purchase_order_id);

CREATE TABLE purchase_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reference text CHECK (reference IS NULL OR length(trim(reference)) <= 80),
  note text CHECK (note IS NULL OR length(trim(note)) <= 300),
  CONSTRAINT purchase_receipts_id_order_unique UNIQUE (id, purchase_order_id)
);
CREATE INDEX purchase_receipts_order_time ON purchase_receipts(purchase_order_id, received_at DESC, id DESC);
CREATE INDEX purchase_receipts_actor_time ON purchase_receipts(actor_id, received_at DESC, id DESC);

CREATE TABLE purchase_receipt_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id bigint NOT NULL,
  receipt_id bigint NOT NULL,
  purchase_order_line_id bigint NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  stock_movement_id bigint NOT NULL UNIQUE REFERENCES stock_movements(id) ON DELETE RESTRICT,
  CONSTRAINT purchase_receipt_lines_receipt_order_fk
    FOREIGN KEY (receipt_id, purchase_order_id) REFERENCES purchase_receipts(id, purchase_order_id) ON DELETE RESTRICT,
  CONSTRAINT purchase_receipt_lines_order_line_fk
    FOREIGN KEY (purchase_order_id, purchase_order_line_id) REFERENCES purchase_order_lines(purchase_order_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_receipt_lines_one_per_item UNIQUE (receipt_id, purchase_order_line_id)
);
CREATE INDEX purchase_receipt_lines_order_line ON purchase_receipt_lines(purchase_order_line_id, receipt_id);
CREATE INDEX purchase_receipt_lines_order ON purchase_receipt_lines(purchase_order_id, purchase_order_line_id);

-- This purchasing history records business changes without retaining supplier
-- contact values or free-form notes in before/after snapshots.
CREATE TABLE purchasing_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('supplier','purchase_order','purchase_receipt')),
  entity_id bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('insert','update','deactivate','reactivate','submit','cancel','receive')),
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  request_id uuid,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX purchasing_audit_entity_time ON purchasing_audit_log(entity_type, entity_id, occurred_at DESC, id DESC);
CREATE INDEX purchasing_audit_actor_time ON purchasing_audit_log(actor_id, occurred_at DESC, id DESC);
CREATE INDEX purchasing_audit_request ON purchasing_audit_log(request_id) WHERE request_id IS NOT NULL;
