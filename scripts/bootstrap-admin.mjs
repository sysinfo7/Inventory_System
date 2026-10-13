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
function askWindowsPasswords() {
  // PowerShell's secure prompt prevents Windows terminals from echoing secrets.
  // The values cross back to this process through a pipe, never the terminal.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
function Read-SecretValue([string] $PromptText) {
  $secure = Read-Host -Prompt $PromptText -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$password = Read-SecretValue 'Create a unique password (minimum 14 characters)'
$confirmation = Read-SecretValue 'Confirm password'
$first = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($password))
$second = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($confirmation))
[Console]::Out.Write($first + ':' + $second)
`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('Secure password entry failed. Re-run npm run auth:bootstrap in an interactive PowerShell window.');
  }
  const encoded = result.stdout.trim().split(':');
  if (encoded.length !== 2) throw new Error('Secure password entry did not return both values. No account was created.');
  return encoded.map((value) => Buffer.from(value, 'base64').toString('utf8'));
}
try {
  const existing = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await existing.connect();
  const admin = await existing.query("SELECT 1 FROM app_users WHERE role = 'admin' AND active = true LIMIT 1");
  await existing.end();
  if (admin.rowCount) throw new Error('An active administrator already exists. Use the user-management screen to make account changes.');

  const email = (await prompt.question('Administrator email: ')).trim().toLowerCase();
  const name = (await prompt.question('Display name: ')).trim();
  let password;
  let confirmation;
  if (process.platform === 'win32') {
    prompt.close();
    stdout.write('Password entry is hidden; no characters or dots will appear while you type.\n');
    [password, confirmation] = askWindowsPasswords();
  } else {
    password = await askHidden('Create a unique password (minimum 14 characters): ');
    confirmation = await askHidden('Confirm password: ');
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  if (name.length < 1 || name.length > 120) throw new Error('Display name must contain 1 to 120 characters.');
  if (password.length < 14 || password.length > 1024) throw new Error('Password must contain 14 to 1024 characters.');
  if (password !== confirmation) throw new Error('Passwords did not match. No account was created. Run npm run auth:bootstrap again and enter the same value at both hidden password prompts.');

  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  try {
    const hash = await hashPassword(password);
    await client.query("INSERT INTO app_users(email, display_name, password_hash, role) VALUES ($1, $2, $3, 'admin')", [email, name, hash]);
    console.log('Administrator account created. Sign in at http://127.0.0.1:3000/login.');
  } finally { await client.end(); }
} finally { prompt.close(); }
