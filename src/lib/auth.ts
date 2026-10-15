import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDbPool } from '@/lib/db';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'inventory_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export type Role = 'admin' | 'manager' | 'clerk' | 'viewer';
export type Permission = 'catalog:read' | 'catalog:write' | 'stock:read' | 'stock:receive' | 'stock:sale' | 'stock:adjust' | 'activity:read' | 'users:manage' | 'suppliers:read' | 'suppliers:write' | 'suppliers:manage' | 'purchase_orders:read' | 'purchase_orders:write' | 'purchase_orders:receive';
export type AuthUser = { id: string; email: string; displayName: string; role: Role; passwordChangeRequired: boolean; publicDemo?: boolean };
export type AuthenticationResult = { user: AuthUser | null; rateLimited: boolean; retryAfterSeconds?: number };

export type PublicReadPermission = 'catalog:read' | 'stock:read' | 'activity:read' | 'suppliers:read' | 'purchase_orders:read';
const publicDemoPermissions: readonly PublicReadPermission[] = [
  'catalog:read', 'stock:read', 'activity:read', 'suppliers:read', 'purchase_orders:read',
];

export function isPublicDemoModeEnabled() {
  return process.env.PUBLIC_DEMO_MODE === 'true';
}

const grants: Record<Role, readonly Permission[]> = {
  admin: ['catalog:read', 'catalog:write', 'stock:read', 'stock:receive', 'stock:sale', 'stock:adjust', 'activity:read', 'users:manage', 'suppliers:read', 'suppliers:write', 'suppliers:manage', 'purchase_orders:read', 'purchase_orders:write', 'purchase_orders:receive'],
  manager: ['catalog:read', 'catalog:write', 'stock:read', 'stock:receive', 'stock:sale', 'stock:adjust', 'activity:read', 'suppliers:read', 'suppliers:write', 'purchase_orders:read', 'purchase_orders:write', 'purchase_orders:receive'],
  clerk: ['catalog:read', 'stock:read', 'stock:receive', 'stock:sale', 'activity:read', 'suppliers:read', 'purchase_orders:read', 'purchase_orders:receive'],
  viewer: ['catalog:read', 'stock:read', 'activity:read', 'suppliers:read', 'purchase_orders:read'],
};

export function hasPermission(role: Role, permission: Permission) {
  return grants[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: Role) {
  return grants[role] ?? [];
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, keyHex, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex || extra !== undefined || !/^[\da-f]{32}$/.test(saltHex) || !/^[\da-f]{128}$/.test(keyHex)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

export type PasswordChangeResult = 'changed' | 'incorrect' | 'same' | 'session';

export type PasswordAttemptReservation = { authenticated: false } | { authenticated: true; allowed: boolean; retryAfterSeconds: number };

export async function reserveCurrentPasswordAttempt(clientAddress: string): Promise<PasswordAttemptReservation> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { authenticated: false };

  const pool = getDbPool();
  const account = await pool.query(`
    SELECT u.email
    FROM app_sessions AS s JOIN app_users AS u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true
  `, [tokenDigest(token)]);
  if (!account.rowCount) return { authenticated: false };

  const emailKey = loginRateKey('email', `${String(account.rows[0].email).trim().toLowerCase()}\0${clientAddress}`);
  const clientKey = loginRateKey('client', clientAddress);
  const result = await pool.query(
    'SELECT allowed, retry_after_seconds FROM reserve_auth_login_attempt($1, $2)',
    [emailKey, clientKey],
  );
  return {
    authenticated: true,
    allowed: Boolean(result.rows[0].allowed),
    retryAfterSeconds: Number(result.rows[0].retry_after_seconds ?? 0),
  };
}

export async function changeCurrentPassword(currentPassword: string, newPassword: string, clientAddress: string): Promise<PasswordChangeResult> {
  // Lock the verified account and its session so a concurrent role change or
  // deactivation cannot race with this sensitive credential update.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return 'session';

  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    // Lock the account first, matching administrator updates that lock the
    // account before their trigger removes sessions; this avoids lock inversion.
    // The runtime role intentionally cannot lock session rows directly because
    // PostgreSQL requires UPDATE privileges for SELECT ... FOR UPDATE.
    const session = await client.query(
      'SELECT user_id FROM app_sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenDigest(token)],
    );
    if (!session.rowCount) {
      await client.query('ROLLBACK');
      return 'session';
    }
    const account = await client.query(
      'SELECT id, email, password_hash FROM app_users WHERE id = $1::uuid AND active = true FOR UPDATE',
      [session.rows[0].user_id],
    );
    if (!account.rowCount) {
      await client.query('ROLLBACK');
      return 'session';
    }
    const currentSession = await client.query(
      'SELECT id FROM app_sessions WHERE token_hash = $1 AND user_id = $2::uuid AND expires_at > now()',
      [tokenDigest(token), account.rows[0].id],
    );
    if (!currentSession.rowCount) {
      await client.query('ROLLBACK');
      return 'session';
    }

    const oldHash = account.rows[0].password_hash as string;
    if (!(await verifyPassword(currentPassword, oldHash))) {
      await client.query('ROLLBACK');
      return 'incorrect';
    }
    if (await verifyPassword(newPassword, oldHash)) {
      await client.query('ROLLBACK');
      return 'same';
    }

    const updated = await client.query(
      'UPDATE app_users SET password_hash = $1, password_change_required = false, updated_at = now() WHERE id = $2::uuid AND password_hash = $3 AND active = true',
      [await hashPassword(newPassword), account.rows[0].id, oldHash],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return 'session';
    }
    const emailKey = loginRateKey('email', `${String(account.rows[0].email).trim().toLowerCase()}\0${clientAddress}`);
    await client.query('SELECT clear_auth_login_email_attempts($1)', [emailKey]);
    await client.query('COMMIT');
    return 'changed';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function loginRateKey(scope: 'email' | 'client', value: string) {
  // The dedicated random app-DB password supplies a secret HMAC key; raw identifiers never enter the limiter table.
  const secret = process.env.APP_DATABASE_URL;
  if (!secret) throw new Error('APP_DATABASE_URL is missing.');
  return createHmac('sha256', secret).update(`inventory-login-rate-v1\0${scope}\0${value}`).digest('hex');
}

export async function authenticate(email: string, password: string, clientAddress: string): Promise<AuthenticationResult> {
  if (email.length > 254 || password.length > 1024) return { user: null, rateLimited: false };
  const normalizedEmail = email.trim().toLowerCase();
  const emailDigest = loginRateKey('email', `${normalizedEmail}\0${clientAddress}`);
  const clientDigest = loginRateKey('client', clientAddress);
  const pool = getDbPool();
  const limiter = await pool.query(
    'SELECT allowed, retry_after_seconds FROM reserve_auth_login_attempt($1, $2)',
    [emailDigest, clientDigest],
  );
  if (!limiter.rows[0].allowed) {
    return { user: null, rateLimited: true, retryAfterSeconds: Number(limiter.rows[0].retry_after_seconds) };
  }

  const authClient = await pool.connect();
  let user: { id: string; email: string; display_name: string; password_hash: string; role: Role; password_change_required: boolean } | undefined;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  try {
    await authClient.query('BEGIN');
    // Serialize login with password changes and deactivation so an old password
    // cannot create a fresh session after an administrator reset commits.
    const result = await authClient.query(`
      SELECT id, email, display_name, password_hash, role, password_change_required
      FROM app_users WHERE lower(email) = lower($1) AND active = true LIMIT 1 FOR UPDATE
    `, [normalizedEmail]);
    user = result.rows[0];
    // Verify a fixed dummy hash on unknown users to reduce email enumeration timing leaks.
    const fallbackHash = 'scrypt$00000000000000000000000000000000$'.concat('00'.repeat(64));
    if (!(await verifyPassword(password, user?.password_hash ?? fallbackHash)) || !user) {
      await authClient.query('ROLLBACK');
      return { user: null, rateLimited: false };
    }

    await authClient.query('SELECT clear_auth_login_email_attempts($1)', [emailDigest]);
    await authClient.query('INSERT INTO app_sessions(user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)', [user.id, tokenDigest(token), expiresAt]);
    await authClient.query('COMMIT');
  } catch (error) {
    await authClient.query('ROLLBACK');
    throw error;
  } finally {
    authClient.release();
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
    expires: expiresAt,
  });
  return {
    user: { id: String(user.id), email: user.email, displayName: user.display_name, role: user.role, passwordChangeRequired: user.password_change_required },
    rateLimited: false,
  };
}

export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await getDbPool().query(`
    SELECT u.id, u.email, u.display_name, u.role, u.password_change_required
    FROM app_sessions AS s JOIN app_users AS u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true
  `, [tokenDigest(token)]);
  const user = result.rows[0];
  return user ? { id: String(user.id), email: user.email, displayName: user.display_name, role: user.role, passwordChangeRequired: user.password_change_required } : null;
}

export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.passwordChangeRequired && !options.allowPasswordChange) redirect('/account/security?required=1');
  return user;
}

export async function requirePermission(permission: Permission): Promise<AuthUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) redirect('/forbidden');
  return user;
}

/** Allow anonymous visitors to use only the explicitly selected read-only demo pages. */
export async function requireReadPermission(permission: PublicReadPermission): Promise<AuthUser> {
  const user = await currentUser();
  if (user) {
    if (user.passwordChangeRequired) redirect('/account/security?required=1');
    if (!hasPermission(user.role, permission)) redirect('/forbidden');
    return user;
  }
  if (!isPublicDemoModeEnabled() || !publicDemoPermissions.includes(permission)) redirect('/login');
  return {
    id: '00000000-0000-4000-8000-000000000000',
    email: '',
    displayName: 'Employer demo visitor',
    role: 'viewer',
    passwordChangeRequired: false,
    publicDemo: true,
  };
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await getDbPool().query('DELETE FROM app_sessions WHERE token_hash = $1', [tokenDigest(token)]);
  }
  cookieStore.delete(SESSION_COOKIE);
}
