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
