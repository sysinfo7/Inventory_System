# Setup and verification status

## Environment and project

- The repository uses Node.js 24, npm, Next.js 16.4, TypeScript, PostgreSQL 17, Docker Compose, and `pg`.
- The local PostgreSQL service is configured on loopback port `5433`; the development web server binds to `127.0.0.1`.
- The local database is migrated through 007, and `npm run db:check` confirmed PostgreSQL is reachable as role `inventory`. The owner previously reported provisioning of `inventory_runtime`; Atlas also ran `npm run db:verify-stock` successfully.
- Migrations 004 and 006 seed `Demo Store` and `Demo Outlet`; migration 005 prevents stock movements for inactive/missing products; migration 007 seeds three fictional products and eight audited movements using the database write functions.

## Implemented application behavior

- Product catalog: search, active/inactive filtering, create/edit, and deactivate through the controlled `save_product` function.
- `/stock`: selected-location balances for active products, reorder attention for quantities at or below each product's reorder point, receiving form, and manual sale-deduction form.
- `/activity`: location, movement-type, and name/SKU/reason filters; newest-first signed movement rows, capped at 200 results.
- Stock writes call `record_stock_movement` through `APP_DATABASE_URL`. The function validates active product status, direction, reason, request-token idempotency, and nonnegative balances transactionally. The current route passes a NULL actor UUID.
- Stock routes and actions are available only in local development while authentication is absent. These are quantity records; they do not process payments or create accounting entries.

## Verification evidence

- `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run db:migrate` (twice), and `npm run db:check` passed during the demo-data task.
- The running app displayed eight movements across both locations; the Demo Store activity filter returned four rows. Atlas ran `npm run db:verify-stock`; receipt, sale, retry, oversell, and audit checks passed, and test rows were rolled back.
- A production build was attempted but Turbopack stopped while processing CSS because its child Node.js process exited before connecting. No concurrent deduction check or screenshot has been completed.
- `npm run db:verify-stock` checks receipt, sale deduction, same-token retry, conflicting-token rejection, oversell rejection, inactive-product rejection, resulting balance, and blank-actor audit rows. Its test writes run in a transaction that rolls back. The owner supplied successful output, and Atlas reran it successfully after migration 007.
- GitHub Actions success has not been verified.

## Owner's next local steps

1. Review `/products`, `/stock`, and `/activity` with the fictional demo data, and capture the real screenshots listed in `docs/USER_MANUAL.md`.
2. Verify the GitHub Actions run for migrations 006 and 007.
3. Continue with authentication and authorization before any public deployment.

Do not expose the app to untrusted users or enter real customer data while authentication and authorization are absent.
