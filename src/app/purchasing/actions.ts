'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDbPool } from '@/lib/db';
import { requirePermission } from '@/lib/auth';

function readText(form: FormData, field: string) {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.trim() : '';
}

function validId(value: string) {
  return /^[1-9]\d{0,18}$/.test(value) && (value.length < 19 || value <= '9223372036854775807');
}

function queryErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
}

export async function saveSupplierAction(form: FormData) {
  const actor = await requirePermission('suppliers:write');
  const rawId = readText(form, 'supplierId');
  const id = rawId ? rawId : null;
  const name = readText(form, 'name');
  const contactName = readText(form, 'contactName');
  const email = readText(form, 'email').toLowerCase();
  const phone = readText(form, 'phone');
  const notes = readText(form, 'notes');
  if ((id !== null && !validId(id)) || name.length < 1 || name.length > 160
      || contactName.length > 120 || (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254))
      || phone.length > 40 || notes.length > 500) redirect('/suppliers?error=invalid');
  try {
    await getDbPool().query(
      'SELECT save_supplier($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::text,$7::uuid)',
      [id, name, contactName || null, email || null, phone || null, notes || null, actor.id],
    );
  } catch (error) {
    if (queryErrorCode(error) === '23505') redirect('/suppliers?error=duplicate');
    console.error('Supplier save failed:', queryErrorCode(error));
    redirect('/suppliers?error=failed');
  }
  revalidatePath('/suppliers');
  revalidatePath('/purchase-orders');
  redirect('/suppliers?saved=1');
}

export async function setSupplierActiveAction(form: FormData) {
  const actor = await requirePermission('suppliers:manage');
  const id = readText(form, 'supplierId');
  const active = readText(form, 'active');
  if (!validId(id) || !['true', 'false'].includes(active)) redirect('/suppliers?error=invalid');
  try {
    await getDbPool().query('SELECT set_supplier_active($1::bigint,$2::boolean,$3::uuid)', [id, active, actor.id]);
  } catch (error) {
    console.error('Supplier status update failed:', queryErrorCode(error));
    redirect('/suppliers?error=failed');
  }
  revalidatePath('/suppliers');
  revalidatePath('/purchase-orders');
  redirect('/suppliers?saved=1');
}

export async function savePurchaseOrderAction(form: FormData) {
  const actor = await requirePermission('purchase_orders:write');
  const rawId = readText(form, 'orderId');
  const orderId = rawId || null;
  const supplierId = readText(form, 'supplierId');
  const locationId = readText(form, 'locationId');
  const expected = readText(form, 'expectedDeliveryOn');
  const notes = readText(form, 'notes');
  const productIds = form.getAll('productId').map((value) => typeof value === 'string' ? value.trim() : '');
  const quantities = form.getAll('quantity').map((value) => typeof value === 'string' ? value.trim() : '');
  if ((orderId !== null && !validId(orderId)) || !validId(supplierId) || !validId(locationId)
      || (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) || notes.length > 500
      || productIds.length !== quantities.length || productIds.length > 100) redirect('/purchase-orders?error=invalid');

  const lines: Array<{ productId: string; quantity: string }> = [];
  for (let index = 0; index < productIds.length; index++) {
    const productId = productIds[index];
    const quantity = quantities[index];
    if (!productId && !quantity) continue;
    if (!validId(productId) || !/^[1-9]\d{0,18}$/.test(quantity)
        || (quantity.length === 19 && quantity > '9223372036854775807')) redirect('/purchase-orders?error=invalid');
    lines.push({ productId, quantity });
  }
  if (lines.length < 1 || new Set(lines.map((line) => line.productId)).size !== lines.length) redirect('/purchase-orders?error=lines');
  try {
    const result = await getDbPool().query(
      'SELECT save_purchase_order($1::bigint,$2::bigint,$3::bigint,$4::date,$5::text,$6::jsonb,$7::uuid) AS id',
      [orderId, supplierId, locationId, expected || null, notes || null, JSON.stringify(lines), actor.id],
    );
    const id = String(result.rows[0].id);
    revalidatePath('/purchase-orders');
    redirect(`/purchase-orders/${id}?saved=draft`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    console.error('Purchase-order save failed:', queryErrorCode(error));
    redirect('/purchase-orders?error=failed');
  }
}

export async function submitPurchaseOrderAction(form: FormData) {
  const actor = await requirePermission('purchase_orders:write');
  const id = readText(form, 'orderId');
  if (!validId(id) || readText(form, 'confirmed') !== 'yes') redirect(`/purchase-orders/${encodeURIComponent(id)}?error=submit`);
  try {
    await getDbPool().query('SELECT submit_purchase_order($1::bigint,$2::uuid)', [id, actor.id]);
  } catch (error) {
    console.error('Purchase-order submit failed:', queryErrorCode(error));
    redirect(`/purchase-orders/${id}?error=submit`);
  }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${id}`);
  redirect(`/purchase-orders/${id}?saved=submitted`);
}

export async function cancelPurchaseOrderAction(form: FormData) {
  const actor = await requirePermission('purchase_orders:write');
  const id = readText(form, 'orderId');
  const reason = readText(form, 'reason');
  if (!validId(id) || reason.length < 1 || reason.length > 300 || readText(form, 'confirmed') !== 'yes') redirect(`/purchase-orders/${encodeURIComponent(id)}?error=cancel`);
  try {
    await getDbPool().query('SELECT cancel_purchase_order($1::bigint,$2::text,$3::uuid)', [id, reason, actor.id]);
  } catch (error) {
    console.error('Purchase-order cancellation failed:', queryErrorCode(error));
    redirect(`/purchase-orders/${id}?error=cancel`);
  }
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${id}`);
  redirect(`/purchase-orders/${id}?saved=cancelled`);
}

export async function receivePurchaseOrderAction(form: FormData) {
  const actor = await requirePermission('purchase_orders:receive');
  const id = readText(form, 'orderId');
  const requestId = readText(form, 'requestId');
  const lineIds = form.getAll('lineId').map((value) => typeof value === 'string' ? value.trim() : '');
  const lines: Array<{ lineId: string; quantity: string }> = [];
  if (!validId(id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
      || lineIds.length > 100 || lineIds.some((lineId) => !validId(lineId))) redirect(`/purchase-orders/${encodeURIComponent(id)}?error=receipt`);
  for (const lineId of lineIds) {
    const rawQuantity = readText(form, `quantity-${lineId}`);
    if (!rawQuantity || rawQuantity === '0') continue;
    if (!/^[1-9]\d{0,18}$/.test(rawQuantity)
        || (rawQuantity.length === 19 && rawQuantity > '9223372036854775807')) redirect(`/purchase-orders/${id}?error=receipt`);
    lines.push({ lineId, quantity: rawQuantity });
  }
  if (lines.length < 1) redirect(`/purchase-orders/${id}?error=receipt`);
  const reference = readText(form, 'reference');
  const note = readText(form, 'note');
  if (reference.length > 80 || note.length > 300) redirect(`/purchase-orders/${id}?error=receipt`);
  try {
    await getDbPool().query(
      'SELECT receive_purchase_order($1::bigint,$2::jsonb,$3::text,$4::text,$5::uuid,$6::uuid)',
      [id, JSON.stringify(lines), reference || null, note || null, requestId, actor.id],
    );
  } catch (error) {
    console.error('Purchase-order receipt failed:', queryErrorCode(error));
    redirect(`/purchase-orders/${id}?error=receipt`);
  }
  const unitsReceived = lines.reduce((total, line) => total + BigInt(line.quantity), BigInt(0)).toString();
  let completionStatus: string | null = null;
  try {
    const order = await getDbPool().query('SELECT status FROM purchase_orders WHERE id=$1::bigint', [id]);
    completionStatus = order.rows[0]?.status === 'received' ? 'true' : 'false';
  } catch (error) {
    // The receipt already committed. Fall back to the detail page's current status.
    console.error('Purchase-order receipt status lookup failed:', queryErrorCode(error));
  }
  revalidatePath('/stock');
  revalidatePath('/activity');
  revalidatePath('/purchase-orders');
  revalidatePath(`/purchase-orders/${id}`);
  const receiptMessage = new URLSearchParams({ saved: 'receipt', received: unitsReceived });
  if (completionStatus !== null) receiptMessage.set('completed', completionStatus);
  redirect(`/purchase-orders/${id}?${receiptMessage.toString()}`);
}
