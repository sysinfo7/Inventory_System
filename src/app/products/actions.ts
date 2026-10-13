'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDbPool } from '@/lib/db';

export type ProductFormState = {
  message: string;
  errors: Record<string, string>;
  values?: ProductFormValues;
  valuesToken?: string;
};

export type ProductFormValues = {
  productId: string;
  sku: string;
  name: string;
  categoryId: string;
  salePrice: string;
  reorderPoint: string;
  status: string;
};

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function validBigintId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807');
}

export async function saveProductAction(productId: string | null, _previous: ProductFormState, formData: FormData): Promise<ProductFormState> {
  // No authentication exists yet, so database writes are limited to local development.
  if (process.env.NODE_ENV !== 'development') {
    return { message: 'Product editing is available only in local development until sign-in is implemented.', errors: {} };
  }

  const sku = readText(formData, 'sku');
  const name = readText(formData, 'name');
  const categoryIdText = readText(formData, 'categoryId');
  const salePriceText = readText(formData, 'salePrice');
  const reorderPointText = readText(formData, 'reorderPoint');
  const status = readText(formData, 'status');
  const values: ProductFormValues = { productId: productId ?? '', sku, name, categoryId: categoryIdText, salePrice: salePriceText, reorderPoint: reorderPointText, status };
  const errors: Record<string, string> = {};

  if (productId && !validBigintId(productId)) errors.productId = 'The selected product is invalid.';
  if (sku.length < 1 || sku.length > 100) errors.sku = 'Enter an SKU between 1 and 100 characters.';
  if (name.length < 1 || name.length > 200) errors.name = 'Enter a product name between 1 and 200 characters.';
  if (categoryIdText && !validBigintId(categoryIdText)) errors.categoryId = 'Choose a valid category.';
  if (salePriceText && !/^\d{1,10}(?:\.\d{1,2})?$/.test(salePriceText)) {
    errors.salePrice = 'Enter a nonnegative amount with no more than two decimal places.';
  }
  if (!/^\d{1,10}$/.test(reorderPointText) || Number(reorderPointText) > 2147483647) {
    errors.reorderPoint = 'Enter a nonnegative whole number.';
  }
  if (status !== 'active' && status !== 'inactive') errors.status = 'Choose an available product status.';
  if (Object.keys(errors).length) return { message: 'Check the fields below and try again.', errors, values, valuesToken: randomUUID() };

  try {
    await getDbPool().query(
      'SELECT save_product($1::bigint, $2::text, $3::text, $4::bigint, $5::numeric, $6::integer, $7::boolean, $8::uuid)',
      [productId || null, sku, name, categoryIdText || null, salePriceText || null,
        Number(reorderPointText), status === 'active', randomUUID()],
    );
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === '23505') {
      return { message: 'That SKU is already in use. Choose a unique SKU and try again.', errors: { sku: 'This SKU is already in use.' }, values, valuesToken: randomUUID() };
    }
    if (code === '23503') {
      return { message: 'That category is no longer available. Choose another category and try again.', errors: { categoryId: 'Choose an available category.' }, values, valuesToken: randomUUID() };
    }
    // Keep SQL, connection details, and stack traces on the server.
    console.error('Product save failed:', error instanceof Error ? error.message : 'Unknown database error');
    return { message: 'The product could not be saved. Check the database setup and try again.', errors: {}, values, valuesToken: randomUUID() };
  }

  revalidatePath('/products');
  redirect('/products?saved=1');
}
