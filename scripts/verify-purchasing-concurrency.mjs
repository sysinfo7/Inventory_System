import pg from 'pg';
import { randomUUID } from 'node:crypto';

// This test creates persistent fixtures, so only run it in the disposable CI database.
if (process.env.CI !== 'true') {
  throw new Error('Concurrent purchasing verification is limited to the disposable CI database.');
}
if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) {
  throw new Error('DATABASE_URL and APP_DATABASE_URL are required.');
}
for (const key of ['DATABASE_URL', 'APP_DATABASE_URL']) {
  const parsed = new URL(process.env[key]);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(`${key} must point to a local disposable CI database.`);
  }
}

const suffix = randomUUID();
const actorId = randomUUID();
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'ci-purchasing-receipt-blocker' });
const locationClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
const receiptClients = [
  new pg.Client({ connectionString: process.env.APP_DATABASE_URL, application_name: `ci-receipt-race-a-${suffix}` }),
  new pg.Client({ connectionString: process.env.APP_DATABASE_URL, application_name: `ci-receipt-race-b-${suffix}` }),
];

async function receive(client, orderId, lineId, requestId) {
  try {
    const result = await client.query(
      'SELECT receive_purchase_order($1::bigint,$2::jsonb,$3::text,NULL::text,$4::uuid,$5::uuid) AS id',
      [orderId, JSON.stringify([{ lineId, quantity: 4 }]), 'CI concurrent receipt', requestId, actorId],
    );
    return { ok: true, receiptId: String(result.rows[0].id) };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

let lockHeld = false;
try {
  await setup.connect();
  await blocker.connect();
  await locationClient.connect();
  const actor = await setup.query(
    `INSERT INTO app_users(id,email,display_name,password_hash,role,active)
     VALUES ($1::uuid,$2,'CI receipt race','verification-only','manager',true) RETURNING id`,
    [actorId, `ci-receipt-${suffix}@example.invalid`],
  );
  if (!actor.rowCount) throw new Error('Could not create the temporary CI receiving actor.');

  const locationResult = await locationClient.query('SELECT id FROM locations ORDER BY id LIMIT 1');
  if (!locationResult.rowCount) throw new Error('No location exists; apply database migrations first.');
  const locationId = String(locationResult.rows[0].id);
  const product = await setup.query(
    'SELECT save_product(NULL::bigint,$1::text,$2::text,NULL::bigint,NULL::numeric,0,true,$3::uuid,$4::uuid) AS id',
    [`CI-PO-RACE-${suffix}`, 'Temporary concurrent receipt verification item', randomUUID(), actorId],
  );
  const supplier = await setup.query(
    'SELECT save_supplier(NULL::bigint,$1::text,NULL::text,NULL::text,NULL::text,NULL::text,$2::uuid) AS id',
    [`CI receipt race ${suffix}`, actorId],
  );
  const order = await setup.query(
    'SELECT save_purchase_order(NULL::bigint,$1::bigint,$2::bigint,NULL::date,NULL::text,$3::jsonb,$4::uuid) AS id',
    [supplier.rows[0].id, locationId, JSON.stringify([{ productId: String(product.rows[0].id), quantity: 5 }]), actorId],
  );
  const orderId = String(order.rows[0].id);
  const line = await setup.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1::bigint', [orderId]);
  if (!line.rowCount) throw new Error('The concurrent receipt test order has no line.');
  const lineId = String(line.rows[0].id);
  await setup.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [orderId, actorId]);

  // Hold the order row so both independent receipt calls reach the same lock before either can proceed.
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM purchase_orders WHERE id=$1::bigint FOR UPDATE', [orderId]);
  lockHeld = true;
  const attempts = receiptClients.map((client) => client.connect().then(() => receive(client, orderId, lineId, randomUUID())));

  const deadline = Date.now() + 15_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const result = await setup.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE application_name = ANY($1::text[]) AND state='active' AND wait_event_type='Lock'`,
      [receiptClients.map((client) => client.connectionParameters.application_name)],
    );
    waiting = result.rows[0].n;
    if (waiting === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (waiting !== 2) throw new Error(`Both receipt sessions did not reach the order lock (observed ${waiting}/2).`);
  await blocker.query('COMMIT');
  lockHeld = false;
  const results = await Promise.all(attempts);
  const accepted = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  if (accepted.length !== 1 || rejected.length !== 1 || rejected[0].code !== 'P0001'
      || rejected[0].message !== 'Receipt quantity exceeds the remaining order quantity') {
    throw new Error(`Expected one four-unit receipt and one over-receipt rejection; got ${JSON.stringify(results)}.`);
  }

  const outcome = await setup.query(
    `SELECT o.status, coalesce(sum(rl.quantity),0)::text AS received,
            count(DISTINCT r.id)::int AS receipts, count(DISTINCT m.id)::int AS movements,
            coalesce((SELECT quantity FROM stock_balances WHERE product_id=$2::bigint AND location_id=$3::bigint),0)::text AS balance
     FROM purchase_orders o
     LEFT JOIN purchase_receipts r ON r.purchase_order_id=o.id
     LEFT JOIN purchase_receipt_lines rl ON rl.receipt_id=r.id
     LEFT JOIN stock_movements m ON m.id=rl.stock_movement_id
     WHERE o.id=$1::bigint GROUP BY o.id`,
    [orderId, product.rows[0].id, locationId],
  );
  const row = outcome.rows[0];
  if (row?.status !== 'partially_received' || row.received !== '4' || row.receipts !== 1
      || row.movements !== 1 || row.balance !== '4') {
    throw new Error(`Concurrent receipt outcome was inconsistent: ${JSON.stringify(row)}.`);
  }
  console.log('Concurrent purchasing verification passed: one four-unit receipt succeeded, the competing over-receipt was rejected, and one linked movement remains.');
  console.log('Fixtures persist only in the disposable GitHub Actions database.');
} finally {
  if (lockHeld) await blocker.query('ROLLBACK').catch(() => {});
  await Promise.allSettled(receiptClients.map((client) => client.end()));
  await Promise.allSettled([setup.end(), blocker.end(), locationClient.end()]);
}
