# Retail inventory system

A portfolio project for a small retail business to manage products and record stock by location. Built with TypeScript, Next.js 16, and PostgreSQL 17.

## Current status

The repository includes a working local product catalog and PostgreSQL foundations for stock balances, inventory movements, and audit events. The catalog supports search, add, edit, and deactivate, with product changes written through a restricted database function and recorded by the audit trigger. Stock receiving/sales screens and authentication remain future work.

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
npm run dev
```

The local helper creates a separate 256-bit app password in `.env` without displaying it, and refuses to replace an existing app URL. The web app binds to `127.0.0.1`; do not change it to a public interface. PostgreSQL is published to the local machine at port 5433. Never commit or share `.env` or database backups.

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
```

GitHub Actions is configured to run code checks and migration commands. CI success has not yet been verified for the current migrations.

## Security boundary

The local PostgreSQL port and Next.js development server bind to loopback. Product reads and writes are local-demo only; writes are disabled in production builds. The app uses a dedicated `inventory_runtime` login that inherits limited grants from the `inventory_app` group. Authentication is not implemented, so do not expose the server to untrusted users or use real customer data. Actor UUIDs remain unverified. See [SECURITY.md](docs/SECURITY.md).

## Planned first features

1. Stock receiving and sale deductions through the database transaction function.
2. Movement history, location balances, and low-stock alerts.
3. Authentication, role permissions, accessibility review, and stronger CI coverage before deployment.
