'use server';

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission, type Role } from '@/lib/auth';
import { getDbPool } from '@/lib/db';

const scrypt = promisify(scryptCallback);
const roles: Role[] = ['admin', 'manager', 'clerk', 'viewer'];

async function passwordHash(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function value(form: FormData, name: string) {
  const result = form.get(name);
  return typeof result === 'string' ? result.trim() : '';
}

export async function createUserAction(form: FormData) {
  await requirePermission('users:manage');
  const email = value(form, 'email').toLowerCase();
  const name = value(form, 'displayName');
  const role = value(form, 'role') as Role;
  const password = value(form, 'password');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || name.length < 1 || name.length > 120 || !roles.includes(role) || password.length < 14 || password.length > 1024) {
    redirect('/users?error=invalid');
  }
  try {
    await getDbPool().query('INSERT INTO app_users(email, display_name, password_hash, role, password_change_required) VALUES ($1, $2, $3, $4, true)', [email, name, await passwordHash(password), role]);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === '23505') redirect('/users?error=duplicate');
    console.error('User creation failed:', code ?? 'unknown database error');
    redirect('/users?error=failed');
  }
  revalidatePath('/users');
  redirect('/users?saved=1');
}

export async function setUserActiveAction(form: FormData) {
  const actor = await requirePermission('users:manage');
  const userId = value(form, 'userId');
  const activeValue = value(form, 'active');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || (activeValue !== 'true' && activeValue !== 'false')) redirect('/users?error=invalid');
  if (actor.id === userId && activeValue === 'false') redirect('/users?error=self');

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory-user-admin', 0))");
    const target = await client.query('SELECT id, role, active FROM app_users WHERE id = $1::uuid FOR UPDATE', [userId]);
    if (!target.rowCount) { await client.query('ROLLBACK'); redirect('/users?error=missing'); }
    if (target.rows[0].role === 'admin' && target.rows[0].active && activeValue === 'false') {
      const admins = await client.query("SELECT count(*)::int AS count FROM app_users WHERE role = 'admin' AND active = true");
      if (admins.rows[0].count <= 1) { await client.query('ROLLBACK'); redirect('/users?error=lastadmin'); }
    }
    await client.query('UPDATE app_users SET active = $2, updated_at = now() WHERE id = $1::uuid', [userId, activeValue === 'true']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  revalidatePath('/users');
  redirect('/users?saved=1');
}
