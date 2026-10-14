# Retail inventory system

A portfolio project for a small retail business to manage products and record stock by location. Built with TypeScript, Next.js 16, and PostgreSQL 17.

**Project version: 1.4.0** — adds authenticated self-service password changes, an append-only password-change event, and database-enforced session revocation.

## Versioning

The project follows Semantic Versioning (`MAJOR.MINOR.PATCH`): increment MAJOR for incompatible changes, MINOR for backward-compatible features, and PATCH for backward-compatible fixes. Changes made before the first stable release use `0.x.y`; `1.0.0` marks the initial feature-complete portfolio release. Keep `package.json` and `package-lock.json` versions in sync, and create a matching Git tag such as `v1.2.3` when publishing each release. Commit hashes identify source revisions but are not release numbers.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Current status

The repository includes a product catalog, location-based stock balances, receipt, return, sale-deduction, and manager-approved count-adjustment workflows, sign-in with persistent rate limiting, role-based permissions, administrator user management, and self-service password changes. Authenticated product and stock changes record their actor in the inventory audit trail; password changes use a separate security event log. Movement history filters by location, type, product/reason, actor, and inclusive UTC date range. Application permission roles are administrator, manager, clerk, and read-only.

Migrations 004–007 seed two fictional locations, three products, and sample stock history. Migrations 008–010 add app users, sessions, authenticated audit attribution, and actor foreign keys; migration 011 adds database-backed login throttling; migrations 012–014 revoke sessions when an account role changes or it is deactivated; migration 015 adds activity-filter indexes; migration 016 logs password changes and revokes sessions. Authenticated users can change their password after confirming their current password. See [SETUP_STATUS.md](SETUP_STATUS.md) for evidence and remaining checks.

The inventory audit trail records product changes and quantity movements. It is not a full financial accounting ledger and does not establish regulatory or accounting compliance.

## Local setup

Requirements: Node.js 24, npm, Git, and Docker Desktop with its Linux engine running. In PowerShell from this repository:

```powershell
Copy-Item .env.example .env
# Use the same local password for DB_PASSWORD and DATABASE_URL; set a different app password.
npm ci
.\scripts\setup-database.ps1
.\scripts\configure-app-url.ps1
npm run db:provision-app
npm run db:verify-stock
npm run dev
```

The app requires sign-in. After `npm run db:migrate` and `npm run db:provision-app`, create your local administrator with `npm run auth:bootstrap`; this asks you to set a private password. Start `npm run dev` in a separate window to use the app or run `npm run auth:verify`. The admin page can create test users with chosen roles; a helper can also create optional random-password test accounts. See [the user manual](docs/USER_MANUAL.md) and [the security notes](docs/SECURITY.md).

The local helper creates a separate 256-bit app password in `.env` without displaying it, and refuses to replace an existing app URL. The web app binds to `127.0.0.1`; do not change it to a public interface. PostgreSQL is published to the local machine at port 5433. Never commit or share `.env` or database backups.

`db:verify-stock` exercises receiving, sale deduction, customer returns, positive and negative adjustments, matching idempotent retry, conflicting request-token rejection, oversell/zero rejection, inactive-product rejection, resulting balance, and blank-actor audit rows. It runs its writes in one transaction and rolls them back. It requires the latest migrations and a working `APP_DATABASE_URL`.

`db:verify-stock-concurrency` runs only in CI against its disposable PostgreSQL service. It submits two simultaneous four-unit sales against five units and verifies that one succeeds, the other is rejected, and the remaining balance is one. The uniquely identified test records stay in that disposable CI database.

## Project documentation

- [Employer database design](docs/EMPLOYER_DATABASE_DESIGN.md): ER diagram, fields, keys, normalization, relationships, transaction and audit flow.
- [Architecture](docs/ARCHITECTURE.md): data model, stock transaction flow, and implementation boundaries.
- [Database operations](docs/DATABASE.md): migrations, database commands, backup, restore, and clean reset.
- [Security](docs/SECURITY.md): implemented safeguards, limitations, and work required before deployment.
- [User manual](docs/USER_MANUAL.md): local product catalog walkthrough, database operations, and screenshot checklist.
- [Requirements](docs/REQUIREMENTS.md): retail scope and initial milestone.
- [UI/UX specification](docs/agents/retail-ui-spec.md): proposed workflows and accessibility criteria.
- [AI collaboration log](docs/AI_COLLABORATION.md): actual agent contributions and verification evidence.
- [Agent roles](docs/agents/TEAM.md): responsibilities, permissions, and handoff rules.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
npm run db:migrate
npm run db:check
npm run db:provision-app
npm run db:verify-stock
npm run auth:verify
```

GitHub Actions runs lint, typecheck, a production build, database migrations, least-privilege app-role provisioning, stock workflow and competing-deduction checks, and an end-to-end authentication/permission check against the built app. Release `v1.3.2` passed on [main](https://github.com/sysinfo7/Inventory_System/actions/runs/38618177582) and [the release tag](https://github.com/sysinfo7/Inventory_System/actions/runs/38618177238).

## Security boundary

The local PostgreSQL port and Next.js development server bind to loopback. The app uses a dedicated `inventory_runtime` login that inherits app-operation grants from the `inventory_app` group; app user permissions are enforced server-side. AI collaboration agents are project contributors, not inventory accounts, and cannot sign in or act as users. Persistent account lockout, password recovery, and production deployment controls remain future work. See [SECURITY.md](docs/SECURITY.md).

## Future work

1. Password recovery, account invitation, and a persistent account lockout policy.
2. A production security review and deployment configuration; keep the verified backup local unless a secure off-checkout destination is chosen.
3. Purchase orders, suppliers, and deployment work after the local portfolio scope is complete.
