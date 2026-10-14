import { Pool } from 'pg';

// The UI uses a separate, least-privilege login; DATABASE_URL is for migrations only.
const globalForInventory = globalThis as typeof globalThis & { inventoryPool?: Pool };

export function getDbPool() {
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) {
    throw new Error('APP_DATABASE_URL is missing. See the local catalog setup instructions.');
  }

  globalForInventory.inventoryPool ??= new Pool({ connectionString, max: 5 });
  return globalForInventory.inventoryPool;
}

export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  salePrice: string | null;
  reorderPoint: number;
  active: boolean;
  createdAt: string;
};

export type ProductCategory = { id: string; name: string };

export type InventoryLocation = { id: string; name: string };
export type StockItem = {
  id: string;
  sku: string;
  name: string;
  reorderPoint: number;
  quantity: string;
};
export type StockActivity = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  locationId: string;
  locationName: string;
  quantityDelta: string;
  movementType: 'receiving' | 'sale' | 'return' | 'adjustment';
  reason: string;
  occurredAt: string;
  actorName: string | null;
};
export type StockActivityActor = { id: string; name: string };

export async function listInventoryLocations(): Promise<InventoryLocation[]> {
  const result = await getDbPool().query('SELECT id, name FROM locations ORDER BY lower(name), id');
  return result.rows.map((row): InventoryLocation => ({ id: String(row.id), name: row.name }));
}

export async function listStockActivityActors(): Promise<StockActivityActor[]> {
  const result = await getDbPool().query(`
    SELECT DISTINCT u.id, u.display_name
    FROM stock_movements AS m
    JOIN app_users AS u ON u.id = m.actor_id
    ORDER BY u.display_name, u.id
  `);
  return result.rows.map((row): StockActivityActor => ({ id: String(row.id), name: row.display_name }));
}

export async function listStockItems(locationId: string): Promise<StockItem[]> {
  const result = await getDbPool().query(`
    SELECT p.id, p.sku, p.name, p.reorder_point, coalesce(b.quantity, 0)::text AS quantity
    FROM products AS p
    LEFT JOIN stock_balances AS b ON b.product_id = p.id AND b.location_id = $1::bigint
    WHERE p.active = true
    ORDER BY lower(p.name), p.id
    LIMIT 500
  `, [locationId]);
  return result.rows.map((row): StockItem => ({
    id: String(row.id), sku: row.sku, name: row.name,
    reorderPoint: row.reorder_point, quantity: row.quantity,
  }));
}

export async function listActiveStockProducts() {
  const result = await getDbPool().query(`
    SELECT id, sku, name FROM products WHERE active = true ORDER BY lower(name), id LIMIT 500
  `);
  return result.rows.map((row) => ({ id: String(row.id), sku: row.sku, name: row.name }));
}

export async function readLocationBalance(productId: string, locationId: string): Promise<string> {
  const result = await getDbPool().query(`
    SELECT coalesce((SELECT quantity FROM stock_balances
      WHERE product_id = $1::bigint AND location_id = $2::bigint), 0)::text AS quantity
  `, [productId, locationId]);
  return result.rows[0].quantity;
}

export async function listStockActivity(filters: {
  locationId: string;
  movementType: string;
  search: string;
  actorId: string;
  fromDate: string;
  toDate: string;
}): Promise<StockActivity[]> {
  const result = await getDbPool().query(`
    SELECT m.id, m.product_id, p.sku, p.name AS product_name, m.location_id,
           l.name AS location_name, m.quantity_delta, m.movement_type, m.reason, m.occurred_at,
           u.display_name AS actor_name
    FROM stock_movements AS m
    JOIN products AS p ON p.id = m.product_id
    JOIN locations AS l ON l.id = m.location_id
    LEFT JOIN app_users AS u ON u.id = m.actor_id
    WHERE ($1::text = '' OR m.location_id = NULLIF($1, '')::bigint)
      AND ($2::text = 'all' OR m.movement_type = $2::text)
      AND ($3::text = '' OR p.sku ILIKE '%' || $3 || '%'
        OR p.name ILIKE '%' || $3 || '%' OR m.reason ILIKE '%' || $3 || '%')
      AND CASE WHEN $4::text = '' THEN true
        WHEN $4::text = 'legacy' THEN m.actor_id IS NULL
        ELSE m.actor_id = $4::uuid END
      AND ($5::text = '' OR m.occurred_at >= ($5::date::timestamp AT TIME ZONE 'UTC'))
      AND ($6::text = '' OR m.occurred_at < (($6::date + 1)::timestamp AT TIME ZONE 'UTC'))
    ORDER BY m.occurred_at DESC, m.id DESC
    LIMIT 200
  `, [filters.locationId, filters.movementType, filters.search, filters.actorId, filters.fromDate, filters.toDate]);
  return result.rows.map((row): StockActivity => ({
    id: String(row.id), productId: String(row.product_id), sku: row.sku,
    productName: row.product_name, locationId: String(row.location_id),
    locationName: row.location_name, quantityDelta: String(row.quantity_delta),
    movementType: row.movement_type, reason: row.reason,
    occurredAt: row.occurred_at.toISOString(),
    actorName: row.actor_name,
  }));
}

// Return only fields the catalog needs, not raw PostgreSQL rows.
export async function listCatalogProducts(search: string, status: 'active' | 'inactive' | 'all') {
  const pool = getDbPool();
  const result = await pool.query(`
    SELECT p.id, p.sku, p.name, p.category_id, c.name AS category_name,
           p.sale_price, p.reorder_point, p.active, p.created_at
    FROM products AS p
    LEFT JOIN categories AS c ON c.id = p.category_id
    WHERE ($1::text = '' OR p.sku ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%')
      AND ($2::text = 'all' OR p.active = ($2::text = 'active'))
    ORDER BY p.active DESC, lower(p.name), p.id
    LIMIT 100
  `, [search, status]);

  return result.rows.map((row): CatalogProduct => ({
    id: String(row.id),
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id === null ? null : String(row.category_id),
    categoryName: row.category_name,
    salePrice: row.sale_price,
    reorderPoint: row.reorder_point,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listCategories(): Promise<ProductCategory[]> {
  const result = await getDbPool().query('SELECT id, name FROM categories ORDER BY lower(name), id');
  return result.rows.map((row) => ({ id: String(row.id), name: row.name }));
}

export async function findCatalogProduct(id: string): Promise<CatalogProduct | null> {
  if (!/^[1-9]\d{0,18}$/.test(id) || (id.length === 19 && id > '9223372036854775807')) return null;
  const result = await getDbPool().query(`
    SELECT p.id, p.sku, p.name, p.category_id, c.name AS category_name,
           p.sale_price, p.reorder_point, p.active, p.created_at
    FROM products AS p
    LEFT JOIN categories AS c ON c.id = p.category_id
    WHERE p.id = $1::bigint
  `, [id]);
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id === null ? null : String(row.category_id),
    categoryName: row.category_name,
    salePrice: row.sale_price,
    reorderPoint: row.reorder_point,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}
