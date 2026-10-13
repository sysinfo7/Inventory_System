import pg from 'pg';
import { randomUUID } from 'node:crypto';

// Keep this integration test on the disposable database created by GitHub Actions.
if (process.env.CI !== 'true') {
  throw new Error('Concurrent stock verification is limited to the disposable CI database.');
}
if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');

const appUrl = new URL(process.env.APP_DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname)) {
  throw new Error('Concurrent stock verification only accepts a local database host.');
}

const setup = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
const productSku = `CI-RACE-${randomUUID()}`;
const locationIdResult = await setup.connect().then(() => setup.query('SELECT id FROM locations ORDER BY id LIMIT 1'));
if (!locationIdResult.rowCount) {
  await setup.end();
  throw new Error('No location is configured; apply the database migrations first.');
}

const locationId = String(locationIdResult.rows[0].id);
let productId;
try {
  await setup.query('BEGIN');
  const created = await setup.query(
    'SELECT save_product(NULL, $1::text, $2::text, NULL, NULL, 0, true, $3::uuid) AS id',
    [productSku, 'Temporary concurrent deduction verification item', randomUUID()],
  );
  productId = String(created.rows[0].id);
  await setup.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, 5::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
    [productId, locationId, 'receiving', 'CI concurrency test opening balance', randomUUID()],
  );
  await setup.query('COMMIT');
} catch (error) {
  await setup.query('ROLLBACK');
  throw error;
} finally {
  await setup.end();
}

// Separate PostgreSQL sessions are required to exercise the row lock under contention.
async function deduct(requestId) {
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  try {
    await client.connect();
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, -4::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'sale', 'CI concurrent sale deduction', requestId],
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  } finally {
    await client.end();
  }
}

const results = await Promise.all([deduct(randomUUID()), deduct(randomUUID())]);
const accepted = results.filter((result) => result.ok).length;
const rejected = results.filter((result) => !result.ok);
if (accepted !== 1 || rejected.length !== 1
    || rejected[0].code !== 'P0001' || rejected[0].message !== 'Insufficient stock') {
  throw new Error(`Expected one successful deduction and one insufficient-stock rejection; got ${JSON.stringify(results)}.`);
}

const verify = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
try {
  await verify.connect();
  const balance = await verify.query(
    'SELECT quantity::text AS quantity FROM stock_balances WHERE product_id = $1::bigint AND location_id = $2::bigint',
    [productId, locationId],
  );
  if (balance.rows[0]?.quantity !== '1') {
    throw new Error(`Expected the serialized balance to be 1; got ${balance.rows[0]?.quantity ?? 'no balance row'}.`);
  }
  console.log('Concurrent stock verification passed: one four-unit sale succeeded, the competing sale was rejected, and one unit remains.');
  console.log('The uniquely identified verification product and movements remain only in the disposable CI database.');
} finally {
  await verify.end();
}
