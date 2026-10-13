import pg from 'pg';
import { readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  if (process.argv[2] === 'migrate') {
    await client.query(await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8'));
    console.log('Initial schema is ready.');
  } else {
    await client.query('SELECT 1');
    console.log('PostgreSQL connection verified.');
  }
} finally {
  await client.end();
}
