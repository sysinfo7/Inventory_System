# AI collaboration log

## Initial setup

Human request: prepare an inventory portfolio project and GitHub workflow.

Agent contribution: inspect tools; scaffold TypeScript/Next.js; configure PostgreSQL, initial SQL, database scripts, and CI; document milestones.

Human decisions: retail products; GitHub account sysinfo7; supplied commit identity. Public repository approved: sysinfo7/Inventory_System. Pending: GitHub access.

Validation: see SETUP_STATUS.md. The named project agents contributed to this milestone as recorded below.

Remaining work: inventory workflows, database concurrency tests, authentication, and deployment.



Database verification: owner ran the setup script in external PowerShell; supplied output confirms healthy PostgreSQL container, successful schema application, and successful connection check. Agent did not independently rerun the database checks.



## Named agent team and database foundation milestone

At the owner's explicit request, Atlas (the coordinating chat) initialized Forge (development), Sentinel (testing/review), Iris (UI/UX), and Sage (documentation) with gpt-6-luna and low reasoning. Their durable role boundaries are in `docs/agents/TEAM.md`.

For the database-foundation milestone, Forge implemented migration 002 and the checksum-based migration runner; Iris wrote the retail workflow and accessible UI specification; Sage prepared the architecture, database, security, and user guides; Sentinel statically reviewed the SQL dependency/order changes. Atlas integrated the work and reconciled documentation with the schema. The owner later reported that migration 002 applied successfully.

Validation evidence at that milestone: Forge ran `node --check scripts/db.mjs` and `git diff --check`; Sentinel performed a read-only SQL review. No migration, automated application tests, backup, restore, or destructive reset ran during that milestone. The agent session could not connect to the owner's local PostgreSQL port. No actual screenshots could be captured because the browser preview could not reach the running app; see `docs/USER_MANUAL.md` for the outstanding capture list.

Durable instructions: `docs/agents/TEAM.md`. Runtime task names in this session: `/root/forge`, `/root/sentinel`, `/root/iris`, `/root/sage`. Runtime agents are session-scoped; recreate from the saved role definitions when necessary. The owner authorizes direct lead-worker coordination for this project. No recurring runs were scheduled.

## Product catalog milestone

Atlas implemented the first catalog UI and server-side data path: search/filter/list, add/edit product form, inactive status, server-side validation, parameterized SQL, least-privilege runtime-role provisioning, a security-definer product save function, and audit-trigger integration. The existing UI/UX specification was used for empty/error states, required fields, accessible labels, and keeping stock changes separate from catalog edits.

At the time of the catalog-milestone report, validation performed locally included `npm run typecheck`, `npm run lint`, JavaScript syntax checks, PowerShell script parsing, `.env` ignore check, and `git diff --check`. A Turbopack production build failed when its child process exited; a Webpack build failed with EPERM while creating `.next` output, so no production build was confirmed for that change. Runtime database behavior was then unverified. The owner subsequently reported migration 003 and the dedicated `inventory_runtime` login succeeded. No screenshots were captured because the browser preview could not reach the local app. The catalog is restricted to local development until authentication is implemented.

## Stock workflow milestone

Iris provided stock workflow interaction recommendations. Forge implemented the `/stock` page, receiving and manual sale-deduction forms, stock server actions/data reads, and `/activity` filters/list. Atlas authored migration 004 (seed `Demo Store` only when there are no locations), migration 005 (reject movement writes for inactive/missing products while holding a `FOR SHARE` product lock), and `scripts/verify-stock-workflow.mjs`. Atlas also corrected the verification query after review. Sentinel statically reviewed the SQL and application paths and reported no actionable defects after the read-permission correction. Sage updated the project documentation.

Owner-supplied status: migrations 003 and the `inventory_runtime` provisioning were previously reported successful. Migrations 004 and 005 remain pending and were not independently applied in this agent environment. Atlas reports `npm run typecheck`, `npm run lint`, verification-script syntax checks, and `git diff --check` passed locally. No database integration run, production build, runtime concurrency check, or screenshots were completed for this milestone. The rollback-only `npm run db:verify-stock` script has not been run against the owner's database. The app actions pass `NULL` for actor ID and are development-only while authentication is absent.

## Next.js prerendering issue

The owner reported a Next.js “uncached data during prerendering” error on `/activity`. With Cache Components enabled, the route's request-time `connection()` call was outside a Suspense boundary. The same pattern existed on `/stock`, so both pages now render their data-backed content below page-specific loading fallbacks. Browser verification showed both routes render normally after the change. This follows [Next.js guidance for uncached data during prerendering](https://nextjs.org/docs/messages/blocking-prerender-dynamic).

Validation: `npm run typecheck`, `npm run lint`, and `git diff --check` passed. A production build was attempted, but Turbopack stopped while processing CSS because its child Node.js process exited before connecting; this environment error prevented build validation.

## Two-location demo data

At the owner's request, Atlas added migration 006 to ensure `Demo Store` and `Demo Outlet` exist even when migration 004 skipped `Demo Store` due to preconfigured locations, and migration 007 for three fictional retail products and eight initial movements. Migration 007 uses `save_product` and `record_stock_movement`, and preserves matching existing records. Atlas applied migrations 006/007 to the local database; after clarifying migration 006's behavior, only those unpublished seed-migration ledger entries were reopened and reapplied, and a subsequent migration run was a no-op. The database connection check passed. The app catalog was populated and the eight sample movements were entered through the UI before migration 007 was applied; the migration detected and retained those matching rows. Activity showed eight rows across both locations, and filtering to Demo Store showed four rows. `npm run db:verify-stock` passed and rolled back its test rows.

The sample balance is 10 coffee and 13 trail-mix units at Demo Outlet, plus 7 coffee and 8 water-bottle units at Demo Store. Product creation and stock movement trigger audit events; actor identity remains blank because authentication is not implemented. `npm run db:verify-stock`, `npm run typecheck`, `npm run lint`, and `git diff --check` passed. A production build was attempted but Turbopack exited while starting its CSS-processing child Node.js process, so the build remains unverified. No clean database reset or runtime concurrency test was run.

## Authentication and permissions milestone

Atlas implemented migrations 008-010 for app users/sessions, actor-aware catalog writes, and actor foreign keys; database-backed sign-in with scrypt password hashes and opaque session tokens; server-enforced Administrator, Manager, Clerk, and Read-only roles; an access matrix; Administrator user creation/deactivation; and actor display on activity rows. Codex project agents remain collaboration roles and cannot sign into or impersonate application users. The personal administrator bootstrap prompts the owner for a private password; demo-role accounts are optional.


## CI and concurrency coverage milestone

Atlas expanded `.github/workflows/ci.yml` to provision the disposable CI database's least-privilege runtime login, run the stock workflow verifier, start the production build, and exercise sign-in, cookie protections, read-only permissions, forbidden writes, logout revocation, and audit actor attribution against the running application. Atlas added `scripts/verify-stock-concurrency.mjs`, which uses two independent PostgreSQL connections to compete for the same five-unit balance and requires exactly one four-unit sale to succeed. This script refuses to run unless `CI=true`, and leaves its uniquely named fixture only in the ephemeral GitHub Actions database.

The owner pushed commit `835c6b6`, and GitHub Actions run #10 passed the workflow, including the production build, database integration, authentication and permission checks, and competing-deduction test ([run details](https://github.com/sysinfo7/Inventory_System/actions/runs/38481389156)). The local `npm run build` still fails because Turbopack's CSS worker process exits before connecting in this Windows environment. Earlier local checks `npm run typecheck`, `npm run lint`, `node --check scripts/verify-stock-concurrency.mjs`, and `git diff --check` passed before the push.

## Returns and controlled count adjustments milestone

Atlas added customer-return and inventory-adjustment forms to `/stock`. Returns add sellable units and use the existing receiving permission. Count corrections require a signed direction and explanation, and the new `stock:adjust` permission is granted only to Managers and Administrators. The server action still checks permission directly, and all writes pass through `record_stock_movement` so balance locking, nonnegative stock, request idempotency, and audit actor attribution continue to apply.

Atlas expanded `scripts/verify-stock-workflow.mjs` with rollback-only checks for returns, positive and negative adjustments, zero rejection, negative-balance rejection, final balance, and audit events. `scripts/verify-auth-workflow.mjs` now checks that a Clerk can record returns but cannot see count adjustment controls, while a Manager can. `npm run db:verify-stock`, `npm run auth:verify`, `npm run typecheck`, and `npm run lint` all passed after the code changes. The Windows production build continues to stop when Turbopack's CSS worker exits before connecting. These changes need a fresh CI run after they are pushed.

## Browser security and login throttling milestone

Atlas added global response headers for content-type sniffing, framing, referrer privacy, unused browser permissions, DNS prefetch, and framework-banner suppression. Migration 011 adds atomic PostgreSQL login throttling using expiring HMAC digest buckets: eight attempts per email/client pair and 100 per client per 15 minutes. Migration 014 revokes all sessions when an account role changes or it is deactivated, using only a column-level read grant for `user_id`. The runtime app role can only invoke the limiter functions and cannot access the limiter table. The auth verifier checks throttling, response headers, least-privilege grants, role-change revocation, deactivation, and reactivation. Local migrations, auth and stock workflows, lint, and type checks passed. Release `v1.1.0` passed CI on both main and tag; `v1.2.0` hosted CI awaits publication. Account lockout, password recovery, a production edge limiter, trusted-proxy setup, and broader production security review remain outstanding.

## Administrator-managed password reset milestone

At the owner's selection, Atlas added local administrator-managed password reset. An administrator sets a temporary credential for a different active account; the app records the acting administrator and affected subject, revokes all of the subject's sessions in the password-change trigger, and requires a new password before protected pages or actions work. Login verifies the password and creates a session while holding the account row lock, closing the race where an old password could otherwise create a session during reset. Migrations 017–018 add the forced-change flag, actor-attributed reset event and classification for seed-generated temporary credentials. New accounts also receive the forced-change requirement.

Iris reviewed the reset interface and recommended explicit temporary-password confirmation, clear sharing guidance, and an accessible required-change notice. Sentinel reviewed the access and concurrency boundaries and recommended the verified server-session actor, deterministic row-lock order, and forced-change gate across pages and actions. Atlas integrated those checks into `scripts/verify-auth-workflow.mjs`, including manager denial, same-origin enforcement, self-reset denial, event attribution, session revocation, temporary-password replacement, and a concurrent login/reset test that runs only against the disposable CI database. The local migrations and standard auth verifier passed. GitHub Actions passed lint, typecheck, production build, migrations, stock checks, and the complete authentication/reset concurrency workflow on main commit `eba62e7` ([run 38640141612](https://github.com/sysinfo7/Inventory_System/actions/runs/38640141612)). The local Windows sandbox still blocks Turbopack from creating a junction under `.next`; release-tag verification remains pending.
