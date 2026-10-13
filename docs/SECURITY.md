# Security and data-integrity notes

## Implemented database controls

- `.env` is ignored by Git; `.env.example` contains placeholders. Docker Compose binds the database port to `127.0.0.1:5433` for local development.
- Next.js development binds to `127.0.0.1`. The catalog route and server action reject production use until authentication exists.
- Schema constraints validate required names, unique product/location/category values, SKU normalization, nonnegative reorder points and prices, allowed movement types, and nonzero movement quantities.
- Migration 002 adds a nonnegative cached balance table. `record_stock_movement` validates reason and movement direction, serializes writes by locking the product/location balance row, rejects a negative result, and updates the balance and movement history in one statement transaction.
- A supplied request UUID is locked and checked for an existing matching movement. Matching retries return the original movement ID; reuse for different movement details fails.
- Triggers reject row updates/deletes on movement history and audit history. Product insert/update and movement insert events create audit-log rows.
- Product insert/update/delete operations remain allowed and are recorded with before/after data where applicable. Migration 002 does not backfill old product or movement rows into the audit log.
- Triggers reject updates/deletes to movement and audit rows and reject `TRUNCATE` on those two history tables during normal operations. Catalog rows are auditable, not immutable. Database owners and administrators can change or bypass these controls.
- Migration 002 revokes `CREATE` on schema `public` from `PUBLIC`. It creates `inventory_app` as `NOLOGIN`, revokes public execution of the stock function, grants limited reads and stock-function execution, and revokes public insert/update/delete/truncate on movement and balance tables. Migration 003 grants the app role execution of `save_product`; it does not grant direct product-table writes.
- The stock and product functions use `SECURITY DEFINER` with a restricted `inventory_function_owner` role that has no login and only the required table/sequence grants. Their fixed path is `pg_catalog, public, pg_temp`, with the temporary schema last. Product form writes pass through the validation function and existing audit triggers.
- `scripts/provision-app-role.mjs` creates or updates a local `inventory_runtime` login, removes elevated role attributes, rejects unexpected memberships, and grants membership only in `inventory_app`. The app uses `APP_DATABASE_URL`; migration tools use the more privileged `DATABASE_URL`.

These are data-integrity controls in the current schema, not proof of a production security posture. The owner reported migration 002 applied; migration 003 and its runtime role still require local application and verification. The migration does not configure a login password, secret manager, TLS, production network policy, deployment role, or access monitoring.

## Authentication and attribution limitations

The app has no authentication or authorization and does not currently call the database stock function. Product catalog routes are intended for local development only; server actions also reject mutations unless `NODE_ENV` is `development`. No untrusted users should have access. Catalog audit requests use a generated request UUID but have no actor identity; the product function clears actor context. The stock function accepts an optional `p_actor_id`, and its caller can still omit or spoof that UUID. Audit entries must not be treated as verified human attribution.

The `inventory_app` role's grants are only one boundary. Database owners and sufficiently privileged roles can alter schema objects, change functions/triggers, or bypass the intended workflow. The movement/audit history triggers guard ordinary row update/delete and truncate operations; they do not make history immutable against owners, superusers, trigger removal, or other administrative actions. Product data can be changed or deleted and the change is logged when the trigger runs. Do not describe this design as the highest, production-ready, tamper-proof, or compliance-grade security.

## Operational gaps

- The current app has a product catalog but no login/session controls or per-user authorization. Catalog editing is enabled only for local development.
- The app role provisioning is local-only. There are no production credentials, secret manager, credential rotation procedure, TLS configuration, or deployment role ownership model.
- There is no rate limiting, user authorization, browser security-header policy, or abuse monitoring. Next.js Server Actions enforce an Origin/Host check for CSRF, but that does not authenticate or authorize a caller.
- The schema does not implement supplier/customer records, sales/payment processing, full financial accounting, valuation, tax, or regulatory controls.
- The local setup credentials and database backups are sensitive. Use fictional demo data and keep `.env` and backups out of source control and screenshots.

Before exposing the app beyond local development, implement authentication and authorization, derive actor identity from the verified session rather than a user-controlled form field, provision a least-privilege login with a secret manager, and have the server call database functions using parameterized SQL. Review function ownership and grants in the actual deployed database. Keep migration backups and verify restore/upgrade procedures before changing important data.

## Inventory history is not financial accounting

`stock_movements` and `inventory_audit_log` record quantity changes and selected catalog events. They do not provide double-entry bookkeeping, inventory valuation, period close, reconciliation, tax calculations, payment handling, or compliance certification. Do not claim those capabilities based on this project.

## Evidence status

The owner reported migration 002 applied successfully. Migration 003, the `inventory_runtime` login, and end-to-end catalog writes still need owner-side setup and verification; this agent cannot connect to PostgreSQL on port `5433`. GitHub Actions success has not been verified. TypeScript and lint checks passed for the catalog implementation; database integration and production security review remain outstanding.
