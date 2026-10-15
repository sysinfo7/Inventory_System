import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { hasPermission, requireReadPermission } from '@/lib/auth';
import { listPurchaseOrders } from '@/lib/purchasing';

type Props = { searchParams: Promise<{ q?: string; status?: string; location?: string; error?: string; saved?: string }> };
const statusLabels: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', partially_received: 'Partially received', received: 'Completed', cancelled: 'Cancelled',
};
const errorMessages: Record<string, string> = {
  invalid: 'Check the supplier, destination, date, notes, and product quantities.',
  lines: 'Each order needs at least one valid line, and a product can appear only once.',
  failed: 'The purchase order could not be saved. Check that the supplier and products are active.',
};

export default function PurchaseOrdersPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading purchase orders…</p></section></main>}><PurchaseOrdersContent searchParams={props.searchParams} /></Suspense>;
}

async function PurchaseOrdersContent({ searchParams }: Props) {
  await connection();
  const user = await requireReadPermission('purchase_orders:read');
  const [params, allOrders] = await Promise.all([searchParams, listPurchaseOrders(Boolean(user.publicDemo))]);
  const query = (params.q ?? '').trim().toLocaleLowerCase();
  const chosenStatus = params.status && statusLabels[params.status] ? params.status : '';
  const orders = allOrders.filter((order) => (!chosenStatus || order.status === chosenStatus)
    && (!params.location || order.locationId === params.location)
    && (!query || order.orderNumber.toLocaleLowerCase().includes(query) || order.supplierName.toLocaleLowerCase().includes(query)));
  const locations = Array.from(new Map(allOrders.map((order) => [order.locationId, order.locationName])).entries());
  const openCount = allOrders.filter((order) => ['submitted', 'partially_received'].includes(order.status)).length;
  const canWrite = hasPermission(user.role, 'purchase_orders:write');
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">PURCHASING / REPLENISHMENT</p><h1>Purchase orders</h1><p className="page-description">Track supplier orders from draft through delivery. Only confirmed receipts add stock.</p></div>{canWrite && <Link className="button button-primary" href="/purchase-orders/new">Create purchase order <span aria-hidden="true">+</span></Link>}</div>
    {params.error && <p className="form-alert" role="alert">{errorMessages[params.error] ?? 'The purchase-order request could not be completed.'}</p>}
    {params.saved && <p className="success-notice" role="status">Purchase-order changes saved.</p>}
    <aside className="demo-notice"><span className="notice-mark" aria-hidden="true">i</span><p><strong>Quantity workflow only.</strong> Purchase orders do not store prices, process invoices, or create accounting entries. Receiving records inventory movements at the destination.</p></aside>
    <section className="catalog-panel po-list-panel" aria-labelledby="po-list-title"><div className="catalog-toolbar">
      <div><h2 id="po-list-title">Order register</h2><p>{openCount} open · {allOrders.length} total</p></div>
      <form action="/purchase-orders" method="get" className="catalog-filters po-filters">
        <label className="sr-only" htmlFor="po-search">Search order number or supplier</label><input className="supplier-search" id="po-search" name="q" type="search" placeholder="Order number or supplier" defaultValue={params.q ?? ''} />
        <label className="sr-only" htmlFor="po-status">Filter by order status</label><select id="po-status" name="status" defaultValue={chosenStatus}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label className="sr-only" htmlFor="po-location">Filter by destination</label><select id="po-location" name="location" defaultValue={params.location ?? ''}><option value="">All destinations</option>{locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button className="button button-secondary" type="submit">Filter</button>
      </form>
    </div>
      {orders.length === 0 ? <div className="empty-state"><h3>{allOrders.length ? 'No orders match this filter' : 'No purchase orders yet'}</h3><p>{allOrders.length ? 'Try a different search, status, or destination.' : 'Create a draft to begin a supplier replenishment workflow.'}</p>{canWrite && allOrders.length === 0 && <Link className="button button-primary" href="/purchase-orders/new">Create purchase order</Link>}</div>
        : <div className="table-scroll"><table className="product-table po-table"><caption className="sr-only">Supplier purchase orders, destination, quantity progress, and current state.</caption><thead><tr><th scope="col">Order</th><th scope="col">Supplier</th><th scope="col">Destination</th><th scope="col">Expected</th><th scope="col">Received</th><th scope="col">Status</th></tr></thead><tbody>
          {orders.map((order) => <tr key={order.id}>
            <td data-label="Order"><Link className="table-action" href={`/purchase-orders/${order.id}`}>{order.orderNumber}</Link><small>{order.lineCount} {order.lineCount === 1 ? 'line' : 'lines'}</small></td>
            <td data-label="Supplier">{order.supplierName}{!order.supplierActive && <small className="status-note">Inactive supplier</small>}</td>
            <td data-label="Destination">{order.locationName}</td>
            <td data-label="Expected">{order.expectedDeliveryOn ?? '—'}</td>
            <td data-label="Received">{order.receivedUnits} / {order.orderedUnits} units</td>
            <td data-label="Status"><span className={`status-pill po-status-${order.status}`}>{statusLabels[order.status]}</span></td>
          </tr>)}
        </tbody></table></div>}
    </section>
    <p className="catalog-footnote">Order cancellation preserves received quantities and closes only the remaining units. Replenishment orders do not reserve inventory.</p>
  </main>;
}
