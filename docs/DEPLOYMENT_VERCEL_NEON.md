# Public employer demo deployment: Vercel + Neon

This guide deploys the Next.js app to Vercel and a separate PostgreSQL database to Neon. It is for a portfolio demonstration with fictional records only, not business or production inventory. `PUBLIC_DEMO_MODE=true` publishes selected catalog, stock, activity, supplier-name, and submitted/received purchase-order rows without sign-in. The app blocks anonymous writes, but every row returned by those read pages is public.

The database migrations seed two fictional locations, three products, stock activity, an inactive synthetic audit actor, a fictional supplier, one completed order with a linked receipt, and one submitted order. Do not import the local database or its backup. Keep the local Docker database private.

## 1. Create a dedicated Neon project

1. Create a new Neon project named `inventory-system-employer-demo`. Use the project’s empty default database or create a fresh empty database for the demo. Do not point this setup at an existing project containing personal or business data.
2. In Neon, copy the **direct** connection string for the database owner. Keep it private; it is used only from this computer to apply migrations and create the runtime role.
3. Generate a separate runtime password in PowerShell from the repository folder:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Copy the output somewhere private. It is URL-safe and will not appear in the shell command history.
4. Copy Neon's **pooled** connection string, then change its username to `inventory_runtime` and its password to the generated runtime password. Keep the `-pooler` host and `sslmode=require` query option. Use the same database name as the direct URL.
5. Create the local, ignored connection file and edit it:

   ```powershell
   notepad .env.neon-demo
   ```

   Add these two lines with your own connection values. Do not paste them into chat or commit this file:

   ```dotenv
   DATABASE_URL=postgresql://OWNER:OWNER_PASSWORD@ep-example.region.aws.neon.tech/neondb?sslmode=require
   APP_DATABASE_URL=postgresql://inventory_runtime:YOUR_GENERATED_PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```

   `.env.neon-demo` is ignored by Git. The preparation command verifies that both URLs target the same Neon project/database, use TLS, and use the pooled endpoint for app traffic. It refuses local and non-Neon hosts, and it refuses to initialize a nonempty database without this project's migration ledger.

## 2. Initialize and verify the demo database

From the repository folder, run:

```powershell
npm run db:prepare:neon-demo
```

The command applies migrations through 022, creates or refreshes the constrained `inventory_runtime` login, and connects with that runtime credential to verify the fictional catalog, two locations, supplier, sample orders, and absence of active accounts. The owner URL never needs to be stored in Vercel. Once successful, remove `.env.neon-demo` or keep it in a secure password manager for future maintenance; never upload or commit it.

## 3. Import the GitHub project into Vercel

1. Sign in to Vercel and choose **Add New → Project**.
2. Import `sysinfo7/Inventory_System` from GitHub.
3. Keep the detected Next.js framework, repository root, build command, and output settings.
4. Add these server-side environment variables for both **Production** and **Preview** deployments:

   | Name | Value |
   | --- | --- |
   | `APP_DATABASE_URL` | The Neon pooled URL for `inventory_runtime` from `.env.neon-demo` |
   | `PUBLIC_DEMO_MODE` | `true` |

   Do not set `DATABASE_URL` in Vercel. Do not prefix either variable with `NEXT_PUBLIC_`; credentials must remain server-side. Preview URLs will expose the same fictional read-only dataset, so keep this database fictional-only too.
5. Deploy. Vercel will provide an HTTPS `vercel.app` URL and build new deployments when `main` changes.

## 4. Check the live demo

Open the Vercel URL in a private browser window and confirm that the home page, `/products`, `/stock`, `/activity`, `/suppliers`, and `/purchase-orders` load without signing in. Open one completed and one submitted order. Confirm supplier contact details and staff names are hidden, drafts/cancelled orders are absent, and no mutation controls appear for anonymous visitors. The local CI workflow separately tests that write and account-changing requests remain blocked in public mode.

If a deployment fails, check Vercel's build/runtime logs for missing `APP_DATABASE_URL`, then confirm it is the pooled Neon connection string, its role is `inventory_runtime`, and its password matches the one used by the preparation command. Never print or share the full URL while troubleshooting.

## Cost and limits

Neon's Free plan is currently $0 and includes 100 CU-hours and 1 GB of database storage per project; free compute sleeps after inactivity, so the first visit after a quiet period can be slower. Vercel Hobby is intended for personal projects and includes monthly usage allowances. Check each provider's current plan terms before relying on the demo for a time-sensitive interview or converting it to real business use.

- [Neon plans and current usage allowances](https://neon.com/docs/introduction/plans)
- [Neon pooled connections](https://neon.com/docs/connect/connection-pooling)
- [Vercel Next.js deployment](https://vercel.com/docs/frameworks/full-stack/nextjs)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

## Security boundary

This hosted demo is public by design. It is not a production inventory service and must contain no private supplier details, customer records, real credentials, or operational data. The owner/migration credential stays off Vercel; the deployed app uses the separate `inventory_runtime` credential, which inherits reviewed application permissions. Public-mode authorization is enforced in server routes and actions, with CI coverage for anonymous reads and write denial. Keep the runtime password secret and rotate it if it is exposed. Before any real operational use, disable public mode, complete an independent production security review, add production-grade monitoring/rate limiting, establish backup/restore procedures, and review credential/role rotation.
