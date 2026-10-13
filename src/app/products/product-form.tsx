'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { saveProductAction, type ProductFormState } from './actions';
import type { CatalogProduct, ProductCategory } from '@/lib/db';

const initialActionState: ProductFormState = { message: '', errors: {} };

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p className="field-error" id={id}>{message}</p> : null;
}

export function ProductForm({ product, categories }: { product: CatalogProduct | null; categories: ProductCategory[] }) {
  // Bind the product ID on the server-rendered form instead of trusting a hidden input.
  const [state, formAction, pending] = useActionState(saveProductAction.bind(null, product?.id ?? null), initialActionState);
  const valuesKey = state.valuesToken ?? 'initial';
  const value = (field: keyof NonNullable<typeof state.values>, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <form action={formAction} className="product-form">
      {state.message && (
        <div className="form-alert" role="alert" aria-live="assertive">
          <strong>{state.message}</strong>
          {Object.keys(state.errors).length > 0 && (
            <ul>{Object.values(state.errors).map((message) => <li key={message}>{message}</li>)}</ul>
          )}
        </div>
      )}

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="sku">SKU <span aria-hidden="true">*</span></label>
          <input key={`sku-${valuesKey}`} id="sku" name="sku" required maxLength={100} autoComplete="off" defaultValue={value('sku', product?.sku ?? '')}
            aria-invalid={Boolean(state.errors.sku)}
            aria-describedby={state.errors.sku ? 'sku-error' : 'sku-help'} />
          <p className="field-hint" id="sku-help">A unique stock-keeping code, up to 100 characters.</p>
          <FieldError id="sku-error" message={state.errors.sku} />
        </div>

        <div className="form-field">
          <label htmlFor="name">Product name <span aria-hidden="true">*</span></label>
          <input key={`name-${valuesKey}`} id="name" name="name" required maxLength={200} autoComplete="off" defaultValue={value('name', product?.name ?? '')}
            aria-invalid={Boolean(state.errors.name)}
            aria-describedby={state.errors.name ? 'name-error' : undefined} />
          <FieldError id="name-error" message={state.errors.name} />
        </div>

        <div className="form-field">
          <label htmlFor="categoryId">Category</label>
          <select key={`category-${valuesKey}`} id="categoryId" name="categoryId" defaultValue={value('categoryId', product?.categoryId ?? '')}
            aria-invalid={Boolean(state.errors.categoryId)}
            aria-describedby={state.errors.categoryId ? 'category-error' : undefined}>
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <FieldError id="category-error" message={state.errors.categoryId} />
          {categories.length === 0 && <p className="field-hint">No categories have been added yet; you can leave this blank.</p>}
        </div>

        <div className="form-field">
          <label htmlFor="salePrice">Sale price</label>
          <div className="input-suffix">
            <input id="salePrice" name="salePrice" type="number" min="0" step="0.01" inputMode="decimal"
              placeholder="0.00" defaultValue={value('salePrice', product?.salePrice ?? '')} key={`price-${valuesKey}`}
              aria-invalid={Boolean(state.errors.salePrice)} aria-describedby={state.errors.salePrice ? 'price-error' : 'price-help'} />
            <span>amount</span>
          </div>
          <p className="field-hint" id="price-help">Optional; up to two decimal places. Currency is not configured.</p>
          <FieldError id="price-error" message={state.errors.salePrice} />
        </div>

        <div className="form-field">
          <label htmlFor="reorderPoint">Reorder point <span aria-hidden="true">*</span></label>
          <input key={`reorder-${valuesKey}`} id="reorderPoint" name="reorderPoint" type="number" min="0" step="1" required
            defaultValue={value('reorderPoint', String(product?.reorderPoint ?? 0))}
            aria-invalid={Boolean(state.errors.reorderPoint)} aria-describedby={state.errors.reorderPoint ? 'reorder-error' : 'reorder-help'} />
          <p className="field-hint" id="reorder-help">Whole units. Stock quantity will be recorded separately.</p>
          <FieldError id="reorder-error" message={state.errors.reorderPoint} />
        </div>

        <div className="form-field">
          <label htmlFor="status">Catalog status</label>
          <select key={`status-${valuesKey}`} id="status" name="status" defaultValue={value('status', product?.active === false ? 'inactive' : 'active')}
            aria-invalid={Boolean(state.errors.status)} aria-describedby="status-help">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <p className="field-hint" id="status-help">Inactive products stay in the database and history.</p>
          <FieldError id="status-error" message={state.errors.status} />
        </div>
      </div>

      <div className="form-footer">
        <p className="form-required"><span aria-hidden="true">*</span> Required fields</p>
        <div className="form-buttons">
          <Link href="/products" className="button button-secondary">Cancel</Link>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : product ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </div>
    </form>
  );
}
