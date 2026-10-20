import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const adminValue = process.env.DATABASE_URL;
const appValue = process.env.APP_DATABASE_URL;
if (!adminValue || !appValue) {
  throw new Error('Create .env.neon-demo with Neon DATABASE_URL and APP_DATABASE_URL values first.');
}

const adminUrl = new URL(adminValue);
const appUrl = new URL(appValue);
const sameEndpoint = (host) => host.replace(/-pooler(?=\.)/, '');
const requiresTls = (url) => ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'));
const adminDb = decodeURIComponent(adminUrl.pathname.slice(1));

// Refuse local and non-Neon targets: this command is designed for a fresh,
// isolated employer-demo database and must never touch the local inventory.
if (!adminUrl.hostname.startsWith('ep-') || !adminUrl.hostname.endsWith('.neon.tech')
    || !appUrl.hostname.startsWith('ep-') || !appUrl.hostname.endsWith('.neon.tech')) {
  throw new Error('Both database URLs must point to Neon endpoints; local and other hosts are refused.');
}
if (adminUrl.hostname.includes('-pooler.')) {
  throw new Error("Use Neon's direct (non-pooled) URL for DATABASE_URL because migrations use a session advisory lock.");
}
if (sameEndpoint(adminUrl.hostname) !== sameEndpoint(appUrl.hostname)
    || (adminUrl.port || '5432') !== (appUrl.port || '5432')
    || adminDb.length === 0 || decodeURIComponent(appUrl.pathname.slice(1)) !== adminDb) {
  throw new Error('The direct and pooled URLs must target the same Neon endpoint and database.');
}
if (!requiresTls(adminUrl) || !requiresTls(appUrl)) {
  throw new Error('Both Neon URLs must require TLS (sslmode=require or stronger).');
}
if (appUrl.username !== 'inventory_runtime' || !/^[A-Za-z0-9._~-]{32,}$/.test(decodeURIComponent(appUrl.password))
    || decodeURIComponent(appUrl.password) === decodeURIComponent(adminUrl.password)) {
  throw new Error('Use a distinct, URL-safe runtime password of at least 32 characters and the inventory_runtime username.');
}
if (!appUrl.hostname.includes('-pooler.')) {
  throw new Error("Use Neon's pooled connection URL for APP_DATABASE_URL to limit serverless database connections.");
}

const admin = new pg.Client({ connectionString: adminValue });
try {
  await admin.connect();
  const schema = await admin.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS initialized");
  if (!schema.rows[0].initialized) {
    const tables = await admin.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
    if (tables.rows[0].count !== 0) {
      throw new Error('Target database is not empty and has no inventory migration ledger; refusing to modify it.');
    }
  } else {
    const fixtureMigration = await admin.query("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version='022') AS applied");
    if (!fixtureMigration.rows[0].applied) {
      // A failed transactional migration can leave earlier migrations applied.
      // Resume only a known, empty schema; never seed or migrate existing data.
      const versions = await admin.query('SELECT version FROM schema_migrations');
      const knownVersions = new Set((await readdir(new URL('../db/', import.meta.url)))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
        .map((name) => name.slice(0, name.indexOf('_'))));
      const allVersionsKnown = versions.rows.every((row) => knownVersions.has(row.version));
      const tables = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      const expectedTables = new Set([
        'schema_migrations', 'products', 'locations', 'stock_movements', 'categories',
        'inventory_stock', 'inventory_audit_log', 'app_users', 'app_sessions',
        'auth_login_rate_limits', 'app_security_events', 'suppliers', 'purchase_orders',
        'purchase_order_lines', 'purchase_receipts', 'purchase_receipt_lines', 'purchasing_audit_log',
      ]);
      const schemaIsKnown = allVersionsKnown && tables.rows.every((row) => expectedTables.has(row.tablename));
      const tableNames = new Set(tables.rows.map((row) => row.tablename));
      const noUsers = tableNames.has('app_users') ? "(SELECT count(*)::int FROM app_users) = 0" : 'TRUE';
      const noSessions = tableNames.has('app_sessions') ? "(SELECT count(*)::int FROM app_sessions) = 0" : 'TRUE';
      // Earlier seed migrations intentionally add a small, fixed fictional data
      // set. Permit resuming only when every existing business row still matches
      // that exact starter set; operator-entered or unexpected data is refused.
      const seedState = await admin.query(`
        SELECT
          (SELECT count(*)::int FROM categories) = 0 AS no_categories,
          (SELECT count(*)::int FROM products) = 3 AND
            (SELECT count(*)::int FROM products WHERE NOT active OR category_id IS NOT NULL OR
              (sku='DEMO-COFFEE-001' AND (name<>'Northstar Coffee Beans, 12 oz' OR reorder_point<>5 OR sale_price<>14.99)) OR
              (sku='DEMO-SNACK-001' AND (name<>'Crisp Orchard Trail Mix, 8 oz' OR reorder_point<>8 OR sale_price<>6.49)) OR
              (sku='DEMO-BOTTLE-001' AND (name<>'Summit Steel Water Bottle, 24 oz' OR reorder_point<>3 OR sale_price<>18.00)) OR
              sku NOT IN ('DEMO-COFFEE-001','DEMO-SNACK-001','DEMO-BOTTLE-001')) = 0 AS known_products,
          (SELECT count(*)::int FROM locations) = 2 AND
            (SELECT count(*)::int FROM locations WHERE name NOT IN ('Demo Store','Demo Outlet')) = 0 AS known_locations,
          (SELECT count(*)::int FROM stock_movements) = 8 AND
            (SELECT count(*)::int FROM stock_movements WHERE request_id NOT IN (
              '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002',
              '72000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000004',
              '72000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000006',
              '72000000-0000-4000-8000-000000000007','72000000-0000-4000-8000-000000000008') OR
              actor_id IS NOT NULL OR reason NOT IN ('Demo setup - initial receiving','Demo setup - sample sale')) = 0 AS known_movements,
          (SELECT count(*)::int FROM inventory_audit_log) = 11 AND
            (SELECT count(*)::int FROM inventory_audit_log WHERE actor_id IS NOT NULL OR
              NOT ((entity_type='product' AND action='insert') OR (entity_type='stock_movement' AND action='movement'))) = 0 AS known_audit,
          ${noUsers} AS no_users,
          ${noSessions} AS no_sessions
      `);
      const knownSeedState = Object.values(seedState.rows[0]).every(Boolean);
      if (!schemaIsKnown || !knownSeedState) {
        throw new Error('Target has unexpected schema or data; refusing to continue. Use a fresh empty Neon database.');
      }
      console.log('Found a known partial schema containing only the exact fictional starter data; safely resuming migrations.');
    } else {
    const demo = await admin.query(`
      SELECT
        EXISTS (SELECT 1 FROM schema_migrations WHERE version='022') AS fixture_migration,
        EXISTS (SELECT 1 FROM schema_migrations WHERE version='023') AS category_migration,
        (SELECT count(*)::int FROM app_users) AS user_count,
        (SELECT count(*)::int FROM app_users WHERE id <> '73000000-0000-4000-8000-000000000001'
          OR email <> 'demo-system@inventory-demo.invalid' OR active OR role <> 'viewer') AS unexpected_users,
        (SELECT count(*)::int FROM products) AS product_count,
        (SELECT count(*)::int FROM categories) AS category_count,
        (SELECT count(*)::int FROM categories WHERE name NOT IN ('Coffee & Tea','Snacks','Drinkware')) AS unexpected_categories,
        (SELECT count(*)::int FROM products AS product WHERE NOT active OR
          (sku='DEMO-COFFEE-001' AND (name<>'Northstar Coffee Beans, 12 oz' OR reorder_point<>5 OR sale_price<>14.99 OR
            (SELECT category.name FROM categories AS category WHERE category.id=product.category_id) IS DISTINCT FROM
              CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version='023') THEN 'Coffee & Tea' ELSE NULL END)) OR
          (sku='DEMO-SNACK-001' AND (name<>'Crisp Orchard Trail Mix, 8 oz' OR reorder_point<>8 OR sale_price<>6.49 OR
            (SELECT category.name FROM categories AS category WHERE category.id=product.category_id) IS DISTINCT FROM
              CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version='023') THEN 'Snacks' ELSE NULL END)) OR
          (sku='DEMO-BOTTLE-001' AND (name<>'Summit Steel Water Bottle, 24 oz' OR reorder_point<>3 OR sale_price<>18.00 OR
            (SELECT category.name FROM categories AS category WHERE category.id=product.category_id) IS DISTINCT FROM
              CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version='023') THEN 'Drinkware' ELSE NULL END)) OR
          sku NOT IN ('DEMO-COFFEE-001','DEMO-SNACK-001','DEMO-BOTTLE-001')) AS unexpected_products,
        (SELECT count(*)::int FROM inventory_audit_log) AS inventory_audit_count,
        (SELECT count(*)::int FROM inventory_audit_log WHERE
          (actor_id IS NOT NULL AND actor_id <> '73000000-0000-4000-8000-000000000001') OR NOT (
          (entity_type='product' AND action IN ('insert','update')) OR
          (entity_type='stock_movement' AND action='movement'))) AS unexpected_inventory_audit,
        (SELECT count(*)::int FROM locations) AS location_count,
        (SELECT count(*)::int FROM locations WHERE name NOT IN ('Demo Store','Demo Outlet')) AS unexpected_locations,
        (SELECT count(*)::int FROM suppliers) AS supplier_count,
        (SELECT count(*)::int FROM suppliers WHERE name <> 'Northstar Wholesale Supply'
          OR contact_name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL OR notes IS NOT NULL) AS unexpected_suppliers,
        (SELECT count(*)::int FROM purchase_orders) AS order_count,
        (SELECT count(*)::int FROM purchase_orders WHERE notes NOT IN (
          'Employer demo fixture: completed bottle delivery','Employer demo fixture: open coffee replenishment') OR
          (notes='Employer demo fixture: completed bottle delivery' AND
            (status<>'received' OR supplier_name_snapshot<>'Northstar Wholesale Supply' OR location_name_snapshot<>'Demo Store')) OR
          (notes='Employer demo fixture: open coffee replenishment' AND
            (status<>'submitted' OR supplier_name_snapshot<>'Northstar Wholesale Supply' OR location_name_snapshot<>'Demo Outlet'))) AS unexpected_orders,
        (SELECT count(*)::int FROM stock_movements) AS movement_count,
        (SELECT count(*)::int FROM stock_movements WHERE reason NOT IN (
          'Demo setup - initial receiving','Demo setup - sample sale','Purchase order demo receipt')
          OR (actor_id IS NOT NULL AND actor_id <> '73000000-0000-4000-8000-000000000001')) AS unexpected_movements,
        (SELECT count(*)::int FROM purchase_receipts) AS receipt_count,
        (SELECT count(*)::int FROM purchase_receipts WHERE reference<>'DEMO-PACKING-SLIP-001'
          OR note<>'Fictional employer-demo receipt' OR actor_id<>'73000000-0000-4000-8000-000000000001') AS unexpected_receipts,
        (SELECT count(*)::int FROM purchase_order_lines) AS order_line_count,
        (SELECT count(*)::int FROM purchase_receipt_lines) AS receipt_line_count
    `);
    const current = demo.rows[0];
    if (!current.fixture_migration || current.user_count !== 1 || current.unexpected_users !== 0
        || current.product_count !== 3 || current.category_count !== (current.category_migration ? 3 : 0)
        || current.unexpected_categories !== 0 || current.unexpected_products !== 0
        || current.inventory_audit_count !== (current.category_migration ? 15 : 12)
        || current.unexpected_inventory_audit !== 0
        || current.location_count !== 2 || current.unexpected_locations !== 0
        || current.supplier_count !== 1 || current.unexpected_suppliers !== 0
        || current.order_count !== 2 || current.unexpected_orders !== 0
        || current.movement_count !== 9 || current.unexpected_movements !== 0
        || current.receipt_count !== 1 || current.unexpected_receipts !== 0
        || current.order_line_count !== 2 || current.receipt_line_count !== 1) {
      throw new Error('Target already has a schema but is not the clean employer-demo dataset; use a new empty Neon database.');
    }
    }
  }
} finally {
  await admin.end();
}

function run(script, args = [], extraEnvironment = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}.`);
}

console.log('Verified a TLS-protected Neon target. Applying the reviewed schema and fictional demo fixtures.');
run('scripts/db.mjs', ['migrate']);
run('scripts/provision-app-role.mjs', [], { ALLOW_REMOTE_DB_PROVISIONING: 'true' });
run('scripts/verify-demo-seed.mjs');

const runtime = new pg.Client({ connectionString: appValue });
try {
  await runtime.connect();
  const result = await runtime.query(`
    SELECT current_database() AS database, current_user AS role,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM locations) AS locations,
      (SELECT count(*)::int FROM suppliers) AS suppliers,
      (SELECT count(*)::int FROM purchase_orders) AS orders,
      (SELECT count(*)::int FROM app_users WHERE active) AS active_users,
      (SELECT count(*)::int FROM app_users) AS users
  `);
  const ready = result.rows[0];
  if (ready.role !== 'inventory_runtime' || ready.products < 3 || ready.locations < 2
      || ready.suppliers < 1 || ready.orders < 2 || ready.users !== 1 || ready.active_users !== 0) {
    throw new Error('Runtime verification did not find the expected read-only fictional demo data.');
  }
  console.log(`Neon employer-demo database is ready (${ready.database}): ${ready.products} products, ${ready.locations} locations, ${ready.suppliers} supplier, ${ready.orders} sample orders, and no active accounts.`);
} finally {
  await runtime.end();
}
