# Database setup and operations

These instructions cover the local PostgreSQL 17 development database. The web app includes a product catalog, stock workflow, movement activity, authentication, and role checks. Migrations 008–010 add application identities/sessions, authenticated audit attribution, and actor foreign keys. Do not use these local-development steps as production deployment instructions.

For an employer-facing field/key diagram and explanation of the relational model, see [EMPLOYER_DATABASE_DESIGN.md](EMPLOYER_DATABASE_DESIGN.md).

## Requirements and configuration

Install Node.js 24, npm, and Docker Desktop with its Linux engine running. In the repository root, copy `.env.example` to `.env`, set the migration password for `DATABASE_URL` and Docker, and set a different long URL-safe password for `APP_DATABASE_URL`. `.env` is ignored by Git; never commit or share it. The Compose configuration publishes PostgreSQL at `localhost:5433` and stores data in the `inventory_data` volume.

```powershell
Copy-Item .env.example .env
# Edit .env locally. DATABASE_URL and DB_PASSWORD match; APP_DATABASE_URL has a distinct password.
npm ci
```

## Apply or upgrade the schema

The package exposes these commands:

```powershell
npm run db:migrate
npm run db:check
```

`db:migrate` discovers numbered SQL files under `db/`, in filename order. It obtains PostgreSQL advisory lock `736241905` so migration runs serialize, creates `schema_migrations` if needed, and records each migration version with its SHA-256 checksum and applied time. Each SQL file and its ledger insert run in a transaction. If an already-applied file has changed, the runner stops and asks for a new migration instead. The runner has no automatic down/rollback command. `db:check` prints the connected database and database role; it does not verify all schema objects or application behavior.

The current migration files are:

| File | Purpose |
| --- | --- |
| `db/001_initial.sql` | Products, locations, movement history, the original movement-sum balance view, and an index. |
| `db/002_inventory_controls.sql` | Categories and product catalog fields; cached stock balances; typed, append-only movements; audit log and triggers; serialized stock function; and database-role grants. |
| `db/003_product_catalog_writes.sql` | A validated security-definer product save function, least-privilege function owner, and grant to the application role. |
| `db/004_seed_demo_location.sql` | Inserts `Demo Store` only when no location exists; preserves all existing configured locations. |
| `db/005_restrict_stock_movement_products.sql` | Updates the stock function to require an active product while holding a `FOR SHARE` lock, preventing a concurrent deactivation from racing with a new movement. |
| `db/006_seed_demo_outlet.sql` | Ensures `Demo Store` and `Demo Outlet` exist, including when migration 004 skipped `Demo Store` for a preconfigured database; preserves operator-configured locations. |
| `db/007_seed_demo_inventory.sql` | Creates three fictional retail products and eight receiving/sale movements through audited database functions when equivalent records are absent. |
| `db/008_authentication_permissions.sql` | Adds application users and revocable hashed-token sessions plus runtime grants. |
| `db/009_authenticated_audit.sql` | Adds the verified-actor overload of the product save function while preserving migration seeding compatibility. |
| `db/010_authenticated_actor_foreign_keys.sql` | Enforces that non-null product and movement audit actors reference an application user. |

For an existing checkout/database, the local upgrade wrapper starts PostgreSQL if needed, applies any unapplied migrations, and checks the connection:

```powershell
.\scripts\setup-database.ps1
```

This applies pending numbered migrations and checks the connection. Migrations through 010 and the connection have been verified in the local database. The wrapper does not back up the database before applying changes; make a backup first if the data matters.

## Provision the application login

`DATABASE_URL` is the local migration/operator credential. Do not use it in application code. The web app reads only `APP_DATABASE_URL`, whose `inventory_runtime` login inherits the limited privileges in `inventory_app`. Generate and save a separate 256-bit URL-safe password in `.env`, then provision the role:

```powershell
.\scripts\configure-app-url.ps1
npm run db:provision-app
```

The URL helper stores the random credential in `.env` without displaying it and refuses to replace an existing app URL. The provisioning command connects with `DATABASE_URL`, verifies both URLs target the same loopback database, provisions `inventory_runtime`, clears elevated role attributes and direct grants, checks for unexpected inherited memberships and owned objects, and grants only membership in `inventory_app`. It does not print either password. It requires migration 002 to have created the group role. If a pre-existing `inventory_runtime` role has other memberships or owns database objects, it stops so an operator can review them.

## Relationships and integrity rules

- `categories` has a unique nonblank name and a case-insensitive unique index over the trimmed name. A product may optionally reference a category.
- `products` has unique nonblank SKU, name, reorder point, optional nonnegative sale price, and active status. A case-insensitive unique index prevents duplicates whose SKU differs only in case or surrounding whitespace.
- `locations` has a unique nonblank name.
- `stock_movements` references one product and one location. It stores a signed nonzero bigint delta, movement type, reason, optional actor/request UUIDs, optional unit price, and event timestamp. Movement types are `receiving`, `sale`, `return`, and `adjustment`; receiving/return quantities must be positive and sale quantities negative when written through the function.
- `inventory_stock` has one row per product/location pair and a nonnegative cached quantity. Migration 002 initializes rows from the old movement sums and aborts if any legacy balance is negative.
- Migration 004 seeds `Demo Store` only if the `locations` table is empty; migration 006 ensures both demo locations exist if either is missing.
- Migration 007 seeds three fictional retail products and eight receiving/sale entries across both locations. It preserves matching demo records, uses the audited `save_product` and `record_stock_movement` functions, and records no verified actor identity.
- `stock_balances` is a view over `inventory_stock`. The `record_stock_movement` function requires an active product (migration 005 locks that product `FOR SHARE`), locks the balance row, rejects a negative result, updates the cached quantity, and inserts the movement atomically. It supports request UUID idempotency.
- `save_product` is the controlled catalog create/edit/deactivate path. It validates fields and writes product rows so the audit trigger captures before/after data. The application role has no direct product-table write grant.
- `inventory_function_owner` is a no-login role used to own the security-definer stock, product, and audit routines. It receives only the table and sequence privileges those routines need; its temporary schema `CREATE` grant is revoked in the migration.
- Product insert/update/delete operations remain allowed and are recorded in `inventory_audit_log` with before/after row data when applicable. Migration 002 does not backfill pre-existing product or movement rows into the audit log; it captures events from trigger installation onward.
- Triggers reject updates/deletes to movement and audit rows and reject `TRUNCATE` on both tables for normal operations. Product catalog rows themselves are not immutable. Database owners/superusers can bypass or change these controls.
- Migration 002 revokes `CREATE` on schema `public` from `PUBLIC`. It creates `inventory_app` as `NOLOGIN` and grants it limited reads plus stock-function execution; migration 003 adds product-function execution. It does not grant direct table writes. `inventory_runtime` is a separate local login provisioned by `npm run db:provision-app` and inherits the group role.
- Migration 008 adds `app_users` and `app_sessions`; the application stores salted scrypt hashes and only a SHA-256 digest of the opaque browser session token. Roles are checked in trusted server code. Migration 009 lets the actor-aware catalog writer pass the authenticated user UUID to the audit trigger while preserving the legacy seeding signature. Migration 010 makes non-null movement and audit actor IDs reference a real app user.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the entity diagram and stock transaction flow, and [SECURITY.md](SECURITY.md) for limits on the actor and database-role boundaries.

## Verify the stock workflow

After migrations are current and `APP_DATABASE_URL` points to the provisioned local `inventory_runtime` login, run:

```powershell
npm run db:verify-stock
```

The script checks receiving, sale deduction, identical-token retry, conflicting-token rejection, oversell rejection, inactive-product rejection, the resulting balance, and audit rows for its synthetic database-only movements. It creates a temporary product and movement rows inside one explicit transaction and rolls the transaction back on success, so it leaves no test data behind. If an assertion fails, it also attempts rollback before exiting. The owner reported a successful run. GitHub Actions also runs a separate concurrency check against its disposable database; that workflow has not yet produced a verified passing run.

The concurrency script is intentionally CI-only and rejects execution unless `CI=true`. It creates a uniquely named product with five units in the disposable GitHub Actions PostgreSQL service, submits two simultaneous four-unit sales on separate connections, and verifies that one succeeds while the other receives an insufficient-stock error. Its fixture remains in the disposable CI database for the duration of that job.

## Back up the local database

This PowerShell example writes a timestamped PostgreSQL custom-format dump without sending binary data through the PowerShell pipeline:

```powershell
New-Item -ItemType Directory -Force -Path .\backups | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$containerDump = "/tmp/inventory-$stamp.dump"
$hostDump = ".\backups\inventory-$stamp.dump"
docker compose exec -T db pg_dump -U inventory -d inventory -Fc -f $containerDump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
docker compose cp "db:$containerDump" $hostDump
if ($LASTEXITCODE -ne 0) { throw 'Copying the backup from the container failed.' }
docker compose exec -T db rm -f $containerDump
Write-Host "Backup written to $hostDump"
```

Backups can contain sensitive business data. Store them outside source control, restrict access, and verify a backup by restoring it to a separate database. The command uses the local Compose database and default `inventory` role.

## Restore and verify in a separate database

This restores to a new database named `inventory_restore_check`, leaving `inventory` untouched. If that target name already exists, choose a different fresh name rather than dropping it.

```powershell
$dump = '.\backups\inventory-YYYYMMDD-HHMMSS.dump' # Set this to the dump to verify.
$containerDump = '/tmp/inventory-restore-check.dump'
docker compose cp $dump "db:$containerDump"
if ($LASTEXITCODE -ne 0) { throw 'Copying the backup into the container failed.' }
docker compose exec -T db createdb -U inventory inventory_restore_check
if ($LASTEXITCODE -ne 0) { throw 'Could not create the fresh restore-check database.' }
docker compose exec -T db pg_restore -U inventory -d inventory_restore_check --no-owner --no-privileges $containerDump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. Preserve both the source database and dump while investigating.' }
docker compose exec -T db psql -U inventory -d inventory_restore_check -c '\dt'
```

Only after the restored database has been reviewed and is no longer needed, remove that temporary database:

```powershell
docker compose exec -T db dropdb -U inventory inventory_restore_check
```

Do not restore with `--clean` over a database that contains data you need. Restore to a fresh database, verify it, and plan any cutover separately.

## Clean local reset (destructive)

The following sequence permanently removes the local Compose database volume. It is included as a documented development reset procedure and was not executed during documentation work. First make and verify a backup if anything in the database might be needed. Stop any app process connected to the database. Confirm that this is the intended local development checkout before executing:

```powershell
docker compose down -v
docker compose up -d --wait
npm run db:migrate
npm run db:check
```

`docker compose down -v` deletes the named `inventory_data` volume. It cannot be undone through the normal Compose workflow. Do not run it against data you need. The reset recreates an empty database and reapplies migrations 001–010. Those migrations recreate both demo locations, three fictional products, and eight initial movements. Run `npm run db:provision-app` and `npm run auth:bootstrap` afterward to recreate the local app login and administrator. The sample records are fictional and their history starts over on reset.

## Verification status

Migrations through 010 were applied to the local database. `npm run db:check`, `npm run db:provision-app`, `npm run db:verify-stock`, and the temporary-account `npm run auth:verify` passed. The local administrator and optional role test accounts are set up. GitHub Actions success, production build (blocked by Windows Turbopack child-process permissions in this environment), backup, restore, and clean reset remain unverified. Older auth-verification runs may leave temporary accounts because the least-privilege app role cannot delete users; `npm run auth:cleanup-checks` removes only those generated test accounts using the local database administrator URL.
