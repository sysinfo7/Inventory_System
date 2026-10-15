const baseUrl = (process.env.PUBLIC_DEMO_TEST_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

async function get(path) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual' });
}

async function redirectsToLogin(response) {
  const destination = response.headers.get('location') || '';
  if ([302, 303, 307, 308].includes(response.status) && destination.includes('/login')) return true;
  // Next can stream a 200 shell before encoding a server-side redirect in its RSC payload.
  const body = await response.text();
  return body.includes('NEXT_REDIRECT;replace;/login;') || body.includes('NEXT_REDIRECT;push;/login;');
}

async function verifyCredentialPostsRequireLogin() {
  for (const [path, body] of [
    ['/users/password-reset', 'userId=00000000-0000-4000-8000-000000000001&temporaryPassword=demo-password&confirmation=demo-password'],
    ['/account/password/change', 'currentPassword=demo-password&newPassword=demo-password-long&confirmation=demo-password-long'],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl },
      body,
    });
    if (!(await redirectsToLogin(response))) {
      throw new Error(`Expected anonymous POST ${path} to redirect to sign-in; received ${response.status}.`);
    }
  }
}

if (process.env.PUBLIC_DEMO_EXPECT_DISABLED === 'true') {
  for (const path of ['/products', '/stock', '/activity', '/suppliers', '/purchase-orders']) {
    const response = await get(path);
    if (!(await redirectsToLogin(response))) {
      throw new Error(`Public mode is off, but anonymous GET ${path} did not redirect to sign-in (received ${response.status}).`);
    }
  }
  await verifyCredentialPostsRequireLogin();
  console.log('Public demo default verified: anonymous inventory reads and credential changes redirect to sign-in when the flag is disabled.');
  process.exit(0);
}

for (const path of ['/', '/products', '/stock', '/activity', '/suppliers', '/purchase-orders']) {
  const response = await get(path);
  if (!response.ok) throw new Error(`Expected anonymous GET ${path} to succeed; received ${response.status}.`);
  const html = await response.text();
  if (html.includes('Employer demo') === false && path !== '/') {
    // The global badge is rendered in the shared navigation for every demo page.
    throw new Error(`The public demo label is missing from ${path}.`);
  }
  if (path === '/' && !html.includes('EMPLOYER DEMO')) {
    throw new Error('The public overview does not identify itself as an employer demo.');
  }
  if (path === '/stock' && (html.includes('RECORD A CHANGE') || html.includes('Record a receipt'))) {
    throw new Error('The anonymous stock page rendered a stock-write control.');
  }
  if (path === '/purchase-orders' && html.includes('Create purchase order')) {
    throw new Error('The anonymous purchase-order page rendered a create control.');
  }
}

for (const path of ['/users', '/permissions', '/account/security', '/products/new', '/products/1/edit', '/purchase-orders/new']) {
  const response = await get(path);
  if (!(await redirectsToLogin(response))) {
    throw new Error(`Expected anonymous GET ${path} to redirect to sign-in; received ${response.status}.`);
  }
}

const suppliers = await get('/suppliers');
const suppliersHtml = await suppliers.text();
if (suppliersHtml.includes('name="contactName"') || suppliersHtml.includes('<th scope="col">Email / phone</th>')) {
  throw new Error('The public supplier view rendered contact-edit or contact-detail fields.');
}

await verifyCredentialPostsRequireLogin();

console.log('Public demo verified: anonymous read pages, protected management routes, hidden supplier contacts, and rejected credential changes passed.');
