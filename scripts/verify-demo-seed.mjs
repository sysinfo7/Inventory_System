import pg from 'pg';

if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');
const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });

try {
  await client.connect();
  const products = await client.query(`
    SELECT sku,name FROM products ORDER BY sku
  `);
  const expectedProducts = new Map([
    ['DEMO-BOTTLE-001','Summit Steel Water Bottle, 24 oz'],
    ['DEMO-COFFEE-001','Northstar Coffee Beans, 12 oz'],
    ['DEMO-SNACK-001','Crisp Orchard Trail Mix, 8 oz'],
  ]);
  if (products.rowCount !== expectedProducts.size
      || products.rows.some((row) => expectedProducts.get(row.sku) !== row.name)) {
    throw new Error('The expected fictional demo products are missing or unexpected products are present.');
  }

  const actors = await client.query(`
    SELECT id,email,role,active,password_change_required
    FROM app_users
  `);
  if (actors.rowCount !== 1 || actors.rows[0].id !== '73000000-0000-4000-8000-000000000001'
      || actors.rows[0].email !== 'demo-system@inventory-demo.invalid'
      || actors.rows[0].role !== 'viewer' || actors.rows[0].active
      || !actors.rows[0].password_change_required) {
    throw new Error('The demo audit identity must be the single inactive, non-sign-in viewer account.');
  }

  const suppliers = await client.query(`
    SELECT name,contact_name,email,phone,notes,active FROM suppliers
  `);
  if (suppliers.rowCount !== 1 || suppliers.rows[0].name !== 'Northstar Wholesale Supply'
      || suppliers.rows[0].contact_name !== null || suppliers.rows[0].email !== null
      || suppliers.rows[0].phone !== null || suppliers.rows[0].notes !== null
      || !suppliers.rows[0].active) {
    throw new Error('The demo supplier must be fictional and contain no contact details.');
  }

  const orders = await client.query(`
    SELECT po.notes,po.status,count(line.id)::int AS line_count,
      coalesce(sum(line.ordered_quantity),0)::int AS ordered,
      coalesce(sum(received.quantity),0)::int AS received
    FROM purchase_orders AS po
    LEFT JOIN purchase_order_lines AS line ON line.purchase_order_id=po.id
    LEFT JOIN LATERAL (
      SELECT sum(item.quantity)::int AS quantity
      FROM purchase_receipt_lines AS item WHERE item.purchase_order_line_id=line.id
    ) AS received ON true
    GROUP BY po.id
    ORDER BY po.notes
  `);
  const byPurpose = new Map(orders.rows.map((row) => [row.notes, row]));
  const completed = byPurpose.get('Employer demo fixture: completed bottle delivery');
  const open = byPurpose.get('Employer demo fixture: open coffee replenishment');
  if (orders.rowCount !== 2 || !completed || completed.status !== 'received'
      || completed.line_count !== 1 || completed.ordered !== 3 || completed.received !== 3
      || !open || open.status !== 'submitted' || open.line_count !== 1
      || open.ordered !== 6 || open.received !== 0) {
    throw new Error('The seeded purchase orders do not show the completed-receipt and open-order workflows.');
  }

  const linkedReceipt = await client.query(`
    SELECT count(*)::int AS line_count,
      bool_and(receipt_line.quantity=movement.quantity_delta
        AND movement.movement_type='receiving'
        AND movement.product_id=line.product_id
        AND movement.location_id=po.location_id
        AND movement.actor_id=receipt.actor_id) AS linked_correctly
    FROM purchase_receipt_lines AS receipt_line
    JOIN purchase_receipts AS receipt ON receipt.id=receipt_line.receipt_id
    JOIN purchase_order_lines AS line ON line.id=receipt_line.purchase_order_line_id
    JOIN purchase_orders AS po ON po.id=receipt_line.purchase_order_id
    JOIN stock_movements AS movement ON movement.id=receipt_line.stock_movement_id
  `);
  if (linkedReceipt.rows[0].line_count !== 1 || !linkedReceipt.rows[0].linked_correctly) {
    throw new Error('The completed demo receipt must link to its matching stock movement.');
  }

  const bottleBalance = await client.query(`
    SELECT balance.quantity
    FROM stock_balances AS balance
    JOIN products AS product ON product.id=balance.product_id
    JOIN locations AS location ON location.id=balance.location_id
    WHERE product.sku='DEMO-BOTTLE-001' AND location.name='Demo Store'
  `);
  if (bottleBalance.rows[0]?.quantity !== '11') {
    throw new Error('The completed bottle receipt did not add three units to Demo Store stock.');
  }

  const audit = await client.query(`
    SELECT count(*)::int AS events FROM purchasing_audit_log
    WHERE actor_id='73000000-0000-4000-8000-000000000001'
  `);
  if (audit.rows[0].events !== 6) {
    throw new Error('The fictional purchasing seed did not write the expected actor-attributed audit history.');
  }

  console.log('Employer-demo seed verified: fictional catalog, inactive actor, contact-free supplier, submitted and completed orders, linked receipt, stock balance, and audit history passed.');
} finally {
  await client.end();
}
