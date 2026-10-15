import pg from 'pg';

const adminConnectionString = process.env.DATABASE_URL;
const appConnectionString = process.env.APP_DATABASE_URL;
if (!adminConnectionString || !appConnectionString) {
  throw new Error('Set DATABASE_URL and APP_DATABASE_URL in the local .env file first.');
}

const adminUrl = new URL(adminConnectionString);
const appUrl = new URL(appConnectionString);
const appPassword = decodeURIComponent(appUrl.password);
const databaseName = decodeURIComponent(adminUrl.pathname.slice(1));
const remoteProvisioning = process.env.ALLOW_REMOTE_DB_PROVISIONING === 'true';
// Neon role defaults are least-privileged, and its owner cannot set NOSUPERUSER.
// Verify the resulting flags below instead of requesting negative flags explicitly.
const roleAttributes = remoteProvisioning ? '' : ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
if (appUrl.username !== 'inventory_runtime') {
  throw new Error('APP_DATABASE_URL must use the inventory_runtime role name.');
}
if (appPassword === decodeURIComponent(adminUrl.password)) {
  throw new Error('Use a different password for inventory_runtime and the migration/operator login.');
}
if (!/^[a-zA-Z0-9._~-]{32,}$/.test(appPassword)) {
  throw new Error('Use a distinct URL-safe app password with at least 32 characters.');
}
const normalizedHost = (hostname) => hostname.replace(/-pooler(?=\.)/, '');
if (normalizedHost(adminUrl.hostname) !== normalizedHost(appUrl.hostname)
    || (adminUrl.port || '5432') !== (appUrl.port || '5432')
    || decodeURIComponent(appUrl.pathname.slice(1)) !== databaseName) {
  throw new Error('The app and migration URLs must target the same database endpoint and database.');
}
const localHosts = ['localhost', '127.0.0.1', '::1'];
if (localHosts.includes(adminUrl.hostname) || localHosts.includes(appUrl.hostname)) {
  if (remoteProvisioning) throw new Error('Remote provisioning mode cannot target a local database.');
} else {
  const sslRequired = (url) => ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'));
  if (!remoteProvisioning || !adminUrl.hostname.endsWith('.neon.tech') || !appUrl.hostname.endsWith('.neon.tech')) {
    throw new Error('Remote provisioning requires explicit Neon-only opt-in.');
  }
  if (!sslRequired(adminUrl) || !sslRequired(appUrl)) {
    throw new Error('Both Neon connection URLs must require TLS with sslmode=require or stronger.');
  }
}

const client = new pg.Client({ connectionString: adminConnectionString });
try {
  await client.connect();
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'inventory_runtime'");
  if (existing.rowCount === 0) {
    // Let PostgreSQL quote the password as a SQL literal; never build it by concatenation.
    const createRole = await client.query(
      `SELECT format('CREATE ROLE inventory_runtime LOGIN INHERIT CONNECTION LIMIT 5${roleAttributes} PASSWORD %L', $1::text) AS statement`,
      [appPassword],
    );
    await client.query(createRole.rows[0].statement);
  } else {
    const ownedObjects = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class AS object
        JOIN pg_roles AS owner ON owner.oid = object.relowner
        JOIN pg_namespace AS ns ON ns.oid = object.relnamespace
        WHERE owner.rolname = 'inventory_runtime' AND ns.nspname = 'public'
        UNION ALL
        SELECT 1 FROM pg_proc AS object
        JOIN pg_roles AS owner ON owner.oid = object.proowner
        JOIN pg_namespace AS ns ON ns.oid = object.pronamespace
        WHERE owner.rolname = 'inventory_runtime' AND ns.nspname = 'public'
        UNION ALL
        SELECT 1 FROM pg_namespace AS ns
        JOIN pg_roles AS owner ON owner.oid = ns.nspowner
        WHERE owner.rolname = 'inventory_runtime'
        UNION ALL
        SELECT 1 FROM pg_database AS db
        JOIN pg_roles AS owner ON owner.oid = db.datdba
        WHERE owner.rolname = 'inventory_runtime'
      ) AS has_owned_objects
    `);
    if (ownedObjects.rows[0].has_owned_objects) {
      throw new Error('inventory_runtime owns database objects; review ownership before provisioning.');
    }

    const memberships = await client.query(`
      SELECT granted.rolname
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted ON granted.oid = membership.roleid
      JOIN pg_roles AS member ON member.oid = membership.member
      WHERE member.rolname = 'inventory_runtime' AND granted.rolname <> 'inventory_app'
    `);
    if (memberships.rowCount) {
      throw new Error('inventory_runtime has unexpected role memberships; review and remove them before provisioning.');
    }
    const passwordLiteral = await client.query('SELECT quote_literal($1::text) AS literal', [appPassword]);
    await client.query(`ALTER ROLE inventory_runtime LOGIN INHERIT CONNECTION LIMIT 5${roleAttributes} PASSWORD ${passwordLiteral.rows[0].literal}`);
  }
  // Remove any old direct grants so access comes only from the reviewed group role.
  await client.query('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM inventory_runtime');
  await client.query('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM inventory_runtime');
  await client.query('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM inventory_runtime');
  await client.query('REVOKE CREATE ON SCHEMA public FROM inventory_runtime');
  await client.query('GRANT inventory_app TO inventory_runtime');

  const verified = await client.query(`
    SELECT app_role.rolsuper, app_role.rolinherit, app_role.rolconnlimit, app_role.rolcreatedb,
           app_role.rolcreaterole, app_role.rolreplication, app_role.rolbypassrls,
           membership.granted_role
    FROM pg_roles AS app_role
    LEFT JOIN (
      SELECT member.oid AS member_id, granted.rolname AS granted_role
      FROM pg_auth_members AS item
      JOIN pg_roles AS member ON member.oid = item.member
      JOIN pg_roles AS granted ON granted.oid = item.roleid
    ) AS membership ON membership.member_id = app_role.oid
    WHERE app_role.rolname = 'inventory_runtime'
  `);
  const role = verified.rows[0];
  if (!role || role.rolsuper || !role.rolinherit || role.rolconnlimit !== 5
      || role.rolcreatedb || role.rolcreaterole || role.rolreplication
      || role.rolbypassrls || role.granted_role !== 'inventory_app') {
    throw new Error('Runtime role verification failed; inspect inventory_runtime before starting the app.');
  }
  console.log(`Least-privilege inventory_runtime login is provisioned for the ${remoteProvisioning ? 'Neon demo' : 'local'} inventory_app role.`);
} finally {
  await client.end();
}
