# Setup and verification status

## Environment and project

- The repository uses Node.js 24, npm, Next.js 16.4, TypeScript, PostgreSQL 17, Docker Compose, and `pg`.
- The local PostgreSQL service is configured on loopback port `5433`; the development web server binds to `127.0.0.1`.
- Database migrations 001-010 are applied locally. `npm run db:check`, `npm run db:provision-app`, and repeat `npm run db:migrate` passed after the authentication changes.
- Migrations 004 and 006 seed `Demo Store` and `Demo Outlet`; migration 005 prevents stock movements for inactive/missing products; migration 007 seeds three fictional products and eight audited movements using the database write functions.

## Implemented application behavior

- Application sign-in uses database-backed app users, salted scrypt password hashes, opaque hashed server sessions, and server-enforced Administrator, Manager, Clerk, and Read-only roles. New product and stock writes use the authenticated account as audit actor. Migrations 008-010 add the account/session schema, actor-aware product write function, and actor foreign keys.
- Initial administrator and optional random-password test accounts are created by local-only, documented scripts; test accounts are opt-in.

- Product catalog: search, active/inactive filtering, create/edit, and deactivate through the controlled `save_product` function.
- `/stock`: selected-location balances for active products, reorder attention, receiving and customer-return forms for stock clerks, sale deductions, and manager/administrator count adjustments.
- `/activity`: location, movement-type, and name/SKU/reason filters; newest-first signed movement rows, capped at 200 results.
- The overview page stays static and no longer repeats the per-request session database lookup already performed by the navigation header. This keeps the main page from triggering Next.js's uncached-data-during-navigation insight.
- The permissions matrix, user management, and permission-denied pages isolate request-specific account checks behind route-level Suspense boundaries and start request-time data work after `connection()`.
- Stock writes call `record_stock_movement` through `APP_DATABASE_URL`, passing the verified signed-in user's UUID as actor. The function validates active product status, direction, reason, request-token idempotency, and nonnegative balances transactionally.
- Customer returns are positive inventory movements available through the stock-receiving permission. Count adjustments require a reason and explicit add/remove direction; only managers and administrators have `stock:adjust`.
- Administrator account management can create, activate, and deactivate accounts; users cannot deactivate themselves or the last active administrator. Manager, Clerk, and Read-only test accounts are opt-in and use generated passwords.
- The authentication verifier now removes its temporary user with the local database administrator connection. Run `npm run auth:cleanup-checks` once to remove temporary users left by earlier verifier versions.
- These are quantity records; they do not process payments or create accounting entries. Account lockout and recovery remain future security work.

## Verification evidence

- `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run db:migrate` (initial and repeat), `npm run db:check`, and `npm run db:provision-app` passed after auth implementation.
- `npm run auth:verify` passed against the running localhost app: valid sign-in and HttpOnly/SameSite cookie, viewer reads, editor/user-admin denial, logout revocation, and actor ID in catalog audit. Its temporary test account and audit write were cleaned up/rolled back.
- The browser reported an uncached-data navigation insight from `currentUser()` on the overview page. Removing that duplicate database-backed session lookup cleared the browser insight on the live overview page; typecheck and lint passed after the change.
- The same insight was visible on `/permissions` before request-specific content was placed behind its own Suspense boundary; the live page rendered without the insight afterward. `/users` also rendered normally after its boundary was added. GitHub `main` was confirmed at `c847a9e` after the owner pushed.
- The local Users page revealed temporary accounts from earlier authentication checks; these are isolated by the `auth-check-…@inventory-demo.invalid` naming rule. The owner later reported cleaning the generated accounts. If needed, `npm run auth:cleanup-checks` removes only that exact test-account pattern using the local database administrator URL.
- The running app displayed eight movements across both locations; the Demo Store activity filter returned four rows. Atlas ran `npm run db:verify-stock`; receipt, sale, retry, oversell, and audit checks passed, and test rows were rolled back.
- A production build was attempted again but Turbopack's CSS worker child process exited before connecting to its parent. The production build passed on GitHub Actions; the Windows-specific build issue remains unresolved. Screenshots of the overview, catalog, product form and validation, stock balances and operations, activity history, and permissions are saved in `docs/screenshots/` and embedded in the user manual. No local concurrent-deduction run has been completed.
- GitHub Actions passed all workflow steps for release commit `a9fb6c6a395b44d21138dd748e5446c1f379c5dc`, including lint, typecheck, production build, migrations, least-privilege role provisioning, stock workflow checks, competing deductions, server startup, and authentication/permission smoke tests. The `main` push passed in [run 38491097632](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097632); the `v1.0.0` tag push passed in [run 38491097851](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097851).
- The CI-only concurrency verifier submits two overlapping four-unit sales against a five-unit test balance and expects one accepted movement, one insufficient-stock rejection, and a final balance of one. It leaves its uniquely named fixture only in GitHub Actions' disposable database; it refuses to run unless `CI=true`.
- `npm run db:verify-stock` passed after migration 009 and confirms the movement semantics; its test writes run in a transaction that rolls back. It checks blank actor for its synthetic database-level call; application actions now pass the authenticated user UUID.
- `npm run db:verify-stock` passed after being expanded to cover returns, positive/negative count adjustments, zero and oversell rejection, and all related audit events; its test transaction rolled back. `npm run auth:verify` passed sign-in/session checks, clerk return access, manager-only adjustment visibility, viewer restrictions, logout, and actor audit attribution.
- `npm run typecheck`, `npm run lint`, `node --check scripts/verify-stock-workflow.mjs`, `node --check scripts/verify-auth-workflow.mjs`, and `git diff --check` passed after the current changes.
- The local administrator account has been created and the owner has confirmed signing in. The bootstrap script requires each operator to choose their own private password.

## Owner's next local steps

1. Optionally capture a narrow mobile viewport and a successful stock-write confirmation for the user manual.
2. Keep the verified local database dump in the ignored `backups/` directory, and store a second copy in a secure location outside this checkout.
3. Consider a clean reset rehearsal only when you are ready to discard and recreate the local demo database.

Keep the app local and use fictional data; account lockout, password recovery, session invalidation on role changes, and production security configuration remain outstanding.
