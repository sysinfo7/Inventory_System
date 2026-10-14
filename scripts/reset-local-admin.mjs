import pg from 'pg';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function askWindowsPasswords() {
  // PowerShell's secure prompt prevents Windows terminals from echoing secrets.
  // Password values return through a pipe, never through displayed terminal text.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
function Read-SecretValue([string] $PromptText) {
  $secure = Read-Host -Prompt $PromptText -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$password = Read-SecretValue 'Create a unique temporary password (minimum 14 characters)'
$confirmation = Read-SecretValue 'Confirm temporary password'
$first = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))
$second = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($confirmation))
[Console]::Out.Write($first + ':' + $second)
`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('Secure password entry failed. Re-run npm run auth:reset-admin-local in an interactive PowerShell window.');
  }
  const encoded = result.stdout.trim().split(':');
  if (encoded.length !== 2) throw new Error('Secure password entry did not return both values. No account was changed.');
  return encoded.map((value) => Buffer.from(value, 'base64').toString('utf8'));
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error('Local administrator recovery only accepts a loopback database host.');
}

const lookupClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
await lookupClient.connect();
let administrators;
try {
  const result = await lookupClient.query(
    "SELECT lower(trim(email)) AS email FROM app_users WHERE role = 'admin' AND active = true ORDER BY lower(trim(email))",
  );
  administrators = result.rows.map((row) => row.email);
} finally {
  await lookupClient.end();
}
if (!administrators.length) throw new Error('No active administrator accounts were found in the local database.');
stdout.write('Active administrator sign-in email(s):\n');
for (const adminEmail of administrators) stdout.write(`- ${adminEmail}\n`);

const prompt = createInterface({ input: stdin, output: stdout });
let password;
let confirmation;
let email;
try {
  email = (await prompt.question('Enter the administrator email to recover: ')).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('Enter a valid administrator email address.');
  if (!administrators.includes(email)) throw new Error('Choose one of the active administrator emails listed above.');
} finally {
  prompt.close();
}

if (process.platform === 'win32') {
  stdout.write('Password entry is hidden; no characters or dots will appear while you type.\n');
  [password, confirmation] = askWindowsPasswords();
} else {
  const hiddenPrompt = createInterface({ input: stdin, output: stdout });
  hiddenPrompt.stdoutMuted = false;
  hiddenPrompt._writeToOutput = (message) => { if (!hiddenPrompt.stdoutMuted) stdout.write(message); };
  async function askHidden(label) {
    stdout.write(label);
    hiddenPrompt.stdoutMuted = true;
    try { return await hiddenPrompt.question(''); }
    finally { hiddenPrompt.stdoutMuted = false; stdout.write('\n'); }
  }
  try {
    password = await askHidden('Create a unique temporary password (minimum 14 characters): ');
    confirmation = await askHidden('Confirm temporary password: ');
  } finally { hiddenPrompt.close(); }
}

if (password.length < 14 || password.length > 1024) throw new Error('Password must contain 14 to 1024 characters.');
if (password !== confirmation) throw new Error('Passwords did not match. No account was changed; run the command again.');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const account = await client.query(
    "SELECT id FROM app_users WHERE lower(trim(email)) = $1 AND role = 'admin' AND active = true FOR UPDATE",
    [email],
  );
  if (account.rowCount !== 1) throw new Error('No active administrator matches that email address. No account was changed.');

  // The password trigger records a local recovery event and revokes old sessions.
  // The forced-change flag requires the administrator to choose a personal password after sign-in.
  const hash = await hashPassword(password);
  await client.query(
    'UPDATE app_users SET password_hash = $1, password_change_required = true, updated_at = clock_timestamp() WHERE id = $2',
    [hash, account.rows[0].id],
  );
  await client.query('COMMIT');
  console.log('Local administrator recovery completed. Existing sessions were revoked; sign in and replace the temporary password.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
