# Security and data-integrity notes

## Implemented database controls

- `.env` is ignored by Git; `.env.example` contains placeholders. Docker Compose binds the database port to `127.0.0.1:5433` for local development.
- Schema constraints validate required names, unique product/location/category values, SKU normalization, nonnegative reorder points and prices, allowed movement types, and nonzero movement quantities.
- Migration 002 adds a nonnegative cached balance table. `record_stock_movement` validates reason and movement direction, serializes writes by locking the product/location balance row, rejects a negative result, and updates the balance and movement history in one statement transaction.
- A supplied request UUID is locked and checked for an existing matching movement. Matching retries return the original movement ID; reuse for different movement details fails.
- Triggers reject row updates/deletes on movement history and audit history. Product insert/update and movement insert events create audit-log rows.
- Product insert/update/delete operations remain allowed and are recorded with before/after data where applicable. Migration 002 does not backfill old product or movement rows into the audit log.
- Triggers reject updates/deletes to movement and audit rows and reject `TRUNCATE` on those two history tables during normal operations. Catalog rows are auditable, not immutable. Database owners and administrators can change or bypass these controls.
- Migration 002 revokes `CREATE` on schema `public` from `PUBLIC`. It creates `inventory_app` as `NOLOGIN`, revokes public execution of the stock function, grants `inventory_app` only `SELECT` on designated catalog/history/view/audit objects and `EXECUTE` on the stock function, and revokes public insert/update/delete/truncate on movement and balance tables.
- The stock function uses `SECURITY DEFINER` with a fixed `search_path` of `pg_catalog, public`.

These are data-integrity controls in the current schema, not proof of a production security posture. Migration 002 remains unapplied in the owner's local database until they rerun `scripts/setup-database.ps1`. `inventory_app` has only select/function grants and needs an operator-provisioned login and membership before use; it does not currently have direct catalog write grants. The migration does not configure a login password, secret manager, TLS, production network policy, deployment role, or access monitoring.

## Authentication and attribution limitations

The app has no authentication or authorization and does not currently call the database stock function. No untrusted users should have access. The function accepts an optional `p_actor_id`, and product-audit triggers read optional `app.actor_id`/`app.request_id` session settings. These identifiers can be null and are caller-controlled. Without authenticated identity propagation, callers can omit or spoof actor UUIDs; audit entries must not be treated as verified human attribution.

The `inventory_app` role's grants are only one boundary. Database owners and sufficiently privileged roles can alter schema objects, change functions/triggers, or bypass the intended workflow. The movement/audit history triggers guard ordinary row update/delete and truncate operations; they do not make history immutable against owners, superusers, trigger removal, or other administrative actions. Product data can be changed or deleted and the change is logged when the trigger runs. Do not describe this design as the highest, production-ready, tamper-proof, or compliance-grade security.

## Operational gaps

- The current app is a landing page and has no login/session controls, authorization checks, or server-side inventory write route.
- The migration creates the database role and grants, but no separate deployment credentials, least-privilege role ownership model, or credential rotation procedure.
- No demonstrated request validation, rate limiting, CSRF strategy, browser security headers, or abuse monitoring exists for a future write UI.
- The schema does not implement supplier/customer records, sales/payment processing, full financial accounting, valuation, tax, or regulatory controls.
- The local setup credentials and database backups are sensitive. Use fictional demo data and keep `.env` and backups out of source control and screenshots.

Before exposing writes, implement authentication and authorization, derive actor identity from the verified session rather than a user-controlled form field, provision a least-privilege login, and have the server call the database function using parameterized SQL. Review function ownership and grants in the actual deployed database. Keep migration backups and test restore/upgrade procedures before changing important data.

## Inventory history is not financial accounting

`stock_movements` and `inventory_audit_log` record quantity changes and selected catalog events. They do not provide double-entry bookkeeping, inventory valuation, period close, reconciliation, tax calculations, payment handling, or compliance certification. Do not claim those capabilities based on this project.

## Evidence status

Migration 002 remains unapplied and requires the owner to apply it locally with `scripts/setup-database.ps1`. This agent could not connect to PostgreSQL on port `5433`. The owner-supplied verification covers the initial setup only; it does not verify the new function, triggers, grants, or upgrade. GitHub Actions success has not been verified, and no new security tests were run for this documentation update.
