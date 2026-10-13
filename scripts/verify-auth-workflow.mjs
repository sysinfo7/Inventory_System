import pg from 'pg';
import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to remove the temporary verification account.');
const databaseUrl = new URL(process.env.APP_DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) throw new Error('Auth verification only accepts a local database host.');
const cleanupUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(cleanupUrl.hostname)) throw new Error('Auth verification cleanup only accepts a local database host.');
const appUrl = process.env.AUTH_TEST_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['http:', 'https:'].includes(new URL(appUrl).protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(appUrl).hostname)) {
  throw new Error('Auth verification only accepts a localhost app URL.');
}

const scrypt = promisify(scryptCallback);
const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2 });
const userId = randomUUID();
const email = `auth-check-${userId}@inventory-demo.invalid`;
const password = randomBytes(24).toString('base64url');
let cookie = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function page(path) {
  return fetch(new URL(path, appUrl), { headers: cookie ? { cookie } : {}, redirect: 'manual' });
}

try {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  await pool.query("INSERT INTO app_users(id, email, display_name, password_hash, role) VALUES ($1, $2, $3, $4, 'viewer')", [userId, email, 'Temporary Auth Check', passwordHash]);

  const login = await fetch(new URL('/login/authenticate', appUrl), {
    method: 'POST', redirect: 'manual',
    headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
  });
  const setCookie = login.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';', 1)[0];
  assert(login.status === 303 && cookie.startsWith('inventory_session='), 'Valid credentials did not establish a session.');
  assert(/httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie), 'Session cookie is missing required browser protections.');

  // Keep requests sequential because the local PostgreSQL login has a small connection cap.
  const products = await page('/products');
  const productHtml = await products.text();
  const stock = await page('/stock');
  const stockHtml = await stock.text();
  const activity = await page('/activity');
  const permissions = await page('/permissions');
  const permissionHtml = await permissions.text();
  const editPage = await page('/products/new');
  const editHtml = await editPage.text();
  const userAdmin = await page('/users');
  const userHtml = await userAdmin.text();
  assert(products.status === 200 && productHtml.includes('Products'), 'Read-only role could not view products.');
  assert(stock.status === 200 && stockHtml.includes('read-only stock access'), 'Read-only stock view or control hiding failed.');
  assert(activity.status === 200, 'Read-only role could not view activity.');
  assert(permissions.status === 200 && permissionHtml.includes('Roles and permissions'), `Role matrix was unavailable to a signed-in user (HTTP ${permissions.status}): ${permissionHtml.slice(0, 500)}`);
  const forbiddenRedirect = (html) => html.includes('Permission required') || html.includes('NEXT_REDIRECT;replace;/forbidden;');
  assert(forbiddenRedirect(editHtml), `Read-only user was not blocked from the product editor (HTTP ${editPage.status}): ${editHtml.slice(-1800)}`);
  assert(forbiddenRedirect(userHtml), `Read-only user was not blocked from user management (HTTP ${userAdmin.status}): ${userHtml.slice(-1800)}`);

  const logout = await fetch(new URL('/logout', appUrl), {
    method: 'POST', redirect: 'manual', headers: { origin: appUrl, host: new URL(appUrl).host, cookie },
  });
  assert(logout.status === 303, 'Sign-out did not redirect to sign-in.');
  cookie = '';
  const signedOutProducts = await page('/products');
  const signedOutHtml = await signedOutProducts.text();
  assert(signedOutHtml.includes('Welcome back.') || signedOutHtml.includes('NEXT_REDIRECT;replace;/login;'), 'Revoked session could still access the product catalog.');

  // Verify actor audit attribution using app grants, rolling back all test rows.
  const client = await pool.connect();
  const requestId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT save_product(NULL, $1, $2, NULL, NULL, 0, true, $3::uuid, $4::uuid)',
      [`AUTH-CHECK-${userId}`, 'Temporary Auth Check Product', requestId, userId],
    );
    const audit = await client.query('SELECT actor_id FROM inventory_audit_log WHERE request_id = $1::uuid', [requestId]);
    assert(audit.rowCount === 1 && String(audit.rows[0].actor_id) === userId, 'Authenticated actor was not recorded on the product audit event.');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  console.log('Authentication verified: sign-in, protected cookie, viewer reads, editor/admin denial, session revocation, and actor audit attribution passed.');
} finally {
  if (cookie) {
    try { await fetch(new URL('/logout', appUrl), { method: 'POST', redirect: 'manual', headers: { origin: appUrl, host: new URL(appUrl).host, cookie } }); } catch { /* The session row is also removed directly below. */ }
  }
  const cleanup = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await cleanup.connect();
    await cleanup.query('DELETE FROM app_users WHERE id = $1::uuid', [userId]);
  } finally {
    await cleanup.end().catch(() => {});
    await pool.end();
  }
}
