# Inventory system

A retail inventory portfolio project using TypeScript, Next.js, PostgreSQL, automated checks, and documented AI collaboration.

## Current status

Development foundation, not a finished inventory application. Includes a starter page, PostgreSQL Compose configuration, initial schema, database scripts, and GitHub Actions checks. Inventory workflows and authentication are planned.

## Run locally

Requirements: Node.js 24, Git, Docker Desktop with the Linux engine running.

```powershell
npm ci
# For a fresh checkout, copy .env.example to .env and replace both password placeholders.
# This workspace already has a generated .env; preserve it.
docker compose up -d --wait
npm run db:migrate
npm run db:check
npm run dev
```

Open http://localhost:3000. Database port: localhost:5433. Credentials are excluded from Git. `docker compose stop` preserves database data.

## Checks

```powershell
npm run lint
npm run typecheck
npm run build
```

GitHub Actions additionally applies the schema and checks PostgreSQL connectivity. The initial schema is repeatable; introduce versioned migrations before changing deployed tables.

## Architecture and milestones

Products have unique SKUs and reorder points. Stock movements reference products and locations; a SQL view computes balances from movement history.

1. Confirm inventory domain, intended users, and acceptance criteria.
2. Implement product catalog, search, and validation.
3. Implement receiving/issuing stock with transactions, nonnegative balances, immutable history, and concurrency tests.
4. Add location balances and reorder alerts.
5. Add authentication, permissions, integration tests, and accessibility checks.
6. Publish a hosted demo, screenshots, architecture decisions, and walkthrough.

This initial schema does not yet enforce nonnegative balances or immutable movement history. Implement those controls before enabling application stock writes.

## AI collaboration

Record substantial AI-assisted changes in docs/AI_COLLABORATION.md: problem, agent contribution, human decisions, checks, and limitations. Claim only work and agent usage that actually occurred.

## GitHub

Local Git repository initialized on main. Creation and first push require the owner's GitHub account, visibility choice, and commit identity. Never commit .env, credentials, or database volumes.

