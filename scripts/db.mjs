import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  if (process.argv[2] === 'migrate') {
    // Serialize deploys so two app instances cannot apply the same migration at once.
    await client.query('SELECT pg_advisory_lock(736241905)');
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const files = (await readdir(new URL('../db/', import.meta.url)))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
        .sort();
      for (const file of files) {
        const sql = await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const version = file.slice(0, file.indexOf('_'));
        const prior = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
        if (prior.rowCount) {
          if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration ${file} was changed; add a new migration instead.`);
          continue;
        }
        await client.query('BEGIN');
        try {
          // 001 is a legacy self-transactional file; strip its wrappers so the ledger
          // insert and all schema changes commit or roll back together.
          const migrationSql = sql.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
          await client.query(migrationSql);
          await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
          await client.query('COMMIT');
          console.log(`Applied ${file}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      console.log('Database migrations are current.');
    } finally {
      await client.query('SELECT pg_advisory_unlock(736241905)');
    }
  } else {
    const result = await client.query('SELECT current_database() AS database, current_user AS role');
    console.log(`PostgreSQL connection verified (${result.rows[0].database}, role ${result.rows[0].role}).`);
  }
} finally {
  await client.end();
}
