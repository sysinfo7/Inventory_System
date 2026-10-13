'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDbPool, readLocationBalance } from '@/lib/db';

export type StockFormValues = {
  locationId: string;
  productId: string;
  quantity: string;
  reason: string;
};

export type StockActionState = {
  message: string;
  errors: Record<string, string>;
  values: StockFormValues;
  requestId: string;
  success?: boolean;
  available?: string;
};

const emptyValues: StockFormValues = { locationId: '', productId: '', quantity: '', reason: '' };

function readText(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function validBigintId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value)
    && (value.length < 19 || value <= '9223372036854775807');
}

function validRequestId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function submitMovement(
  previous: StockActionState,
  formData: FormData,
  movementType: 'receiving' | 'sale',
): Promise<StockActionState> {
  if (process.env.NODE_ENV !== 'development') {
    return {
      message: 'Stock changes are available only in local development until sign-in is implemented.',
      errors: {}, values: previous.values ?? emptyValues, requestId: previous.requestId || randomUUID(),
    };
  }

  const values: StockFormValues = {
    locationId: readText(formData, 'locationId'),
    productId: readText(formData, 'productId'),
    quantity: readText(formData, 'quantity'),
    reason: readText(formData, 'reason'),
  };
  const requestId = readText(formData, 'requestId');
  const errors: Record<string, string> = {};
  if (!validBigintId(values.locationId)) errors.locationId = 'Choose an available location.';
  if (!validBigintId(values.productId)) errors.productId = 'Choose an active product.';
  if (!/^[1-9]\d{0,18}$/.test(values.quantity)
      || (values.quantity.length === 19 && values.quantity > '9223372036854775807')) {
    errors.quantity = 'Enter a positive whole-unit quantity.';
  }
  if (values.reason.length < 1 || values.reason.length > 300) {
    errors.reason = 'Enter a reason between 1 and 300 characters.';
  }
  if (!validRequestId(requestId)) errors.requestId = 'Refresh the page and try again.';
  if (Object.keys(errors).length) {
    return { message: 'Check the fields below and try again.', errors, values, requestId: validRequestId(requestId) ? requestId : randomUUID() };
  }

  const delta = movementType === 'receiving' ? values.quantity : `-${values.quantity}`;
  try {
    await getDbPool().query(
      `SELECT record_stock_movement(
        $1::bigint, $2::bigint, $3::bigint, $4::text, $5::text, NULL, $6::uuid, NULL
      )`,
      [values.productId, values.locationId, delta, movementType, values.reason, requestId],
    );
    const balance = await readLocationBalance(values.productId, values.locationId);
    revalidatePath('/stock');
    revalidatePath('/activity');
    return {
      message: `${movementType === 'receiving' ? 'Received' : 'Removed'} ${values.quantity} ${values.quantity === '1' ? 'unit' : 'units'}. Current on hand: ${balance}.`,
      errors: {}, values: { ...values, quantity: '', reason: '' }, requestId: randomUUID(), success: true,
    };
  } catch (error) {
    const dbError = typeof error === 'object' && error !== null ? error as { code?: string; message?: string } : {};
    if (movementType === 'sale' && dbError.code === 'P0001' && dbError.message === 'Insufficient stock') {
      try {
        const available = await readLocationBalance(values.productId, values.locationId);
        return {
          message: `There are only ${available} units currently on hand at this location. Adjust the quantity and try again.`,
          errors: { quantity: `Current on hand: ${available} units.` }, values, requestId, available,
        };
      } catch {
        return { message: 'The stock issue could not be recorded. Refresh the stock and try again.', errors: {}, values, requestId };
      }
    }
    if (dbError.code === '23503') {
      return {
        message: 'The selected product or location is no longer available. Refresh the page and try again.',
        errors: {}, values, requestId: randomUUID(),
      };
    }
    if (dbError.code === 'P0001' && dbError.message === 'Product is not active or does not exist') {
      return {
        message: 'That product is no longer active. Choose an active product and try again.',
        errors: { productId: 'Choose an active product.' }, values, requestId: randomUUID(),
      };
    }
    console.error('Stock movement failed:', dbError.code ?? 'unknown database error');
    return { message: 'The stock change could not be recorded. Check the database setup and try again.', errors: {}, values, requestId };
  }
}

export async function receiveStockAction(previous: StockActionState, formData: FormData) {
  return submitMovement(previous, formData, 'receiving');
}

export async function deductStockAction(previous: StockActionState, formData: FormData) {
  return submitMovement(previous, formData, 'sale');
}
