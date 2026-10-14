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

These are data-integrity controls in the current schema, not proof of a production security posture. Migrations through 016, `inventory_runtime` provisioning, and stock/auth smoke checks passed locally. The migrations do not configure production credentials, a secret manager, TLS, production network policy, deployment role, or access monitoring.

## Application authentication and permissions

Migrations 008-010 add application users with roles (`admin`, `manager`, `clerk`, `viewer`), revocable eight-hour sessions, normalized unique email addresses, salted scrypt password hashes, actor-aware catalog writes, and actor foreign keys. Login uses a cryptographically random opaque cookie; only its SHA-256 digest is stored in PostgreSQL. The cookie is HttpOnly, SameSite=Lax, scoped to `/`, and Secure in production. Sign-out revokes the database session. Passwords use timing-safe comparison; unknown users follow a dummy scrypt path.

Migration 014 installs a database trigger that deletes every session for an account when its role changes or it is deactivated. The trigger runs under the restricted `inventory_function_owner` role, which can delete sessions using the `user_id` column but cannot read session tokens or expiration data. This also prevents an old session from becoming valid again after account reactivation.

Users can change their own password at `/account/security` after confirming the current password. The endpoint checks the same-origin `Origin` and `Host`, limits password length, requires at least 14 characters, verifies the old scrypt hash, and uses a compare-and-update condition to avoid overwriting a concurrent password change. Before the expensive hash check it reserves an attempt in the existing database-backed email/client throttle and follows the same trusted-proxy address rules as sign-in. A successful change clears the account/client attempt bucket within the password transaction. Migration 016 runs a restricted trigger on every password-hash change: it appends a timestamped `password_changed` event with only the subject UUID, then revokes all sessions. The runtime role cannot query or mutate the security-event table directly. Event rows reject ordinary update, delete, and truncate operations; the table retains subject UUIDs without email or credential data. This is a small authentication security log, separate from the inventory quantity/accounting history.

Every inventory page and Server Action checks a permission using the database-resolved current session. UI hiding is only a convenience; direct page/action requests are checked too. Roles:

| Role | Catalog | Stock | Activity | User administration |
| --- | --- | --- | --- | --- |
| Administrator | View and edit | View, receive, return, deduct sale, adjust count | View | Reserved for account management |
| Manager | View and edit | View, receive, return, deduct sale, adjust count | View | No |
| Clerk | View | View, receive, return, deduct sale | View | No |
| Read-only | View | View | View | No |

Demo-only accounts are created only after explicit local opt-in using `npm run auth:seed-test-users`; generated one-time passwords print in the local terminal and only password hashes are stored. The runtime app login has broad app-operation DB grants, so application roles are enforced in trusted server code. Direct use of the DB credential bypasses app roles. The current database setup is local-only.

Migration 011 adds persistent login throttling: at most eight attempts per 15-minute window for an HMAC-keyed normalized email/client pair and 100 per client address. Each attempt is reserved atomically before password hashing; a successful login clears only the email/client bucket. Bucket keys are HMAC digests keyed with the app database connection secret; raw email and IP values are not stored. Expired rows become eligible for deletion after one day and are pruned in bounded batches during subsequent login attempts. The runtime role cannot read or write the limiter table directly; it can execute only the narrow reserve and clear functions. This temporary throttle does not permanently lock an account. Local mode uses one shared `local` client identity. If deployed behind a trusted proxy, set `AUTH_TRUST_PROXY_HEADERS=true` only when the proxy strips caller-supplied values and writes a valid `X-Forwarded-For` address; otherwise requests with an untrusted or missing address are rejected.

Password recovery, invitation flow, and persistent account lockout remain to be built.

Global responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a strict-origin referrer policy, a restrictive browser `Permissions-Policy`, disable DNS prefetch, and omit the `X-Powered-By` framework banner. The authentication smoke check asserts the security headers on the credential endpoint. A Content Security Policy and HSTS are not configured: CSP needs a deliberate nonce-compatible Next.js design, and HSTS should only be enabled with a confirmed HTTPS deployment. The current local HTTP app therefore does not claim transport security.

Stock actions derive `actor_id` from the database-validated session and pass it to `record_stock_movement`; catalog writes pass the same verified UUID to `save_product`. Actor IDs join to `app_users` for display in activity. Previous seed movements retain NULL actors and display as legacy entries.

The `inventory_app` role's grants are only one boundary. Database owners and sufficiently privileged roles can alter schema objects, change functions/triggers, or bypass the intended workflow. The movement/audit history triggers guard ordinary row update/delete and truncate operations; they do not make history immutable against owners, superusers, trigger removal, or other administrative actions. Product data can be changed or deleted and the change is logged when the trigger runs. Do not describe this design as the highest, production-ready, tamper-proof, or compliance-grade security.

## Operational gaps

- Do not use the local bootstrap/test-account tooling on non-local databases; scripts enforce a local host or development mode.
- The app role provisioning is local-only. There are no production credentials, secret manager, credential rotation procedure, TLS configuration, or deployment role ownership model.
- Persistent account lockout and abuse monitoring are not implemented. Login throttling is an app-level control and is not a substitute for a production edge rate limiter. Next.js Server Actions enforce an Origin/Host check for CSRF, but that does not authenticate or authorize a caller.
- The schema does not implement supplier/customer records, sales/payment processing, full financial accounting, valuation, tax, or regulatory controls.
- The local setup credentials and database backups are sensitive. Use fictional demo data and keep `.env` and backups out of source control and screenshots.

Before public deployment, add an edge-level rate limiter and account lockout policy, review password recovery, configure a secret manager/TLS/network policy, and complete an independent production security review. Review function ownership and grants in the deployed database. Keep migration backups and verify restore/upgrade procedures before changing important data.

## Inventory history is not financial accounting

`stock_movements` and `inventory_audit_log` record quantity changes and selected catalog events. They do not provide double-entry bookkeeping, inventory valuation, period close, reconciliation, tax calculations, payment handling, or compliance certification. Do not claim those capabilities based on this project.

## Evidence status

Migrations through 016, the local PostgreSQL connection, application-role provisioning, expanded `npm run db:verify-stock`, and `npm run auth:verify` have been verified. The `v1.4.0` CI workflow passed password-change confirmation, rejection paths, password rotation, security-event recording, session revocation, production build, database migration, stock workflow, and concurrency checks in its disposable database on [main](https://github.com/sysinfo7/Inventory_System/actions/runs/38636338783) and [the release tag](https://github.com/sysinfo7/Inventory_System/actions/runs/38636340456). A local npm audit found no advisories in production dependencies. The full audit reports the same high-severity `braces@3.0.3` advisory through `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`; it is confined to development tooling, and GitHub's advisory currently lists no patched release. The application itself does not use `braces` at runtime. After upgrading Next.js and `eslint-config-next` to 16.4.1, lint, typecheck, and the production dependency audit pass locally. The owner has confirmed the real administrator can sign in. The local backup was restored and verified in a separate database; a second off-checkout backup copy and production security review remain outstanding.
