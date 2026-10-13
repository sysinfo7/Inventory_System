# Security and data-integrity notes

## Implemented database controls

- `.env` is ignored by Git; `.env.example` contains placeholders. Docker Compose binds the database port to `127.0.0.1:5433` for local development.
- Next.js development binds to `127.0.0.1`. Inventory routes and actions require a database-backed login and role permission.
- Schema constraints validate required names, unique product/location/category values, SKU normalization, nonnegative reorder points and prices, allowed movement types, and nonzero movement quantities.
- Migration 002 adds a nonnegative cached balance table. `record_stock_movement` validates reason and movement direction, serializes writes by locking the product/location balance row, rejects a negative result, and updates the balance and movement history in one statement transaction.
- Migration 005 additionally locks the product row `FOR SHARE` and rejects new movements for missing or inactive products, preventing a simultaneous deactivation from racing with a movement.
- A supplied request UUID is locked and checked for an existing matching movement. Matching retries return the original movement ID; reuse for different movement details fails.
- Triggers reject row updates/deletes on movement history and audit history. Product insert/update and movement insert events create audit-log rows.
- Product insert/update/delete operations remain allowed and are recorded with before/after data where applicable. Migration 002 does not backfill old product or movement rows into the audit log.
- Triggers reject updates/deletes to movement and audit rows and reject `TRUNCATE` on those two history tables during normal operations. Catalog rows are auditable, not immutable. Database owners and administrators can change or bypass these controls.
- Migration 002 revokes `CREATE` on schema `public` from `PUBLIC`. It creates `inventory_app` as `NOLOGIN`, revokes public execution of the stock function, grants limited reads and stock-function execution, and revokes public insert/update/delete/truncate on movement and balance tables. Migration 003 grants the app role execution of `save_product`; it does not grant direct product-table writes.
- The stock and product functions use `SECURITY DEFINER` with a restricted `inventory_function_owner` role that has no login and only the required table/sequence grants. Their fixed path is `pg_catalog, public, pg_temp`, with the temporary schema last. Product form writes pass through the validation function and existing audit triggers.
- `scripts/provision-app-role.mjs` creates or updates a local `inventory_runtime` login, removes elevated role attributes, rejects unexpected memberships, and grants membership only in `inventory_app`. The app uses `APP_DATABASE_URL`; migration tools use the more privileged `DATABASE_URL`.

These are data-integrity controls in the current schema, not proof of a production security posture. Migrations through 010, `inventory_runtime` provisioning, and stock/auth smoke checks passed locally. The migrations do not configure production credentials, a secret manager, TLS, production network policy, deployment role, or access monitoring.

## Application authentication and permissions

Migrations 008-010 add application users with roles (`admin`, `manager`, `clerk`, `viewer`), revocable eight-hour sessions, normalized unique email addresses, salted scrypt password hashes, actor-aware catalog writes, and actor foreign keys. Login uses a cryptographically random opaque cookie; only its SHA-256 digest is stored in PostgreSQL. The cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure in production. Sign-out revokes the database session. Passwords use timing-safe comparison; unknown users follow a dummy scrypt path.

Every inventory page and Server Action checks a permission using the database-resolved current session. UI hiding is only a convenience; direct page/action requests are checked too. Roles:

| Role | Catalog | Stock | Activity | User administration |
| --- | --- | --- | --- | --- |
| Administrator | View and edit | View, receive, return, deduct sale, adjust count | View | Reserved for account management |
| Manager | View and edit | View, receive, return, deduct sale, adjust count | View | No |
| Clerk | View | View, receive, return, deduct sale | View | No |
| Read-only | View | View | View | No |

Demo-only accounts are created only after explicit local opt-in using `npm run auth:seed-test-users`; generated one-time passwords print in the local terminal and only password hashes are stored. The runtime app login has broad app-operation DB grants, so application roles are enforced in trusted server code. Direct use of the DB credential bypasses app roles. The current database setup is local-only. Account lockout/rate limits, password recovery, invitation flow, session revocation after role change, and self-service password changes remain to be built.

Stock actions derive `actor_id` from the database-validated session and pass it to `record_stock_movement`; catalog writes pass the same verified UUID to `save_product`. Actor IDs join to `app_users` for display in activity. Previous seed movements retain NULL actors and display as legacy entries.

The `inventory_app` role's grants are only one boundary. Database owners and sufficiently privileged roles can alter schema objects, change functions/triggers, or bypass the intended workflow. The movement/audit history triggers guard ordinary row update/delete and truncate operations; they do not make history immutable against owners, superusers, trigger removal, or other administrative actions. Product data can be changed or deleted and the change is logged when the trigger runs. Do not describe this design as the highest, production-ready, tamper-proof, or compliance-grade security.

## Operational gaps

- Do not use the local bootstrap/test-account tooling on non-local databases; scripts enforce a local host or development mode.
- The app role provisioning is local-only. There are no production credentials, secret manager, credential rotation procedure, TLS configuration, or deployment role ownership model.
- There is no rate limiting, user authorization, browser security-header policy, or abuse monitoring. Next.js Server Actions enforce an Origin/Host check for CSRF, but that does not authenticate or authorize a caller.
- The schema does not implement supplier/customer records, sales/payment processing, full financial accounting, valuation, tax, or regulatory controls.
- The local setup credentials and database backups are sensitive. Use fictional demo data and keep `.env` and backups out of source control and screenshots.

Before public deployment, add rate limiting and account lockout, review password recovery, ensure role changes revoke existing sessions, configure a secret manager/TLS/network policy, and complete an independent production security review. Review function ownership and grants in the deployed database. Keep migration backups and verify restore/upgrade procedures before changing important data.

## Inventory history is not financial accounting

`stock_movements` and `inventory_audit_log` record quantity changes and selected catalog events. They do not provide double-entry bookkeeping, inventory valuation, period close, reconciliation, tax calculations, payment handling, or compliance certification. Do not claim those capabilities based on this project.

## Evidence status

Migrations through 010, the local PostgreSQL connection, application-role provisioning, expanded `npm run db:verify-stock`, and `npm run auth:verify` have been verified. The expanded checks passed locally for returns, count adjustments, clerk/manager permission boundaries, and audit attribution. GitHub Actions run #10 passed the earlier hosted concurrency and authentication checks, along with the production build ([run details](https://github.com/sysinfo7/Inventory_System/actions/runs/38481389156)); a fresh run is needed for the latest changes. The owner has confirmed the real administrator can sign in. A backup/restore rehearsal and production security review remain outstanding.
