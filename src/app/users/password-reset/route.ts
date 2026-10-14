import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { hashPassword, requirePermission } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { formReadErrorResponse, readAuthForm } from '@/lib/url-encoded-form';

function redirectTo(request: Request, query: string) {
  return NextResponse.redirect(new URL(`/users?${query}`, request.url), 303);
}

export async function POST(request: Request) {
  // Password credentials must only be accepted from this app's own user page.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return new Response('Forbidden', { status: 403 });
  try {
    if (new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const actor = await requirePermission('users:manage');
  const parsed = await readAuthForm(request);
  if (!parsed.ok) return formReadErrorResponse(parsed.reason);
  const form = parsed.form;
  const userId = form.get('userId');
  const temporaryPassword = form.get('temporaryPassword');
  const confirmation = form.get('confirmation');
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
      || typeof temporaryPassword !== 'string' || typeof confirmation !== 'string'
      || temporaryPassword.length < 14 || temporaryPassword.length > 1024 || temporaryPassword !== confirmation) {
    return redirectTo(request, 'error=resetinvalid');
  }
  const targetId = userId.toLowerCase();
  if (actor.id === targetId) return redirectTo(request, 'error=selfreset');

  const passwordHash = await hashPassword(temporaryPassword);
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    // Lock both accounts in a stable order so two administrators cannot deadlock
    // while resetting one another at the same time.
    const lockedAccounts = await client.query(
      'SELECT id, role, active FROM app_users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[actor.id, targetId]],
    );
    const authorizedActor = lockedAccounts.rows.find((account) => String(account.id) === actor.id);
    if (!authorizedActor?.active || authorizedActor.role !== 'admin') {
      await client.query('ROLLBACK');
      return new Response('Forbidden', { status: 403 });
    }
    const target = lockedAccounts.rows.find((account) => String(account.id) === targetId);
    if (!target?.active) {
      await client.query('ROLLBACK');
      return redirectTo(request, 'error=resettarget');
    }

    // The trigger records this verified administrator as the audit actor,
    // marks the event as an admin reset, and revokes target sessions atomically.
    await client.query("SELECT set_config('inventory.security_actor_id', $1, true)", [actor.id]);
    await client.query(
      'UPDATE app_users SET password_hash = $1, password_change_required = true, updated_at = now() WHERE id = $2::uuid',
      [passwordHash, targetId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    console.error('Administrator password reset failed:', code ?? 'unknown database error');
    return redirectTo(request, 'error=resetfailed');
  } finally {
    client.release();
  }

  revalidatePath('/users');
  return redirectTo(request, 'saved=reset');
}
