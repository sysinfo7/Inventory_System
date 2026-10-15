import { getDbPool } from '@/lib/db';

export type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PurchaseOrderSummary = {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierActive: boolean;
  locationId: string;
  locationName: string;
  status: 'draft' | 'submitted' | 'partially_received' | 'received' | 'cancelled';
  expectedDeliveryOn: string | null;
  createdAt: Date;
  lineCount: number;
  orderedUnits: string;
  receivedUnits: string;
};

export async function listSuppliers(includeInactive = true): Promise<Supplier[]> {
  const result = await getDbPool().query(`
    SELECT id, name, contact_name, email, phone, notes, active, created_at, updated_at
    FROM suppliers
    WHERE ($1::boolean OR active = true)
    ORDER BY active DESC, lower(name), id
  `, [includeInactive]);
  return result.rows.map((row) => ({
    id: String(row.id), name: row.name, contactName: row.contact_name, email: row.email,
    phone: row.phone, notes: row.notes, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}

export async function listPurchaseOrders(publicDemo = false): Promise<PurchaseOrderSummary[]> {
  const result = await getDbPool().query(`
    SELECT po.id, po.order_number, supplier.name AS supplier_name, supplier.active AS supplier_active,
      location.id AS location_id, location.name AS location_name, po.status, po.expected_delivery_on, po.created_at,
      count(line.id)::integer AS line_count,
      coalesce(sum(line.ordered_quantity), 0)::text AS ordered_units,
      coalesce(sum(received.quantity), 0)::text AS received_units
    FROM purchase_orders AS po
    JOIN suppliers AS supplier ON supplier.id = po.supplier_id
    JOIN locations AS location ON location.id = po.location_id
    LEFT JOIN purchase_order_lines AS line ON line.purchase_order_id = po.id
    LEFT JOIN LATERAL (
      SELECT receipt_line.purchase_order_line_id, sum(receipt_line.quantity)::bigint AS quantity
      FROM purchase_receipt_lines AS receipt_line
      WHERE receipt_line.purchase_order_line_id = line.id
      GROUP BY receipt_line.purchase_order_line_id
    ) AS received ON true
    WHERE (NOT $1::boolean OR po.status IN ('submitted', 'partially_received', 'received'))
    GROUP BY po.id, supplier.id, location.id
    ORDER BY po.created_at DESC, po.id DESC
  `, [publicDemo]);
  return result.rows.map((row) => ({
    id: String(row.id), orderNumber: row.order_number, supplierName: row.supplier_name,
    supplierActive: row.supplier_active, locationId: String(row.location_id), locationName: row.location_name, status: row.status,
    expectedDeliveryOn: row.expected_delivery_on?.toISOString?.().slice(0, 10) ?? row.expected_delivery_on ?? null,
    createdAt: row.created_at, lineCount: row.line_count,
    orderedUnits: row.ordered_units, receivedUnits: row.received_units,
  }));
}

export async function getPurchaseOrder(id: string) {
  const pool = getDbPool();
  const order = await pool.query(`
    SELECT po.id, po.order_number, po.status, po.expected_delivery_on, po.notes, po.cancel_reason,
      po.created_at, po.submitted_at, po.cancelled_at, supplier.id AS supplier_id,
      supplier.name AS supplier_name, supplier.active AS supplier_active, location.id AS location_id,
      location.name AS location_name, creator.display_name AS created_by
    FROM purchase_orders AS po
    JOIN suppliers AS supplier ON supplier.id = po.supplier_id
    JOIN locations AS location ON location.id = po.location_id
    JOIN app_users AS creator ON creator.id = po.created_by
    WHERE po.id = $1::bigint
  `, [id]);
  if (!order.rowCount) return null;

  const [lines, receipts] = await Promise.all([
    pool.query(`
      SELECT line.id, line.product_id, line.sku_snapshot, line.product_name_snapshot,
        line.ordered_quantity::text,
        coalesce(sum(receipt_line.quantity), 0)::text AS received_quantity,
        product.active AS product_active
      FROM purchase_order_lines AS line
      JOIN products AS product ON product.id = line.product_id
      LEFT JOIN purchase_receipt_lines AS receipt_line ON receipt_line.purchase_order_line_id = line.id
      WHERE line.purchase_order_id = $1::bigint
      GROUP BY line.id, product.active
      ORDER BY line.id
    `, [id]),
    pool.query(`
      SELECT receipt.id, receipt.received_at, receipt.reference, receipt.note,
        actor.display_name AS received_by, line.purchase_order_line_id,
        order_line.product_name_snapshot, order_line.sku_snapshot, line.quantity::text
      FROM purchase_receipts AS receipt
      JOIN app_users AS actor ON actor.id = receipt.actor_id
      JOIN purchase_receipt_lines AS line ON line.receipt_id = receipt.id
      JOIN purchase_order_lines AS order_line ON order_line.id = line.purchase_order_line_id
      WHERE receipt.purchase_order_id = $1::bigint
      ORDER BY receipt.received_at DESC, receipt.id DESC, line.id
    `, [id]),
  ]);
  return {
    ...order.rows[0],
    id: String(order.rows[0].id),
    supplier_id: String(order.rows[0].supplier_id),
    location_id: String(order.rows[0].location_id),
    expected_delivery_on: order.rows[0].expected_delivery_on?.toISOString?.().slice(0, 10) ?? order.rows[0].expected_delivery_on ?? null,
    lines: lines.rows.map((line) => ({ ...line, id: String(line.id), product_id: String(line.product_id) })),
    receipts: receipts.rows,
  };
}
