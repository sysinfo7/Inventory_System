import pg from 'pg';
import { randomUUID } from 'node:crypto';

if (!process.env.APP_DATABASE_URL) {
  throw new Error('APP_DATABASE_URL is required. Configure the local app login first.');
}

const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
let transactionStarted = false;

try {
  await client.connect();
  await client.query('BEGIN');
  transactionStarted = true;

  const locationResult = await client.query('SELECT id FROM locations ORDER BY id LIMIT 1');
  if (!locationResult.rowCount) {
    throw new Error('No location is configured. Apply the latest migrations to add Demo Store.');
  }
  const locationId = String(locationResult.rows[0].id);
  const sku = `VERIFY-${randomUUID().slice(0, 8)}`;
  const productResult = await client.query(
    'SELECT save_product(NULL, $1, $2, NULL, NULL, 0, true, $3::uuid) AS id',
    [sku, 'Temporary stock workflow verification item', randomUUID()],
  );
  const productId = String(productResult.rows[0].id);
  const receiveRequestId = randomUUID();
  const saleRequestId = randomUUID();

  const receiveResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, 5::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'receiving', 'Temporary verification receipt', receiveRequestId],
  );
  const receiveId = String(receiveResult.rows[0].id);
  const retryResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, 5::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'receiving', 'Temporary verification receipt', receiveRequestId],
  );
  if (String(retryResult.rows[0].id) !== receiveId) {
    throw new Error('An identical request retry did not return the original movement.');
  }

  const saleResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, -3::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'sale', 'Temporary verification sale', saleRequestId],
  );
  const saleId = String(saleResult.rows[0].id);

  const returnResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, 2::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'return', 'Temporary verification customer return', randomUUID()],
  );
  const returnId = String(returnResult.rows[0].id);
  const adjustmentDownResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, -1::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'adjustment', 'Temporary verification count correction', randomUUID()],
  );
  const adjustmentDownId = String(adjustmentDownResult.rows[0].id);
  const adjustmentUpResult = await client.query(
    'SELECT record_stock_movement($1::bigint, $2::bigint, 1::bigint, $3::text, $4::text, NULL, $5::uuid, NULL) AS id',
    [productId, locationId, 'adjustment', 'Temporary verification count correction', randomUUID()],
  );
  const adjustmentUpId = String(adjustmentUpResult.rows[0].id);

  await client.query('SAVEPOINT zero_adjustment_check');
  let zeroAdjustmentRejected = false;
  try {
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, 0::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'adjustment', 'Temporary invalid zero correction', randomUUID()],
    );
  } catch (error) {
    zeroAdjustmentRejected = error.code === 'P0001' && error.message === 'Quantity delta must not be zero';
    await client.query('ROLLBACK TO SAVEPOINT zero_adjustment_check');
  }
  if (!zeroAdjustmentRejected) throw new Error('The stock function allowed a zero-quantity adjustment.');

  await client.query('SAVEPOINT adjustment_oversell_check');
  let adjustmentOversellRejected = false;
  try {
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, -5::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'adjustment', 'Temporary invalid count correction', randomUUID()],
    );
  } catch (error) {
    adjustmentOversellRejected = error.code === 'P0001' && error.message === 'Insufficient stock';
    await client.query('ROLLBACK TO SAVEPOINT adjustment_oversell_check');
  }
  if (!adjustmentOversellRejected) throw new Error('The stock function allowed an adjustment to make inventory negative.');

  await client.query('SAVEPOINT oversell_check');
  let oversellRejected = false;
  try {
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, -5::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'sale', 'Temporary oversell verification', randomUUID()],
    );
  } catch (error) {
    oversellRejected = error.code === 'P0001' && error.message === 'Insufficient stock';
    await client.query('ROLLBACK TO SAVEPOINT oversell_check');
  }
  if (!oversellRejected) throw new Error('The stock function did not reject an oversized sale deduction.');

  await client.query('SAVEPOINT idempotency_check');
  let conflictRejected = false;
  try {
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, 6::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'receiving', 'Different details with the same request ID', receiveRequestId],
    );
  } catch (error) {
    conflictRejected = error.code === 'P0001' && error.message === 'Request id was already used for a different stock movement';
    await client.query('ROLLBACK TO SAVEPOINT idempotency_check');
  }
  if (!conflictRejected) throw new Error('Reusing a request ID for different details was not rejected.');

  const balanceResult = await client.query(
    'SELECT quantity::text AS quantity FROM stock_balances WHERE product_id = $1::bigint AND location_id = $2::bigint',
    [productId, locationId],
  );
  if (balanceResult.rows[0]?.quantity !== '4') {
    throw new Error(`Expected a remaining quantity of 4 after receiving, sale, return, and both adjustments; got ${balanceResult.rows[0]?.quantity ?? 'no balance row'}.`);
  }

  await client.query(
    'SELECT save_product($1::bigint, $2::text, $3::text, NULL, NULL, 0, false, $4::uuid)',
    [productId, sku, 'Temporary stock workflow verification item', randomUUID()],
  );
  await client.query('SAVEPOINT inactive_product_check');
  let inactiveRejected = false;
  try {
    await client.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, 1::bigint, $3::text, $4::text, NULL, $5::uuid, NULL)',
      [productId, locationId, 'receiving', 'Temporary inactive-item verification', randomUUID()],
    );
  } catch (error) {
    inactiveRejected = error.code === 'P0001' && error.message === 'Product is not active or does not exist';
    await client.query('ROLLBACK TO SAVEPOINT inactive_product_check');
  }
  if (!inactiveRejected) throw new Error('The stock function allowed a new movement for an inactive product.');

  const auditResult = await client.query(`
    SELECT count(*)::integer AS event_count,
           bool_and(actor_id IS NULL) AS actors_unattributed
    FROM inventory_audit_log
    WHERE entity_type = 'stock_movement' AND entity_id = ANY($1::bigint[])
  `, [[receiveId, saleId, returnId, adjustmentDownId, adjustmentUpId]]);
  if (auditResult.rows[0].event_count !== 5 || !auditResult.rows[0].actors_unattributed) {
    throw new Error('The movement audit events or expected blank actor attribution were not present.');
  }

  // Always roll back: the check must not leave demo products, movements, or audit rows behind.
  await client.query('ROLLBACK');
  transactionStarted = false;
  console.log('Stock workflow verified: receiving, sale deduction, return, positive and negative adjustments, idempotent retry, oversell/zero rejection, and audit events passed. Test data was rolled back.');
} finally {
  if (transactionStarted) await client.query('ROLLBACK');
  await client.end();
}
