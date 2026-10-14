import pg from 'pg';
import { randomUUID } from 'node:crypto';

if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');
const dbUrl = new URL(process.env.APP_DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(dbUrl.hostname)) {
  throw new Error('Purchasing verification only runs against a local APP_DATABASE_URL.');
}

const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
let inTransaction = false;
const suffix = randomUUID();
const ids = { actors: {}, products: {}, suppliers: {}, orders: {}, lines: {}, receipts: {} };

async function expectRejected(label, operation, accept = () => true) {
  const savepoint = `check_${randomUUID().replaceAll('-', '')}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (!accept(error)) throw new Error(`${label} failed with unexpected database error ${error.code ?? 'unknown'}: ${error.message}`);
    return;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  throw new Error(`${label} was unexpectedly accepted.`);
}

const isBusinessRejection = (error) => error.code === 'P0001';
async function createProduct(actorId, label) {
  const sku = `VERIFY-PO-${suffix.slice(0, 8)}-${label}`;
  const result = await client.query(
    'SELECT save_product(NULL::bigint,$1::text,$2::text,NULL::bigint,NULL::numeric,0,true,$3::uuid,$4::uuid) AS id',
    [sku, `Temporary purchasing verification ${label}`, randomUUID(), actorId],
  );
  return String(result.rows[0].id);
}
async function saveOrder(actorId, supplierId, locationId, lines) {
  const result = await client.query(
    'SELECT save_purchase_order(NULL::bigint,$1::bigint,$2::bigint,NULL::date,NULL::text,$3::jsonb,$4::uuid) AS id',
    [supplierId, locationId, JSON.stringify(lines), actorId],
  );
  return String(result.rows[0].id);
}
async function supplier(actorId, name) {
  const result = await client.query(
    'SELECT save_supplier(NULL::bigint,$1::text,$2::text,$3::text,$4::text,$5::text,$6::uuid) AS id',
    [name, 'Fictional Test Contact', `test-${suffix.slice(0, 8)}@example.invalid`, '555-0100', 'Temporary rollback-only fixture', actorId],
  );
  return String(result.rows[0].id);
}
async function balance(productId, locationId) {
  const result = await client.query(
    'SELECT coalesce((SELECT quantity FROM stock_balances WHERE product_id=$1::bigint AND location_id=$2::bigint),0)::text AS quantity',
    [productId, locationId],
  );
  return result.rows[0].quantity;
}
async function callReceive(orderId, lines, requestId, actorId, reference = 'TEST-SLIP', note = 'Rollback-only verification') {
  const result = await client.query(
    'SELECT receive_purchase_order($1::bigint,$2::jsonb,$3::text,$4::text,$5::uuid,$6::uuid) AS id',
    [orderId, JSON.stringify(lines), reference, note, requestId, actorId],
  );
  return String(result.rows[0].id);
}
async function orderStatus(orderId) {
  const result = await client.query('SELECT status FROM purchase_orders WHERE id=$1::bigint', [orderId]);
  return result.rows[0]?.status;
}

try {
  await client.connect();
  await client.query('BEGIN');
  inTransaction = true;

  const actorsResult = await client.query(`
    INSERT INTO app_users(email,display_name,password_hash,role,active)
    VALUES
      ($1,'PO verifier admin','verification-only','admin',true),
      ($2,'PO verifier manager','verification-only','manager',true),
      ($3,'PO verifier clerk','verification-only','clerk',true),
      ($4,'PO verifier viewer','verification-only','viewer',true)
    RETURNING id,role
  `, [
    `po-admin-${suffix}@example.invalid`, `po-manager-${suffix}@example.invalid`,
    `po-clerk-${suffix}@example.invalid`, `po-viewer-${suffix}@example.invalid`,
  ]);
  for (const row of actorsResult.rows) ids.actors[row.role] = String(row.id);
  const locationResult = await client.query('SELECT id FROM locations ORDER BY id LIMIT 1');
  if (!locationResult.rowCount) throw new Error('No location exists; apply location setup before verification.');
  const locationId = String(locationResult.rows[0].id);
  ids.products.a = await createProduct(ids.actors.admin, 'A');
  ids.products.b = await createProduct(ids.actors.admin, 'B');
  ids.products.c = await createProduct(ids.actors.admin, 'C');
  const startingA = await balance(ids.products.a, locationId);
  const startingB = await balance(ids.products.b, locationId);
  const startingC = await balance(ids.products.c, locationId);

  ids.suppliers.main = await supplier(ids.actors.manager, `Rollback Supplier ${suffix.slice(0, 8)}`);
  await expectRejected('Case-insensitive duplicate supplier name', () => supplier(ids.actors.admin, `  ROLLBACK SUPPLIER ${suffix.slice(0, 8)}  `), (error) => error.code === '23505');
  await expectRejected('Clerk supplier write', () => supplier(ids.actors.clerk, `Clerk Denied ${suffix.slice(0, 8)}`), isBusinessRejection);
  await expectRejected('Manager supplier deactivation', () => client.query('SELECT set_supplier_active($1::bigint,false,$2::uuid)', [ids.suppliers.main, ids.actors.manager]), isBusinessRejection);
  await client.query('SELECT set_supplier_active($1::bigint,false,$2::uuid)', [ids.suppliers.main, ids.actors.admin]);
  await client.query('SELECT set_supplier_active($1::bigint,true,$2::uuid)', [ids.suppliers.main, ids.actors.admin]);

  ids.orders.main = await saveOrder(ids.actors.manager, ids.suppliers.main, locationId, [{ productId: ids.products.a, quantity: 4 }]);
  const editedDraft = await client.query(
    'SELECT save_purchase_order($1::bigint,$2::bigint,$3::bigint,NULL::date,$4::text,$5::jsonb,$6::uuid) AS id',
    [ids.orders.main, ids.suppliers.main, locationId, 'Edited draft', JSON.stringify([
      { productId: ids.products.a, quantity: 5 }, { productId: ids.products.b, quantity: 2 },
    ]), ids.actors.manager],
  );
  if (String(editedDraft.rows[0].id) !== ids.orders.main) throw new Error('Draft edit returned a different order ID.');
  if ((await balance(ids.products.a, locationId)) !== startingA || (await balance(ids.products.b, locationId)) !== startingB
      || (await balance(ids.products.c, locationId)) !== startingC) {
    throw new Error('Saving/editing a draft changed on-hand stock.');
  }
  const orderLines = await client.query('SELECT id,product_id,ordered_quantity FROM purchase_order_lines WHERE purchase_order_id=$1::bigint ORDER BY product_id', [ids.orders.main]);
  const lineA = String(orderLines.rows.find((row) => String(row.product_id) === ids.products.a).id);
  const lineB = String(orderLines.rows.find((row) => String(row.product_id) === ids.products.b).id);
  ids.lines.a = lineA; ids.lines.b = lineB;
  ids.orders.cross = await saveOrder(ids.actors.manager, ids.suppliers.main, locationId, [{ productId: ids.products.c, quantity: 1 }]);
  const crossLine = await client.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1::bigint', [ids.orders.cross]);
  const crossLineId = String(crossLine.rows[0].id);
  ids.orders.draftCancel = await saveOrder(ids.actors.manager, ids.suppliers.main, locationId, [{ productId: ids.products.c, quantity: 1 }]);
  await client.query('SELECT cancel_purchase_order($1::bigint,$2::text,$3::uuid)', [ids.orders.draftCancel, 'Draft no longer needed', ids.actors.manager]);
  const draftCancellation = await client.query('SELECT status,submitted_at,cancelled_at,cancel_reason FROM purchase_orders WHERE id=$1::bigint', [ids.orders.draftCancel]);
  if (draftCancellation.rows[0]?.status !== 'cancelled' || draftCancellation.rows[0]?.submitted_at !== null
      || !draftCancellation.rows[0]?.cancelled_at || draftCancellation.rows[0]?.cancel_reason !== 'Draft no longer needed') {
    throw new Error('Draft cancellation did not preserve the lifecycle timestamps/reason required by its constraints.');
  }
  await expectRejected('Clerk order submission', () => client.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [ids.orders.main, ids.actors.clerk]), isBusinessRejection);
  await client.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [ids.orders.main, ids.actors.manager]);
  if (await orderStatus(ids.orders.main) !== 'submitted') throw new Error('Submitted purchase order has the wrong status.');
  if ((await balance(ids.products.a, locationId)) !== startingA || (await balance(ids.products.b, locationId)) !== startingB) {
    throw new Error('Submitting an order changed on-hand stock.');
  }

  const requestId = randomUUID();
  ids.receipts.partial = await callReceive(ids.orders.main, [{ lineId: lineA, quantity: 2 }], requestId, ids.actors.clerk);
  if (await orderStatus(ids.orders.main) !== 'partially_received') throw new Error('A partial receipt did not set partially_received status.');
  if ((await balance(ids.products.a, locationId)) !== String(BigInt(startingA) + 2n)) throw new Error('Partial receipt did not add the expected units.');
  const movementsAfterFirst = await client.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1::bigint AND location_id=$2::bigint', [ids.products.a, locationId]);
  const retried = await callReceive(ids.orders.main, [{ lineId: lineA, quantity: 2 }], requestId, ids.actors.clerk);
  if (retried !== ids.receipts.partial) throw new Error('An identical receipt retry did not return the prior receipt ID.');
  const movementsAfterRetry = await client.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1::bigint AND location_id=$2::bigint', [ids.products.a, locationId]);
  if (movementsAfterRetry.rows[0].n !== movementsAfterFirst.rows[0].n || (await balance(ids.products.a, locationId)) !== String(BigInt(startingA) + 2n)) {
    throw new Error('An identical retry duplicated stock or movement history.');
  }
  await expectRejected('Changed payload under an existing receipt request ID', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 1 }], requestId, ids.actors.clerk), isBusinessRejection);
  await expectRejected('Over-receipt', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 4 }], randomUUID(), ids.actors.clerk), isBusinessRejection);
  await expectRejected('Zero-only receipt', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 0 }], randomUUID(), ids.actors.clerk), isBusinessRejection);
  await expectRejected('Duplicate line in one receipt', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 1 }, { lineId: lineA, quantity: 1 }], randomUUID(), ids.actors.clerk), isBusinessRejection);
  await expectRejected('Viewer receipt permission', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 1 }], randomUUID(), ids.actors.viewer), isBusinessRejection);
  await expectRejected('Cross-order line receipt', () => callReceive(ids.orders.main, [{ lineId: crossLineId, quantity: 1 }], randomUUID(), ids.actors.clerk), isBusinessRejection);

  ids.receipts.final = await callReceive(ids.orders.main, [{ lineId: lineA, quantity: 3 }, { lineId: lineB, quantity: 2 }], randomUUID(), ids.actors.clerk, 'FINAL-SLIP', null);
  if (await orderStatus(ids.orders.main) !== 'received') throw new Error('A fully received order was not marked received.');
  if ((await balance(ids.products.a, locationId)) !== String(BigInt(startingA) + 5n)
      || (await balance(ids.products.b, locationId)) !== String(BigInt(startingB) + 2n)) throw new Error('Final receipt balances are incorrect.');
  await expectRejected('Receipt after order completion', () => callReceive(ids.orders.main, [{ lineId: lineA, quantity: 1 }], randomUUID(), ids.actors.clerk), isBusinessRejection);

  ids.orders.cancelled = await saveOrder(ids.actors.manager, ids.suppliers.main, locationId, [{ productId: ids.products.c, quantity: 4 }]);
  await client.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [ids.orders.cancelled, ids.actors.manager]);
  const cancelLine = await client.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1::bigint', [ids.orders.cancelled]);
  const cancelLineId = String(cancelLine.rows[0].id);
  const cBeforePartial = await balance(ids.products.c, locationId);
  await callReceive(ids.orders.cancelled, [{ lineId: cancelLineId, quantity: 1 }], randomUUID(), ids.actors.clerk, 'PARTIAL-SLIP');
  await client.query('SELECT cancel_purchase_order($1::bigint,$2::text,$3::uuid)', [ids.orders.cancelled, 'Supplier could not fulfill remaining units', ids.actors.manager]);
  if (await orderStatus(ids.orders.cancelled) !== 'cancelled') throw new Error('Cancellation did not set cancelled status.');
  const preserved = await client.query(`SELECT coalesce(sum(quantity),0)::text AS received FROM purchase_receipt_lines WHERE purchase_order_id=$1::bigint`, [ids.orders.cancelled]);
  if (preserved.rows[0].received !== '1' || (await balance(ids.products.c, locationId)) !== String(BigInt(cBeforePartial) + 1n)) {
    throw new Error('Cancellation did not preserve already-received units and stock.');
  }
  await expectRejected('Receive canceled remainder', () => callReceive(ids.orders.cancelled, [{ lineId: cancelLineId, quantity: 1 }], randomUUID(), ids.actors.clerk), isBusinessRejection);

  ids.suppliers.inactive = await supplier(ids.actors.manager, `Inactive Supplier ${suffix.slice(0, 8)}`);
  ids.orders.inactiveSupplier = await saveOrder(ids.actors.manager, ids.suppliers.inactive, locationId, [{ productId: ids.products.c, quantity: 1 }]);
  await client.query('SELECT set_supplier_active($1::bigint,false,$2::uuid)', [ids.suppliers.inactive, ids.actors.admin]);
  await expectRejected('Submit order for inactive supplier', () => client.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [ids.orders.inactiveSupplier, ids.actors.manager]), isBusinessRejection);
  await expectRejected('Create order for inactive supplier', () => saveOrder(ids.actors.manager, ids.suppliers.inactive, locationId, [{ productId: ids.products.c, quantity: 1 }]), isBusinessRejection);
  const existingReadable = await client.query('SELECT o.id,s.active FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id WHERE o.id=$1::bigint', [ids.orders.inactiveSupplier]);
  if (!existingReadable.rowCount || existingReadable.rows[0].active !== false) throw new Error('An existing order was not readable after supplier deactivation.');

  await client.query('SELECT set_supplier_active($1::bigint,true,$2::uuid)', [ids.suppliers.inactive, ids.actors.admin]);
  await client.query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [ids.orders.inactiveSupplier, ids.actors.manager]);
  const inactiveLine = await client.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1::bigint', [ids.orders.inactiveSupplier]);
  await client.query('SELECT save_product($1::bigint,$2::text,$3::text,NULL,NULL,0,false,$4::uuid,$5::uuid)',
    [ids.products.c, `VERIFY-PO-${suffix.slice(0, 8)}-C`, `Temporary purchasing verification C`, randomUUID(), ids.actors.admin]);
  const beforeInactiveAttempt = await balance(ids.products.c, locationId);
  await expectRejected('Receive an inactive product', () => callReceive(ids.orders.inactiveSupplier, [{ lineId: String(inactiveLine.rows[0].id), quantity: 1 }], randomUUID(), ids.actors.clerk), isBusinessRejection);
  if ((await balance(ids.products.c, locationId)) !== beforeInactiveAttempt) throw new Error('Rejected inactive-product receipt changed stock.');
  await client.query('SELECT save_product($1::bigint,$2::text,$3::text,NULL,NULL,0,true,$4::uuid,$5::uuid)',
    [ids.products.c, `VERIFY-PO-${suffix.slice(0, 8)}-C`, `Temporary purchasing verification C`, randomUUID(), ids.actors.admin]);

  const movementAudit = await client.query(`
    SELECT count(*)::int AS n, bool_and(m.actor_id=$1::uuid AND m.movement_type='receiving' AND m.quantity_delta>0
      AND m.location_id=$2::bigint AND rl.stock_movement_id=m.id) AS valid
    FROM purchase_receipt_lines rl JOIN stock_movements m ON m.id=rl.stock_movement_id
    WHERE rl.purchase_order_id IN ($3::bigint,$4::bigint)
  `, [ids.actors.clerk, locationId, ids.orders.main, ids.orders.cancelled]);
  if (movementAudit.rows[0].n !== 4 || movementAudit.rows[0].valid !== true) throw new Error('Receipt-to-movement actor/type/location linkage is incorrect.');
  const audit = await client.query(`SELECT count(*)::int AS n FROM purchasing_audit_log WHERE actor_id=$1::uuid`, [ids.actors.manager]);
  if (audit.rows[0].n < 5) throw new Error('Expected supplier, draft, submit, and cancellation audit events for manager actions.');
  const grants = await client.query(`
    SELECT has_table_privilege('inventory_app','purchase_orders','INSERT') AS order_insert,
      has_table_privilege('inventory_app','purchase_receipts','UPDATE') AS receipt_update,
      has_function_privilege('inventory_app','receive_purchase_order(bigint,jsonb,text,text,uuid,uuid)','EXECUTE') AS can_receive
  `);
  if (grants.rows[0].order_insert || grants.rows[0].receipt_update || !grants.rows[0].can_receive) {
    throw new Error('Purchasing runtime grants do not follow the read-plus-function-write boundary.');
  }

  await client.query('ROLLBACK');
  inTransaction = false;
  console.log('Purchasing workflow verified: supplier normalization/roles, editable draft without stock effects, submit lock, partial and final receiving, exact retry, over-receipt and invalid input rejection, cancellation preserving receipts, inactive supplier/product rules, actor audit, movement linkage, and least-privilege grants passed. All test data was rolled back.');
} finally {
  if (inTransaction) await client.query('ROLLBACK');
  await client.end();
}
