import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error('Authentication check cleanup only accepts a local database host.');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  // Remove only fictional users created by the auth verification script.
  const result = await client.query(`
    DELETE FROM app_users
    WHERE display_name = 'Temporary Auth Check'
      AND role = 'viewer'
      AND email ~ '^auth-check-[0-9a-f-]+@inventory-demo[.]invalid$'
  `);
  console.log(`Removed ${result.rowCount} temporary authentication check account(s).`);
} finally {
  await client.end();
}
