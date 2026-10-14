import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { OrderEditor } from '../order-editor';
import { getDbPool, listActiveStockProducts, listInventoryLocations } from '@/lib/db';
import { requirePermission } from '@/lib/auth';

export default function NewPurchaseOrderPage() {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading order form…</p></section></main>}><NewPurchaseOrderContent /></Suspense>;
}

async function NewPurchaseOrderContent() {
  await connection();
  await requirePermission('purchase_orders:write');
  const [supplierResult, locations, products] = await Promise.all([
    getDbPool().query('SELECT id::text, name, contact_name AS "contactName", email, active FROM suppliers WHERE active = true ORDER BY lower(name), id'),
    listInventoryLocations(),
    listActiveStockProducts(),
  ]);
  const suppliers = supplierResult.rows;
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">PURCHASING / NEW ORDER</p><h1>Create purchase order</h1><p className="page-description">Choose a supplier, destination, and products. A saved draft has no effect on on-hand quantities.</p></div><Link className="button button-secondary" href="/purchase-orders">Back to purchase orders</Link></div>
    {suppliers.length === 0 ? <section className="empty-state"><h2>Add a supplier first</h2><p>Purchase orders use a saved supplier record.</p><Link className="button button-primary" href="/suppliers">Manage suppliers</Link></section>
      : locations.length === 0 || products.length === 0 ? <section className="empty-state"><h2>Order setup is incomplete</h2><p>Add a location and at least one active product before creating an order.</p><Link className="button button-secondary" href="/stock">Check inventory setup</Link></section>
        : <OrderEditor suppliers={suppliers} locations={locations} products={products} />}
  </main>;
}
