import pg from 'pg';
import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to remove the temporary verification account.');
if (process.env.CI !== 'true'
    && (process.env.AUTH_PASSWORD_CHANGE_CI_TESTS === 'true' || process.env.ACTIVITY_FILTER_CI_TESTS === 'true')) {
  throw new Error('CI-only auth and activity scenarios write to the disposable verification database; refusing to run them outside CI.');
}
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
const auditPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const userId = randomUUID();
const email = `auth-check-${userId}@inventory-demo.invalid`;
const password = randomBytes(24).toString('base64url');
const resetTargetId = randomUUID();
const resetTargetEmail = `auth-reset-target-${resetTargetId}@inventory-demo.invalid`;
const resetTargetPassword = randomBytes(24).toString('base64url');
let loginPassword = password;
let cookie = '';
let ciMovementCreated = false;
let ciPasswordChanged = false;
let ciResetTargetCreated = false;
let ciPasswordResetCompleted = false;
let resetTargetCookie = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashTestPassword(value) {
  const salt = randomBytes(16);
  const key = await scrypt(value, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function page(path, sessionCookie = cookie) {
  return fetch(new URL(path, appUrl), { headers: sessionCookie ? { cookie: sessionCookie } : {}, redirect: 'manual' });
}

async function postAdminReset(targetId, temporaryPassword, confirmation, sessionCookie = cookie, requestOrigin = appUrl) {
  return fetch(new URL('/users/password-reset', appUrl), {
    method: 'POST', redirect: 'manual',
    headers: { origin: requestOrigin, host: new URL(appUrl).host, cookie: sessionCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ userId: targetId, temporaryPassword, confirmation }),
  });
}

async function signIn() {
  const response = await fetch(new URL('/login/authenticate', appUrl), {
    method: 'POST', redirect: 'manual',
    headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: loginPassword }),
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';', 1)[0];
  assert(response.status === 303 && cookie.startsWith('inventory_session='), 'Valid credentials did not establish a session.');
  assert(/httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie), 'Session cookie is missing required browser protections.');
  return response;
}

async function assertRevokedAndSignInAgain(message) {
  const staleSession = await page('/products');
  const staleHtml = await staleSession.text();
  assert(staleHtml.includes('Welcome back.') || staleHtml.includes('NEXT_REDIRECT;replace;/login;'), message);
  cookie = '';
  await signIn();
}

try {
  const limiterPrivileges = await pool.query(`
    SELECT (has_table_privilege(current_user, 'public.auth_login_rate_limits', 'SELECT')
         OR has_table_privilege(current_user, 'public.auth_login_rate_limits', 'INSERT')
         OR has_table_privilege(current_user, 'public.auth_login_rate_limits', 'UPDATE')
         OR has_table_privilege(current_user, 'public.auth_login_rate_limits', 'DELETE')) AS can_access_table,
           has_function_privilege(current_user, 'public.reserve_auth_login_attempt(text,text)', 'EXECUTE') AS can_reserve,
           has_function_privilege(current_user, 'public.clear_auth_login_email_attempts(text)', 'EXECUTE') AS can_clear
  `);
  assert(!limiterPrivileges.rows[0].can_access_table && limiterPrivileges.rows[0].can_reserve && limiterPrivileges.rows[0].can_clear,
    'Runtime role has incorrect access to the login rate-limit storage/functions.');

  const sessionTriggerPrivileges = await pool.query(`
    SELECT has_table_privilege('inventory_function_owner', 'public.app_sessions', 'DELETE') AS can_delete_sessions,
           has_column_privilege('inventory_function_owner', 'public.app_sessions', 'user_id', 'SELECT') AS can_read_session_owner,
           has_column_privilege('inventory_function_owner', 'public.app_sessions', 'token_hash', 'SELECT') AS can_read_session_token,
           has_column_privilege('inventory_function_owner', 'public.app_sessions', 'expires_at', 'SELECT') AS can_read_expiry,
           has_function_privilege(current_user, 'public.revoke_user_sessions_on_access_change()', 'EXECUTE') AS can_call_trigger
  `);
  assert(sessionTriggerPrivileges.rows[0].can_delete_sessions && sessionTriggerPrivileges.rows[0].can_read_session_owner
      && !sessionTriggerPrivileges.rows[0].can_read_session_token && !sessionTriggerPrivileges.rows[0].can_read_expiry
      && !sessionTriggerPrivileges.rows[0].can_call_trigger,
    'Session-revocation trigger privileges exceed the intended narrow access.');

  const securityEventPrivileges = await pool.query(`
    SELECT has_table_privilege(current_user, 'public.app_security_events', 'SELECT') AS can_read,
           has_table_privilege(current_user, 'public.app_security_events', 'INSERT') AS can_insert,
           has_table_privilege(current_user, 'public.app_security_events', 'UPDATE') AS can_update,
           has_table_privilege(current_user, 'public.app_security_events', 'DELETE') AS can_delete,
           has_table_privilege(current_user, 'public.app_security_events', 'TRUNCATE') AS can_truncate,
           has_table_privilege('inventory_function_owner', 'public.app_security_events', 'INSERT') AS trigger_can_insert,
           has_sequence_privilege('inventory_function_owner', 'public.app_security_events_id_seq', 'USAGE') AS trigger_can_use_id
  `);
  const securityGrants = securityEventPrivileges.rows[0];
  assert(!securityGrants.can_read && !securityGrants.can_insert && !securityGrants.can_update
      && !securityGrants.can_delete && !securityGrants.can_truncate
      && securityGrants.trigger_can_insert && securityGrants.trigger_can_use_id,
    'Password security-event table grants exceed the intended trigger-only write access.');

  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  await pool.query("INSERT INTO app_users(id, email, display_name, password_hash, role) VALUES ($1, $2, $3, $4, 'viewer')", [userId, email, 'Temporary Auth Check', passwordHash]);
  if (process.env.AUTH_PASSWORD_CHANGE_CI_TESTS === 'true') {
    await auditPool.query(
      "INSERT INTO app_users(id, email, display_name, password_hash, role) VALUES ($1, $2, 'Reset Target Check', $3, 'viewer')",
      [resetTargetId, resetTargetEmail, await hashTestPassword(resetTargetPassword)],
    );
    ciResetTargetCreated = true;
  }

  // Verify the password-change trigger transactionally so local checks leave no
  // security event or test session behind. The admin-only connection reads the log.
  const auditClient = await auditPool.connect();
  const syntheticSession = randomBytes(32).toString('hex');
  const changedSalt = randomBytes(16);
  const changedKey = await scrypt(`${password}-transaction-check`, changedSalt, 64);
  try {
    await auditClient.query('BEGIN');
    await auditClient.query('INSERT INTO app_sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')', [userId, syntheticSession]);
    await auditClient.query('UPDATE app_users SET password_hash = $2 WHERE id = $1::uuid', [userId, `scrypt$${changedSalt.toString('hex')}$${changedKey.toString('hex')}`]);
    const event = await auditClient.query("SELECT event_type, actor_id FROM app_security_events WHERE user_id = $1::uuid", [userId]);
    const session = await auditClient.query('SELECT count(*)::int AS count FROM app_sessions WHERE user_id = $1::uuid', [userId]);
    assert(event.rowCount === 1 && event.rows[0].event_type === 'password_changed' && String(event.rows[0].actor_id) === userId,
      'Password update did not append its security event and actor.');
    assert(session.rows[0].count === 0, 'Password update did not revoke the account sessions.');
  } finally {
    await auditClient.query('ROLLBACK');
    auditClient.release();
  }

  const login = await signIn();
  const securityPageCheck = await page('/account/security');
  const securityPageHtml = await securityPageCheck.text();
  assert(securityPageCheck.status === 200 && securityPageHtml.includes('Confirm new password'),
    'Signed-in user could not render the password-change page.');
  assert(login.headers.get('x-content-type-options') === 'nosniff', 'Missing MIME-sniffing protection header.');
  assert(login.headers.get('x-frame-options') === 'DENY', 'Missing clickjacking protection header.');
  assert(login.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Missing referrer privacy header.');
  assert(login.headers.get('permissions-policy') === 'camera=(), microphone=(), geolocation=()', 'Missing restrictive browser permissions header.');
  // Keep requests sequential because the local PostgreSQL login has a small connection cap.
  const products = await page('/products');
  const productHtml = await products.text();
  const stock = await page('/stock');
  const stockHtml = await stock.text();
  const activity = await page('/activity');
  const suppliersPage = await page('/suppliers');
  const suppliersHtml = await suppliersPage.text();
  const purchasingPage = await page('/purchase-orders');
  const purchasingHtml = await purchasingPage.text();
  const permissions = await page('/permissions');
  const permissionHtml = await permissions.text();
  const editPage = await page('/products/new');
  const editHtml = await editPage.text();
  const userAdmin = await page('/users');
  const userHtml = await userAdmin.text();
  assert(products.status === 200 && productHtml.includes('Products'), 'Read-only role could not view products.');
  assert(stock.status === 200 && stockHtml.includes('read-only stock access'), 'Read-only stock view or control hiding failed.');
  assert(activity.status === 200, 'Read-only role could not view activity.');
  assert(suppliersPage.status === 200 && suppliersHtml.includes('Supplier directory') && !suppliersHtml.includes('Add supplier'),
    'Read-only supplier access or supplier-write control hiding failed.');
  assert(purchasingPage.status === 200 && purchasingHtml.includes('Order register') && !purchasingHtml.includes('Create purchase order'),
    'Read-only purchase-order access or purchase-order-write control hiding failed.');
  assert(permissions.status === 200 && permissionHtml.includes('Roles and permissions'), `Role matrix was unavailable to a signed-in user (HTTP ${permissions.status}): ${permissionHtml.slice(0, 500)}`);
  const forbiddenRedirect = (html) => html.includes('Permission required') || html.includes('NEXT_REDIRECT;replace;/forbidden;');
  assert(forbiddenRedirect(editHtml), `Read-only user was not blocked from the product editor (HTTP ${editPage.status}): ${editHtml.slice(-1800)}`);
  assert(forbiddenRedirect(userHtml), `Read-only user was not blocked from user management (HTTP ${userAdmin.status}): ${userHtml.slice(-1800)}`);

  // In CI only, add one attributed movement to the disposable database and verify
  // the actor/date filters through the signed-in activity page. Local verification
  // never leaves stock-test data behind.
  if (process.env.ACTIVITY_FILTER_CI_TESTS === 'true') {
    const product = await pool.query("SELECT id FROM products WHERE sku = 'DEMO-COFFEE-001' AND active = true");
    const location = await pool.query("SELECT id FROM locations WHERE name = 'Demo Outlet'");
    assert(product.rowCount === 1 && location.rowCount === 1, 'Activity filter fixture requires the seeded coffee product and Demo Outlet.');
    const reason = `AUTH-CHECK-${userId}`;
    await pool.query(
      'SELECT record_stock_movement($1::bigint, $2::bigint, 1, $3, $4, $5::uuid, $6::uuid)',
      [product.rows[0].id, location.rows[0].id, 'receiving', reason, userId, randomUUID()],
    );
    // Movements are append-only and retain their actor via a restrictive FK.
    // Leave this fixture account only in CI's disposable database.
    ciMovementCreated = true;
    const today = new Date().toISOString().slice(0, 10);
    const attributedParams = new URLSearchParams({ actor: userId, from: today, to: today, q: reason });
    const attributedActivity = await page(`/activity?${attributedParams}`);
    const attributedHtml = await attributedActivity.text();
    assert(attributedActivity.status === 200 && attributedHtml.includes(reason)
      && attributedHtml.includes(userId) && attributedHtml.includes('1 movement shown'),
    'Activity actor and inclusive UTC date filters did not return the attributed test movement.');
    const legacyParams = new URLSearchParams({ actor: 'legacy', q: 'Demo setup' });
    const legacyActivity = await page(`/activity?${legacyParams}`);
    const legacyHtml = await legacyActivity.text();
    assert(legacyActivity.status === 200 && legacyHtml.includes('8 movements shown')
      && legacyHtml.includes('Legacy entry'), 'Legacy actor filter did not return the eight seeded sample movements.');
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const reversedDates = await page(`/activity?from=${today}&to=${yesterday}`);
    const reversedHtml = await reversedDates.text();
    assert(reversedDates.status === 200 && reversedHtml.includes('The start date must be on or before the end date.'),
      'Reversed activity date filters were not handled safely.');
  }

  // Role changes invalidate existing sessions; sign in again to verify the new grants.
  await pool.query("UPDATE app_users SET role = 'clerk' WHERE id = $1::uuid", [userId]);
  await assertRevokedAndSignInAgain('Changing a role did not revoke its prior session.');
  const clerkStock = await page('/stock');
  const clerkStockHtml = await clerkStock.text();
  assert(clerkStock.status === 200 && clerkStockHtml.includes('Record customer return'), 'Clerk could not record customer returns.');
  assert(!clerkStockHtml.includes('Inventory adjustment') && !clerkStockHtml.includes('Record adjustment'), 'Clerk was shown manager-only adjustment controls.');

  await pool.query("UPDATE app_users SET role = 'manager' WHERE id = $1::uuid", [userId]);
  await assertRevokedAndSignInAgain('Changing a role did not revoke its prior session.');
  const managerStock = await page('/stock');
  const managerStockHtml = await managerStock.text();
  assert(managerStock.status === 200 && managerStockHtml.includes('Inventory adjustment'), 'Manager could not access count adjustments.');
  assert(permissionHtml.includes('Record inventory adjustments'), 'The permission matrix omitted the adjustment capability.');
  if (process.env.AUTH_PASSWORD_CHANGE_CI_TESTS === 'true') {
    const deniedReset = await postAdminReset(resetTargetId, `${password}-temporary`, `${password}-temporary`);
    const deniedResetLocation = new URL(deniedReset.headers.get('location') ?? '/', appUrl);
    assert(deniedReset.status >= 300 && deniedReset.status < 400 && deniedResetLocation.pathname === '/forbidden',
      'A manager was able to access the administrator-only password reset route.');
  }
  await pool.query("UPDATE app_users SET role = 'viewer' WHERE id = $1::uuid", [userId]);
  await assertRevokedAndSignInAgain('Changing a role did not revoke its prior session.');

  // Deactivation removes sessions, and reactivation cannot restore an old login.
  const sessionCount = await pool.query('SELECT count(*)::int AS count FROM app_sessions WHERE user_id = $1::uuid', [userId]);
  assert(sessionCount.rows[0].count === 1, 'Authentication workflow did not create one session for the test account.');
  await pool.query('UPDATE app_users SET active = false WHERE id = $1::uuid', [userId]);
  const sessionsAfterDisable = await pool.query('SELECT count(*)::int AS count FROM app_sessions WHERE user_id = $1::uuid', [userId]);
  assert(sessionsAfterDisable.rows[0].count === 0, 'Deactivating an account left a reusable session behind.');
  await pool.query('UPDATE app_users SET active = true WHERE id = $1::uuid', [userId]);
  await assertRevokedAndSignInAgain('Reactivation unexpectedly preserved an earlier session.');

  if (process.env.AUTH_PASSWORD_CHANGE_CI_TESTS === 'true') {
    await pool.query("UPDATE app_users SET role = 'admin' WHERE id = $1::uuid", [userId]);
    await assertRevokedAndSignInAgain('Restoring the test administrator role did not revoke its prior session.');
    const targetLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: resetTargetEmail, password: resetTargetPassword }),
    });
    resetTargetCookie = (targetLogin.headers.get('set-cookie') ?? '').split(';', 1)[0];
    assert(targetLogin.status === 303 && resetTargetCookie.startsWith('inventory_session='), 'Reset target could not sign in before the administrator reset.');
    const targetProducts = await page('/products', resetTargetCookie);
    assert(targetProducts.status === 200 && (await targetProducts.text()).includes('Products'), 'Reset target session could not access inventory before reset.');
  }

  if (process.env.AUTH_PASSWORD_CHANGE_CI_TESTS === 'true') {
    const securityPage = await page('/account/security');
    const securityHtml = await securityPage.text();
    assert(securityPage.status === 200 && securityHtml.includes('Change password'), 'Signed-in user could not open account security.');

    const postPasswordChange = (currentPassword, newPassword, confirmation, requestOrigin = appUrl, sessionCookie = cookie) => fetch(new URL('/account/password/change', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: requestOrigin, host: new URL(appUrl).host, cookie: sessionCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ currentPassword, newPassword, confirmation }),
    });

    const rejectedReset = await postAdminReset(resetTargetId, `${password}-temporary`, 'different-temporary');
    assert(new URL(rejectedReset.headers.get('location'), appUrl).searchParams.get('error') === 'resetinvalid',
      'A mismatched temporary password was accepted.');
    const selfReset = await postAdminReset(userId, `${password}-temporary`, `${password}-temporary`);
    assert(new URL(selfReset.headers.get('location'), appUrl).searchParams.get('error') === 'selfreset',
      'An administrator was allowed to reset their own password through user management.');
    const crossSiteReset = await postAdminReset(resetTargetId, `${password}-temporary`, `${password}-temporary`, cookie, 'https://attacker.invalid');
    assert(crossSiteReset.status === 403, 'Cross-origin administrator password reset was accepted.');

    const temporaryPassword = `${password}-temporary`;
    // Hold the target row while both an old-password login and an admin reset
    // reach PostgreSQL. Whichever request acquires the row first, the reset must
    // revoke any session created by the competing login before it commits.
    const resetRaceLock = await auditPool.connect();
    const resetRaceObserver = new pg.Client({ connectionString: process.env.DATABASE_URL });
    let resetRaceTransaction = false;
    let resetRaceObserverConnected = false;
    let resetRaceResponse;
    let concurrentOldLogin;
    try {
      await resetRaceObserver.connect();
      resetRaceObserverConnected = true;
      await resetRaceLock.query('BEGIN');
      resetRaceTransaction = true;
      await resetRaceLock.query('SELECT id FROM app_users WHERE id = $1::uuid FOR UPDATE', [resetTargetId]);
      const resetRequest = postAdminReset(resetTargetId, temporaryPassword, temporaryPassword);
      const oldLoginRequest = fetch(new URL('/login/authenticate', appUrl), {
        method: 'POST', redirect: 'manual',
        headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: resetTargetEmail, password: resetTargetPassword }),
      });
      let blockedRequests = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await resetRaceObserver.query(`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `);
        blockedRequests = waiting.rows[0].count;
        if (blockedRequests >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (blockedRequests < 2) {
        await resetRaceLock.query('ROLLBACK');
        resetRaceTransaction = false;
        await Promise.allSettled([resetRequest, oldLoginRequest]);
        throw new Error('Could not coordinate the concurrent login/reset lock test.');
      }
      await resetRaceLock.query('COMMIT');
      resetRaceTransaction = false;
      [resetRaceResponse, concurrentOldLogin] = await Promise.all([resetRequest, oldLoginRequest]);
    } finally {
      if (resetRaceTransaction) await resetRaceLock.query('ROLLBACK');
      resetRaceLock.release();
      if (resetRaceObserverConnected) await resetRaceObserver.end();
    }
    assert(concurrentOldLogin.status === 303, 'The concurrent old-password login did not complete safely.');
    const resetResponse = resetRaceResponse;
    const resetLocation = new URL(resetResponse.headers.get('location'), appUrl);
    assert(resetResponse.status === 303 && resetLocation.pathname === '/users' && resetLocation.searchParams.get('saved') === 'reset',
      'The administrator password reset did not complete successfully.');
    ciPasswordResetCompleted = true;
    const resetState = await auditPool.query(`
      SELECT u.password_change_required,
             (SELECT count(*)::int FROM app_sessions s WHERE s.user_id = u.id) AS session_count
      FROM app_users u WHERE u.id = $1::uuid
    `, [resetTargetId]);
    const resetEvent = await auditPool.query(
      "SELECT actor_id, event_type FROM app_security_events WHERE user_id = $1::uuid ORDER BY id",
      [resetTargetId],
    );
    assert(resetState.rowCount === 1 && resetState.rows[0].password_change_required && resetState.rows[0].session_count === 0,
      'Administrator reset did not require a replacement password and revoke existing sessions.');
    assert(resetEvent.rowCount === 1 && String(resetEvent.rows[0].actor_id) === userId
      && resetEvent.rows[0].event_type === 'admin_password_reset',
    'Administrator reset did not preserve the verified actor and reset event type.');

    const staleTarget = await page('/products', resetTargetCookie);
    const staleTargetHtml = await staleTarget.text();
    assert(staleTarget.status >= 300 && staleTarget.status < 400
      || staleTargetHtml.includes('Welcome back.') || staleTargetHtml.includes('NEXT_REDIRECT;replace;/login;'),
      'A session issued before the administrator reset remained active.');
    const oldTargetLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: resetTargetEmail, password: resetTargetPassword }),
    });
    assert(new URL(oldTargetLogin.headers.get('location'), appUrl).searchParams.get('error') === '1',
      'The original password remained valid after the administrator reset.');
    const temporaryLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: resetTargetEmail, password: temporaryPassword }),
    });
    resetTargetCookie = (temporaryLogin.headers.get('set-cookie') ?? '').split(';', 1)[0];
    const temporaryDestination = new URL(temporaryLogin.headers.get('location'), appUrl);
    assert(temporaryLogin.status === 303 && temporaryDestination.pathname === '/account/security'
      && temporaryDestination.searchParams.get('required') === '1'
      && resetTargetCookie.startsWith('inventory_session='),
    'Temporary credentials did not lead directly to the required password-change screen.');
    const blockedProducts = await page('/products', resetTargetCookie);
    const blockedDestination = new URL(blockedProducts.headers.get('location') ?? '/', appUrl);
    const blockedProductsHtml = await blockedProducts.text();
    assert(blockedProducts.status >= 300 && blockedProducts.status < 400
      && blockedDestination.pathname === '/account/security' && blockedDestination.searchParams.get('required') === '1'
      || blockedProductsHtml.includes('NEXT_REDIRECT;replace;/account/security?required=1'),
    `Temporary-password inventory guard was unexpected: HTTP ${blockedProducts.status} ${blockedProducts.headers.get('location') ?? ''} ${blockedProductsHtml.slice(-500)}`);
    const forcedSecurityPage = await page('/account/security', resetTargetCookie);
    assert(forcedSecurityPage.status === 200 && (await forcedSecurityPage.text()).includes('temporary password'),
      'The forced password-change screen was not accessible to the reset user.');
    const replacementPassword = `${temporaryPassword}-changed`;
    const targetPasswordChanged = await postPasswordChange(temporaryPassword, replacementPassword, replacementPassword, appUrl, resetTargetCookie);
    assert(targetPasswordChanged.status === 303
      && new URL(targetPasswordChanged.headers.get('location'), appUrl).searchParams.get('passwordChanged') === '1',
    'The reset user could not replace the temporary password.');
    const completedReset = await auditPool.query(`
      SELECT u.password_change_required,
             (SELECT count(*)::int FROM app_sessions s WHERE s.user_id = u.id) AS session_count
      FROM app_users u WHERE u.id = $1::uuid
    `, [resetTargetId]);
    const completedEvents = await auditPool.query(
      "SELECT actor_id, event_type FROM app_security_events WHERE user_id = $1::uuid ORDER BY id",
      [resetTargetId],
    );
    assert(completedReset.rows[0].password_change_required === false && completedReset.rows[0].session_count === 0,
      'Changing the temporary password did not clear the requirement and revoke sessions.');
    assert(completedEvents.rowCount === 2 && completedEvents.rows[0].event_type === 'admin_password_reset'
      && String(completedEvents.rows[0].actor_id) === userId
      && completedEvents.rows[1].event_type === 'password_changed'
      && String(completedEvents.rows[1].actor_id) === resetTargetId,
    'Reset and replacement password events did not record the correct actor and subject.');
    const temporaryAfterChange = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: resetTargetEmail, password: temporaryPassword }),
    });
    assert(new URL(temporaryAfterChange.headers.get('location'), appUrl).searchParams.get('error') === '1',
      'The temporary password remained valid after replacement.');
    const replacementLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: resetTargetEmail, password: replacementPassword }),
    });
    resetTargetCookie = (replacementLogin.headers.get('set-cookie') ?? '').split(';', 1)[0];
    const restoredProducts = await page('/products', resetTargetCookie);
    assert(replacementLogin.status === 303 && restoredProducts.status === 200
      && (await restoredProducts.text()).includes('Products'),
    'The replacement password did not restore normal inventory access.');

    const crossSite = await postPasswordChange(password, `${password}-rotated`, `${password}-rotated`, 'https://attacker.invalid');
    assert(crossSite.status === 403, 'Cross-origin password-change request was accepted.');
    const incorrectPassword = await postPasswordChange(`${password}-wrong`, `${password}-rotated`, `${password}-rotated`);
    const incorrectLocation = new URL(incorrectPassword.headers.get('location'), appUrl);
    assert(incorrectPassword.status === 303 && incorrectLocation.pathname === '/account/security' && incorrectLocation.searchParams.get('error') === 'incorrect',
      `Incorrect current password response was unexpected: ${incorrectPassword.status} ${incorrectLocation.pathname}${incorrectLocation.search}`);
    const mismatch = await postPasswordChange(password, `${password}-rotated`, `${password}-different`);
    assert(mismatch.status === 303 && new URL(mismatch.headers.get('location'), appUrl).searchParams.get('error') === 'invalid',
      'A mismatched password confirmation was accepted.');
    const tooShort = await postPasswordChange(password, 'short', 'short');
    assert(tooShort.status === 303 && new URL(tooShort.headers.get('location'), appUrl).searchParams.get('error') === 'invalid',
      'A short password was accepted.');
    const unchanged = await postPasswordChange(password, password, password);
    assert(unchanged.status === 303 && new URL(unchanged.headers.get('location'), appUrl).searchParams.get('error') === 'invalid',
      'The existing password was accepted as its own replacement.');

    const staleCookie = cookie;
    const rotatedPassword = `${password}-rotated`;
    const changed = await postPasswordChange(password, rotatedPassword, rotatedPassword);
    assert(changed.status === 303 && new URL(changed.headers.get('location'), appUrl).searchParams.get('passwordChanged') === '1',
      'A valid password change did not redirect to sign-in.');
    ciPasswordChanged = true;
    const revokedSessions = await pool.query('SELECT count(*)::int AS count FROM app_sessions WHERE user_id = $1::uuid', [userId]);
    assert(revokedSessions.rows[0].count === 0, 'Password change did not revoke all sessions.');
    const securityEvent = await auditPool.query(
      "SELECT count(*)::int AS count FROM app_security_events WHERE user_id = $1::uuid AND event_type = 'password_changed'",
      [userId],
    );
    assert(securityEvent.rows[0].count === 1, 'Password change did not append exactly one security event.');

    cookie = staleCookie;
    const staleProducts = await page('/products');
    const staleHtml = await staleProducts.text();
    assert(staleHtml.includes('Welcome back.') || staleHtml.includes('NEXT_REDIRECT;replace;/login;'),
      'The pre-change session remained usable after password rotation.');
    cookie = '';
    const oldPasswordLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password }),
    });
    assert(new URL(oldPasswordLogin.headers.get('location'), appUrl).searchParams.get('error') === '1',
      'The previous password remained valid after rotation.');
    loginPassword = rotatedPassword;
    await signIn();
  }

  const logout = await fetch(new URL('/logout', appUrl), {
    method: 'POST', redirect: 'manual', headers: { origin: appUrl, host: new URL(appUrl).host, cookie },
  });
  assert(logout.status === 303, 'Sign-out did not redirect to sign-in.');
  cookie = '';
  const signedOutProducts = await page('/products');
  const signedOutHtml = await signedOutProducts.text();
  assert(signedOutHtml.includes('Welcome back.') || signedOutHtml.includes('NEXT_REDIRECT;replace;/login;'), 'Revoked session could still access the product catalog.');

  // Check that repeated failures for one identifier/client pair are throttled before another scrypt check.
  for (let attempt = 0; attempt < 8; attempt++) {
    const failedLogin = await fetch(new URL('/login/authenticate', appUrl), {
      method: 'POST', redirect: 'manual',
      headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: `${password}-wrong` }),
    });
    assert(failedLogin.status === 303 && new URL(failedLogin.headers.get('location'), appUrl).searchParams.get('error') === '1', 'Invalid sign-in did not use the generic failure response.');
  }
  const limitedLogin = await fetch(new URL('/login/authenticate', appUrl), {
    method: 'POST', redirect: 'manual',
    headers: { origin: appUrl, host: new URL(appUrl).host, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
  });
  const retryAfter = Number(limitedLogin.headers.get('retry-after'));
  assert(limitedLogin.status === 303 && new URL(limitedLogin.headers.get('location'), appUrl).searchParams.get('error') === '2' && retryAfter > 0 && retryAfter <= 900, 'Repeated sign-in attempts were not throttled with a retry interval.');

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

  console.log(`Authentication verified: sign-in, protected cookie, response security headers, account security page, rollback-only password-event/session trigger, viewer reads, clerk return access, manager-only adjustment access, editor/admin denial, role/deactivation session revocation, login throttling, and actor audit attribution${process.env.ACTIVITY_FILTER_CI_TESTS === 'true' ? ' plus activity actor/date/legacy filters' : ''}${ciPasswordChanged ? ', password-change confirmation, event audit and session revocation' : ''}${ciPasswordResetCompleted ? ', administrator reset, forced-change gate, actor audit, and concurrent-login revocation' : ''} passed.`);
} finally {
  if (cookie) {
    try { await fetch(new URL('/logout', appUrl), { method: 'POST', redirect: 'manual', headers: { origin: appUrl, host: new URL(appUrl).host, cookie } }); } catch { /* The session row is also removed directly below. */ }
  }
  const cleanup = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    if (ciResetTargetCreated || !ciMovementCreated) await cleanup.connect();
    if (ciResetTargetCreated) await cleanup.query('DELETE FROM app_users WHERE id = $1::uuid', [resetTargetId]);
    if (!ciMovementCreated) {
      await cleanup.query('DELETE FROM app_users WHERE id = $1::uuid', [userId]);
    }
  } finally {
    await cleanup.end().catch(() => {});
    await pool.end();
    await auditPool.end();
  }
}
