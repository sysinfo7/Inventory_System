# Retail inventory system

A portfolio project for a small retail business to manage products and record stock by location. Built with TypeScript, Next.js 16, and PostgreSQL 17.

## Current status

The repository includes the Next.js project page and database foundations for a product catalog, stock balances, inventory movements, and audit events. The web app does not yet expose product editing or stock workflows. Migration 002 has not been applied to the owner's database from this environment.

The inventory audit trail records product changes and quantity movements. It is not a full financial accounting ledger and does not establish regulatory or accounting compliance.

## Local setup

Requirements: Node.js 24, npm, Git, and Docker Desktop with its Linux engine running. In PowerShell from this repository:

```powershell
Copy-Item .env.example .env
# Set the same long, unique development password for both password placeholders in .env.
npm ci
.\scripts\setup-database.ps1
npm run dev
```

Open http://localhost:3000. PostgreSQL is published to the local machine at port 5433. Never commit or share `.env` or database backups.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md): data model, stock transaction flow, and implementation boundaries.
- [Database operations](docs/DATABASE.md): migrations, database commands, backup, restore, and clean reset.
- [Security](docs/SECURITY.md): implemented safeguards, limitations, and work required before deployment.
- [User manual](docs/USER_MANUAL.md): current page and database operations; application screenshots await browser access.
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
```

GitHub Actions is configured to run code checks and migration commands. CI success has not yet been verified for the current migrations.

## Security boundary

The local PostgreSQL port binds to loopback. The app has no authentication and must not be exposed to untrusted users or deployed with real customer data. The application role is a `NOLOGIN` group role with limited read/function grants; a trusted operator must provision a separate runtime login. Actor UUIDs are optional and caller-controlled until authenticated identity is implemented. See [SECURITY.md](docs/SECURITY.md).

## Planned first features

1. Product catalog with unique SKU, category, sale price, and reorder point.
2. Stock receiving and sale deductions through the database transaction function.
3. Movement and audit views, location balances, and low-stock alerts.
4. Authentication, role permissions, accessibility, and stronger CI coverage before deployment.
