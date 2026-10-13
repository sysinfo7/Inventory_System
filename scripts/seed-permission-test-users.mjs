import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required.');
const appUrl = new URL(process.env.APP_DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname)) throw new Error('Permission test users can only be created against a local database.');
const prompt = createInterface({ input: stdin, output: stdout });
try {
  const answer = (await prompt.question('Create fictional manager, clerk, and read-only test accounts locally? (type YES): ')).trim();
  if (answer !== 'YES') throw new Error('No test accounts were created.');
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    for (const [role, name] of [['manager', 'Demo Manager'], ['clerk', 'Demo Clerk'], ['viewer', 'Demo Viewer']]) {
      const password = randomBytes(24).toString('base64url');
      const hash = await hashPassword(password);
      const email = `${role}@inventory-demo.invalid`;
      await client.query(`
        INSERT INTO app_users(email, display_name, password_hash, role, active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (lower(trim(email))) DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true
      `, [email, name, hash, role]);
      console.log(`${role}: ${email} / ${password}`);
    }
  } finally { await client.end(); }
} finally { prompt.close(); }
