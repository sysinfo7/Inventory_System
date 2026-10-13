import pg from 'pg';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
const adminUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(adminUrl.hostname)) throw new Error('Administrator bootstrap only accepts a local database host.');
if (!process.env.APP_DATABASE_URL || !['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.APP_DATABASE_URL).hostname)) throw new Error('APP_DATABASE_URL must target a local database host.');
const prompt = createInterface({ input: stdin, output: stdout });
prompt.stdoutMuted = false;
prompt._writeToOutput = (message) => { if (!prompt.stdoutMuted) stdout.write(message); };
async function askHidden(label) {
  stdout.write(label);
  prompt.stdoutMuted = true;
  try { return await prompt.question(''); }
  finally { prompt.stdoutMuted = false; stdout.write('\n'); }
}
try {
  const existing = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await existing.connect();
  const admin = await existing.query("SELECT 1 FROM app_users WHERE role = 'admin' AND active = true LIMIT 1");
  await existing.end();
  if (admin.rowCount) throw new Error('An active administrator already exists. Use the user-management screen to make account changes.');

  const email = (await prompt.question('Administrator email: ')).trim().toLowerCase();
  const name = (await prompt.question('Display name: ')).trim();
  const password = await askHidden('Create a unique password (minimum 14 characters): ');
  const confirmation = await askHidden('Confirm password: ');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (name.length < 1 || name.length > 120) throw new Error('Display name must contain 1 to 120 characters.');
  if (password.length < 14 || password.length > 1024) throw new Error('Password must contain 14 to 1024 characters.');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    const hash = await hashPassword(password);
    await client.query("INSERT INTO app_users(email, display_name, password_hash, role) VALUES ($1, $2, $3, 'admin')", [email, name, hash]);
    console.log('Administrator account created. Sign in at http://127.0.0.1:3000/login.');
  } finally { await client.end(); }
} finally { prompt.close(); }
