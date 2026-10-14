import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import { hasPermission, requirePermission } from '@/lib/auth';
import { getDbPool, listActiveStockProducts, listInventoryLocations } from '@/lib/db';
import { getPurchaseOrder } from '@/lib/purchasing';
import { OrderEditor } from '../order-editor';
import { cancelPurchaseOrderAction, receivePurchaseOrderAction, submitPurchaseOrderAction } from '@/app/purchasing/actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; received?: string; completed?: string }> };
const statusLabels: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', partially_received: 'Partially received', received: 'Completed', cancelled: 'Cancelled' };
const savedMessages: Record<string, string> = {
  draft: 'Draft saved. On-hand stock has not changed.', submitted: 'Purchase order submitted. It is ready for receiving; stock has not changed yet.',
  receipt: 'Receipt recorded. Inventory and the purchase-order history were updated together.',
  cancelled: 'Order cancelled. Any earlier receipts remain in stock; only the remaining quantity was closed.',
};
const errorMessages: Record<string, string> = {
  submit: 'The order could not be submitted. Check that it has active suppliers, active products, and at least one line.',
  cancel: 'The order could not be cancelled. Provide a reason and confirm the remaining quantity will be closed.',
  receipt: 'The receipt was not recorded. Check remaining quantities, active products, and the entered receipt details.',
  failed: 'The order could not be saved.',
};

export default function PurchaseOrderDetailPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading purchase order…</p></section></main>}><PurchaseOrderDetailContent params={props.params} searchParams={props.searchParams} /></Suspense>;
}

async function PurchaseOrderDetailContent({ params, searchParams }: Props) {
  await connection();
  const actor = await requirePermission('purchase_orders:read');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[1-9]\d{0,18}$/.test(id) || (id.length === 19 && id > '9223372036854775807')) notFound();
  const order = await getPurchaseOrder(id);
  if (!order) notFound();
  const canWrite = hasPermission(actor.role, 'purchase_orders:write');
  const canReceive = hasPermission(actor.role, 'purchase_orders:receive');
  const isDraft = order.status === 'draft';
  const isOpen = ['submitted', 'partially_received'].includes(order.status);
  const lines = order.lines as Array<{ id: string; product_id: string; sku_snapshot: string; product_name_snapshot: string; ordered_quantity: string; received_quantity: string; product_active: boolean }>;
  const locations = isDraft && canWrite ? await listInventoryLocations() : [];
  const [activeSuppliers, activeProducts] = isDraft && canWrite ? await Promise.all([
    getDbPool().query('SELECT id::text,name,contact_name AS "contactName",email,active FROM suppliers WHERE active=true OR id=$1::bigint ORDER BY active DESC,lower(name),id', [order.supplier_id]),
    listActiveStockProducts(),
  ]) : [null, null];
  const suppliers = activeSuppliers?.rows ?? [];
  const products = activeProducts ? [...activeProducts] : [];
  for (const line of lines) {
    if (!line.product_active && !products.some((product) => product.id === line.product_id)) {
      products.push({ id: line.product_id, sku: line.sku_snapshot, name: `${line.product_name_snapshot} (inactive — remove this line)` });
    }
  }
  const header = order as Record<string, unknown>;
  const orderNumber = String(header.order_number);
  const orderedTotal = lines.reduce((sum, line) => sum + BigInt(line.ordered_quantity), BigInt(0));
  const receivedTotal = lines.reduce((sum, line) => sum + BigInt(line.received_quantity), BigInt(0));
  const remainingTotal = orderedTotal - receivedTotal;
  const activityHref = `/activity?location=${encodeURIComponent(String(header.location_id))}&q=${encodeURIComponent(orderNumber)}`;
  const receipts = new Map<string, { receivedAt: Date; reference: string | null; note: string | null; actor: string; lines: Array<{ name: string; sku: string; quantity: string }> }>();
  const orderNotes = typeof header.notes === 'string' ? header.notes : '';
  const cancelReason = typeof header.cancel_reason === 'string' ? header.cancel_reason : '';
  for (const row of order.receipts as Array<Record<string, unknown>>) {
    const receiptId = String(row.id);
    if (!receipts.has(receiptId)) receipts.set(receiptId, {
      receivedAt: row.received_at as Date, reference: row.reference as string | null,
      note: row.note as string | null, actor: String(row.received_by), lines: [],
    });
    receipts.get(receiptId)!.lines.push({ name: String(row.product_name_snapshot), sku: String(row.sku_snapshot), quantity: String(row.quantity) });
  }
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">PURCHASING / {orderNumber}</p><h1>{orderNumber}</h1><p className="page-description">{String(header.supplier_name)} · deliver to {String(header.location_name)}</p></div><div className="po-heading-actions"><span className={`status-pill po-status-${order.status}`}>{statusLabels[order.status]}</span><Link className="button button-secondary" href={activityHref}>View activity</Link><Link className="button button-secondary" href="/purchase-orders">All orders</Link></div></div>
    {query.error && <p className="form-alert" role="alert">{errorMessages[query.error] ?? 'The purchase-order request could not be completed.'}</p>}
    {query.saved && <p className="success-notice" role="status">{query.saved === 'receipt' && query.received && /^\d+$/.test(query.received)
      ? `${query.received} ${query.received === '1' ? 'unit' : 'units'} received for ${orderNumber}. ${query.completed === 'true' ? 'The order is complete.' : query.completed === 'false' ? 'The order remains open for later deliveries.' : 'See the updated order status below.'}`
      : savedMessages[query.saved] ?? 'Purchase-order changes saved.'}</p>}
    <section className="catalog-panel po-summary-panel"><div className="po-summary-grid">
      <div><span>Supplier</span><strong>{String(header.supplier_name)}</strong>{!header.supplier_active && <small>Inactive supplier · existing orders remain available</small>}</div>
      <div><span>Destination</span><strong>{String(header.location_name)}</strong></div>
      <div><span>Expected delivery</span><strong>{String(header.expected_delivery_on || 'Not set')}</strong></div>
      <div><span>Quantity progress</span><strong>{receivedTotal.toString()} / {orderedTotal.toString()} units</strong></div>
      <div><span>Created by</span><strong>{String(header.created_by)}</strong></div>
      <div><span>Created</span><strong>{new Date(String(header.created_at)).toLocaleDateString()}</strong></div>
    </div>{orderNotes && <p className="po-notes"><strong>Order notes:</strong> {orderNotes}</p>}
    {order.status === 'cancelled' && cancelReason && <p className="po-notes"><strong>Cancellation reason:</strong> {cancelReason}</p>}</section>

    {isDraft && canWrite ? <><section className="po-draft-editor"><div className="section-heading"><div><p className="eyebrow">DRAFT ORDER</p><h2>Edit order before submission</h2></div><p>Supplier, destination, and product quantities lock when submitted.</p></div><OrderEditor orderId={id} suppliers={suppliers} locations={locations} products={products}
      initial={{ supplierId: String(header.supplier_id), locationId: String(header.location_id), expectedDeliveryOn: String(header.expected_delivery_on ?? ''), notes: orderNotes, lines: lines.map((line) => ({ productId: line.product_id, quantity: line.ordered_quantity })) }} /></section>
      <section className="po-submit-section"><h2>Ready to receive this order?</h2><p>Review the supplier, destination, and ordered quantities above. Submission locks those details but does not change on-hand stock.</p><form action={submitPurchaseOrderAction} className="po-submit-confirm"><input type="hidden" name="orderId" value={id} /><label className="confirm-label"><input type="checkbox" name="confirmed" value="yes" required /> I reviewed the order details and want to submit this order.</label><button className="button button-primary" type="submit">Submit purchase order</button></form></section></>
      : <section className="catalog-panel po-lines-panel"><div className="catalog-toolbar"><div><h2>Products and quantities</h2><p>{lines.length} {lines.length === 1 ? 'line' : 'lines'} · received / ordered</p></div>
      </div>
      {lines.length === 0 ? <div className="empty-state"><h3>No products on this order</h3><p>Add at least one product before submitting.</p></div>
        : <div className="table-scroll"><table className="product-table po-detail-table"><caption className="sr-only">Ordered and received quantities for {orderNumber}.</caption><thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Ordered</th><th scope="col">Received</th><th scope="col">Remaining</th><th scope="col">Product status</th></tr></thead><tbody>{lines.map((line) => {
          const remaining = BigInt(line.ordered_quantity) - BigInt(line.received_quantity);
          return <tr key={line.id}><td data-label="Product">{line.product_name_snapshot}</td><td data-label="SKU"><code>{line.sku_snapshot}</code></td><td data-label="Ordered">{line.ordered_quantity}</td><td data-label="Received">{line.received_quantity}</td><td data-label="Remaining">{remaining.toString()}</td><td data-label="Product status">{line.product_active ? 'Active' : 'Inactive'}</td></tr>;
        })}</tbody></table></div>}
      </section>}

    {isOpen && canReceive && <section className="editor-panel po-receive-panel"><div className="section-heading"><div><p className="eyebrow">INBOUND STOCK</p><h2>Record a delivery</h2></div><p>Received quantities increase on-hand stock at {String(header.location_name)} and enter movement history.</p></div>
      <form action={receivePurchaseOrderAction} className="po-receive-form"><input type="hidden" name="orderId" value={id} /><input type="hidden" name="requestId" value={randomUUID()} />
        <div className="po-receive-lines">{lines.map((line) => {
          const remaining = BigInt(line.ordered_quantity) - BigInt(line.received_quantity);
          return <div className={`po-receive-line ${!line.product_active ? 'po-receive-disabled' : ''}`} key={line.id}>
            <input type="hidden" name="lineId" value={line.id} />
            <div><strong>{line.product_name_snapshot}</strong><small>{line.sku_snapshot} · {line.received_quantity} received · {remaining.toString()} remaining</small></div>
            <label className="form-field"><span>Received now</span><input name={`quantity-${line.id}`} type="number" min="0" max={remaining.toString()} step="1" inputMode="numeric" defaultValue="0" disabled={!line.product_active || remaining === BigInt(0)} /></label>
            {!line.product_active && <p className="field-error">This product is inactive and cannot be received. A manager can reactivate it or cancel the remaining quantity.</p>}
          </div>;
        })}</div>
        <label className="form-field"><span>Supplier delivery reference</span><input name="reference" maxLength={80} placeholder="Optional packing slip number" /></label>
        <label className="form-field"><span>Receipt note</span><textarea name="note" rows={2} maxLength={300} /></label>
        <button className="button button-primary" type="submit" disabled={lines.every((line) => BigInt(line.ordered_quantity) === BigInt(line.received_quantity) || !line.product_active)}>Record receipt</button>
      </form>
    </section>}

    {isOpen && canWrite && <section className="po-cancel-section"><details><summary className="table-action">Cancel order or close remaining quantity</summary><div className="po-cancel-box"><p>Already received units stay in inventory. The remaining {remainingTotal.toString()} {remainingTotal === BigInt(1) ? 'unit' : 'units'} will be closed and cannot be received later.</p><form action={cancelPurchaseOrderAction}>
      <input type="hidden" name="orderId" value={id} /><label className="form-field"><span>Cancellation reason <span aria-hidden="true">*</span></span><textarea name="reason" rows={2} maxLength={300} required /></label>
      <label className="confirm-label"><input type="checkbox" name="confirmed" value="yes" required /> I understand the remaining quantity will be cancelled.</label>
      <button className="button button-secondary" type="submit">Confirm cancellation</button>
    </form></div></details></section>}

    {receipts.size > 0 && <section className="catalog-panel po-receipts-panel"><div className="catalog-toolbar"><div><h2>Receipt history</h2><p>Each posted receipt links to its stock movements.</p></div><Link className="button button-secondary" href={activityHref}>View activity</Link></div>
      <div className="po-receipt-stack">{Array.from(receipts.entries()).map(([receiptId, receipt]) => <article className="po-receipt-card" key={receiptId}>
        <div className="po-receipt-heading"><div><h3>Receipt #{receiptId}</h3><p>{new Date(receipt.receivedAt).toLocaleString()} · recorded by {receipt.actor}</p></div>{receipt.reference && <span>Reference: {receipt.reference}</span>}</div>
        <ul>{receipt.lines.map((line, index) => <li key={`${line.sku}-${index}`}>{line.name} · {line.sku}: <strong>{line.quantity} units</strong></li>)}</ul>
        {receipt.note && <p className="po-notes">{receipt.note}</p>}
      </article>)}</div>
    </section>}
    <p className="catalog-footnote">Purchase orders track quantities only. Supplier costs, payments, invoices, tax, and accounting entries are outside this workflow.</p>
  </main>;
}
