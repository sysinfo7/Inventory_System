import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const neonDatabase = new URL(process.env.DATABASE_URL).hostname.endsWith('.neon.tech');
const migrationFiles = (await readdir(new URL('../db/', import.meta.url)))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name));

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
      const files = [...migrationFiles].sort();
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
          let migrationSql = sql.replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
          if (neonDatabase) {
            // Neon owners are not PostgreSQL superusers, so Neon rejects even
            // explicit NOSUPERUSER clauses. These negative role flags are the
            // PostgreSQL defaults; leaving them out preserves least privilege.
            migrationSql = migrationSql.replace(/\bNO(?:SUPERUSER|CREATEDB|CREATEROLE|REPLICATION|BYPASSRLS)\b/gi, '');
            if (file === '003_product_catalog_writes.sql') {
              // The Neon project owner can create the restricted routine-owner
              // role, but must be a member of it to transfer function ownership.
              // Grant only that membership; the role itself remains NOLOGIN and
              // receives only the explicit table and schema privileges below.
              migrationSql = migrationSql.replace(
                /ALTER ROLE inventory_function_owner NOLOGIN NOINHERIT\s*;/i,
                (statement) => `${statement}\nDO $$ BEGIN EXECUTE format('GRANT inventory_function_owner TO %I', current_user); END $$;`,
              );
            }
            // Subsequent migrations create SECURITY DEFINER functions and then
            // transfer them to this NOLOGIN role. PostgreSQL requires the new
            // owner to have CREATE on the containing schema during transfer.
            // Grant it only for this migration transaction and revoke before
            // recording the migration as complete.
            if (Number(version) > 3) {
              await client.query('GRANT CREATE ON SCHEMA public TO inventory_function_owner');
            }
          }
          await client.query(migrationSql);
          if (neonDatabase && Number(version) > 3) {
            await client.query('REVOKE CREATE ON SCHEMA public FROM inventory_function_owner');
          }
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
