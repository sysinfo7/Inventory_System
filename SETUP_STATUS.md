# Setup and verification status

## Environment and project

- The repository uses Node.js 24, npm, Next.js 16.4, TypeScript, PostgreSQL 17, Docker Compose, and `pg`.
- The local PostgreSQL service is configured on loopback port `5433`; the development web server binds to `127.0.0.1`.
- The owner previously reported migrations 001–003 and provisioning of the `inventory_runtime` app login succeeded. Migrations 004 and 005 are pending, and this agent did not independently apply or inspect them in the owner's database.
- Migration 004 inserts `Demo Store` only when no location exists. Migration 005 makes the database stock function reject inactive/missing products while holding a `FOR SHARE` row lock.

## Implemented application behavior

- Product catalog: search, active/inactive filtering, create/edit, and deactivate through the controlled `save_product` function.
- `/stock`: selected-location balances for active products, reorder attention for quantities at or below each product's reorder point, receiving form, and manual sale-deduction form.
- `/activity`: location, movement-type, and name/SKU/reason filters; newest-first signed movement rows, capped at 200 results.
- Stock writes call `record_stock_movement` through `APP_DATABASE_URL`. The function validates active product status, direction, reason, request-token idempotency, and nonnegative balances transactionally. The current route passes a NULL actor UUID.
- Stock routes and actions are available only in local development while authentication is absent. These are quantity records; they do not process payments or create accounting entries.

## Verification evidence

- For this stock workflow, Atlas reports `npm run typecheck`, `npm run lint`, JavaScript syntax checks for the verification script, and `git diff --check` passed locally.
- No production build, database integration run, runtime concurrency check, or screenshot was completed for this workflow.
- `npm run db:verify-stock` is implemented to check receipt, sale deduction, same-token retry, conflicting-token rejection, oversell rejection, inactive-product rejection, resulting balance, and blank-actor audit rows. It executes its test writes in a single transaction and rolls them back. The script has not been run against the owner's database.
- The agent session cannot connect to the owner's PostgreSQL port `5433`; owner-reported setup results are not independent verification of migrations 004/005 or the current stock actions.
- GitHub Actions success has not been verified.

## Owner's next local steps

1. Review/back up any local data that matters, then run `scripts/setup-database.ps1` to apply pending migrations 004 and 005 and check the connection.
2. Run `npm run db:verify-stock` against the configured local `APP_DATABASE_URL`; confirm the script reports success and rollback.
3. Start `npm run dev`, review `/stock` and `/activity` with fictional data, and capture the real screenshots listed in `docs/USER_MANUAL.md`.
4. Push the local changes and verify the GitHub Actions run.

Do not expose the app to untrusted users or enter real customer data while authentication and authorization are absent.
