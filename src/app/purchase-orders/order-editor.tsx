'use client';

import { useState } from 'react';
import type { InventoryLocation } from '@/lib/db';
import { savePurchaseOrderAction } from '@/app/purchasing/actions';
import { SearchSelect } from './search-select';

type OrderLine = { productId: string; quantity: string };
type Product = { id: string; name: string; sku: string };
type Supplier = { id: string; name: string; active?: boolean; contactName?: string | null; email?: string | null };

export function OrderEditor({
  orderId,
  suppliers,
  locations,
  products,
  initial,
}: {
  orderId?: string;
  suppliers: Supplier[];
  locations: InventoryLocation[];
  products: Product[];
  initial?: { supplierId: string; locationId: string; expectedDeliveryOn: string; notes: string; lines: OrderLine[] };
}) {
  const [lines, setLines] = useState<OrderLine[]>(initial?.lines.length ? initial.lines : [{ productId: '', quantity: '' }]);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  function changeLine(index: number, value: Partial<OrderLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...value } : line));
  }
  return <form action={savePurchaseOrderAction} className="editor-panel po-editor">
    {orderId && <input type="hidden" name="orderId" value={orderId} />}
    <section aria-labelledby="po-order-details"><h2 id="po-order-details">Order details</h2>
      <div className="po-header-fields">
        <label className="form-field"><span>Supplier <span aria-hidden="true">*</span></span>
          <SearchSelect id="purchase-supplier" name="supplierId" label="Supplier" placeholder="Search supplier name" required
            options={suppliers.map((supplier) => ({
              id: supplier.id,
              label: `${supplier.name}${supplier.contactName ? ` · ${supplier.contactName}` : ''}${supplier.active === false ? ' (inactive)' : ''}`,
              searchText: `${supplier.contactName ?? ''} ${supplier.email ?? ''}`,
            }))}
            value={supplierId} onChange={setSupplierId} />
        </label>
        <label className="form-field"><span>Deliver to <span aria-hidden="true">*</span></span>
          <select name="locationId" required defaultValue={initial?.locationId ?? locations[0]?.id ?? ''}>
            <option value="">Choose a location</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="form-field"><span>Expected delivery</span><input name="expectedDeliveryOn" type="date" min={new Date().toISOString().slice(0, 10)} defaultValue={initial?.expectedDeliveryOn ?? ''} /></label>
        <label className="form-field"><span>Notes</span><textarea name="notes" maxLength={500} rows={3} defaultValue={initial?.notes ?? ''} /></label>
      </div>
    </section>
    <section aria-labelledby="po-products-heading"><div className="po-lines-heading"><div><h2 id="po-products-heading">Products</h2><p className="field-hint">Choose each product once. Saving a draft does not change stock.</p></div>
        <button type="button" className="button button-secondary" onClick={() => setLines((current) => current.length < 100 ? [...current, { productId: '', quantity: '' }] : current)}>Add a product</button></div>
      <div className="po-line-stack">{lines.map((line, index) => <div className="po-line-editor" key={index}>
        <label className="form-field"><span>Product {index + 1}</span><SearchSelect id={`purchase-product-${index}`} name="productId" label={`Product ${index + 1}`} placeholder="Search product name or SKU" required
          options={products.map((product) => ({ id: product.id, label: `${product.name} · ${product.sku}`, searchText: product.sku }))}
          value={line.productId} onChange={(productId) => changeLine(index, { productId })} /></label>
        <label className="form-field"><span>Ordered quantity</span><input name="quantity" type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={line.quantity} onChange={(event) => changeLine(index, { quantity: event.target.value })} /></label>
        <button type="button" className="table-action po-remove-line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove product {index + 1}</button>
      </div>)}</div>
    </section>
    <div className="po-editor-actions"><button className="button button-primary" type="submit">Save draft</button><p className="field-hint">After saving, review the order and submit it to make its quantities available for receiving.</p></div>
  </form>;
}
