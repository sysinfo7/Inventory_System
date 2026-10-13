# Database setup and operations

These instructions cover the local PostgreSQL 17 development database. The database has schema support for catalog and stock-control operations, but the current web page does not yet provide those workflows. Do not use these development steps as production deployment instructions.

## Requirements and configuration

Install Node.js 24, npm, and Docker Desktop with its Linux engine running. In the repository root, copy `.env.example` to `.env` and replace both password placeholders with the same long random local-development value. `.env` is ignored by Git; never commit or share it. The Compose configuration publishes PostgreSQL at `localhost:5433` and stores data in the `inventory_data` volume.

```powershell
Copy-Item .env.example .env
# Edit .env locally; both password values must match.
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

For an existing checkout/database, the local upgrade wrapper starts PostgreSQL if needed, applies any unapplied migrations, and checks the connection:

```powershell
.\scripts\setup-database.ps1
```

The owner must run this wrapper in a normal PowerShell terminal to upgrade their local database. This agent session cannot access the owner's PostgreSQL port `5433`, so migration 002 has not been applied or verified here. The wrapper does not back up the database before applying changes; make a backup first if the data matters.

## Relationships and integrity rules

- `categories` has a unique nonblank name and a case-insensitive unique index over the trimmed name. A product may optionally reference a category.
- `products` has unique nonblank SKU, name, reorder point, optional nonnegative sale price, and active status. A case-insensitive unique index prevents duplicates whose SKU differs only in case or surrounding whitespace.
- `locations` has a unique nonblank name.
- `stock_movements` references one product and one location. It stores a signed nonzero bigint delta, movement type, reason, optional actor/request UUIDs, optional unit price, and event timestamp. Movement types are `receiving`, `sale`, `return`, and `adjustment`; receiving/return quantities must be positive and sale quantities negative when written through the function.
- `inventory_stock` has one row per product/location pair and a nonnegative cached quantity. Migration 002 initializes rows from the old movement sums and aborts if any legacy balance is negative.
- `stock_balances` is a view over `inventory_stock`. The `record_stock_movement` function locks the balance row, rejects a negative result, updates the cached quantity, and inserts the movement atomically. It supports request UUID idempotency.
- Product insert/update/delete operations remain allowed and are recorded in `inventory_audit_log` with before/after row data when applicable. Migration 002 does not backfill pre-existing product or movement rows into the audit log; it captures events from trigger installation onward.
- Triggers reject updates/deletes to movement and audit rows and reject `TRUNCATE` on both tables for normal operations. Product catalog rows themselves are not immutable. Database owners/superusers can bypass or change these controls.
- Migration 002 revokes `CREATE` on schema `public` from `PUBLIC`. It creates `inventory_app` as `NOLOGIN` and grants it only `SELECT` on catalog/history/view/audit objects plus `EXECUTE` on `record_stock_movement`. It does not grant catalog write operations directly. A database operator must deliberately provision a login and group membership before that role can be used.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the entity diagram and stock transaction flow, and [SECURITY.md](SECURITY.md) for limits on the actor and database-role boundaries.

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

`docker compose down -v` deletes the named `inventory_data` volume. It cannot be undone through the normal Compose workflow. Do not run it against data you need. The reset recreates an empty database and reapplies migrations 001 and 002; it does not add demo products or stock.

## Verification status

The owner previously supplied output for a successful initial PostgreSQL setup in an external PowerShell session. Migration 002 remains unapplied and the current schema upgrade still requires the owner to rerun `scripts/setup-database.ps1`; this agent could not reach port `5433`. GitHub Actions success is not verified. No backup, restore, clean reset, or migration command was executed while preparing this guide.
