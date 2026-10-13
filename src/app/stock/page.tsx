import Link from 'next/link';
import { connection } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import { StockForms } from './stock-forms';
import { listActiveStockProducts, listInventoryLocations, listStockItems } from '@/lib/db';
import { requirePermission, hasPermission } from '@/lib/auth';

type QueryValue = string | string[] | undefined;
type StockPageProps = { searchParams: Promise<{ location?: QueryValue }> };

function firstValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default function StockPage({ searchParams }: StockPageProps) {
  return (
    <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p className="eyebrow">Inventory / Stock</p><h1>Stock on hand</h1><p>Loading current stock…</p></section></main>}>
      <StockContent searchParams={searchParams} />
    </Suspense>
  );
}

async function StockContent({ searchParams }: StockPageProps) {
  await connection();
  const user = await requirePermission('stock:read');

  const params = await searchParams;
  let locations;
  let products;
  try {
    [locations, products] = await Promise.all([listInventoryLocations(), listActiveStockProducts()]);
  } catch (error) {
    console.error('Stock page setup failed:', error instanceof Error ? error.name : 'unknown error');
    return <Unavailable />;
  }

  if (locations.length === 0) {
    return <main className="page-shell"><div className="page-heading"><div><p className="eyebrow">Inventory / Stock</p><h1>Stock on hand</h1><p className="page-description">Receive units or record manual sale deductions by location.</p></div></div><div className="demo-notice"><span className="notice-mark" aria-hidden="true">i</span><p><strong>Local inventory demo.</strong> This records quantities only; it does not process payments or create accounting entries.</p></div><section className="catalog-panel"><div className="empty-state"><div className="empty-icon" aria-hidden="true">⌖</div><h3>No locations are available</h3><p>The latest database migration seeds a “Demo Store” when no location exists. Apply the migrations, then refresh this page.</p></div></section></main>;
  }

  const requestedLocation = firstValue(params.location);
  const location = locations.find((item) => item.id === requestedLocation) ?? locations[0];
  let stockItems;
  try {
    stockItems = await listStockItems(location.id);
  } catch (error) {
    console.error('Stock balance read failed:', error instanceof Error ? error.name : 'unknown error');
    return <Unavailable />;
  }
  const lowCount = stockItems.filter((item) => BigInt(item.quantity) <= BigInt(item.reorderPoint)).length;
  const receiveRequestId = randomUUID();
  const saleRequestId = randomUUID();

  return (
    <main className="page-shell">
      <div className="page-heading">
        <div><p className="eyebrow">Inventory / Stock</p><h1>Stock on hand</h1><p className="page-description">View current quantities and record receiving or manual sale deductions at a selected location.</p></div>
        <Link className="button button-secondary" href={`/activity?location=${encodeURIComponent(location.id)}`}>View movement activity <span aria-hidden="true">→</span></Link>
      </div>
      <aside className="demo-notice" aria-label="Inventory information"><span className="notice-mark" aria-hidden="true">i</span><p><strong>Manual inventory demo.</strong> Quantity records only; no payment processing, point-of-sale integration, or accounting entries. Stock changes are attributed to your signed-in account.</p></aside>

      <section className="catalog-panel stock-balance-panel" aria-labelledby="balance-heading">
        <div className="catalog-toolbar">
          <div><h2 id="balance-heading">Current on hand · {location.name}</h2><p>{stockItems.length} active {stockItems.length === 1 ? 'product' : 'products'} · {lowCount} at or below reorder point</p></div>
          <form action="/stock" method="get" className="catalog-filters stock-location-filter">
            <label htmlFor="stock-location">Location</label>
            <select id="stock-location" name="location" defaultValue={location.id}>
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="button button-secondary" type="submit">Show stock</button>
          </form>
        </div>
        {stockItems.length === 0 ? (
          <div className="empty-state"><div className="empty-icon" aria-hidden="true">▤</div><h3>No active products yet</h3><p>Add a product to begin tracking stock at {location.name}.</p><Link className="button button-primary" href="/products/new">Add a product</Link></div>
        ) : (
          <div className="table-scroll"><table className="product-table stock-table"><caption className="sr-only">Current on-hand inventory and reorder status for {location.name}.</caption><thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Current on hand</th><th scope="col">Reorder point</th><th scope="col">Status</th></tr></thead><tbody>
            {stockItems.map((item) => {
              const low = BigInt(item.quantity) <= BigInt(item.reorderPoint);
              return <tr key={item.id}><td data-label="Product"><span className="product-name">{item.name}</span></td><td data-label="SKU"><code className="sku-tag">{item.sku}</code></td><td data-label="Current on hand"><strong>{item.quantity}</strong> <span className="muted">units</span></td><td data-label="Reorder point">{item.reorderPoint} <span className="muted">units</span></td><td data-label="Status"><span className={`status-pill ${low ? 'status-low-stock' : 'status-active'}`}><span aria-hidden="true">●</span> {low ? 'Reorder attention' : 'On track'}</span></td></tr>;
            })}
          </tbody></table></div>
        )}
      </section>

      {hasPermission(user.role, 'stock:receive') || hasPermission(user.role, 'stock:sale') ? <section className="stock-entry-section" aria-labelledby="stock-entry-heading">
        <div className="section-heading"><div><p className="eyebrow">RECORD A CHANGE</p><h2 id="stock-entry-heading">Keep the movement history current.</h2></div><p>Every completed change is recorded with its reason, type, and time.</p></div>
        <StockForms locations={locations} products={products} selectedLocationId={location.id} receiveRequestId={receiveRequestId} saleRequestId={saleRequestId} canReceive={hasPermission(user.role, 'stock:receive')} canSell={hasPermission(user.role, 'stock:sale')} />
      </section> : <p className="catalog-footnote">Your account has read-only stock access.</p>}
      <p className="catalog-footnote">Reorder point is compared with the current on-hand quantity at this selected location. “Current on hand” does not include reservations or open orders.</p>
    </main>
  );
}

function Unavailable() {
  return <main className="page-shell"><section className="unavailable-panel"><p className="eyebrow">Inventory / Stock</p><h1>Stock is unavailable</h1><p>The stock view could not be loaded. Check the local database setup and refresh this page.</p><Link className="button button-secondary" href="/">Back to overview</Link></section></main>;
}
