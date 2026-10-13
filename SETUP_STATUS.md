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
- Stock writes call `record_stock_movement` through `APP_DATABASE_URL`, passing the verified signed-in user's UUID as actor. The function validates active product status, direction, reason, request-token idempotency, and nonnegative balances transactionally.
- Administrator account management can create, activate, and deactivate accounts; users cannot deactivate themselves or the last active administrator. Manager, Clerk, and Read-only test accounts are opt-in and use generated passwords.
- These are quantity records; they do not process payments or create accounting entries. Account lockout and recovery remain future security work.

## Verification evidence

- `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run db:migrate` (initial and repeat), `npm run db:check`, and `npm run db:provision-app` passed after auth implementation.
- `npm run auth:verify` passed against the running localhost app: valid sign-in and HttpOnly/SameSite cookie, viewer reads, editor/user-admin denial, logout revocation, and actor ID in catalog audit. Its temporary test account and audit write were cleaned up/rolled back.
- The running app displayed eight movements across both locations; the Demo Store activity filter returned four rows. Atlas ran `npm run db:verify-stock`; receipt, sale, retry, oversell, and audit checks passed, and test rows were rolled back.
- A production build was attempted but Turbopack could not create a Windows junction in `.next` (access denied). No concurrent deduction check or screenshot has been completed.
- `npm run db:verify-stock` passed after migration 009 and confirms the movement semantics; its test writes run in a transaction that rolls back. It checks blank actor for its synthetic database-level call; application actions now pass the authenticated user UUID.
- GitHub Actions success has not been verified. The real administrator account has not yet been created; the bootstrap command requires the owner to choose their private password.

## Owner's next local steps

1. Run `npm run auth:bootstrap` and create your own private administrator password.
2. Sign in at `http://127.0.0.1:3000/login`, then run `npm run auth:seed-test-users` to generate the optional role-test accounts.
3. Test each role as described in `docs/USER_MANUAL.md`, and capture the updated real screenshots.
4. Verify the GitHub Actions run for migrations 008–010.

Keep the app local and use fictional data; account lockout, password recovery, session invalidation on role changes, and production security configuration remain outstanding.
