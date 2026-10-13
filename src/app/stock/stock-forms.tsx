'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { InventoryLocation } from '@/lib/db';
import {
  adjustStockAction, deductStockAction, receiveStockAction, returnStockAction,
  type StockActionState,
} from './actions';

const initialState = (locationId: string, requestId: string): StockActionState => ({
  message: '', errors: {}, values: { locationId, productId: '', quantity: '', reason: '', direction: 'increase' }, requestId,
});

function StockForm({
  kind,
  locations,
  products,
  selectedLocationId,
  initialRequestId,
}: {
  kind: 'receive' | 'sale' | 'return' | 'adjustment';
  locations: InventoryLocation[];
  products: Array<{ id: string; sku: string; name: string }>;
  selectedLocationId: string;
  initialRequestId: string;
}) {
  const action = kind === 'receive' ? receiveStockAction
    : kind === 'sale' ? deductStockAction
      : kind === 'return' ? returnStockAction : adjustStockAction;
  const [state, formAction, pending] = useActionState(action, initialState(selectedLocationId, initialRequestId));
  const alertRef = useRef<HTMLDivElement>(null);
  const values = state.values;
  const isReceive = kind === 'receive';
  const isReturn = kind === 'return';
  const isAdjustment = kind === 'adjustment';
  const [preview, setPreview] = useState({ requestId: state.requestId, locationId: selectedLocationId, productId: '', quantity: '', direction: 'increase' as 'increase' | 'decrease' });

  useEffect(() => {
    if (state.message && !state.success) alertRef.current?.focus();
  }, [state.message, state.success]);

  function errorFor(field: string) {
    return state.errors[field];
  }

  function updatePreview(form: HTMLFormElement) {
    const data = new FormData(form);
    setPreview({
      requestId: state.requestId,
      locationId: String(data.get('locationId') ?? ''),
      productId: String(data.get('productId') ?? ''),
      quantity: String(data.get('quantity') ?? ''),
      direction: data.get('direction') === 'decrease' ? 'decrease' : 'increase',
    });
  }

  const currentPreview = preview.requestId === state.requestId
    ? preview
    : { requestId: state.requestId, locationId: values.locationId || selectedLocationId, productId: values.productId, quantity: values.quantity, direction: values.direction };
  const selectedProduct = products.find((product) => product.id === currentPreview.productId);
  const selectedLocation = locations.find((location) => location.id === currentPreview.locationId);
  const previewAddsStock = isReceive || isReturn || (isAdjustment && currentPreview.direction === 'increase');
  const previewQuantity = /^[1-9]\d*$/.test(currentPreview.quantity) ? currentPreview.quantity : '—';

  return (
    <form action={formAction} className="stock-form" onChange={(event) => updatePreview(event.currentTarget)}>
      {state.message && (
        <div ref={alertRef} tabIndex={-1} className={state.success ? 'stock-success' : 'form-alert'} role={state.success ? 'status' : 'alert'} aria-live={state.success ? 'polite' : 'assertive'}>
          <strong>{state.message}</strong>
          {Object.keys(state.errors).length > 0 && <ul>{Object.values(state.errors).map((message) => <li key={message}>{message}</li>)}</ul>}
        </div>
      )}
      <input type="hidden" name="requestId" value={state.requestId} key={`request-${state.requestId}`} />
      <div className="stock-form-grid">
        <div className="form-field">
          <label htmlFor={`${kind}-location`}>Location <span aria-hidden="true">*</span></label>
          <select id={`${kind}-location`} name="locationId" required defaultValue={values.locationId || selectedLocationId} key={`location-${state.requestId}`} aria-invalid={Boolean(errorFor('locationId'))} aria-describedby={errorFor('locationId') ? `${kind}-location-error` : undefined}>
            <option value="">Choose a location</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          {errorFor('locationId') && <p className="field-error" id={`${kind}-location-error`}>{errorFor('locationId')}</p>}
        </div>
        <div className="form-field">
          <label htmlFor={`${kind}-product`}>Product <span aria-hidden="true">*</span></label>
          <select id={`${kind}-product`} name="productId" required defaultValue={values.productId} key={`product-${state.requestId}`} aria-invalid={Boolean(errorFor('productId'))} aria-describedby={errorFor('productId') ? `${kind}-product-error` : undefined}>
            <option value="">Choose a product</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
          </select>
          {errorFor('productId') && <p className="field-error" id={`${kind}-product-error`}>{errorFor('productId')}</p>}
        </div>
        {isAdjustment && <div className="form-field">
          <label htmlFor={`${kind}-direction`}>Adjustment direction <span aria-hidden="true">*</span></label>
          <select id={`${kind}-direction`} name="direction" required defaultValue={values.direction} key={`direction-${state.requestId}`} aria-invalid={Boolean(errorFor('direction'))} aria-describedby={errorFor('direction') ? `${kind}-direction-error` : undefined}>
            <option value="increase">Increase on-hand</option>
            <option value="decrease">Decrease on-hand</option>
          </select>
          {errorFor('direction') && <p className="field-error" id={`${kind}-direction-error`}>{errorFor('direction')}</p>}
        </div>}
        <div className="form-field">
          <label htmlFor={`${kind}-quantity`}>{isAdjustment ? 'Units to adjust' : isReturn ? 'Units returned' : isReceive ? 'Units to receive' : 'Units to deduct'} <span aria-hidden="true">*</span></label>
          <input id={`${kind}-quantity`} name="quantity" type="number" min="1" max="9223372036854775807" step="1" inputMode="numeric" required defaultValue={values.quantity} key={`quantity-${state.requestId}`} aria-invalid={Boolean(errorFor('quantity'))} aria-describedby={errorFor('quantity') ? `${kind}-quantity-error` : `${kind}-quantity-help`} />
          <p className="field-hint" id={`${kind}-quantity-help`}>{isAdjustment ? 'Enter a positive whole number; the selected direction determines the signed inventory change.' : isReturn ? 'Returned goods increase on-hand only when they are suitable to put back into inventory.' : isReceive ? 'Adds this many whole units to current on-hand.' : 'Enter a positive number; the inventory record stores the deduction as a negative delta.'}</p>
          {errorFor('quantity') && <p className="field-error" id={`${kind}-quantity-error`}>{errorFor('quantity')}</p>}
        </div>
        <div className="form-field">
          <label htmlFor={`${kind}-reason`}>Reason <span aria-hidden="true">*</span></label>
          <input id={`${kind}-reason`} name="reason" type="text" maxLength={300} required defaultValue={values.reason || (isReceive ? 'Stock received' : isReturn ? 'Customer return' : isAdjustment ? 'Inventory count correction' : 'Manual sale entry')} key={`reason-${state.requestId}`} aria-invalid={Boolean(errorFor('reason'))} aria-describedby={errorFor('reason') ? `${kind}-reason-error` : `${kind}-reason-help`} />
          <p className="field-hint" id={`${kind}-reason-help`}>{isAdjustment ? 'Explain the count or correction. This audit entry cannot be edited later.' : isReceive || isReturn ? 'A short note for the inventory history.' : 'Manual inventory tracking only. This does not record payment or accounting entries.'}</p>
          {errorFor('reason') && <p className="field-error" id={`${kind}-reason-error`}>{errorFor('reason')}</p>}
        </div>
      </div>
      <div className="movement-preview" aria-live="polite">
        <span className="movement-preview-label">Review before recording</span>
        <strong>{previewAddsStock ? 'Add' : 'Subtract'} {previewQuantity} {previewQuantity === '1' ? 'unit' : 'units'}</strong>
        <span>{selectedProduct ? `${selectedProduct.name} · ${selectedProduct.sku}` : 'Choose a product'}</span>
        <span>{selectedLocation ? `at ${selectedLocation.name}` : 'Choose a location'}</span>
      </div>
      <div className="stock-form-footer">
        <span>{previewAddsStock ? 'Adds stock on hand' : 'Reduces stock on hand'}</span>
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? 'Recording…' : isReceive ? 'Receive stock' : isReturn ? 'Record customer return' : isAdjustment ? 'Record adjustment' : 'Record manual sale deduction'}
        </button>
      </div>
    </form>
  );
}

export function StockForms(props: {
  locations: InventoryLocation[];
  products: Array<{ id: string; sku: string; name: string }>;
  selectedLocationId: string;
  receiveRequestId: string;
  saleRequestId: string;
  returnRequestId: string;
  adjustmentRequestId: string;
  canReceive: boolean;
  canSell: boolean;
  canAdjust: boolean;
}) {
  if (props.locations.length === 0) {
    return <div className="empty-state compact-empty"><h3>No locations are available</h3><p>The latest database migration seeds a “Demo Store” when no location exists. Apply the migrations, then refresh this page.</p></div>;
  }
  if (props.products.length === 0) {
    return <div className="empty-state compact-empty"><h3>No active products yet</h3><p>Add a product to the catalog before recording stock.</p><Link className="button button-secondary" href="/products/new">Add a product</Link></div>;
  }
  if (!props.canReceive && !props.canSell && !props.canAdjust) return <p className="catalog-footnote">Your account has read-only stock access.</p>;
  return (
    <div className="stock-forms-grid">
      {props.canReceive && <section className="stock-panel" aria-labelledby="receive-heading">
        <div className="stock-panel-heading"><span className="stock-panel-icon" aria-hidden="true">＋</span><div><h2 id="receive-heading">Receive stock</h2><p>Record units arriving at a location.</p></div></div>
        <StockForm kind="receive" locations={props.locations} products={props.products} selectedLocationId={props.selectedLocationId} initialRequestId={props.receiveRequestId} />
      </section>}
      {props.canReceive && <section className="stock-panel" aria-labelledby="return-heading">
        <div className="stock-panel-heading"><span className="stock-panel-icon" aria-hidden="true">↩</span><div><h2 id="return-heading">Customer return</h2><p>Add sellable returned units back into stock.</p></div></div>
        <StockForm kind="return" locations={props.locations} products={props.products} selectedLocationId={props.selectedLocationId} initialRequestId={props.returnRequestId} />
      </section>}
      {props.canSell && <section className="stock-panel" aria-labelledby="sale-heading">
        <div className="stock-panel-heading"><span className="stock-panel-icon" aria-hidden="true">−</span><div><h2 id="sale-heading">Manual sale deduction</h2><p>Record units leaving inventory for a manual sale.</p></div></div>
        <StockForm kind="sale" locations={props.locations} products={props.products} selectedLocationId={props.selectedLocationId} initialRequestId={props.saleRequestId} />
      </section>}
      {props.canAdjust && <section className="stock-panel" aria-labelledby="adjustment-heading">
        <div className="stock-panel-heading"><span className="stock-panel-icon" aria-hidden="true">±</span><div><h2 id="adjustment-heading">Inventory adjustment</h2><p>Correct a physical count; manager or administrator access only.</p></div></div>
        <StockForm kind="adjustment" locations={props.locations} products={props.products} selectedLocationId={props.selectedLocationId} initialRequestId={props.adjustmentRequestId} />
      </section>}
    </div>
  );
}
