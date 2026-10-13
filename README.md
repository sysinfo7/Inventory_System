# Retail inventory system

A portfolio project for a small retail business to manage products and record stock by location. Built with TypeScript, Next.js 16, and PostgreSQL 17.

## Current status

The repository includes a local product catalog, stock-on-hand page, and movement activity page. The catalog supports search, add, edit, and deactivate. The stock page shows active product balances and reorder attention for a selected location, and provides receiving and manual sale-deduction forms. The activity page filters and lists signed movement rows. These app routes and writes are local-development only while authentication is absent; the current app passes a null actor ID.

Migrations 004 and 005 add a default `Demo Store` only when the database has no locations and enforce active-product status inside the stock function. The owner reported migration 003 and runtime-role provisioning succeeded; migrations 004/005 remain pending and were not independently applied here. The web workflows are implemented in code, but database integration remains unverified until the owner upgrades the local database and runs `npm run db:verify-stock`.

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

The local helper creates a separate 256-bit app password in `.env` without displaying it, and refuses to replace an existing app URL. The web app binds to `127.0.0.1`; do not change it to a public interface. PostgreSQL is published to the local machine at port 5433. Never commit or share `.env` or database backups.

`db:verify-stock` exercises receiving, sale deduction, matching idempotent retry, conflicting request-token rejection, oversell rejection, inactive-product rejection, resulting balance, and blank-actor audit rows. It runs its writes in one transaction and rolls them back. It requires the latest migrations and a working `APP_DATABASE_URL`; it has not been run against the owner's database.

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
```

GitHub Actions is configured to run code checks and migration commands. CI success has not yet been verified for the current migrations. Local `typecheck`, `lint`, verification-script syntax, and `git diff --check` passed for the stock workflow; production build, database integration, concurrency runtime behavior, and screenshots remain unverified.

## Security boundary

The local PostgreSQL port and Next.js development server bind to loopback. Catalog and stock reads/writes are local-demo only; routes/actions are disabled outside development. The app uses a dedicated `inventory_runtime` login that inherits limited grants from the `inventory_app` group. Authentication is not implemented, so do not expose the server to untrusted users or use real customer data. The stock action passes NULL actor IDs; activity cannot identify a human user. See [SECURITY.md](docs/SECURITY.md).

## Planned first features

1. Returns, adjustments, and their business rules/user flows.
2. Authentication, role permissions, verified actor identity, and deployment controls.
3. Integration/runtime concurrency coverage and CI verification before deployment.
