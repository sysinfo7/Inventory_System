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
- `/stock`: selected-location balances for active products, reorder attention for quantities at or below each product's reorder point, receiving form, and manual sale-deduction form.
- `/activity`: location, movement-type, and name/SKU/reason filters; newest-first signed movement rows, capped at 200 results.
- The overview page stays static and no longer repeats the per-request session database lookup already performed by the navigation header. This keeps the main page from triggering Next.js's uncached-data-during-navigation insight.
- The permissions matrix, user management, and permission-denied pages isolate request-specific account checks behind route-level Suspense boundaries and start request-time data work after `connection()`.
- Stock writes call `record_stock_movement` through `APP_DATABASE_URL`, passing the verified signed-in user's UUID as actor. The function validates active product status, direction, reason, request-token idempotency, and nonnegative balances transactionally.
- Administrator account management can create, activate, and deactivate accounts; users cannot deactivate themselves or the last active administrator. Manager, Clerk, and Read-only test accounts are opt-in and use generated passwords.
- The authentication verifier now removes its temporary user with the local database administrator connection. Run `npm run auth:cleanup-checks` once to remove temporary users left by earlier verifier versions.
- These are quantity records; they do not process payments or create accounting entries. Account lockout and recovery remain future security work.

## Verification evidence

- `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run db:migrate` (initial and repeat), `npm run db:check`, and `npm run db:provision-app` passed after auth implementation.
- `npm run auth:verify` passed against the running localhost app: valid sign-in and HttpOnly/SameSite cookie, viewer reads, editor/user-admin denial, logout revocation, and actor ID in catalog audit. Its temporary test account and audit write were cleaned up/rolled back.
- The browser reported an uncached-data navigation insight from `currentUser()` on the overview page. Removing that duplicate database-backed session lookup cleared the browser insight on the live overview page; typecheck and lint passed after the change.
- The same insight was visible on `/permissions` before request-specific content was placed behind its own Suspense boundary; the live page rendered without the insight afterward. `/users` also rendered normally after its boundary was added. GitHub `main` was confirmed at `c847a9e` after the owner pushed.
- The local Users page revealed temporary accounts from earlier authentication checks; these are isolated by the `auth-check-…@inventory-demo.invalid` naming rule. A local-only cleanup command is available. Its execution from this tool environment was blocked by loopback database access, so the owner must run the command in the project PowerShell terminal.
- The running app displayed eight movements across both locations; the Demo Store activity filter returned four rows. Atlas ran `npm run db:verify-stock`; receipt, sale, retry, oversell, and audit checks passed, and test rows were rolled back.
- A production build was attempted but Turbopack could not create a Windows junction in `.next` (access denied). No concurrent deduction check or screenshot has been completed.
- `npm run db:verify-stock` passed after migration 009 and confirms the movement semantics; its test writes run in a transaction that rolls back. It checks blank actor for its synthetic database-level call; application actions now pass the authenticated user UUID.
- GitHub Actions success has not been verified. The local administrator account has been created; the bootstrap script requires each operator to choose their own private password.

## Owner's next local steps

1. Run `npm run auth:bootstrap` and create your own private administrator password.
2. Sign in at `http://127.0.0.1:3000/login`, then run `npm run auth:seed-test-users` to generate the optional role-test accounts.
3. Test each role as described in `docs/USER_MANUAL.md`, and capture the updated real screenshots.
4. Verify the GitHub Actions run for migrations 008–010.

Keep the app local and use fictional data; account lockout, password recovery, session invalidation on role changes, and production security configuration remain outstanding.
